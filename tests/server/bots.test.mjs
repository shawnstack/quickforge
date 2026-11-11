import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  BOT_MEMORY_FILE,
  BOT_STORE,
  inspectBotWork,
  nextHeartbeatAt,
  normalizeBotName,
  normalizeBotRecord,
} from '../../server/bots.mjs'
import { stores } from '../../server/storage.mjs'

describe('bots store registration', () => {
  it('registers the bots store so the generic storage route can reach it', () => {
    expect(stores.has(BOT_STORE)).toBe(true)
    expect(BOT_STORE).toBe('bots')
  })
})

describe('normalizeBotName', () => {
  it('keeps ordinary names, including CJK and spaces', () => {
    expect(normalizeBotName('小助手')).toBe('小助手')
    expect(normalizeBotName('  helper  ')).toBe('helper')
    expect(normalizeBotName('note taker')).toBe('note taker')
  })

  it('rejects path-hostile characters (kept as a guard even though names no longer become folder names)', () => {
    expect(() => normalizeBotName('')).toThrow()
    expect(() => normalizeBotName('   ')).toThrow()
    expect(() => normalizeBotName('a/b')).toThrow()
    expect(() => normalizeBotName('a\\b')).toThrow()
    expect(() => normalizeBotName('.hidden')).toThrow()
    expect(() => normalizeBotName('a:b')).toThrow()
    expect(() => normalizeBotName('x'.repeat(41))).toThrow()
  })
})

describe('normalizeBotRecord', () => {
  it('applies defaults: quickforge-api skill on, heartbeat on, full access', () => {
    const bot = normalizeBotRecord({ name: 'helper' })
    expect(bot.id).toEqual(expect.any(String))
    expect(bot.name).toBe('helper')
    // 技能不归 bot 管：会话的技能来自全局与项目配置，所以记录里不该有这个字段。
    expect(bot).not.toHaveProperty('skills')
    expect(bot.heartbeat.enabled).toBe(true)
    expect(bot.heartbeat.intervalMinutes).toBe(60)
    expect(bot.accessMode).toBe('full-access')
    expect(bot.memoryFile.endsWith(BOT_MEMORY_FILE)).toBe(true)
    expect(bot.sessionId).toBeNull()
  })

  it('keeps identity and workspace stable across patches', () => {
    const first = normalizeBotRecord({ name: 'helper' })
    const second = normalizeBotRecord({ ...first, thinkingLevel: 'high' }, first)
    expect(second.id).toBe(first.id)
    expect(second.workspacePath).toBe(first.workspacePath)
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.thinkingLevel).toBe('high')
  })

  it('clamps the heartbeat interval to a sane floor', () => {
    const bot = normalizeBotRecord({ name: 'helper', heartbeat: { intervalMinutes: 0 } })
    expect(bot.heartbeat.intervalMinutes).toBe(5)
  })

  // 目录名与显示名解耦：名字里可以有中文和空格，路径里不该出现它们。
  it('derives the workspace folder from the id, not from the display name', () => {
    const bot = normalizeBotRecord({ name: '总bo t' })
    const id8 = bot.id.replace(/-/g, '').slice(0, 8)
    expect(bot.workspacePath.endsWith(path.join('bots', `bot-${id8}`))).toBe(true)
    expect(bot.workspacePath).not.toContain('总bo t')
    expect(bot.memoryFile).toBe(path.join(bot.workspacePath, BOT_MEMORY_FILE))
  })

  it('puts two bots that share a display name in different folders', () => {
    const a = normalizeBotRecord({ name: '小助手' })
    const b = normalizeBotRecord({ name: '小助手' })
    expect(a.name).toBe(b.name)
    expect(a.workspacePath).not.toBe(b.workspacePath)
  })

  it('keeps the workspacePath stored on an older record instead of recomputing it', () => {
    const legacy = {
      id: 'e7e445bf-2247-4e61-963b-b3c0a84fa7b3',
      name: '小助手',
      workspacePath: path.join('/tmp', 'bots', '小助手'),
    }
    const patched = normalizeBotRecord({ ...legacy, thinkingLevel: 'high' }, legacy)
    expect(patched.workspacePath).toBe(legacy.workspacePath)
    expect(patched.memoryFile.endsWith(BOT_MEMORY_FILE)).toBe(true)
  })
})

describe('nextHeartbeatAt', () => {
  it('adds the interval to the given instant', () => {
    const from = Date.parse('2026-11-11T00:00:00.000Z')
    const next = nextHeartbeatAt({ heartbeat: { intervalMinutes: 30 } }, from)
    expect(next).toBe('2026-11-11T00:30:00.000Z')
  })
})

describe('inspectBotWork', () => {
  let dir

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-bot-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  function botWith(lastWakeAt) {
    return {
      id: 'bot-1',
      name: 'helper',
      workspacePath: dir,
      memoryFile: path.join(dir, BOT_MEMORY_FILE),
      heartbeat: { enabled: true, intervalMinutes: 60, lastWakeAt },
    }
  }

  it('wakes a bot that has never run', async () => {
    const result = await inspectBotWork(botWith(null))
    expect(result).toEqual({ hasWork: true, reason: 'first-wake' })
  })

  it('stays idle when nothing changed since the last wake', async () => {
    await fs.writeFile(path.join(dir, BOT_MEMORY_FILE), '# helper\n', 'utf8')
    const lastWakeAt = new Date(Date.now() + 60_000).toISOString()
    const result = await inspectBotWork(botWith(lastWakeAt))
    expect(result.hasWork).toBe(false)
    expect(result.reason).toBe('idle')
  })

  it('wakes when the workspace gained a file after the last wake', async () => {
    const lastWakeAt = new Date(Date.now() - 60_000).toISOString()
    await fs.writeFile(path.join(dir, 'notes.md'), 'todo\n', 'utf8')
    const result = await inspectBotWork(botWith(lastWakeAt))
    expect(result.hasWork).toBe(true)
    expect(result.reason).toBe('workspace-changed')
  })

  it('wakes on an inbox message even when nothing else changed', async () => {
    const lastWakeAt = new Date(Date.now() + 60_000).toISOString()
    await fs.mkdir(path.join(dir, '.bot'), { recursive: true })
    await fs.writeFile(path.join(dir, '.bot', 'inbox.md'), 'look at this\n', 'utf8')
    const result = await inspectBotWork(botWith(lastWakeAt))
    expect(result).toEqual({ hasWork: true, reason: 'inbox' })
  })

  it('does not treat its own MEMORY.md as new work', async () => {
    const lastWakeAt = new Date(Date.now() - 60_000).toISOString()
    await fs.writeFile(path.join(dir, BOT_MEMORY_FILE), '# helper\n', 'utf8')
    const result = await inspectBotWork(botWith(lastWakeAt))
    expect(result.hasWork).toBe(false)
  })

  it('forces a wake when it has idled too long', async () => {
    // 死锁兜底：它不动手 → 没有新文件 → 判没事 → 永远不醒。
    const lastWakeAt = new Date(Date.now() - 4 * 60 * 60_000).toISOString()
    await fs.writeFile(path.join(dir, BOT_MEMORY_FILE), '# helper\n', 'utf8')
    const result = await inspectBotWork(botWith(lastWakeAt))
    expect(result).toEqual({ hasWork: true, reason: 'stale' })
  })
})

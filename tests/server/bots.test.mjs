import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  BOT_MEMORY_FILE,
  BOT_STORE,
  ensureBotWorkspace,
  inspectBotWork,
  nextHeartbeatAt,
  normalizeBotName,
  normalizeBotRecord,
} from '../../server/bots.mjs'
import { BOT_HEARTBEAT_REPORT_PREFIX, heartbeatInstruction, parseHeartbeatReport } from '../../server/bot-runner.mjs'
import { stores } from '../../server/storage.mjs'

describe('bots store registration', () => {
  it('registers the bots store so the generic storage route can reach it', () => {
    expect(stores.has(BOT_STORE)).toBe(true)
    expect(BOT_STORE).toBe('bots')
  })
})

describe('bot heartbeat instruction (proactivity contract)', () => {
  const bot = normalizeBotRecord({ name: 'helper' })

  it('injects the bot workspace path and keeps the report marker contract', () => {
    const text = heartbeatInstruction(bot)
    expect(text).toContain(bot.workspacePath)
    // [报告] 首行是服务端发通知的唯一依据（runBotHeartbeat 解析首行），必须出现在指令里。
    expect(text).toContain('[报告]')
  })

  it('guides instead of prescribing, and keeps the pinned rules', () => {
    const text = heartbeatInstruction(bot)
    // 半径三层如实描述：qf-api 自发现 + spawn 子会话 + 不 commit。
    expect(text).toContain('quickforge-api')
    expect(text).toContain('spawn')
    expect(text).toContain('不 commit')
    // 记忆自我迭代与渐进披露的引导。
    expect(text).toContain('MEMORY.md')
    expect(text).toContain('一屏')
    // 防守型指令不应回归。
    expect(text).not.toContain('不值得动')
    expect(text).not.toContain('制造工作')
  })
})

describe('parseHeartbeatReport ([报告] first-line contract)', () => {
  it('extracts the summary from the last assistant reply that starts with the marker', () => {
    const messages = [
      { role: 'user', content: '[心跳] …' },
      { role: 'assistant', content: `${BOT_HEARTBEAT_REPORT_PREFIX} 修复了 demo.ts 的空指针，改动在工作区` },
    ]
    expect(parseHeartbeatReport(messages)).toBe('修复了 demo.ts 的空指针，改动在工作区')
  })

  it('returns null when no assistant reply carries the marker', () => {
    expect(parseHeartbeatReport([
      { role: 'user', content: '[心跳] …' },
      { role: 'assistant', content: '这一跳没有值得做的事，原因：清单为空。' },
    ])).toBeNull()
    // 标记不在首行不算：服务端只认首行，正文里出现不算报告。
    expect(parseHeartbeatReport([
      { role: 'assistant', content: `看完了。\n${BOT_HEARTBEAT_REPORT_PREFIX} 第二行不算` },
    ])).toBeNull()
  })

  it('falls back to a default summary when the marker line is bare', () => {
    expect(parseHeartbeatReport([{ role: 'assistant', content: BOT_HEARTBEAT_REPORT_PREFIX }])).toBe('有事找你')
    expect(parseHeartbeatReport([{ role: 'assistant', content: `${BOT_HEARTBEAT_REPORT_PREFIX}   ` }])).toBe('有事找你')
  })

  it('skips non-assistant and empty replies, and tolerates missing input', () => {
    expect(parseHeartbeatReport([
      { role: 'user', content: BOT_HEARTBEAT_REPORT_PREFIX },
      { role: 'assistant', content: '   ' },
      { role: 'assistant', content: `${BOT_HEARTBEAT_REPORT_PREFIX} 轮到我了` },
    ])).toBe('轮到我了')
    expect(parseHeartbeatReport([])).toBeNull()
    expect(parseHeartbeatReport(undefined)).toBeNull()
  })
})

describe('bot memory template (seed, not schema)', () => {
  it('seeds a self-owned structure with progressive disclosure pact', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-bot-memory-'))
    // memoryFile 也必须一起指到临时目录：normalizeBotRecord 的默认值指向真实用户目录。
    const bot = {
      ...normalizeBotRecord({ name: '小助手' }),
      workspacePath: dir,
      memoryFile: path.join(dir, BOT_MEMORY_FILE),
    }
    try {
      await ensureBotWorkspace(bot)
      const memory = await fs.readFile(path.join(dir, BOT_MEMORY_FILE), 'utf8')
      // 种子三节 + 「结构由我定」的自我迭代授权 + 渐进披露自约定。
      expect(memory).toContain('结构由我定')
      expect(memory).toContain('在做的事')
      expect(memory).toContain('等用户')
      expect(memory).toContain('踩过的坑')
      expect(memory).toContain('一屏读完')
      // 与主动探索冲突的旧守则不应回归。
      expect(memory).not.toContain('不确定的时候先问')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
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
    expect(bot.heartbeat.intervalMinutes).toBe(15)
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

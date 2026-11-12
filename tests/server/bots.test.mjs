import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  BOT_HEARTBEAT_TEMPLATE_FILE,
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

  it('injects the bot workspace path, self-evolution grant and report marker contract even without a template file', async () => {
    const text = await heartbeatInstruction(bot)
    expect(text).toContain(bot.workspacePath)
    // 自进化授权：指令和记忆都可自己改，这是自驱动的入口，钉在固定头。
    expect(text).toContain('.bot/heartbeat.md')
    expect(text).toContain('自我进化')
    // [报告] 首行是服务端发通知的唯一依据（runBotHeartbeat 解析首行），必须出现在指令里。
    expect(text).toContain('[报告]')
    // 不 commit 钉在固定尾，模板里删不掉。
    expect(text).toContain('不 commit')
  })

  it('seeds a guiding template (not a scene-specific playbook)', async () => {
    const text = await heartbeatInstruction(bot)
    // 半径三层如实描述：qf-api 自发现 + spawn 子会话。
    expect(text).toContain('quickforge-api')
    expect(text).toContain('spawn')
    // 记忆自我迭代与渐进披露的引导。
    expect(text).toContain('MEMORY.md')
    expect(text).toContain('一屏')
    // 判断标准在、场景步骤不在（防过拟合）。
    expect(text).toContain('自己判断')
    expect(text).not.toMatch(/^1\. /m)
    expect(text).not.toContain('不值得动')
    expect(text).not.toContain('制造工作')
  })

  it('uses the bot-owned template file when present, and pinned contracts survive rewrites', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-bot-hb-'))
    const custom = {
      ...bot,
      workspacePath: dir,
      // memoryFile 也必须指到临时目录，默认值指向真实用户目录。
      memoryFile: path.join(dir, BOT_MEMORY_FILE),
    }
    try {
      // bot 重写过的模板：只剩一句自己的话，契约相关的字眼一个都没有。
      const rewritten = '# 我的工作方式\n\n先看投喂，再扫清单；其余时间自由探索。'
      await fs.mkdir(path.dirname(path.join(dir, BOT_HEARTBEAT_TEMPLATE_FILE)), { recursive: true })
      await fs.writeFile(path.join(dir, BOT_HEARTBEAT_TEMPLATE_FILE), rewritten, 'utf8')
      const text = await heartbeatInstruction(custom)
      expect(text).toContain('先看投喂，再扫清单')
      expect(text).toContain(rewritten)
      // 模板被重写，钉死的契约仍然在场。
      expect(text).toContain('[报告]')
      expect(text).toContain('不 commit')
      expect(text).toContain('.bot/heartbeat.md')
      // 派活半径同样钉死：实现不在本会话里做，重写模板也删不掉这句。
      expect(text).toContain('spawn')
      expect(text).toContain('子会话')
      // 空模板视为无效，回退种子而不是发出空指令。
      await fs.writeFile(path.join(dir, BOT_HEARTBEAT_TEMPLATE_FILE), '   ', 'utf8')
      const fallback = await heartbeatInstruction(custom)
      expect(fallback).toContain('# 我的心跳操作模板')
      expect(fallback).toContain('[报告]')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('bot heartbeat template seeding', () => {
  it('plants the editable template once at workspace creation, never overwriting', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-bot-hb-seed-'))
    const bot = {
      ...normalizeBotRecord({ name: '小助手' }),
      workspacePath: dir,
      memoryFile: path.join(dir, BOT_MEMORY_FILE),
    }
    try {
      await ensureBotWorkspace(bot)
      const file = path.join(dir, BOT_HEARTBEAT_TEMPLATE_FILE)
      const seeded = await fs.readFile(file, 'utf8')
      expect(seeded).toContain('我的心跳操作模板')
      expect(seeded).toContain('不好用就改')
      // 半径节是指令式：项目活实现一律派给子会话，不是「想深入再说」。
      expect(seeded).toContain('子会话')
      expect(seeded).toContain('派给')
      // 引导式种子不含场景化固定步骤。
      expect(seeded).not.toContain('先看投喂')
      // bot 自己改过之后，ensure 不再覆盖。
      await fs.writeFile(file, '# 我的版本', 'utf8')
      await ensureBotWorkspace(bot)
      expect(await fs.readFile(file, 'utf8')).toBe('# 我的版本')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('backfills the template for legacy bots that predate it, without touching their memory', async () => {
    // 存量 bot：目录里已有 MEMORY.md（甚至已演化过），但没有 heartbeat.md。
    // runBotHeartbeat 每跳都会走同一个幂等 ensure——这里锁的是那个函数的行为：
    // 只补缺的模板，不动已有记忆。
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-bot-hb-legacy-'))
    const bot = {
      ...normalizeBotRecord({ name: 'old-timer' }),
      workspacePath: dir,
      memoryFile: path.join(dir, BOT_MEMORY_FILE),
    }
    try {
      await fs.writeFile(bot.memoryFile, '# 我自己演化过的记忆\n', 'utf8')
      await ensureBotWorkspace(bot)
      const template = await fs.readFile(path.join(dir, BOT_HEARTBEAT_TEMPLATE_FILE), 'utf8')
      expect(template).toContain('我的心跳操作模板')
      expect(await fs.readFile(bot.memoryFile, 'utf8')).toBe('# 我自己演化过的记忆\n')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
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

// ---------------------------------------------------------------------------
// runBotHeartbeat 的 alwaysWake 分支：开关开着时跳过判活，无事也真醒。
// bot-runner 依赖 agent-manager / bot-session（真实实现会建会话、跑模型），
// 这里用 vi.doMock 隔离模块图，只桩会话存在性与 runPrompt，其余走真实现。
// ---------------------------------------------------------------------------
describe('runBotHeartbeat alwaysWake', () => {
  let tmpDir
  let previousDataDir
  let previousHome
  let previousUserProfile
  let promptCalls

  beforeEach(() => {
    promptCalls = []
    vi.resetModules()
  })

  async function importBotRunner() {
    // watchBotHeartbeatReport 在 eventBus 为 null 时直接返回，不会用到 agentEvents，
    // 但模块顶部 import 了它，桩里必须给一个带 emit 的对象。
    vi.doMock('../../server/agent-manager.mjs', () => ({
      agentEvents: { emit: () => {} },
      getSessionEventBus: () => null,
      isSessionFileRollbackBusy: () => false,
      runPrompt: vi.fn(async (_sessionId, _prompt, _history, _a, _b, meta) => {
        promptCalls.push(meta ?? null)
        return {}
      }),
    }))
    vi.doMock('../../server/bot-session.mjs', () => ({
      sessionExists: vi.fn(async () => true),
      ensureBotSession: vi.fn(async (bot) => bot),
    }))
    const { runBotHeartbeat } = await import('../../server/bot-runner.mjs')
    return runBotHeartbeat
  }

  /** 真实建一条 bot 记录并落盘，返回它。 */
  async function seedBot(name, heartbeatOverrides) {
    const { normalizeBotRecord, saveBotRecord } = await import('../../server/bots.mjs')
    const base = normalizeBotRecord({ name, heartbeat: heartbeatOverrides ?? {} })
    // runBotHeartbeat 要求 bot 自带 sessionId；这里不建真实会话，塞个假 id 即可
    // （bot-session 已被 mock：sessionExists 恒 true，不会再走 ensureBotSession 建会话）。
    return saveBotRecord({ ...base, sessionId: `bot-${base.id}-stub` })
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-bot-wake-'))
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    previousHome = process.env.HOME
    previousUserProfile = process.env.USERPROFILE
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    process.env.HOME = tmpDir
    process.env.USERPROFILE = tmpDir
  })

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
    vi.resetModules()
    vi.doUnmock('../../server/agent-manager.mjs')
    vi.doUnmock('../../server/bot-session.mjs')
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('skips the work inspection and wakes anyway when alwaysWake is on', async () => {
    const runBotHeartbeat = await importBotRunner()
    // 上一醒在「未来」且工作区无新文件、无投喂：判活必判 idle。
    // 开关开着也应跳过判活直接真醒（这一跳调用一次模型）。
    const lastWakeAt = new Date(Date.now() + 60_000).toISOString()
    const bot = await seedBot('alarm', { alwaysWake: true, lastWakeAt })
    const result = await runBotHeartbeat(bot)
    expect(result.woke).toBe(true)
    expect(result.reason).toBe('signal')
    expect(promptCalls).toHaveLength(1)
  })

  it('still marks the round idle without alwaysWake when there is nothing to do', async () => {
    const runBotHeartbeat = await importBotRunner()
    const lastWakeAt = new Date(Date.now() + 60_000).toISOString()
    const bot = await seedBot('sleeper', { alwaysWake: false, lastWakeAt })
    const result = await runBotHeartbeat(bot)
    expect(result.woke).toBe(false)
    expect(result.reason).toBe('idle')
    expect(promptCalls).toHaveLength(0)
  })

  it('treats a legacy heartbeat without the field as off', async () => {
    const runBotHeartbeat = await importBotRunner()
    const lastWakeAt = new Date(Date.now() + 60_000).toISOString()
    // 老记录：字段缺失 → undefined !== true → 走判活 → idle
    const bot = await seedBot('legacy', { lastWakeAt })
    delete bot.heartbeat.alwaysWake
    const result = await runBotHeartbeat(bot)
    expect(result.woke).toBe(false)
    expect(result.reason).toBe('idle')
    expect(promptCalls).toHaveLength(0)
  })
})

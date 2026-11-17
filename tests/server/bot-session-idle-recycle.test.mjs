import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * bot 会话的空闲回收契约（内存第一刀）。
 *
 * bot 会话与普通会话一样接受 10 分钟空闲销毁：销毁只清内存，存储仍在；
 * 下次心跳 / 打开时走 restoreAgent 恢复（见 agent-idle-recycler.mjs）。
 * 三条判据，每条都对应一次真实回归：
 *   1. 空闲 10 分钟 → agentSessions 里没了，hasSession 仍为 true（存续性）；
 *   2. SSE 活动 touchSession → 计时器被重置，推进 10 分钟仍在；
 *   3. running 状态 → 计时器到点只重置不销毁（既有行为锁死）。
 *
 * 路子照 agent-manager.background-idle.test.mjs：mock 掉 pi-agent-core 的
 * Agent（不建真模型客户端），fake timers 只假 setTimeout/clearTimeout/
 * setInterval/clearInterval——createAgent 里真实 setTimeout 建的 idle timer
 * 正好落在被假的名单里，而 fs / SQLite / setImmediate 走真实，存储断言才有效。
 */

class MockAgent {
  static instances = []

  constructor(options = {}) {
    MockAgent.instances.push(this)
    this.state = {
      ...(options.initialState || {}),
      messages: [],
      pendingToolCalls: new Set(),
      isStreaming: false,
    }
    this.listeners = new Set()
    this.signal = new AbortController().signal
    this.abort = vi.fn()
    this.waitForIdle = vi.fn(async () => {})
    this.continue = vi.fn()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: MockAgent,
  estimateContextTokens: vi.fn(() => 0),
  estimateTokens: vi.fn(() => 0),
  shouldCompact: vi.fn(() => false),
}))
vi.mock('../../server/ai-http-logger.mjs', () => ({ streamSimpleWithAiHttpLogging: vi.fn() }))
vi.mock('../../server/mcp/registry.mjs', () => ({
  createMcpToolDefinitions: vi.fn(async () => []),
  isMcpToolName: vi.fn(() => false),
  subscribeMcpToolsetChanged: vi.fn(() => () => {}),
}))
vi.mock('../../server/plugins/registry.mjs', () => ({
  callPluginTool: vi.fn(),
  createPluginToolDefinitions: vi.fn(async () => []),
  getEnabledPluginCommandSources: vi.fn(async () => []),
  getEnabledPluginSkillSources: vi.fn(async () => []),
  isPluginToolName: vi.fn(() => false),
}))

const TEN_MINUTES = 10 * 60 * 1000

async function waitFor(predicate, { timeoutMs = 5000 } = {}) {
  // Date/setImmediate stay real under the fake-timer config used here（与
  // agent-manager.background-idle.test.mjs 同款）：destroy 的 final persist
  // 虽是同步 SQLite override，仍要给真实事件循环留几个 turn。
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setImmediate(resolve))
  }
  return predicate()
}

describe('bot session idle recycling (memory cut #1)', () => {
  let tmpDir
  let previousDataDir
  let database
  let repository

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-bot-idle-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
    MockAgent.instances = []
    vi.resetModules()

    // 真实 SQLite（会话域的权威存储）：hasSession 的存续性断言必须在真库上做，
    // 否则 destroy 只清内存这条契约无从验证。configureSessionStateService 用
    // 同步 repository override——绕开 heavy-op worker 线程（worker 用真实定时器
    // 调度消息往返，fake timers 下会让写入悬挂）。
    const { initializeSqliteStorage } = await import('../../server/sqlite/database.mjs')
    const { createSessionStateRepository } = await import('../../server/sqlite/session-state-repository.mjs')
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    database = await initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    repository = createSessionStateRepository(database)
    configureSessionStateService({ repository })
  })

  afterEach(async () => {
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    configureSessionStateService({ repository: null })
    const { closeSqliteStorage } = await import('../../server/sqlite/database.mjs')
    await closeSqliteStorage()
    vi.useRealTimers()
    // logger 的 5s 刷盘定时器还挂在这个临时数据目录上：留着它会在 rm 之后把
    // data/logs 重新 mkdir 出来（Windows 上表现为 ENOTEMPTY 或 %TEMP% 空壳目录）。
    // 先把缓冲刷完并关流，再恢复 env / 删目录；之后 logger 会按需重建。
    const { flushLogger } = await import('../../server/utils/logger.mjs')
    flushLogger()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {})
    vi.restoreAllMocks()
  })

  /**
   * 建一个真实 bot（记录 + 会话），返回 sessionId。
   * 消息预置一条并立即落盘：空会话在 persist 时会被清理（见
   * agent-persistence.mjs「Empty sessions are cleaned up」），而 createAgent
   * 只在「创建时就带消息」的路径落盘——这里 ensure 路径没有，所以显式
   * persistSessionState 一次，hasSession 的存续性断言才有对象。
   */
  async function seedBotSession(name = 'idle-bot') {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))

    const { saveBotRecord, normalizeBotRecord } = await import('../../server/bots.mjs')
    const base = normalizeBotRecord({ name })
    // 不带 sessionId：走 ensureBotSession 的「从没有过 → 生成新 id」分支，
    // 这正是 createAgent 参数（idleRetention）被应用的路径。
    const bot = await saveBotRecord(base)

    const { ensureBotSession } = await import('../../server/bot-session.mjs')
    const ensured = await ensureBotSession(bot)

    // 给 agent 预置一条消息并落盘：有消息的会话才是可持久化对象。
    const { agentSessions } = await import('../../server/agent-session-store.mjs')
    const session = agentSessions.get(ensured.sessionId)
    session.agent.state.messages.push({ role: 'user', content: [{ type: 'text', text: '[心跳] hello' }] })
    const { persistSessionState } = await import('../../server/agent-manager.mjs')
    await persistSessionState(session)

    return ensured.sessionId
  }

  it('destroys a bot session after ten idle minutes while storage keeps it', async () => {
    const sessionId = await seedBotSession()
    const { agentSessions } = await import('../../server/agent-session-store.mjs')
    const { hasSession } = await import('../../server/storage.mjs')

    // 前置：会话在内存、在存储。
    expect(agentSessions.has(sessionId)).toBe(true)
    expect(await hasSession(sessionId)).toBe(true)

    await vi.advanceTimersByTimeAsync(TEN_MINUTES + 1000)

    // 内存没了，存储还在——「销毁只清内存」就是这一刀的全部安全性所在。
    expect(await waitFor(() => agentSessions.has(sessionId) === false)).toBe(true)
    expect(await hasSession(sessionId)).toBe(true)
  })

  it('keeps the bot session alive while SSE activity keeps touching it', async () => {
    const sessionId = await seedBotSession()
    const { agentSessions } = await import('../../server/agent-session-store.mjs')
    const { touchSession } = await import('../../server/agent-idle-recycler.mjs')

    // 模拟 SSE 连接期活动：每个窗口中段（5 分钟处）touch 一次，连续跨过
    // 多个「裸 10 分钟」期限都活着。若 touch 不再重置计时器（回归），第一次
    // 推进到 10 分钟时原始期限就已到点销毁——下面的断言就会变红。
    await vi.advanceTimersByTimeAsync(TEN_MINUTES / 2)
    expect(touchSession(sessionId)).toBe(true)

    await vi.advanceTimersByTimeAsync(TEN_MINUTES / 2)
    expect(agentSessions.has(sessionId)).toBe(true)
    expect(touchSession(sessionId)).toBe(true)

    await vi.advanceTimersByTimeAsync(TEN_MINUTES / 2)
    expect(agentSessions.has(sessionId)).toBe(true)
    expect(touchSession(sessionId)).toBe(true)

    // 最后一次 touch 后推进满一个窗口差 1 秒（未到新期限），必须仍在。
    await vi.advanceTimersByTimeAsync(TEN_MINUTES / 2 - 1000)
    expect(agentSessions.has(sessionId)).toBe(true)
  })

  it('spares a running bot session from idle destruction', async () => {
    const sessionId = await seedBotSession()
    const { agentSessions } = await import('../../server/agent-session-store.mjs')
    const session = agentSessions.get(sessionId)

    // running 到点只重置不销毁——既有行为锁死。原始代码上这条也绿：
    // retention 豁免时 timer 根本不挂，会话更不会被销毁；改动后 timer 挂上、
    // 到点发现 status === 'running' 只重置。两种实现都必须「仍在」。
    session.status = 'running'
    await vi.advanceTimersByTimeAsync(TEN_MINUTES + 1000)
    expect(agentSessions.has(sessionId)).toBe(true)
  })
})

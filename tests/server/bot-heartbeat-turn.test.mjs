import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Only the provider loop is synthetic. runPrompt, agent_end, persistence,
// destroy and restore use their normal implementations and a temporary SQLite DB.
vi.mock('@earendil-works/pi-agent-core', async (importOriginal) => {
  const core = await importOriginal()
  return { ...core, Agent: class extends core.Agent {
    subscribe(listener) { this.listener = listener; return () => {} }
    async prompt(input) {
      const messages = [input, ...(this.replies ?? [])]
      this.state.messages.push(...messages)
      await this.listener({ type: 'agent_end', messages })
    }
  } }
})

const sessionId = 'test-heartbeat'
const source = { source: 'bot-heartbeat', botId: 'test-bot' }
const user = content => ({ role: 'user', content, timestamp: '2026-11-01T00:00:00.000Z' })
const hb = content => ({ ...user(content), details: { quickforgeBotHeartbeat: { version: 1 } } })
const assistant = content => ({ role: 'assistant', content })

describe('bot heartbeat turn', () => {
  let manager, repository, tmpDir, logger
  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-hb-turn-'))
    vi.stubEnv('QUICKFORGE_DATA_DIR', tmpDir)
    const { initializeSqliteStorage } = await import('../../server/sqlite/database.mjs')
    const { createSessionStateRepository } = await import('../../server/sqlite/session-state-repository.mjs')
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    repository = createSessionStateRepository(await initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') }))
    configureSessionStateService({ repository })
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(tmpDir)
    manager = await import('../../server/agent-manager.mjs')
    ;({ logger } = await import('../../server/utils/logger.mjs'))
  })
  afterEach(async () => {
    await manager.destroyAgent(sessionId)
    await (await import('../../server/session-state-service.mjs')).deleteSessionState(sessionId)
    vi.restoreAllMocks()
  })
  afterAll(async () => {
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    configureSessionStateService({ repository: null })
    await (await import('../../server/sqlite/database.mjs')).closeSqliteStorage()
    ;(await import('../../server/utils/logger.mjs')).flushLogger()
    vi.unstubAllEnvs()
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 })
  })

  async function seed(messages) {
    return manager.createAgent(sessionId, { scope: 'global', title: 'Heartbeat', titleSource: 'manual', systemPrompt: '', model: { provider: 'mock', id: 'mock' }, messages })
  }
  async function prompt(session, message, context) {
    await manager.runPrompt(sessionId, message, [], null, null, context)
    await session.activePromptPromise
    // Drain the agent_end write without issuing a second persist that could
    // repair a stale row and mask an incorrect first commit.
    const { withSessionPersistenceLock } = await import('../../server/session-persistence-lock.mjs')
    await withSessionPersistenceLock(() => {}, `session:${sessionId}`)
  }

  it('replaces only the three trailing unanswered wakes, including for a marker-only request', async () => {
    const session = await seed(['one', 'two', 'three'].map(hb))
    await prompt(session, hb('four'))
    expect(session.agent.state.messages).toEqual([{ ...hb('four'), details: { quickforgeBotHeartbeat: { version: 1, supersededWakeCount: 3 } } }])
  })

  it.each([
    ['any assistant (even empty)', assistant([])],
    ['an ordinary user', user('stop here')],
  ])('keeps a wake before %s', async (_label, boundary) => {
    const history = [hb('old'), boundary]
    const session = await seed(history)
    await prompt(session, hb('new'), source)
    expect(session.agent.state.messages.slice(0, -1)).toMatchObject(history)
    expect(session.agent.state.messages.at(-1).details.quickforgeBotHeartbeat.supersededWakeCount).toBe(0)
  })

  it('deletes superseded DB rows even when the first persist sees a longer transcript', async () => {
    const prefix = user('keep me')
    const session = await seed([prefix, hb('old')])
    const rows = () => repository.readMessagesPage({ scope: 'global', sessionId }).messages.map(row => row.message)
    expect(rows()).toEqual([prefix, hb('old')])
    session.agent.replies = [assistant('done')]
    await prompt(session, user('new'), source) // source-only enqueue
    const expected = [prefix, { ...hb('new'), details: { quickforgeBotHeartbeat: { version: 1, supersededWakeCount: 1 } } }, assistant('done')]
    expect(rows()).toMatchObject(expected)
    await manager.destroyAgent(sessionId)
    expect((await manager.restoreAgent(sessionId)).agent.state.messages).toMatchObject(expected)
  })

  it.each([
    ['no assistant', []], ['null content', [assistant(null)]], ['empty array', [assistant([])]],
    ['empty parts', [assistant([{ type: 'text', text: '' }, { type: 'thinking', thinking: '' }])]],
  ])('warns exactly once for %s without setting an error or warning on a later ordinary turn', async (_label, replies) => {
    const { normalizeBotRecord, saveBotRecord, getBotRecord } = await import('../../server/bots.mjs')
    const bot = await saveBotRecord(normalizeBotRecord({ id: source.botId, name: 'test', sessionId, heartbeat: { lastError: 'prior diagnostic' } }))
    const session = await seed([hb('answered'), assistant('prior reply')])
    const warn = vi.spyOn(logger, 'warn')
    const notices = () => warn.mock.calls.filter(([msg]) => msg === 'bot heartbeat empty completion')
    const wake = hb('wake')
    session.agent.replies = replies
    await prompt(session, wake, source)
    expect(notices()).toEqual([['bot heartbeat empty completion', { botId: source.botId, sessionId, wakeAt: wake.timestamp }]])
    expect((await getBotRecord(bot.id)).heartbeat.lastError).toBe('prior diagnostic')
    expect(session.status).toBe('idle')
    const history = [...session.agent.state.messages]
    await prompt(session, user('ordinary'))
    expect(session.agent.state.messages.slice(0, history.length)).toEqual(history)
    expect(notices()).toHaveLength(1)
  })

  it.each([
    ['text', { type: 'text', text: 'awake' }], ['thinking', { type: 'thinking', thinking: 'checking' }],
    ['flat toolCall', { type: 'toolCall', id: 'call', name: 'check', arguments: {} }],
  ])('does not warn on %s output', async (_label, part) => {
    const session = await seed([user('hello')])
    const warn = vi.spyOn(logger, 'warn')
    session.agent.replies = [assistant([part]), assistant([])]
    await prompt(session, hb('wake'), source)
    expect(warn.mock.calls.some(([msg]) => msg === 'bot heartbeat empty completion')).toBe(false)
  })

  it.each([
    ['empty', [{ type: 'text', text: '' }, { type: 'thinking', thinking: '' }], true],
    ['nonempty', [{ type: 'text', text: 'finished' }], false],
  ])('checks for a tail warning after earlier output and an %s final reply', async (_label, tail, shouldWarn) => {
    const session = await seed([])
    const warn = vi.spyOn(logger, 'warn')
    const wake = hb('wake')
    session.agent.replies = [assistant([{ type: 'text', text: 'checking' }]), assistant(tail)]
    await prompt(session, wake, source)
    expect(warn.mock.calls.some(([msg]) => msg === 'bot heartbeat empty completion')).toBe(false)
    const tailWarn = 'bot heartbeat tail empty completion'
    expect(warn.mock.calls.filter(([msg]) => msg === tailWarn)).toEqual(
      shouldWarn ? [[tailWarn, { botId: source.botId, sessionId, wakeAt: wake.timestamp }]] : [])
  })
})

// 慢 persist 日志的可诊断性：日志只报 durationMs + 内存消息数时，无法判断这次
// 写的是 append 1 行还是全量 replace——而这两者的开销差着量级（decisions §38/§39）。
// 这里钉住「日志必须带上存储计划与计划行数」，否则下一次仍然只能靠猜。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
  readSessionStateRecord: vi.fn(),
  saveSessionStatePair: vi.fn(),
  deleteSessionState: vi.fn(),
  storedMessagesState: vi.fn(() => null),
  sessionMessagesTailDigest: vi.fn(() => ''),
  emitSessionEvent: vi.fn(),
  goalMetadataSummary: vi.fn(() => null),
}))

vi.mock('../../server/utils/logger.mjs', () => ({ logger: mocks.logger }))
vi.mock('../../server/session-state-service.mjs', () => ({
  readSessionStateRecord: mocks.readSessionStateRecord,
  saveSessionStatePair: mocks.saveSessionStatePair,
  deleteSessionState: mocks.deleteSessionState,
  storedMessagesState: mocks.storedMessagesState,
  sessionMessagesTailDigest: mocks.sessionMessagesTailDigest,
}))
vi.mock('../../server/agent-session-events.mjs', () => ({ emitSessionEvent: mocks.emitSessionEvent }))
vi.mock('../../server/agent-goal-state.mjs', () => ({ goalMetadataSummary: mocks.goalMetadataSummary }))

const { persistSession } = await import('../../server/agent-persistence.mjs')

function makeSession() {
  return {
    sessionId: 'session-slow-log-1',
    scope: 'global',
    title: 'T',
    agent: { state: { messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }] } },
    persistedStorageRevision: 3,
    stateVersion: 1,
    persistConflictCount: 0,
  }
}

function savedPair(plan, rows) {
  return {
    state: {},
    metadata: {},
    revision: 4,
    stateVersion: 2,
    messageStoragePlan: plan,
    messagePlanRows: rows,
    messageCount: 1,
  }
}

function slowPersist() {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ ok: true }), 210)
  })
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (typeof fn?.mockClear === 'function') fn.mockClear()
  }
  mocks.readSessionStateRecord.mockReturnValue({ state: {}, metadata: {}, revision: 3, stateVersion: 1 })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('慢 persist 日志（persist took > 200ms）', () => {
  it('带上存储计划与计划行数——否则「replace 全量重写」和「append 一行」在日志里长得一模一样', async () => {
    mocks.saveSessionStatePair.mockImplementation(async () => {
      await slowPersist()
      return savedPair('replace', 15363)
    })

    await persistSession(makeSession())

    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    const [message, fields] = mocks.logger.warn.mock.calls[0]
    expect(message).toContain('persist took')
    expect(fields).toMatchObject({ messageStoragePlan: 'replace', messagePlanRows: 15363 })
  })

  it('append 一行的小事务也如实报 1 行（不是拿内存消息数冒充写入行数）', async () => {
    mocks.saveSessionStatePair.mockImplementation(async () => {
      await slowPersist()
      return savedPair('append', 1)
    })

    await persistSession(makeSession())

    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    const [, fields] = mocks.logger.warn.mock.calls[0]
    expect(fields).toMatchObject({ messageStoragePlan: 'append', messagePlanRows: 1 })
  })

  it('快 persist 不写日志（阈值仍在 200ms）', async () => {
    mocks.saveSessionStatePair.mockResolvedValue(savedPair('append', 1))

    await persistSession(makeSession())

    expect(mocks.logger.warn).not.toHaveBeenCalled()
  })

  it('保存方没报计划时降级为 null，不抛错也不编造', async () => {
    mocks.saveSessionStatePair.mockImplementation(async () => {
      await slowPersist()
      const pair = savedPair(undefined, undefined)
      delete pair.messageStoragePlan
      delete pair.messagePlanRows
      return pair
    })

    await persistSession(makeSession())

    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    const [, fields] = mocks.logger.warn.mock.calls[0]
    expect(fields.messageStoragePlan).toBeNull()
    expect(fields.messagePlanRows).toBeNull()
  })
})

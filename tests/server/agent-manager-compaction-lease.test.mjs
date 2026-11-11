// requestSessionCompaction 的写权限豁免边界。
//
// 背景：会话给自己请求压缩时必然正在 streaming，而此刻该会话几乎必然被一个
// 浏览器窗口打开着——写租约在窗口手里。旧实现把租约守卫放在路由入口，于是
// 「会话压自己」永远 409。现在守卫下沉到 running 判定之后，只豁免运行中这条
// 分支（它只写内存里的 forceCompaction 标记，不落库）。
//
// 这里钉住四件事：
//  1. 运行中 + 自我请求 → 完全不碰租约，只登记标记。
//  2. 运行中 + 他人请求 → 照旧要租约（409 原样抛出）。
//  3. 空闲（不管谁请求）→ 必须过租约，因为这条分支会写库。
//  4. 不传 assertWriteAccess 的调用方（内部调用）行为不变。

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agentSessions: new Map(),
  compactSessionNow: vi.fn(),
  requestForceCompaction: vi.fn(),
  getSessionContextUsage: vi.fn(() => ({ percent: 12, inputTokens: 1200 })),
}))

vi.mock('../../server/agent-session-store.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  agentSessions: mocks.agentSessions,
}))

vi.mock('../../server/agent-compaction.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  compactSessionNow: mocks.compactSessionNow,
}))

vi.mock('../../server/auto-compaction.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  requestForceCompaction: mocks.requestForceCompaction,
}))

vi.mock('../../server/agent-session-events.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionContextUsage: mocks.getSessionContextUsage,
}))

const { requestSessionCompaction } = await import('../../server/agent-manager.mjs')

const SESSION_ID = 'session-compact'

function leaseHeld() {
  const error = new Error('This session is open for writing in another window')
  error.statusCode = 409
  error.errorCode = 'SESSION_LEASE_HELD'
  return error
}

function putSession({ running }) {
  mocks.agentSessions.set(SESSION_ID, {
    sessionId: SESSION_ID,
    abortPending: false,
    agent: { state: { isStreaming: running } },
  })
}

describe('requestSessionCompaction 的写租约边界', () => {
  beforeEach(() => {
    mocks.agentSessions.clear()
    mocks.compactSessionNow.mockReset()
    mocks.requestForceCompaction.mockReset()
    mocks.getSessionContextUsage.mockClear()
    mocks.compactSessionNow.mockResolvedValue({ compacted: true, summary: '摘要', usageAfter: { percent: 4 } })
  })

  it('运行中的自我请求跳过租约，只登记强制压缩标记', async () => {
    putSession({ running: true })
    const assertWriteAccess = vi.fn(() => { throw leaseHeld() })

    const result = await requestSessionCompaction(SESSION_ID, {
      reason: 'agent_request',
      selfRequest: true,
      assertWriteAccess,
    })

    expect(assertWriteAccess).not.toHaveBeenCalled()
    expect(mocks.requestForceCompaction).toHaveBeenCalledTimes(1)
    expect(mocks.compactSessionNow).not.toHaveBeenCalled()
    expect(result).toMatchObject({ scheduled: true, compacted: false, reason: 'deferred_to_next_model_request' })
  })

  it('运行中的他人请求仍然要租约', async () => {
    putSession({ running: true })
    const assertWriteAccess = vi.fn(() => { throw leaseHeld() })

    await expect(requestSessionCompaction(SESSION_ID, {
      selfRequest: false,
      assertWriteAccess,
    })).rejects.toMatchObject({ statusCode: 409, errorCode: 'SESSION_LEASE_HELD' })

    expect(assertWriteAccess).toHaveBeenCalledTimes(1)
    // 被拦下时绝不能已经登记了标记。
    expect(mocks.requestForceCompaction).not.toHaveBeenCalled()
  })

  it('空闲时即使自称自我请求也必须过租约（这条分支会写库）', async () => {
    putSession({ running: false })
    const assertWriteAccess = vi.fn(() => { throw leaseHeld() })

    await expect(requestSessionCompaction(SESSION_ID, {
      selfRequest: true,
      assertWriteAccess,
    })).rejects.toMatchObject({ errorCode: 'SESSION_LEASE_HELD' })

    expect(assertWriteAccess).toHaveBeenCalledTimes(1)
    expect(mocks.compactSessionNow).not.toHaveBeenCalled()
  })

  it('空闲且持有租约时同步压缩', async () => {
    putSession({ running: false })
    const assertWriteAccess = vi.fn()

    const result = await requestSessionCompaction(SESSION_ID, { assertWriteAccess })

    expect(assertWriteAccess).toHaveBeenCalledTimes(1)
    expect(mocks.compactSessionNow).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ scheduled: false, compacted: true, summary: '摘要' })
  })

  it('不传 assertWriteAccess 的内部调用方行为不变', async () => {
    putSession({ running: true })

    const result = await requestSessionCompaction(SESSION_ID, { reason: 'manual' })

    expect(mocks.requestForceCompaction).toHaveBeenCalledTimes(1)
    expect(result.sessionId).toBe(SESSION_ID)
  })
})

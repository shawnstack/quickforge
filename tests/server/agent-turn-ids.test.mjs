import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginSessionTurn,
  clearSessionTurn,
  currentSessionTurnId,
  endSessionTurn,
  sessionTurnIds,
} from '../../server/agent-turn-ids.mjs'

/**
 * 轮级归因：一轮用户请求 = 一个 turnId，这一轮里所有落盘写入都带着它，前端靠
 * 「共享同一条 user 消息的那组 id」回滚。风险全在**清理时机**：goal 续行会比
 * 上一轮的 finally 清理更早开始，若无条件删就会把新一轮的登记误删，回滚目标
 * 随之丢失。
 */
describe('session turn ids', () => {
  beforeEach(() => {
    sessionTurnIds.clear()
  })

  it('returns null for a session that never started a turn', () => {
    expect(currentSessionTurnId('session-1')).toBeNull()
  })

  it('registers a fresh uuid per run', () => {
    const first = beginSessionTurn('session-1')

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(currentSessionTurnId('session-1')).toBe(first)

    const second = beginSessionTurn('session-1')

    expect(second).not.toBe(first)
    expect(currentSessionTurnId('session-1')).toBe(second)
  })

  it('keeps sessions isolated from each other', () => {
    const a = beginSessionTurn('a')
    const b = beginSessionTurn('b')

    expect(a).not.toBe(b)
    expect(currentSessionTurnId('a')).toBe(a)
    expect(currentSessionTurnId('b')).toBe(b)

    endSessionTurn('a', a)

    expect(currentSessionTurnId('a')).toBeNull()
    expect(currentSessionTurnId('b')).toBe(b)
  })

  it('only clears when the registered turn is the one being ended', () => {
    const stale = beginSessionTurn('session-1')
    // 上一轮的清理晚于新一轮启动：必须无操作，否则新一轮的归因就丢了。
    const fresh = beginSessionTurn('session-1')

    endSessionTurn('session-1', stale)

    expect(currentSessionTurnId('session-1')).toBe(fresh)
  })

  it('clears unconditionally when no turn id is given', () => {
    beginSessionTurn('session-1')

    endSessionTurn('session-1')

    expect(currentSessionTurnId('session-1')).toBeNull()
  })

  it('treats ending an unknown session as a no-op', () => {
    expect(() => endSessionTurn('missing', 'whatever')).not.toThrow()
    expect(currentSessionTurnId('missing')).toBeNull()
  })

  it('clearSessionTurn always drops the registration', () => {
    beginSessionTurn('session-1')

    clearSessionTurn('session-1')

    expect(currentSessionTurnId('session-1')).toBeNull()
    expect(sessionTurnIds.size).toBe(0)
  })
})

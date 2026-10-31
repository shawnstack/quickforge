import { describe, expect, it } from 'vitest'
import { shouldInvalidatePinnedSummary } from '../../src/lib/pinned-summary-events'

describe('pinned summary invalidation', () => {
  it('recomputes on the structural boundaries that feed the projections', () => {
    for (const type of [
      'tool_execution_start',
      'tool_execution_end',
      'message_end',
      'messages_replaced',
      'agent_end',
      'background_commands',
      'goal_updated',
    ]) {
      expect(shouldInvalidatePinnedSummary(type), type).toBe(true)
    }
  })

  it('does not recompute on streaming tool deltas', () => {
    // 该事件按合并后的 ~20fps 到达，只原地增补 toolResult；投影在结构性边界
    // 已经完整（todos/终态 run/background snapshot 都不在此期间变化）。
    expect(shouldInvalidatePinnedSummary('tool_execution_update')).toBe(false)
    expect(shouldInvalidatePinnedSummary('message_update')).toBe(false)
    expect(shouldInvalidatePinnedSummary('state')).toBe(false)
  })
})

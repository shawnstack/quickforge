import { beforeEach, describe, expect, it } from 'vitest'
import { useRuntimeStatusesStore } from '../../src/stores/runtime-statuses-store'

describe('runtimeStatusesStore', () => {
  beforeEach(() => {
    useRuntimeStatusesStore.setState({ statuses: {}, completedSessionIds: new Set() })
  })

  it('setStatuses 兼容直接赋值与函数式更新', () => {
    useRuntimeStatusesStore.getState().setStatuses({ 'session-1': 'running' })
    expect(useRuntimeStatusesStore.getState().statuses).toEqual({ 'session-1': 'running' })

    // SSE agent_end 语义：基于当前值派生新状态
    useRuntimeStatusesStore.getState().setStatuses((current) => ({ ...current, 'session-2': 'idle' }))
    expect(useRuntimeStatusesStore.getState().statuses).toEqual({
      'session-1': 'running',
      'session-2': 'idle',
    })

    // 可见集合为空时的刷新语义：整体清空
    useRuntimeStatusesStore.getState().setStatuses({})
    expect(useRuntimeStatusesStore.getState().statuses).toEqual({})
  })

  it('setCompletedSessionIds 兼容直接赋值与函数式更新（markSessionRead / agent_end 语义）', () => {
    useRuntimeStatusesStore.getState().setCompletedSessionIds(new Set(['session-1', 'session-2']))
    const current = useRuntimeStatusesStore.getState().completedSessionIds
    expect(current.has('session-1')).toBe(true)
    expect(current.has('session-2')).toBe(true)

    // markSessionRead / agent_start 语义：按需删除
    useRuntimeStatusesStore.getState().setCompletedSessionIds((prev) => {
      if (!prev.has('session-1')) return prev
      const next = new Set(prev)
      next.delete('session-1')
      return next
    })
    expect(useRuntimeStatusesStore.getState().completedSessionIds.has('session-1')).toBe(false)
    expect(useRuntimeStatusesStore.getState().completedSessionIds.has('session-2')).toBe(true)

    // 不变时返回原引用，zustand 浅比较下不触发订阅方更新
    const before = useRuntimeStatusesStore.getState().completedSessionIds
    useRuntimeStatusesStore.getState().setCompletedSessionIds((prev) => prev)
    expect(useRuntimeStatusesStore.getState().completedSessionIds).toBe(before)
  })

  it('action 引用恒定，非 React 代码可经 getState() 直接调用', () => {
    const { setStatuses, setCompletedSessionIds } = useRuntimeStatusesStore.getState()
    setStatuses({ 'session-1': 'error' })
    setCompletedSessionIds(new Set(['session-1']))

    const next = useRuntimeStatusesStore.getState()
    expect(next.statuses).toEqual({ 'session-1': 'error' })
    expect(next.setStatuses).toBe(setStatuses)
    expect(next.setCompletedSessionIds).toBe(setCompletedSessionIds)
  })
})

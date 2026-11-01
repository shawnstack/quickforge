import { beforeEach, describe, expect, it } from 'vitest'
import { useTaskToastsStore } from '../../src/stores/task-toasts-store'

describe('taskToastsStore', () => {
  beforeEach(() => {
    useTaskToastsStore.setState({ toasts: [] })
  })

  it('addToast 追加带 id/createdAt 的新 toast', () => {
    const before = Date.now()
    useTaskToastsStore.getState().addToast({ sessionId: 's1', title: '任务完成', status: 'completed' })

    const { toasts } = useTaskToastsStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].id).toBeTruthy()
    expect(toasts[0].sessionId).toBe('s1')
    expect(toasts[0].title).toBe('任务完成')
    expect(toasts[0].createdAt).toBeGreaterThanOrEqual(before)
  })

  it('handleTaskComplete 等价于 addToast({ sessionId, title, status })', () => {
    useTaskToastsStore.getState().handleTaskComplete('s2', '后台任务失败', 'error')

    const { toasts } = useTaskToastsStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ sessionId: 's2', title: '后台任务失败', status: 'error' })
  })

  it('dismissToast 按 id 移除目标且不影响其他 toast', () => {
    useTaskToastsStore.getState().addToast({ sessionId: 'a', title: 'A', status: 'completed' })
    useTaskToastsStore.getState().addToast({ sessionId: 'b', title: 'B', status: 'error' })
    const firstId = useTaskToastsStore.getState().toasts[0].id

    useTaskToastsStore.getState().dismissToast(firstId)

    const { toasts } = useTaskToastsStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].sessionId).toBe('b')
  })

  it('action 引用恒定，可直接经 getState() 在非 React 代码中调用', () => {
    const { addToast, dismissToast, handleTaskComplete } = useTaskToastsStore.getState()
    addToast({ sessionId: 'c', title: 'C', status: 'completed' })

    const next = useTaskToastsStore.getState()
    expect(next.addToast).toBe(addToast)
    expect(next.dismissToast).toBe(dismissToast)
    expect(next.handleTaskComplete).toBe(handleTaskComplete)
  })
})

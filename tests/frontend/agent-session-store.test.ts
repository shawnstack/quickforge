import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentSessionStore } from '../../src/stores/agent-session-store'
import type { BackgroundTaskStatus, ProjectInfo } from '../../src/lib/types'

// 模块创建时 currentRuntimeScopeId 即为随机 id；在任何 setState 覆盖前捕获。
const moduleInitRuntimeScopeId = useAgentSessionStore.getState().currentRuntimeScopeId

const INITIAL = {
  currentSessionId: undefined as string | undefined,
  currentRuntimeScopeId: 'runtime-init',
  currentTitle: 'New chat',
  chatScope: 'global' as const,
  currentToolProject: undefined as ProjectInfo | undefined,
  taskStatuses: {} as Record<string, BackgroundTaskStatus>,
  chatPanelRevision: 0,
  loadingSessionId: undefined as string | undefined,
}

const project = { id: 'project-a', name: 'Project A' } as ProjectInfo

describe('agentSessionStore', () => {
  beforeEach(() => {
    useAgentSessionStore.setState(INITIAL)
  })

  it('初始状态与旧 useAgentManager 的 useState 初值一致', () => {
    // 迁移前的 useState 初值：session/title/scope/project/statuses/revision/loading。
    const state = useAgentSessionStore.getState()
    expect(state.currentSessionId).toBeUndefined()
    expect(state.currentTitle).toBe('New chat')
    expect(state.chatScope).toBe('global')
    expect(state.currentToolProject).toBeUndefined()
    expect(state.taskStatuses).toEqual({})
    expect(state.chatPanelRevision).toBe(0)
    expect(state.loadingSessionId).toBeUndefined()
    // runtimeScopeId 是模块创建时生成的一次性随机 id（旧 useState(randomId)[0]）。
    expect(typeof moduleInitRuntimeScopeId).toBe('string')
    expect(moduleInitRuntimeScopeId.length).toBeGreaterThan(0)
  })

  it('各 setter 兼容 useState 的直接值形式', () => {
    const store = useAgentSessionStore.getState()
    store.setCurrentSessionId('session-1')
    store.setCurrentRuntimeScopeId('runtime-2')
    store.setCurrentTitle('New title')
    store.setChatScope('project')
    store.setCurrentToolProject(project)
    store.setTaskStatuses({ 'session-1': 'running' })
    store.setChatPanelRevision(3)
    store.setLoadingSessionId('session-2')

    const next = useAgentSessionStore.getState()
    expect(next.currentSessionId).toBe('session-1')
    expect(next.currentRuntimeScopeId).toBe('runtime-2')
    expect(next.currentTitle).toBe('New title')
    expect(next.chatScope).toBe('project')
    expect(next.currentToolProject).toBe(project)
    expect(next.taskStatuses).toEqual({ 'session-1': 'running' })
    expect(next.chatPanelRevision).toBe(3)
    expect(next.loadingSessionId).toBe('session-2')

    // 可回退：undefined / 覆盖旧值（切会话、结束加载等路径依赖）。
    next.setCurrentSessionId(undefined)
    next.setCurrentToolProject(undefined)
    next.setLoadingSessionId(undefined)
    next.setCurrentTitle('New chat')
    const reset = useAgentSessionStore.getState()
    expect(reset.currentSessionId).toBeUndefined()
    expect(reset.currentToolProject).toBeUndefined()
    expect(reset.loadingSessionId).toBeUndefined()
    expect(reset.currentTitle).toBe('New chat')
  })

  it('各 setter 兼容 useState 的函数式更新', () => {
    const store = useAgentSessionStore.getState()
    store.setCurrentSessionId('session-1')
    store.setCurrentSessionId((current) => current ?? 'fallback-session')
    expect(useAgentSessionStore.getState().currentSessionId).toBe('session-1')

    store.setCurrentRuntimeScopeId((current) => `${current}#patched`)
    expect(useAgentSessionStore.getState().currentRuntimeScopeId).toBe('runtime-init#patched')

    store.setCurrentTitle((current) => current.toUpperCase())
    expect(useAgentSessionStore.getState().currentTitle).toBe('NEW CHAT')

    store.setChatScope((current) => (current === 'global' ? 'project' : 'global'))
    expect(useAgentSessionStore.getState().chatScope).toBe('project')

    store.setLoadingSessionId('session-9')
    store.setLoadingSessionId(() => undefined)
    expect(useAgentSessionStore.getState().loadingSessionId).toBeUndefined()

    // chatPanelRevision 的递增 bump 是 useChatActions / useModelActions 等
    // 依赖注入方的主要用法。
    store.setChatPanelRevision((current) => current + 1)
    store.setChatPanelRevision((current) => current + 1)
    expect(useAgentSessionStore.getState().chatPanelRevision).toBe(2)
  })

  it('taskStatuses 函数式更新按 sessionId 合并、删除后其余键不受影响', () => {
    const store = useAgentSessionStore.getState()
    store.setTaskStatuses({ 's-1': 'running', 's-2': 'error' })
    store.setTaskStatuses((current) => ({ ...current, 's-1': 'idle', 's-3': 'aborted' }))

    expect(useAgentSessionStore.getState().taskStatuses).toEqual({
      's-1': 'idle',
      's-2': 'error',
      's-3': 'aborted',
    })

    // removeTaskStatuses 语义：删除不存在的键时 updater 返回原引用 current
    // （changed=false 分支），切片引用不变、订阅侧跳过重渲染。
    const before = useAgentSessionStore.getState().taskStatuses
    store.setTaskStatuses((current) => {
      const next = { ...current }
      let changed = false
      if (Object.prototype.hasOwnProperty.call(next, 's-missing')) {
        delete next['s-missing']
        changed = true
      }
      return changed ? next : current
    })
    expect(useAgentSessionStore.getState().taskStatuses).toBe(before)

    store.setTaskStatuses((current) => {
      const next = { ...current }
      delete next['s-1']
      return next
    })
    expect(useAgentSessionStore.getState().taskStatuses).toEqual({ 's-2': 'error', 's-3': 'aborted' })
  })

  it('set 同步应用：调用返回后 getState() 立即可读到新值', () => {
    // 旧实现靠 currentSessionIdRef 等 ref 镜像保证稳定回调同步读最新值；
    // 迁 store 后 getState() 提供同一保证。
    useAgentSessionStore.getState().setCurrentSessionId('session-sync')
    expect(useAgentSessionStore.getState().currentSessionId).toBe('session-sync')
  })

  it('action 引用恒定，非 React 代码可经 getState() 直接调用', () => {
    const { setCurrentSessionId, setChatPanelRevision, setTaskStatuses } = useAgentSessionStore.getState()
    setCurrentSessionId('session-1')
    setChatPanelRevision((current) => current + 1)
    setTaskStatuses({ 'session-1': 'running' })

    const next = useAgentSessionStore.getState()
    expect(next.setCurrentSessionId).toBe(setCurrentSessionId)
    expect(next.setChatPanelRevision).toBe(setChatPanelRevision)
    expect(next.setTaskStatuses).toBe(setTaskStatuses)
  })

  it('函数式更新返回相同引用时切片引用保持不变（订阅侧跳过重渲染）', () => {
    const statusesBefore = useAgentSessionStore.getState().taskStatuses
    useAgentSessionStore.getState().setTaskStatuses((current) => current)
    expect(useAgentSessionStore.getState().taskStatuses).toBe(statusesBefore)

    const revisionBefore = useAgentSessionStore.getState().chatPanelRevision
    useAgentSessionStore.getState().setChatPanelRevision((current) => current)
    expect(useAgentSessionStore.getState().chatPanelRevision).toBe(revisionBefore)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', () => ({
  useCallback<T>(callback: T) {
    return callback
  },
}))
vi.mock('@/lib/pi-chat', () => ({ initializePiStorage: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/components/ui/prompt-dialog', () => ({ showPrompt: vi.fn() }))

import { useSessionActions } from '../../src/hooks/useSessionActions'

const NOW_ISO = '2026-08-20T00:00:00.000Z'
const SESSION_ID = 'session-1'

type FakeTask = {
  sessionId: string
  status: 'running'
  agent: { state: { isStreaming: boolean }; dispose: () => void }
  unsubscribe: () => void
}

type FakeStorage = {
  sessions: {
    get: (sessionId: string) => Promise<unknown>
    getMetadata: (sessionId: string) => Promise<unknown>
    save: (session: unknown, metadata: unknown) => Promise<void>
  }
}

/** archiveSession 只用到 storage.sessions 的三个方法，外加 taskMapRef / removeSession。 */
function useArchiveEnv(saveImpl: () => Promise<void>) {
  const unsubscribe = vi.fn()
  const dispose = vi.fn()
  const taskMap = new Map<string, FakeTask>([
    [SESSION_ID, {
      sessionId: SESSION_ID,
      status: 'running',
      agent: { state: { isStreaming: true }, dispose },
      unsubscribe,
    }],
  ])

  const save = vi.fn(saveImpl)
  const storage: FakeStorage = {
    sessions: {
      get: vi.fn(async () => ({ id: SESSION_ID, title: 'Streaming chat', createdAt: NOW_ISO, lastModified: NOW_ISO })),
      getMetadata: vi.fn(async () => ({ id: SESSION_ID, title: 'Streaming chat' })),
      save,
    },
  }

  const removeSession = vi.fn()
  const notifySessionsChanged = vi.fn()
  const actions = useSessionActions({
    storageRef: { current: storage } as never,
    taskMapRef: { current: taskMap } as never,
    currentSessionIdRef: { current: null } as never,
    loadAgentSession: vi.fn() as never,
    setCurrentTitleRef: vi.fn(),
    refreshSessions: vi.fn(async () => undefined),
    removeSession,
    notifySessionsChanged,
    updateSessionTitle: vi.fn(),
    closeWorkspacePage: vi.fn(),
    startNewGlobalChat: vi.fn(async () => undefined),
  })

  return { actions, taskMap, save, removeSession, notifySessionsChanged, unsubscribe, dispose }
}

describe('archiveSession keeps the in-flight round when persisting the archive fails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not dispose the running agent task, and does not drop the row, when save rejects', async () => {
    const env = useArchiveEnv(async () => { throw new Error('boom') })

    // 错误必须继续向上抛：ChatSidebar 依赖它复位 deleting 状态，这里吞掉就等于行永远淡出
    await expect(env.actions.archiveSession(SESSION_ID)).rejects.toThrow('boom')

    // 缺陷形态：disposeAgentTask 在 await save 之前执行 —— 写盘失败时任务已被销毁，
    // 屏幕上正在生成的那一轮直接断掉，而会话本身还留在列表里
    expect(env.taskMap.has(SESSION_ID)).toBe(true)
    expect(env.unsubscribe).not.toHaveBeenCalled()
    expect(env.dispose).not.toHaveBeenCalled()
    expect(env.removeSession).not.toHaveBeenCalled()
  })

  it('disposes the agent task once the archive has been persisted', async () => {
    const env = useArchiveEnv(async () => undefined)

    await env.actions.archiveSession(SESSION_ID)

    expect(env.save).toHaveBeenCalledTimes(1)
    expect(env.unsubscribe).toHaveBeenCalledTimes(1)
    expect(env.dispose).toHaveBeenCalledTimes(1)
    expect(env.taskMap.has(SESSION_ID)).toBe(false)
    expect(env.removeSession).toHaveBeenCalledWith(SESSION_ID)
    expect(env.notifySessionsChanged).toHaveBeenCalledTimes(1)
  })
})

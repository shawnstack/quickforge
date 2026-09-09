import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuickForgeSessionMetadata } from '../../src/lib/types'

const reactStub = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  memos: [] as Array<{ deps?: unknown[]; value: unknown }>,
  effects: [] as Array<{ deps?: unknown[]; cleanup?: () => void }>,
}))

const serverAgentMocks = vi.hoisted(() => ({
  fetchActiveAgentStatuses: vi.fn(async () => [] as Array<{ sessionId: string; status: string }>),
  subscribeToAgentEvents: vi.fn(() => () => {}),
}))

function sameDeps(previous: unknown[] | undefined, next: unknown[] | undefined) {
  if (!previous || !next || previous.length !== next.length) return false
  return previous.every((value, index) => Object.is(value, next[index]))
}

// 与真实 React 对齐的最小测试桩：deps 不变时 effect/useMemo 不重跑，
// useCallback 每次渲染返回新函数（真实场景中 sessions 数组身份变化即如此）。
vi.mock('react', () => ({
  useCallback<T>(callback: T) {
    return callback
  },
  useEffect(effect: () => void | (() => void), deps?: unknown[]) {
    const index = reactStub.cursor
    reactStub.cursor += 1
    const previous = reactStub.effects[index]
    if (previous && sameDeps(previous.deps, deps)) return
    previous?.cleanup?.()
    const cleanup = effect()
    reactStub.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
  },
  useMemo<T>(factory: () => T, deps?: unknown[]) {
    const index = reactStub.cursor
    reactStub.cursor += 1
    const previous = reactStub.memos[index]
    if (previous && sameDeps(previous.deps, deps)) return previous.value as T
    const value = factory()
    reactStub.memos[index] = { deps, value }
    return value
  },
  useRef<T>(initialValue: T) {
    const index = reactStub.cursor
    reactStub.cursor += 1
    if (!reactStub.refs[index]) reactStub.refs[index] = { current: initialValue }
    return reactStub.refs[index] as { current: T }
  },
  useState<T>(initialValue: T | (() => T)) {
    const index = reactStub.cursor
    reactStub.cursor += 1
    if (!(index in reactStub.states)) {
      reactStub.states[index] = typeof initialValue === 'function'
        ? (initialValue as () => T)()
        : initialValue
    }
    const setState = (update: T | ((previous: T) => T)) => {
      const previous = reactStub.states[index] as T
      reactStub.states[index] = typeof update === 'function'
        ? (update as (value: T) => T)(previous)
        : update
    }
    return [reactStub.states[index] as T, setState] as const
  },
}))

vi.mock('@/lib/server-agent', () => serverAgentMocks)
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { useVisibleRuntimeStatuses } from '../../src/hooks/useVisibleRuntimeStatuses'

type WindowEnv = {
  runTimers: () => void
  setTimeout: ReturnType<typeof vi.fn>
  clearTimeout: ReturnType<typeof vi.fn>
}

function createWindowEnv(): WindowEnv {
  const timers = new Map<number, () => void>()
  let nextHandle = 1
  return {
    runTimers() {
      const pending = [...timers.values()]
      timers.clear()
      for (const handler of pending) handler()
    },
    setTimeout: vi.fn((handler: () => void) => {
      const handle = nextHandle
      nextHandle += 1
      timers.set(handle, handler)
      return handle
    }),
    clearTimeout: vi.fn((handle: number) => {
      timers.delete(handle)
    }),
  }
}

function createDocumentEnv() {
  return {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

function session(id: string): QuickForgeSessionMetadata {
  return {
    id,
    title: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-02T00:00:00.000Z',
    messageCount: 1,
  }
}

let windowEnv: WindowEnv

// 测试用桩：在非组件函数里直接调用被测 hook，react-hooks 规则不适用于此。
function renderHook(sessions: QuickForgeSessionMetadata[]) {
  reactStub.cursor = 0
  // eslint-disable-next-line react-hooks/rules-of-hooks -- test stub invokes the hook under test
  return useVisibleRuntimeStatuses(sessions)
}

describe('useVisibleRuntimeStatuses', () => {
  beforeEach(() => {
    reactStub.cursor = 0
    reactStub.states = []
    reactStub.refs = []
    reactStub.memos = []
    reactStub.effects = []
    serverAgentMocks.fetchActiveAgentStatuses.mockClear()
    serverAgentMocks.subscribeToAgentEvents.mockClear()
    windowEnv = createWindowEnv()
    vi.stubGlobal('window', windowEnv)
    vi.stubGlobal('document', createDocumentEnv())
  })

  it('does not refetch /api/agents while the visible id set is unchanged', async () => {
    renderHook([session('session-1'), session('session-2')])
    windowEnv.runTimers()
    await flushMicrotasks()
    expect(serverAgentMocks.fetchActiveAgentStatuses).toHaveBeenCalledTimes(1)

    // 同一批 id、新的 sessions 数组身份（分页刷新会重建数组）——不得重复请求
    renderHook([session('session-1'), session('session-2')])
    windowEnv.runTimers()
    await flushMicrotasks()
    expect(serverAgentMocks.fetchActiveAgentStatuses).toHaveBeenCalledTimes(1)

    // 对照组：id 集合变化时必须重新刷新
    renderHook([session('session-1'), session('session-2'), session('session-3')])
    windowEnv.runTimers()
    await flushMicrotasks()
    expect(serverAgentMocks.fetchActiveAgentStatuses).toHaveBeenCalledTimes(2)
  })
})

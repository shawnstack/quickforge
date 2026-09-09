import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuickForgeSessionMetadata } from '../../src/lib/types'

const reactHarness = vi.hoisted(() => ({
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

// 与真实 React 对齐的最小 harness：deps 不变时 effect/useMemo 不重跑，
// useCallback 每次渲染返回新函数（真实场景中 sessions 数组身份变化即如此）。
vi.mock('react', () => ({
  useCallback<T>(callback: T) {
    return callback
  },
  useEffect(effect: () => void | (() => void), deps?: unknown[]) {
    const index = reactHarness.cursor
    reactHarness.cursor += 1
    const previous = reactHarness.effects[index]
    if (previous && sameDeps(previous.deps, deps)) return
    previous?.cleanup?.()
    const cleanup = effect()
    reactHarness.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
  },
  useMemo<T>(factory: () => T, deps?: unknown[]) {
    const index = reactHarness.cursor
    reactHarness.cursor += 1
    const previous = reactHarness.memos[index]
    if (previous && sameDeps(previous.deps, deps)) return previous.value as T
    const value = factory()
    reactHarness.memos[index] = { deps, value }
    return value
  },
  useRef<T>(initialValue: T) {
    const index = reactHarness.cursor
    reactHarness.cursor += 1
    if (!reactHarness.refs[index]) reactHarness.refs[index] = { current: initialValue }
    return reactHarness.refs[index] as { current: T }
  },
  useState<T>(initialValue: T | (() => T)) {
    const index = reactHarness.cursor
    reactHarness.cursor += 1
    if (!(index in reactHarness.states)) {
      reactHarness.states[index] = typeof initialValue === 'function'
        ? (initialValue as () => T)()
        : initialValue
    }
    const setState = (update: T | ((previous: T) => T)) => {
      const previous = reactHarness.states[index] as T
      reactHarness.states[index] = typeof update === 'function'
        ? (update as (value: T) => T)(previous)
        : update
    }
    return [reactHarness.states[index] as T, setState] as const
  },
}))

vi.mock('@/lib/server-agent', () => serverAgentMocks)
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { useVisibleRuntimeStatuses } from '../../src/hooks/useVisibleRuntimeStatuses'

type WindowHarness = {
  runTimers: () => void
  setTimeout: ReturnType<typeof vi.fn>
  clearTimeout: ReturnType<typeof vi.fn>
}

function createWindowHarness(): WindowHarness {
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

function createDocumentHarness() {
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

let windowHarness: WindowHarness

// 测试用 harness：在非组件函数里直接调用被测 hook，react-hooks 规则不适用于此。
function renderHook(sessions: QuickForgeSessionMetadata[]) {
  reactHarness.cursor = 0
  // eslint-disable-next-line react-hooks/rules-of-hooks -- test harness invokes the hook under test
  return useVisibleRuntimeStatuses(sessions)
}

describe('useVisibleRuntimeStatuses', () => {
  beforeEach(() => {
    reactHarness.cursor = 0
    reactHarness.states = []
    reactHarness.refs = []
    reactHarness.memos = []
    reactHarness.effects = []
    serverAgentMocks.fetchActiveAgentStatuses.mockClear()
    serverAgentMocks.subscribeToAgentEvents.mockClear()
    windowHarness = createWindowHarness()
    vi.stubGlobal('window', windowHarness)
    vi.stubGlobal('document', createDocumentHarness())
  })

  it('does not refetch /api/agents while the visible id set is unchanged', async () => {
    renderHook([session('session-1'), session('session-2')])
    windowHarness.runTimers()
    await flushMicrotasks()
    expect(serverAgentMocks.fetchActiveAgentStatuses).toHaveBeenCalledTimes(1)

    // 同一批 id、新的 sessions 数组身份（分页刷新会重建数组）——不得重复请求
    renderHook([session('session-1'), session('session-2')])
    windowHarness.runTimers()
    await flushMicrotasks()
    expect(serverAgentMocks.fetchActiveAgentStatuses).toHaveBeenCalledTimes(1)

    // 对照组：id 集合变化时必须重新刷新
    renderHook([session('session-1'), session('session-2'), session('session-3')])
    windowHarness.runTimers()
    await flushMicrotasks()
    expect(serverAgentMocks.fetchActiveAgentStatuses).toHaveBeenCalledTimes(2)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'

const reactHarness = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
  stateCursor: 0,
  states: [] as unknown[],
}))

const piMocks = vi.hoisted(() => ({
  getSelectableConfiguredModels: vi.fn(),
  initializePiStorage: vi.fn(),
  loadActiveModel: vi.fn(),
  loadDefaultOptions: vi.fn(),
  mergeAvailableModels: vi.fn((configured: Model<Api>[], cloud: readonly Model<Api>[]) => [...configured, ...cloud]),
  openCodePlaceholderModel: vi.fn(() => ({ id: 'opencode', provider: 'opencode' })),
}))

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('react', () => ({
  useCallback<T>(callback: T) {
    return callback
  },
  useEffect(effect: () => void | (() => void)) {
    const cleanup = effect()
    if (cleanup) reactHarness.cleanups.push(cleanup)
  },
  useRef<T>(initialValue: T) {
    return { current: initialValue }
  },
  useState<T>(initialValue: T | (() => T)) {
    const index = reactHarness.stateCursor
    reactHarness.stateCursor += 1
    reactHarness.states[index] = typeof initialValue === 'function'
      ? (initialValue as () => T)()
      : initialValue
    const setState = (update: T | ((previous: T) => T)) => {
      const previous = reactHarness.states[index] as T
      reactHarness.states[index] = typeof update === 'function'
        ? (update as (current: T) => T)(previous)
        : update
    }
    return [reactHarness.states[index] as T, setState] as const
  },
}))

vi.mock('@/lib/pi-chat', () => piMocks)
vi.mock('@/lib/i18n', () => ({
  applyAppLanguageFromSnapshot: vi.fn(),
  initializeAppLanguage: vi.fn(async () => undefined),
  t: (key: string) => key,
}))
vi.mock('@/lib/http-storage-backend', () => ({ HttpStorageBackend: class {} }))
vi.mock('@/lib/migration-status', () => ({
  fetchMigrationStatus: vi.fn(async () => ({ ok: true, state: 'ready' })),
  waitForMigrationSettled: vi.fn(async () => ({ state: 'ready' })),
}))
vi.mock('@/lib/tool-display-settings', () => ({
  applyToolDisplaySettingsValue: vi.fn(),
  loadToolDisplaySettings: vi.fn(async () => undefined),
}))
vi.mock('@/lib/font-size-settings', () => ({
  applyFontSizeSettings: vi.fn(),
  loadAndApplyFontSizeSettings: vi.fn(async () => undefined),
  normalizeFontSizeSettings: vi.fn((value: unknown) => value),
}))
vi.mock('@/lib/appearance-settings', () => ({
  applyAppearanceSettings: vi.fn(),
  loadAndApplyAppearanceSettings: vi.fn(async () => undefined),
  normalizeAppearanceSettings: vi.fn((value: unknown) => value),
}))
vi.mock('@/lib/types', () => ({
  normalizeAgentHarness: (value: unknown) => value === 'opencode' ? 'opencode' : 'quickforge',
}))
vi.mock('@/lib/startup-model', () => ({
  chooseStartupModel: (models: Model<Api>[]) => models[0] ?? null,
}))
vi.mock('@/lib/managed-cloud-model', () => ({
  isManagedQuickForgeCloudModel: (value: unknown) => (
    typeof value === 'object'
    && value !== null
    && (value as { quickforgeModelSource?: string }).quickforgeModelSource === 'cloud'
  ),
}))
vi.mock('@/lib/logger', () => ({ logger: loggerMocks }))
vi.mock('@/lib/random-id', () => ({ randomId: () => 'startup-session' }))
vi.mock('@/lib/agent-task-retention', () => ({ disposeAllAgentTasks: vi.fn() }))

import { useAppBootstrap } from '../../src/hooks/useAppBootstrap'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

async function flushMicrotasks() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

function localModel() {
  return { id: 'local', provider: 'custom' } as Model<Api>
}

function cloudModel() {
  return {
    id: 'cloud',
    provider: 'quickforge-cloud',
    quickforgeModelSource: 'cloud',
  } as Model<Api>
}

function useBootstrapHarness(
  loadCloudModels: () => Promise<Model<Api>[]>,
  options?: {
    refreshSessions?: () => Promise<void>
    backendRef?: { current: unknown }
  },
) {
  const createAgent = vi.fn(async () => undefined)
  const setNeedsModelSetup = vi.fn()
  const backendRef = options?.backendRef ?? { current: null }
  const refreshSessions = options?.refreshSessions ?? vi.fn(async () => undefined)
  useAppBootstrap({
    storageRef: { current: null },
    backendRef: backendRef as never,
    activeModelRef: { current: localModel() },
    agentAccessModeRef: { current: 'default' },
    taskMapRef: { current: new Map() },
    refreshSessions,
    loadProject: vi.fn(async () => undefined),
    initAgentAccessMode: vi.fn(async () => 'default'),
    createAgent: createAgent as never,
    loadSession: vi.fn(async () => false) as never,
    loadCloudModels,
    readCachedCloudModels: () => [],
    isCloudModelsLoaded: () => false,
    setNeedsModelSetup,
  })
  return { createAgent, refreshSessions, setNeedsModelSetup }
}

describe('useAppBootstrap Cloud loading boundary', () => {
  beforeEach(() => {
    reactHarness.cleanups = []
    reactHarness.stateCursor = 0
    reactHarness.states = []
    vi.clearAllMocks()
    vi.stubGlobal('window', { location: { search: '' } })
    piMocks.initializePiStorage.mockResolvedValue({ backend: {} })
    piMocks.loadActiveModel.mockResolvedValue(null)
    piMocks.loadDefaultOptions.mockResolvedValue({
      harness: 'quickforge',
      model: undefined,
      thinkingLevel: 'off',
    })
  })

  it('does not prefetch Cloud for an OpenCode startup', async () => {
    const loadCloudModels = vi.fn(async () => [cloudModel()])
    piMocks.loadDefaultOptions.mockResolvedValue({
      harness: 'opencode',
      model: undefined,
      thinkingLevel: 'off',
    })

    const { createAgent } = useBootstrapHarness(loadCloudModels)
    await flushMicrotasks()

    expect(loadCloudModels).not.toHaveBeenCalled()
    expect(createAgent).toHaveBeenCalledTimes(1)
  })

  it('starts one Cloud prefetch early and does not await it for an ordinary local startup', async () => {
    const configured = deferred<Model<Api>[]>()
    const cloud = deferred<Model<Api>[]>()
    const loadCloudModels = vi.fn(() => cloud.promise)
    piMocks.getSelectableConfiguredModels.mockReturnValue(configured.promise)

    const { createAgent } = useBootstrapHarness(loadCloudModels)
    await flushMicrotasks()

    expect(loadCloudModels).toHaveBeenCalledTimes(1)
    expect(piMocks.getSelectableConfiguredModels).toHaveBeenCalledTimes(1)
    expect(createAgent).not.toHaveBeenCalled()

    configured.resolve([localModel()])
    await flushMicrotasks()

    expect(createAgent).toHaveBeenCalledTimes(1)
    cloud.resolve([cloudModel()])
    await flushMicrotasks()
  })

  it('awaits the same prefetch for a persisted Cloud model and stops after cancellation', async () => {
    const cloud = deferred<Model<Api>[]>()
    const loadCloudModels = vi.fn(() => cloud.promise)
    piMocks.getSelectableConfiguredModels.mockResolvedValue([localModel()])
    piMocks.loadDefaultOptions.mockResolvedValue({
      harness: 'quickforge',
      model: cloudModel(),
      thinkingLevel: 'off',
    })

    const { createAgent, setNeedsModelSetup } = useBootstrapHarness(loadCloudModels)
    await flushMicrotasks()

    expect(loadCloudModels).toHaveBeenCalledTimes(1)
    expect(setNeedsModelSetup).toHaveBeenCalledWith(true)
    expect(createAgent).not.toHaveBeenCalled()

    for (const cleanup of [...reactHarness.cleanups].reverse()) cleanup()
    cloud.resolve([cloudModel()])
    await flushMicrotasks()

    expect(loadCloudModels).toHaveBeenCalledTimes(1)
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('stops waiting for a stalled Cloud catalog after the deadline and falls back to local models', async () => {
    vi.useFakeTimers()
    try {
      const loadCloudModels = vi.fn(() => new Promise<Model<Api>[]>(() => {}))
      piMocks.getSelectableConfiguredModels.mockResolvedValue([localModel()])
      piMocks.loadDefaultOptions.mockResolvedValue({
        harness: 'quickforge',
        model: cloudModel(),
        thinkingLevel: 'off',
      })

      const { createAgent } = useBootstrapHarness(loadCloudModels)
      await flushMicrotasks()
      expect(reactHarness.states[0]).toBe(true)
      expect(createAgent).not.toHaveBeenCalled()

      vi.advanceTimersByTime(5_000)
      await flushMicrotasks()
      expect(createAgent).toHaveBeenCalledTimes(1)
      expect(createAgent.mock.calls[0][0].model).toMatchObject({ id: 'local', provider: 'custom' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('triggers one session refresh after the backend is ready without blocking Agent creation or ready', async () => {
    const sessionRefresh = deferred<void>()
    const backendRef = { current: null as unknown }
    const backend = {}
    let backendAtRefresh: unknown
    const refreshSessions = vi.fn(() => {
      backendAtRefresh = backendRef.current
      return sessionRefresh.promise
    })
    piMocks.initializePiStorage.mockResolvedValue({ backend })
    piMocks.getSelectableConfiguredModels.mockResolvedValue([localModel()])

    const { createAgent } = useBootstrapHarness(
      vi.fn(async () => []),
      { refreshSessions, backendRef },
    )
    await flushMicrotasks()

    expect(backendRef.current).toBe(backend)
    expect(backendAtRefresh).toBe(backend)
    expect(refreshSessions).toHaveBeenCalledTimes(1)
    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(reactHarness.states[0]).toBe(true)
    expect(reactHarness.states[1]).toBeUndefined()

    sessionRefresh.resolve()
    await flushMicrotasks()
  })

  it('keeps a startup session refresh failure local to the sidebar', async () => {
    const refreshError = new Error('metadata unavailable')
    piMocks.getSelectableConfiguredModels.mockResolvedValue([localModel()])

    const { createAgent, refreshSessions } = useBootstrapHarness(
      vi.fn(async () => []),
      { refreshSessions: vi.fn(async () => Promise.reject(refreshError)) },
    )
    await flushMicrotasks()

    expect(refreshSessions).toHaveBeenCalledTimes(1)
    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(reactHarness.states[0]).toBe(true)
    expect(reactHarness.states[1]).toBeUndefined()
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Failed to refresh startup session list:',
      refreshError,
    )
  })

  it('handles a background prefetch rejection without blocking local startup', async () => {
    const loadCloudModels = vi.fn(async () => Promise.reject(new Error('offline')))
    piMocks.getSelectableConfiguredModels.mockResolvedValue([localModel()])

    const { createAgent } = useBootstrapHarness(loadCloudModels)
    await flushMicrotasks()

    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Failed to restore QuickForge Cloud models:',
      expect.any(Error),
    )
  })
})

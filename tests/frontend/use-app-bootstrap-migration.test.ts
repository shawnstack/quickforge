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

const migrationMocks = vi.hoisted(() => ({
  fetchMigrationStatus: vi.fn(),
  waitForMigrationSettled: vi.fn(),
}))

const settingsSnapshotMocks = vi.hoisted(() => ({
  readAppSettingSnapshotValue: vi.fn(async () => null),
  writeAppSettingSnapshotValue: vi.fn(async () => undefined),
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
  isManagedQuickForgeCloudModel: () => false,
}))
vi.mock('@/lib/logger', () => ({ logger: loggerMocks }))
vi.mock('@/lib/random-id', () => ({ randomId: () => 'startup-session' }))
vi.mock('@/lib/agent-task-retention', () => ({ disposeAllAgentTasks: vi.fn() }))
vi.mock('@/lib/session-message-cache', () => ({
  resolveServerCacheKey: () => 'server-snapshot',
}))
vi.mock('@/lib/app-settings-cache', () => settingsSnapshotMocks)
vi.mock('@/lib/migration-status', () => ({
  MIGRATION_POLL_INTERVAL_MS: 2000,
  fetchMigrationStatus: migrationMocks.fetchMigrationStatus,
  waitForMigrationSettled: migrationMocks.waitForMigrationSettled,
}))

import { useAppBootstrap } from '../../src/hooks/useAppBootstrap'

async function flushMicrotasks() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

function localModel() {
  return { id: 'local', provider: 'custom' } as Model<Api>
}

const MIGRATING_STATUS = {
  ok: true,
  state: 'migrating',
  domains: {
    scheduledRuns: { phase: 'hybrid', runCount: 3 },
    sessionState: { phase: 'cutover_running', stateCount: 42 },
    share: { phase: 'authoritative', shareCount: 5 },
    lanAccess: { phase: 'unknown' },
  },
}

// React harness state slots: 0=ready, 1=startupError, 2=retryNonce,
// 3=migrationStatus (order fixed by the hook's useState calls).
const READY_STATE = 0
const STARTUP_ERROR_STATE = 1
const RETRY_NONCE_STATE = 2
const MIGRATION_STATUS_STATE = 3

type GateOptions = { onStatus?: (status: unknown) => void }

function useBootstrapHarness(options?: { storageRef?: { current: unknown } }) {
  const createAgent = vi.fn(async () => undefined)
  const storageRef = options?.storageRef ?? { current: null }
  const boot = useAppBootstrap({
    storageRef: storageRef as never,
    backendRef: { current: null },
    activeModelRef: { current: localModel() },
    agentAccessModeRef: { current: 'default' },
    taskMapRef: { current: new Map() },
    refreshSessions: vi.fn(async () => undefined),
    loadProject: vi.fn(async () => undefined),
    initAgentAccessMode: vi.fn(async () => 'default'),
    createAgent: createAgent as never,
    loadSession: vi.fn(async () => false) as never,
    loadCloudModels: vi.fn(async () => []),
    readCachedCloudModels: () => [],
    isCloudModelsLoaded: () => false,
    setNeedsModelSetup: vi.fn(),
  })
  return { createAgent, storageRef, retryBootstrap: boot.retryBootstrap }
}

describe('useAppBootstrap startup maintenance window', () => {
  beforeEach(() => {
    reactHarness.cleanups = []
    reactHarness.stateCursor = 0
    reactHarness.states = []
    vi.clearAllMocks()
    vi.stubGlobal('window', { location: { search: '' } })
    piMocks.initializePiStorage.mockResolvedValue({ backend: {} })
    piMocks.loadActiveModel.mockResolvedValue(null)
    piMocks.getSelectableConfiguredModels.mockResolvedValue([localModel()])
    piMocks.loadDefaultOptions.mockResolvedValue({
      harness: 'quickforge',
      model: undefined,
      thinkingLevel: 'off',
    })
    migrationMocks.fetchMigrationStatus.mockResolvedValue({ ok: true, state: 'ready' })
    migrationMocks.waitForMigrationSettled.mockImplementation(async (gateOptions: GateOptions = {}) => {
      const status = await migrationMocks.fetchMigrationStatus()
      if (!status.ok) throw new Error('QuickForge migration status is unavailable.')
      gateOptions.onStatus?.(status)
      if (status.state === 'failed') return { state: 'failed', startupError: status.startupError }
      return { state: 'ready' }
    })
  })

  it('boots straight through when the server is already ready', async () => {
    const { createAgent } = useBootstrapHarness()

    await flushMicrotasks()

    expect(migrationMocks.waitForMigrationSettled).toHaveBeenCalledTimes(1)
    expect(reactHarness.states[READY_STATE]).toBe(true)
    expect(reactHarness.states[STARTUP_ERROR_STATE]).toBeUndefined()
    expect(reactHarness.states[MIGRATION_STATUS_STATE]).toBeUndefined()
    expect(createAgent).toHaveBeenCalledTimes(1)
  })

  it('parks the boot in the migration window and resumes once ready', async () => {
    let resolveGate!: (outcome: unknown) => void
    const gate = new Promise<unknown>((resolve) => { resolveGate = resolve })
    migrationMocks.waitForMigrationSettled.mockImplementation(async (gateOptions: GateOptions = {}) => {
      gateOptions.onStatus?.(MIGRATING_STATUS)
      return gate
    })
    const storageRef = { current: null }
    const { createAgent } = useBootstrapHarness({ storageRef })

    await flushMicrotasks()

    // Window open: progress snapshot exposed, nothing booted, storage untouched.
    expect(reactHarness.states[MIGRATION_STATUS_STATE]).toEqual(MIGRATING_STATUS)
    expect(reactHarness.states[READY_STATE]).toBe(false)
    expect(storageRef.current).toBe(null)
    expect(createAgent).not.toHaveBeenCalled()

    resolveGate({ state: 'ready' })
    await flushMicrotasks()

    expect(reactHarness.states[READY_STATE]).toBe(true)
    expect(reactHarness.states[MIGRATION_STATUS_STATE]).toBeUndefined()
    expect(storageRef.current).toEqual({ backend: {} })
    expect(createAgent).toHaveBeenCalledTimes(1)
  })

  it('reports a migration failure with the server detail and stops booting', async () => {
    migrationMocks.waitForMigrationSettled.mockResolvedValue({ state: 'failed', startupError: 'session cutover failed' })
    const { createAgent } = useBootstrapHarness()

    await flushMicrotasks()

    expect(reactHarness.states[READY_STATE]).toBe(false)
    expect(reactHarness.states[STARTUP_ERROR_STATE]).toEqual({
      message: 'migration.failedDescription',
      kind: 'migration',
      detail: 'session cutover failed',
    })
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('falls back to the generic service error when the status endpoint is unreachable', async () => {
    migrationMocks.waitForMigrationSettled.mockRejectedValue(new Error('QuickForge migration status is unavailable.'))
    migrationMocks.fetchMigrationStatus.mockResolvedValue({ ok: false })
    const { createAgent } = useBootstrapHarness()

    await flushMicrotasks()

    expect(reactHarness.states[READY_STATE]).toBe(false)
    expect(reactHarness.states[STARTUP_ERROR_STATE]).toEqual({
      message: 'localServiceUnavailableDescription',
      kind: 'service',
    })
    expect(createAgent).not.toHaveBeenCalled()
    expect(loggerMocks.error).toHaveBeenCalledTimes(1)
  })

  it('explains migration failures caught by storage initialization (failed-at-load path)', async () => {
    piMocks.initializePiStorage.mockRejectedValue(new Error('QuickForge local service is unavailable.'))
    migrationMocks.fetchMigrationStatus.mockResolvedValue({
      ok: true,
      state: 'failed',
      startupError: 'scheduled runs cutover crashed',
    })
    const { createAgent } = useBootstrapHarness()

    await flushMicrotasks()

    expect(migrationMocks.fetchMigrationStatus).toHaveBeenCalledTimes(1)
    expect(reactHarness.states[STARTUP_ERROR_STATE]).toEqual({
      message: 'migration.failedDescription',
      kind: 'migration',
      detail: 'scheduled runs cutover crashed',
    })
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('recovers when boot races into the maintenance window and auto-retries once ready', async () => {
    piMocks.initializePiStorage.mockRejectedValue(new Error('QuickForge local service is unavailable.'))
    migrationMocks.fetchMigrationStatus.mockResolvedValue(MIGRATING_STATUS)
    let resolveGate!: (outcome: unknown) => void
    const gate = new Promise<unknown>((resolve) => { resolveGate = resolve })
    migrationMocks.waitForMigrationSettled.mockImplementation(async (gateOptions: GateOptions = {}) => {
      gateOptions.onStatus?.(MIGRATING_STATUS)
      return gate
    })
    const storageRef = { current: null }
    const { createAgent } = useBootstrapHarness({ storageRef })

    await flushMicrotasks()

    // The catch path probed a migrating window, so the generic error card is
    // skipped and the UI parks on the migration progress view instead.
    expect(reactHarness.states[STARTUP_ERROR_STATE]).toBeUndefined()
    expect(reactHarness.states[MIGRATION_STATUS_STATE]).toEqual(MIGRATING_STATUS)
    expect(reactHarness.states[READY_STATE]).toBe(false)
    expect(storageRef.current).toBe(null)
    expect(createAgent).not.toHaveBeenCalled()
    expect(migrationMocks.waitForMigrationSettled).toHaveBeenCalledWith(
      expect.objectContaining({ onStatus: expect.any(Function), isCancelled: expect.any(Function) }),
    )

    resolveGate({ state: 'ready' })
    await flushMicrotasks()

    // Window closed: progress view cleared, no error card, boot auto-retries.
    expect(reactHarness.states[MIGRATION_STATUS_STATE]).toBeUndefined()
    expect(reactHarness.states[STARTUP_ERROR_STATE]).toBeUndefined()
    expect(reactHarness.states[RETRY_NONCE_STATE]).toBe(1)
    expect(reactHarness.states[READY_STATE]).toBe(false)

    // The retryNonce change re-runs the boot effect; the window is closed now,
    // so the second boot goes straight through.
    piMocks.initializePiStorage.mockResolvedValue({ backend: {} })
    migrationMocks.fetchMigrationStatus.mockResolvedValue({ ok: true, state: 'ready' })
    migrationMocks.waitForMigrationSettled.mockResolvedValue({ state: 'ready' })
    const secondReadyState = reactHarness.stateCursor
    const second = useBootstrapHarness()
    await flushMicrotasks()
    expect(migrationMocks.waitForMigrationSettled).toHaveBeenCalledTimes(2)
    expect(second.createAgent).toHaveBeenCalledTimes(1)
    expect(reactHarness.states[secondReadyState]).toBe(true)
  })

  it('shows the migration error card when the race recovery gate fails', async () => {
    piMocks.initializePiStorage.mockRejectedValue(new Error('QuickForge local service is unavailable.'))
    migrationMocks.fetchMigrationStatus.mockResolvedValue(MIGRATING_STATUS)
    migrationMocks.waitForMigrationSettled.mockImplementation(async (gateOptions: GateOptions = {}) => {
      gateOptions.onStatus?.(MIGRATING_STATUS)
      return { state: 'failed', startupError: 'session cutover crashed mid-window' }
    })
    const { createAgent } = useBootstrapHarness()

    await flushMicrotasks()

    expect(reactHarness.states[STARTUP_ERROR_STATE]).toEqual({
      message: 'migration.failedDescription',
      kind: 'migration',
      detail: 'session cutover crashed mid-window',
    })
    expect(reactHarness.states[RETRY_NONCE_STATE]).toBe(0)
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('retry clears the failure and re-runs the full boot including the gate', async () => {
    migrationMocks.waitForMigrationSettled.mockResolvedValue({ state: 'failed', startupError: 'boom' })
    const { retryBootstrap } = useBootstrapHarness()
    await flushMicrotasks()
    expect(reactHarness.states[STARTUP_ERROR_STATE]?.kind).toBe('migration')

    retryBootstrap()
    expect(reactHarness.states[STARTUP_ERROR_STATE]).toBeUndefined()
    expect(reactHarness.states[MIGRATION_STATUS_STATE]).toBeUndefined()
    expect(reactHarness.states[RETRY_NONCE_STATE]).toBe(1)

    // The retryNonce change re-runs the boot effect; the server is ready now.
    migrationMocks.waitForMigrationSettled.mockResolvedValue({ state: 'ready' })
    // A fresh useAppBootstrap call allocates the next state slots; capture
    // where the second mount's `ready` lives.
    const secondReadyState = reactHarness.stateCursor
    const second = useBootstrapHarness()
    await flushMicrotasks()
    expect(migrationMocks.waitForMigrationSettled).toHaveBeenCalledTimes(2)
    expect(second.createAgent).toHaveBeenCalledTimes(1)
    expect(reactHarness.states[secondReadyState]).toBe(true)
  })
})

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

const i18nMocks = vi.hoisted(() => ({
  applyAppLanguageFromSnapshot: vi.fn(),
  initializeAppLanguage: vi.fn(),
}))

const toolDisplayMocks = vi.hoisted(() => ({
  applyToolDisplaySettingsValue: vi.fn(),
  loadToolDisplaySettings: vi.fn(),
}))

const appearanceMocks = vi.hoisted(() => ({
  applyAppearanceSettings: vi.fn(),
  loadAndApplyAppearanceSettings: vi.fn(),
  normalizeAppearanceSettings: vi.fn((value: unknown) => value),
}))

const fontSizeMocks = vi.hoisted(() => ({
  applyFontSizeSettings: vi.fn(),
  loadAndApplyFontSizeSettings: vi.fn(),
  normalizeFontSizeSettings: vi.fn((value: unknown) => value),
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
  applyAppLanguageFromSnapshot: i18nMocks.applyAppLanguageFromSnapshot,
  initializeAppLanguage: i18nMocks.initializeAppLanguage,
  t: (key: string) => key,
}))
vi.mock('@/lib/http-storage-backend', () => ({ HttpStorageBackend: class {} }))
vi.mock('@/lib/migration-status', () => ({
  fetchMigrationStatus: vi.fn(async () => ({ ok: true, state: 'ready' })),
  waitForMigrationSettled: vi.fn(async () => ({ state: 'ready' })),
}))
vi.mock('@/lib/tool-display-settings', () => ({
  applyToolDisplaySettingsValue: toolDisplayMocks.applyToolDisplaySettingsValue,
  loadToolDisplaySettings: toolDisplayMocks.loadToolDisplaySettings,
}))
vi.mock('@/lib/font-size-settings', () => ({
  applyFontSizeSettings: fontSizeMocks.applyFontSizeSettings,
  loadAndApplyFontSizeSettings: fontSizeMocks.loadAndApplyFontSizeSettings,
  normalizeFontSizeSettings: fontSizeMocks.normalizeFontSizeSettings,
}))
vi.mock('@/lib/appearance-settings', () => ({
  applyAppearanceSettings: appearanceMocks.applyAppearanceSettings,
  loadAndApplyAppearanceSettings: appearanceMocks.loadAndApplyAppearanceSettings,
  normalizeAppearanceSettings: appearanceMocks.normalizeAppearanceSettings,
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
vi.mock('@/lib/session-message-cache', () => ({
  resolveServerCacheKey: () => 'server-snapshot',
}))
vi.mock('@/lib/app-settings-cache', () => settingsSnapshotMocks)

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

/** 快照值与服务器校准值刻意不同，便于断言来源。 */
const SNAPSHOT_VALUES: Record<string, unknown> = {
  'language': 'en',
  'appearance-settings': { theme: 'light' },
  'font-size-settings': { interfaceFontSizePx: 12, messageFontSizePx: 12 },
  'tool-display-settings': { toolDisplayMode: 'compact', showContextUsage: false },
}

const SERVER_VALUES: Record<string, unknown> = {
  'language': 'zh',
  'appearance-settings': { theme: 'dark' },
  'font-size-settings': { interfaceFontSizePx: 15, messageFontSizePx: 15 },
  'tool-display-settings': { toolDisplayMode: 'detailed', showContextUsage: true },
}

function mockSnapshotHit() {
  settingsSnapshotMocks.readAppSettingSnapshotValue.mockImplementation(
    async (_serverKey: string, key: string) => SNAPSHOT_VALUES[key] ?? null,
  )
}

function useBootstrapHarness() {
  const createAgent = vi.fn(async () => undefined)
  useAppBootstrap({
    storageRef: { current: null },
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
  return { createAgent }
}

describe('useAppBootstrap settings snapshot (stale-while-revalidate)', () => {
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
    i18nMocks.initializeAppLanguage.mockResolvedValue(SERVER_VALUES.language)
    toolDisplayMocks.loadToolDisplaySettings.mockResolvedValue(SERVER_VALUES['tool-display-settings'])
    appearanceMocks.loadAndApplyAppearanceSettings.mockResolvedValue(SERVER_VALUES['appearance-settings'])
    fontSizeMocks.loadAndApplyFontSizeSettings.mockResolvedValue(SERVER_VALUES['font-size-settings'])
    settingsSnapshotMocks.readAppSettingSnapshotValue.mockResolvedValue(null)
  })

  it('preapplies all four snapshot values before initializePiStorage resolves', async () => {
    const storageReady = deferred<{ backend: unknown }>()
    const callOrder: string[] = []
    piMocks.initializePiStorage.mockImplementation(() => {
      callOrder.push('initializePiStorage')
      return storageReady.promise
    })
    settingsSnapshotMocks.readAppSettingSnapshotValue.mockImplementation(
      async (_serverKey: string, key: string) => {
        callOrder.push(`read:${key}`)
        return SNAPSHOT_VALUES[key] ?? null
      },
    )

    const { createAgent } = useBootstrapHarness()
    await flushMicrotasks()

    // 快照读取与预应用都发生在存储初始化（health+构造后端）完成之前。
    expect(callOrder).toEqual([
      'read:language',
      'read:appearance-settings',
      'read:font-size-settings',
      'read:tool-display-settings',
      'initializePiStorage',
    ])
    expect(settingsSnapshotMocks.readAppSettingSnapshotValue.mock.calls.every(
      (call) => call[0] === 'server-snapshot',
    )).toBe(true)
    expect(i18nMocks.applyAppLanguageFromSnapshot).toHaveBeenCalledTimes(1)
    expect(i18nMocks.applyAppLanguageFromSnapshot).toHaveBeenCalledWith('en')
    expect(appearanceMocks.applyAppearanceSettings).toHaveBeenCalledWith({ theme: 'light' })
    expect(fontSizeMocks.applyFontSizeSettings).toHaveBeenCalledWith({ interfaceFontSizePx: 12, messageFontSizePx: 12 })
    expect(toolDisplayMocks.applyToolDisplaySettingsValue).toHaveBeenCalledWith({
      toolDisplayMode: 'compact',
      showContextUsage: false,
    })
    // initializePiStorage 尚未 resolve：ready 仍为 false。
    expect(reactHarness.states[0]).toBe(false)

    storageReady.resolve({ backend: {} })
    await flushMicrotasks()
    expect(reactHarness.states[0]).toBe(true)
    expect(createAgent).toHaveBeenCalledTimes(1)
  })

  it('skips every preapply on snapshot miss and keeps the boot flow unchanged', async () => {
    const { createAgent } = useBootstrapHarness()
    await flushMicrotasks()

    expect(settingsSnapshotMocks.readAppSettingSnapshotValue).toHaveBeenCalledTimes(4)
    expect(i18nMocks.applyAppLanguageFromSnapshot).not.toHaveBeenCalled()
    expect(appearanceMocks.applyAppearanceSettings).not.toHaveBeenCalled()
    expect(fontSizeMocks.applyFontSizeSettings).not.toHaveBeenCalled()
    expect(toolDisplayMocks.applyToolDisplaySettingsValue).not.toHaveBeenCalled()
    expect(piMocks.initializePiStorage).toHaveBeenCalledTimes(1)
    expect(i18nMocks.initializeAppLanguage).toHaveBeenCalledTimes(1)
    expect(toolDisplayMocks.loadToolDisplaySettings).toHaveBeenCalledTimes(1)
    expect(appearanceMocks.loadAndApplyAppearanceSettings).toHaveBeenCalledTimes(1)
    expect(fontSizeMocks.loadAndApplyFontSizeSettings).toHaveBeenCalledTimes(1)
    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(reactHarness.states[0]).toBe(true)
    expect(loggerMocks.error).not.toHaveBeenCalled()
  })

  it('writes the four server-calibrated values back into the snapshot once ready', async () => {
    const { createAgent } = useBootstrapHarness()
    await flushMicrotasks()

    expect(reactHarness.states[0]).toBe(true)
    expect(settingsSnapshotMocks.writeAppSettingSnapshotValue).toHaveBeenCalledTimes(4)
    const written = settingsSnapshotMocks.writeAppSettingSnapshotValue.mock.calls.map(
      (call) => [call[1], call[2]],
    )
    expect(written).toEqual([
      ['language', 'zh'],
      ['appearance-settings', { theme: 'dark' }],
      ['font-size-settings', { interfaceFontSizePx: 15, messageFontSizePx: 15 }],
      ['tool-display-settings', { toolDisplayMode: 'detailed', showContextUsage: true }],
    ])
    expect(settingsSnapshotMocks.writeAppSettingSnapshotValue.mock.calls.every(
      (call) => call[0] === 'server-snapshot',
    )).toBe(true)
    expect(createAgent).toHaveBeenCalledTimes(1)
  })

  it('keeps booting when a snapshot preapply throws', async () => {
    mockSnapshotHit()
    appearanceMocks.applyAppearanceSettings.mockImplementation(() => {
      throw new Error('apply failed')
    })
    fontSizeMocks.applyFontSizeSettings.mockImplementation(() => {
      throw new Error('apply failed')
    })

    const { createAgent } = useBootstrapHarness()
    await flushMicrotasks()

    // 抛错的键被吞掉，其余键照常预应用，启动流程不受影响。
    expect(i18nMocks.applyAppLanguageFromSnapshot).toHaveBeenCalledWith('en')
    expect(toolDisplayMocks.applyToolDisplaySettingsValue).toHaveBeenCalledTimes(1)
    expect(piMocks.initializePiStorage).toHaveBeenCalledTimes(1)
    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(reactHarness.states[0]).toBe(true)
    expect(reactHarness.states[1]).toBeUndefined()
    expect(loggerMocks.error).not.toHaveBeenCalled()
  })
})

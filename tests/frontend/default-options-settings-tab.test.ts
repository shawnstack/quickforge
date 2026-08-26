import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'

vi.hoisted(() => {
  // The tab module registers a custom element on import; keep that inert in Node.
  globalThis.customElements ??= {
    get: () => undefined,
    define: () => undefined,
  } as unknown as typeof CustomElementRegistry
})

const piWebUiMocks = vi.hoisted(() => ({
  SettingsTab: class {
    requestUpdate() {}
  },
  getAppStorage: vi.fn(),
}))

const piChatMocks = vi.hoisted(() => ({
  defaultThinkingLevelForModel: vi.fn(() => 'off'),
  getSelectableConfiguredModels: vi.fn(),
  loadDefaultOptions: vi.fn(),
  mergeAvailableModels: vi.fn((base: unknown[], cloud: unknown[] = []) => [...base, ...cloud]),
  saveDefaultOptions: vi.fn(async () => undefined),
}))

const modelReferenceMocks = vi.hoisted(() => ({
  loadModelCatalog: vi.fn(),
}))

const cloudClientMocks = vi.hoisted(() => ({
  getCloudStatus: vi.fn(),
  getCloudModels: vi.fn(),
}))

vi.mock('@earendil-works/pi-web-ui', () => piWebUiMocks)
vi.mock('@/lib/pi-chat', () => piChatMocks)
vi.mock('@/lib/model-reference', () => modelReferenceMocks)
vi.mock('@/lib/cloud-client', () => cloudClientMocks)
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/tool-display-settings', () => ({
  loadToolDisplaySettings: vi.fn(async () => ({ toolDisplayMode: 'compact', showContextUsage: false })),
  saveToolDisplaySettings: vi.fn(async () => undefined),
}))
vi.mock('@/lib/auto-compact-settings', () => ({
  loadAutoCompactSettings: vi.fn(async () => ({
    enabled: true, requireConfirmation: true, thresholdPercent: 80, keepRecentTurns: 3,
  })),
  saveAutoCompactSettings: vi.fn(async () => undefined),
}))
vi.mock('@/lib/auto-archive-settings', () => ({
  loadAutoArchiveSettings: vi.fn(async () => ({ enabled: false })),
  saveAutoArchiveSettings: vi.fn(async () => undefined),
}))
vi.mock('@/lib/i18n', () => ({
  applyAppLanguage: vi.fn(async () => undefined),
  getAppLanguage: vi.fn(() => 'zh'),
  t: (key: string) => key,
}))
vi.mock('@/lib/system-notifications', () => ({
  getSystemNotificationPermission: vi.fn(async () => 'denied'),
  isSystemNotificationsEnabled: vi.fn(() => false),
  requestSystemNotificationPermission: vi.fn(async () => 'denied'),
  setSystemNotificationsEnabled: vi.fn(),
  showTaskSystemNotification: vi.fn(),
}))
vi.mock('@/components/ui/confirm-dialog', () => ({ showConfirm: vi.fn(async () => false) }))
vi.mock('@/hooks/useCloudModels', () => ({ CLOUD_STATE_CHANGED_EVENT: 'quickforge:cloud-state-changed' }))
vi.mock('../../src/lib/info-tip', () => ({}))
vi.mock('../../src/lib/quickforge-settings-select', () => ({}))

import { DefaultOptionsSettingsTab } from '../../src/lib/default-options-settings-tab'

const baseModel = {
  id: 'base', name: 'Base', provider: 'custom', api: 'openai-completions', baseUrl: 'https://base.example/v1',
} as Model<Api>
const secondBaseModel = {
  id: 'second', name: 'Second', provider: 'custom', api: 'openai-completions', baseUrl: 'https://base.example/v1',
} as Model<Api>
const cloudModel = {
  id: 'cloud-fast', name: 'Cloud Fast', provider: 'quickforge-cloud', api: 'openai-completions',
  baseUrl: 'quickforge://cloud/cloud-fast', quickforgeModelSource: 'cloud', quickforgeCatalogId: 'cloud-fast',
} as Model<Api>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

type TestTab = DefaultOptionsSettingsTab & {
  loadSettings: () => Promise<void>
  updateModel: (value: string) => void
  models: Model<Api>[]
  selectedModel?: Model<Api>
  loading: boolean
}

function createTab(): TestTab {
  return new DefaultOptionsSettingsTab() as TestTab
}

describe('default options settings tab incremental Cloud merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
    piWebUiMocks.getAppStorage.mockReturnValue({ settings: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) } })
    piChatMocks.getSelectableConfiguredModels.mockResolvedValue([])
    piChatMocks.loadDefaultOptions.mockResolvedValue({})
    modelReferenceMocks.loadModelCatalog.mockResolvedValue([baseModel, secondBaseModel])
    cloudClientMocks.getCloudStatus.mockResolvedValue({ configured: true, mode: 'account', hasSession: true })
  })

  it('renders catalog models first and merges the slow Cloud catalog in the background', async () => {
    piChatMocks.loadDefaultOptions.mockResolvedValue({ model: cloudModel })
    const cloudCatalog = deferred<Model<Api>[]>()
    cloudClientMocks.getCloudModels.mockImplementationOnce(() => cloudCatalog.promise)

    const tab = createTab()
    const loaded = tab.loadSettings()
    await loaded
    expect(tab.loading).toBe(false)
    expect(tab.models).toEqual([baseModel, secondBaseModel])
    // The Cloud default is not in the catalog yet, so the first automatic pick falls back.
    expect(tab.selectedModel).toBe(baseModel)

    cloudCatalog.resolve([cloudModel])
    await flushMicrotasks()
    expect(tab.models).toEqual([baseModel, secondBaseModel, cloudModel])
    expect(tab.selectedModel).toBe(cloudModel)
  })

  it('keeps a manually changed selection when the Cloud catalog arrives late', async () => {
    const cloudCatalog = deferred<Model<Api>[]>()
    cloudClientMocks.getCloudModels.mockImplementationOnce(() => cloudCatalog.promise)

    const tab = createTab()
    await tab.loadSettings()
    tab.updateModel(JSON.stringify([secondBaseModel.provider, secondBaseModel.id, secondBaseModel.api, secondBaseModel.baseUrl]))
    expect(tab.selectedModel).toBe(secondBaseModel)

    cloudCatalog.resolve([cloudModel])
    await flushMicrotasks()
    expect(tab.models).toEqual([baseModel, secondBaseModel, cloudModel])
    expect(tab.selectedModel).toBe(secondBaseModel)
  })
})

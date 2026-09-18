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
  mergeAvailableModels: vi.fn((base: unknown[], extra: unknown[] = []) => [...base, ...extra]),
  saveDefaultOptions: vi.fn(async () => undefined),
}))

const modelReferenceMocks = vi.hoisted(() => ({
  loadModelCatalog: vi.fn(),
}))

vi.mock('@earendil-works/pi-web-ui', () => piWebUiMocks)
vi.mock('@/lib/pi-chat', () => piChatMocks)
vi.mock('@/lib/model-reference', () => modelReferenceMocks)
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/tool-display-settings', () => ({
  loadToolDisplaySettings: vi.fn(async () => ({ toolDisplayMode: 'compact', showContextUsage: false })),
  saveToolDisplaySettings: vi.fn(async () => undefined),
}))
vi.mock('@/lib/auto-compact-settings', () => ({
  loadAutoCompactSettings: vi.fn(async () => ({
    enabled: true, requireConfirmation: true, thresholdPercent: 80, keepRecentTurns: 0,
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
vi.mock('../../src/lib/info-tip', () => ({}))
vi.mock('../../src/lib/quickforge-settings-select', () => ({}))

import { DefaultOptionsSettingsTab } from '../../src/lib/default-options-settings-tab'

const baseModel = {
  id: 'base', name: 'Base', provider: 'custom', api: 'openai-completions', baseUrl: 'https://base.example/v1',
} as Model<Api>
const secondBaseModel = {
  id: 'second', name: 'Second', provider: 'custom', api: 'openai-completions', baseUrl: 'https://base.example/v1',
} as Model<Api>

function modelKey(model: Model<Api>) {
  return JSON.stringify([model.provider, model.id, model.api, (model.baseUrl ?? '').trim().replace(/\/$/, '')])
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

describe('default options settings tab local model catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
    piWebUiMocks.getAppStorage.mockReturnValue({ settings: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) } })
    piChatMocks.getSelectableConfiguredModels.mockResolvedValue([])
    piChatMocks.loadDefaultOptions.mockResolvedValue({})
    modelReferenceMocks.loadModelCatalog.mockResolvedValue([baseModel, secondBaseModel])
  })

  it('auto-selects the saved default from the catalog', async () => {
    piChatMocks.loadDefaultOptions.mockResolvedValue({ model: secondBaseModel })

    const tab = createTab()
    await tab.loadSettings()

    expect(tab.loading).toBe(false)
    expect(tab.models).toEqual([baseModel, secondBaseModel])
    expect(tab.selectedModel).toBe(secondBaseModel)
  })

  it('falls back to the first catalog model when the saved default is missing', async () => {
    piChatMocks.loadDefaultOptions.mockResolvedValue({ model: { ...baseModel, id: 'removed' } as Model<Api> })

    const tab = createTab()
    await tab.loadSettings()

    expect(tab.models).toEqual([baseModel, secondBaseModel])
    expect(tab.selectedModel).toBe(baseModel)
  })

  it('updates the manual selection immediately', async () => {
    const tab = createTab()
    await tab.loadSettings()

    tab.updateModel(modelKey(secondBaseModel))

    expect(tab.selectedModel).toBe(secondBaseModel)
  })
})

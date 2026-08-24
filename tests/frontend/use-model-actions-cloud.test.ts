import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'

const modelListMocks = vi.hoisted(() => ({
  readCachedModelList: vi.fn(),
  readCachedModelListStale: vi.fn(),
  writeCachedModelList: vi.fn(),
}))

const piMocks = vi.hoisted(() => ({
  getSelectableConfiguredModels: vi.fn(),
  mergeAvailableModels: vi.fn((custom: Model<Api>[], cloud: readonly Model<Api>[]) => [...custom, ...cloud]),
}))

const selectorMocks = vi.hoisted(() => ({
  openCustomOnlyModelSelector: vi.fn(() => ({
    isOpen: () => true,
    updateModels: vi.fn(),
  })),
}))

const confirmMocks = vi.hoisted(() => ({
  showConfirm: vi.fn(async () => false),
}))

vi.mock('react', () => ({
  useCallback<T>(callback: T) {
    return callback
  },
}))

vi.mock('@/lib/pi-chat', () => ({
  buildConnectionModel: vi.fn(),
  DEFAULT_CONNECTION: {},
  initializePiStorage: vi.fn(),
  loadInitialConfiguredModel: vi.fn(),
  saveActiveModel: vi.fn(async () => undefined),
  saveConnectionProfile: vi.fn(async () => undefined),
  ...piMocks,
}))
vi.mock('@/lib/custom-model-selector', () => selectorMocks)
vi.mock('@/lib/model-list-cache', () => modelListMocks)
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/random-id', () => ({ randomId: () => 'model-actions' }))
vi.mock('@/components/ui/confirm-dialog', () => confirmMocks)

import { useModelActions } from '../../src/hooks/useModelActions'

async function flushMicrotasks() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

function cloudModel() {
  return { id: 'cloud', provider: 'quickforge-cloud' } as Model<Api>
}

function useActionsHarness(options: {
  loadCloudModels: () => Promise<Model<Api>[]>
  isCloudModelsLoaded: () => boolean
}) {
  const currentModel = { id: 'current', provider: 'custom' } as Model<Api>
  const openSettingsPage = vi.fn()
  const actions = useModelActions({
    storageRef: { current: {} as never },
    activeModelRef: { current: currentModel },
    agentRef: {
      current: {
        sessionId: 'session-1',
        state: { model: currentModel, thinkingLevel: 'off' },
        updateThinkingLevel: vi.fn(async () => undefined),
      } as never,
    },
    createAgent: vi.fn() as never,
    updateCurrentAgentModel: vi.fn(),
    setChatPanelRevision: vi.fn(),
    setNeedsModelSetup: vi.fn(),
    setRestoredDraft: vi.fn(),
    notifySettingsChanged: vi.fn(),
    openSettingsPage,
    loadCloudModels: options.loadCloudModels,
    readCachedCloudModels: () => [],
    isCloudModelsLoaded: options.isCloudModelsLoaded,
  })
  return { actions, openSettingsPage }
}

describe('useModelActions Cloud selector boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelListMocks.readCachedModelList.mockReturnValue([])
    vi.stubGlobal('HTMLElement', class HTMLElement {})
    vi.stubGlobal('document', { querySelector: vi.fn(() => null) })
  })

  it('waits for Cloud instead of showing an empty-model confirmation before Cloud is loaded', async () => {
    const loadCloudModels = vi.fn(async () => [cloudModel()])
    const { actions, openSettingsPage } = useActionsHarness({
      loadCloudModels,
      isCloudModelsLoaded: () => false,
    })

    actions.openCustomModelSelector()
    expect(confirmMocks.showConfirm).not.toHaveBeenCalled()

    await flushMicrotasks()

    expect(loadCloudModels).toHaveBeenCalledTimes(1)
    expect(selectorMocks.openCustomOnlyModelSelector).toHaveBeenCalledWith(
      expect.anything(),
      [cloudModel()],
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ onOpenModelSettings: expect.any(Function) }),
    )
    const selectorOptions = selectorMocks.openCustomOnlyModelSelector.mock.calls[0]?.[4]
    selectorOptions?.onOpenModelSettings?.()
    expect(openSettingsPage).toHaveBeenCalledWith('customModels', undefined)
    expect(confirmMocks.showConfirm).not.toHaveBeenCalled()
  })

  it('does not show an empty-model confirmation when the Cloud request fails closed', async () => {
    const loadCloudModels = vi.fn(async () => [])
    const { actions } = useActionsHarness({
      loadCloudModels,
      isCloudModelsLoaded: () => false,
    })

    actions.openCustomModelSelector()
    await flushMicrotasks()

    expect(loadCloudModels).toHaveBeenCalledTimes(1)
    expect(selectorMocks.openCustomOnlyModelSelector).not.toHaveBeenCalled()
    expect(confirmMocks.showConfirm).not.toHaveBeenCalled()
  })

  it('shows the existing confirmation only after Cloud is known to be empty', async () => {
    const loadCloudModels = vi.fn(async () => [])
    const { actions } = useActionsHarness({
      loadCloudModels,
      isCloudModelsLoaded: () => true,
    })

    actions.openCustomModelSelector()
    await flushMicrotasks()

    expect(loadCloudModels).not.toHaveBeenCalled()
    expect(selectorMocks.openCustomOnlyModelSelector).not.toHaveBeenCalled()
    expect(confirmMocks.showConfirm).toHaveBeenCalledWith({
      description: 'addCustomModelFirst',
      confirmLabel: 'modelSetupAddModel',
      cancelLabel: 'cancel',
    })
  })
})

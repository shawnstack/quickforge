import { useCallback } from 'react'
import {
  ProxyTab,
  SettingsDialog,
} from '@mariozechner/pi-web-ui'
import type { Api, Model } from '@mariozechner/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import {
  buildConnectionModel,
  DEFAULT_CONNECTION,
  getConfiguredModels,
  initializePiStorage,
  loadInitialConfiguredModel,
  saveActiveModel,
  saveConnectionProfile,
} from '@/lib/pi-chat'
import { createCustomProvidersOnlyTab } from '@/lib/custom-providers-only-tab'
import { t } from '@/lib/i18n'
import { createLanguageSettingsTab } from '@/lib/language-settings-tab'
import { openCustomOnlyModelSelector } from '@/lib/custom-model-selector'
import type { RestoredDraft } from '@/lib/types'

type UseModelActionsOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  activeModelRef: React.MutableRefObject<Model<Api>>
  agentRef: AgentManager['agentRef']
  createAgent: AgentManager['createAgent']
  updateCurrentAgentModel: AgentManager['updateCurrentAgentModel']
  setChatPanelRevision: AgentManager['setChatPanelRevision']
  needsModelSetup: boolean
  setNeedsModelSetup: React.Dispatch<React.SetStateAction<boolean>>
  setRestoredDraft: React.Dispatch<React.SetStateAction<RestoredDraft | undefined>>
  notifySettingsChanged: () => void
}

export function useModelActions({
  storageRef,
  activeModelRef,
  agentRef,
  createAgent,
  updateCurrentAgentModel,
  setChatPanelRevision,
  needsModelSetup,
  setNeedsModelSetup,
  setRestoredDraft,
  notifySettingsChanged,
}: UseModelActionsOptions) {
  const activateConfiguredModel = useCallback(async () => {
    const storage = storageRef.current
    if (!storage) return false

    const model = await loadInitialConfiguredModel(storage)
    if (!model) {
      setNeedsModelSetup(true)
      return false
    }

    activeModelRef.current = model
    setNeedsModelSetup(false)
    await saveActiveModel(storage, model)

    const currentAgent = agentRef.current
    if (currentAgent) {
      updateCurrentAgentModel(model)
      setChatPanelRevision((value) => value + 1)
    } else {
      await createAgent(
        { model, tools: [] },
        crypto.randomUUID(),
        { scope: 'global', attachToView: true },
      )
    }

    notifySettingsChanged()
    return true
  }, [
    storageRef,
    activeModelRef,
    agentRef,
    createAgent,
    updateCurrentAgentModel,
    setChatPanelRevision,
    setNeedsModelSetup,
    notifySettingsChanged,
  ])

  const openModelSettings = useCallback(() => {
    SettingsDialog.open(
      [createLanguageSettingsTab(), createCustomProvidersOnlyTab(), new ProxyTab()],
      () => {
        if (needsModelSetup || !agentRef.current) {
          void activateConfiguredModel().catch((error) => console.error('Failed to activate configured model:', error))
        }
      },
    )
    window.setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dialog = document.querySelector('settings-dialog') as any
      if (dialog) {
        dialog.activeTabIndex = 1
        dialog.requestUpdate?.()
      }
    }, 0)
  }, [activateConfiguredModel, needsModelSetup, agentRef])

  const activateLiteLlmExampleModel = useCallback(async () => {
    const storage = storageRef.current
    if (!storage) return

    const model = buildConnectionModel(DEFAULT_CONNECTION)
    await saveConnectionProfile(storage, DEFAULT_CONNECTION, model)
    await saveActiveModel(storage, model)
    activeModelRef.current = model
    setNeedsModelSetup(false)

    if (agentRef.current) {
      updateCurrentAgentModel(model)
      setChatPanelRevision((value) => value + 1)
    } else {
      await createAgent(
        { model, tools: [] },
        crypto.randomUUID(),
        { scope: 'global', attachToView: true },
      )
    }
    notifySettingsChanged()
  }, [
    storageRef,
    activeModelRef,
    agentRef,
    createAgent,
    updateCurrentAgentModel,
    setChatPanelRevision,
    setNeedsModelSetup,
    notifySettingsChanged,
  ])

  const openCustomModelSelector = useCallback(async () => {
    const storage = storageRef.current
    const currentAgent = agentRef.current
    if (!storage || !currentAgent) return

    const textarea = document.querySelector<HTMLTextAreaElement>(
      'agent-interface message-editor textarea',
    )
    const currentInput = textarea?.value ?? ''

    const customProviders = await storage.customProviders.getAll()

    for (const provider of customProviders) {
      if (provider.apiKey) {
        await storage.providerKeys.set(provider.name, provider.apiKey)
      }
    }

    const customModels = await getConfiguredModels(storage)

    if (customModels.length === 0) {
      if (confirm(t('addCustomModelFirst'))) {
        openModelSettings()
      }
      return
    }

    openCustomOnlyModelSelector(
      currentAgent.state.model ?? activeModelRef.current,
      customModels,
      (model) => {
        const nextModel = model as Model<Api>
        currentAgent.state.model = nextModel
        activeModelRef.current = nextModel
        updateCurrentAgentModel(nextModel)
        void currentAgent.updateModel(nextModel).catch((error) => {
          console.error('Failed to sync model to server:', error)
        })

        if (currentInput) {
          setRestoredDraft({
            id: Date.now(),
            text: currentInput,
          })
        }

        setChatPanelRevision((value) => value + 1)
        void saveActiveModel(storage, nextModel).catch((error) => {
          console.error('Failed to save active model:', error)
        })
      },
      async (model) => {
        await SettingsDialog.open([createLanguageSettingsTab(), createCustomProvidersOnlyTab(model.provider), new ProxyTab()])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dialog = document.querySelector('settings-dialog') as any
        if (dialog) {
          dialog.activeTabIndex = 1
          dialog.requestUpdate?.()
        }
      },
    )
  }, [
    storageRef,
    activeModelRef,
    agentRef,
    updateCurrentAgentModel,
    setChatPanelRevision,
    setRestoredDraft,
    openModelSettings,
  ])

  return {
    activateConfiguredModel,
    openModelSettings,
    activateLiteLlmExampleModel,
    openCustomModelSelector,
  }
}

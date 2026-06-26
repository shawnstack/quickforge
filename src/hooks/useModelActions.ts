import { useCallback } from 'react'
import { SettingsDialog } from '@earendil-works/pi-web-ui'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import {
  buildConnectionModel,
  configuredModelsFromProviders,
  DEFAULT_CONNECTION,
  initializePiStorage,
  loadInitialConfiguredModel,
  saveActiveModel,
  saveConnectionProfile,
} from '@/lib/pi-chat'
import { createCustomProvidersOnlyTab } from '@/lib/custom-providers-only-tab'
import { t } from '@/lib/i18n'
import { createLanguageSettingsTab } from '@/lib/language-settings-tab'
import { createDefaultOptionsSettingsTab } from '@/lib/default-options-settings-tab'
import { createBackupSettingsTab } from '@/lib/backup-settings-tab'
import { createServiceSettingsTab } from '@/lib/service-settings-tab'
import { createLanAccessSettingsTab } from '@/lib/lan-access-settings-tab'
import { createAboutSettingsTab } from '@/lib/about-settings-tab'
import { createProjectCommandsSettingsTab } from '@/lib/project-commands-settings-tab'
import { createChannelsSettingsTab } from '@/lib/channels-settings-tab'
import { openCustomOnlyModelSelector } from '@/lib/custom-model-selector'
import type { RestoredDraft } from '@/lib/types'
import { logger } from '@/lib/logger'
import { randomId } from '@/lib/random-id'
import { showConfirm } from '@/components/ui/confirm-dialog'

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
  setSettingsDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
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
  setSettingsDialogOpen,
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
        randomId(),
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

  const openSettingsDialog = useCallback((initialTab: 'defaults' | 'customModels') => {
    setSettingsDialogOpen(true)
    SettingsDialog.open(
      [createLanguageSettingsTab(), createDefaultOptionsSettingsTab(), createCustomProvidersOnlyTab(), createProjectCommandsSettingsTab(), createBackupSettingsTab(), createServiceSettingsTab(), createChannelsSettingsTab(), createLanAccessSettingsTab(), createAboutSettingsTab()],
      () => {
        setSettingsDialogOpen(false)
        if (needsModelSetup || !agentRef.current) {
          void activateConfiguredModel().catch((error) => logger.error('Failed to activate configured model:', error))
        }
      },
    )
    window.setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dialog = document.querySelector('settings-dialog') as any
      if (dialog) {
        dialog.activeTabIndex = initialTab === 'defaults' ? 1 : 2
        dialog.requestUpdate?.()
      }
    }, 0)
  }, [activateConfiguredModel, needsModelSetup, agentRef, setSettingsDialogOpen])

  const openModelSettings = useCallback(() => {
    openSettingsDialog('customModels')
  }, [openSettingsDialog])

  const openDefaultOptionsSettings = useCallback(() => {
    openSettingsDialog('defaults')
  }, [openSettingsDialog])

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
        randomId(),
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

  const openCustomModelSelector = useCallback(async (event?: Event | HTMLElement) => {
    const storage = storageRef.current
    const currentAgent = agentRef.current
    if (!storage || !currentAgent) return

    const anchor = event instanceof HTMLElement
      ? event
      : event?.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : document.querySelector<HTMLElement>('.quickforge-model-trigger')

    const textarea = document.querySelector<HTMLTextAreaElement>(
      'agent-interface message-editor textarea',
    )
    const currentInput = textarea?.value ?? ''

    const customProviders = await storage.customProviders.getAll()
    const customModels = configuredModelsFromProviders(customProviders)

    if (customModels.length === 0) {
      const confirmed = await showConfirm({
        description: t('addCustomModelFirst'),
        confirmLabel: t('modelSetupAddModel'),
        cancelLabel: t('cancel'),
      })
      if (confirmed) {
        openModelSettings()
      }
      return
    }

    openCustomOnlyModelSelector(
      currentAgent.state.model ?? activeModelRef.current,
      customModels,
      (model) => {
        const nextModel = model as Model<Api>
        const nextThinkingLevel = nextModel.reasoning ? currentAgent.state.thinkingLevel : 'off'
        if (currentAgent.state.thinkingLevel !== nextThinkingLevel) {
          currentAgent.state.thinkingLevel = nextThinkingLevel
          void currentAgent.updateThinkingLevel(nextThinkingLevel).catch((error) => {
            logger.error('Failed to sync thinking level to server:', error)
          })
        }
        activeModelRef.current = nextModel
        updateCurrentAgentModel(nextModel)

        if (currentInput) {
          setRestoredDraft({
            id: Date.now(),
            sessionId: currentAgent.sessionId,
            text: currentInput,
          })
        }

        setChatPanelRevision((value) => value + 1)
        void saveActiveModel(storage, nextModel).catch((error) => {
          logger.error('Failed to save active model:', error)
        })
      },
      async (model) => {
        setSettingsDialogOpen(true)
        await SettingsDialog.open([createLanguageSettingsTab(), createDefaultOptionsSettingsTab(), createCustomProvidersOnlyTab(model.provider), createProjectCommandsSettingsTab(), createBackupSettingsTab(), createServiceSettingsTab(), createChannelsSettingsTab(), createLanAccessSettingsTab(), createAboutSettingsTab()], () => setSettingsDialogOpen(false))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dialog = document.querySelector('settings-dialog') as any
        if (dialog) {
          dialog.activeTabIndex = 2
          dialog.requestUpdate?.()
        }
      },
      {
        thinkingLevel: currentAgent.state.thinkingLevel,
        anchor,
        onThinkingLevelSelect: (level) => {
          currentAgent.state.thinkingLevel = level
          void currentAgent.updateThinkingLevel(level).catch((error) => {
            logger.error('Failed to sync thinking level to server:', error)
          })
          setChatPanelRevision((value) => value + 1)
        },
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
    setSettingsDialogOpen,
  ])

  return {
    activateConfiguredModel,
    openModelSettings,
    openDefaultOptionsSettings,
    activateLiteLlmExampleModel,
    openCustomModelSelector,
  }
}

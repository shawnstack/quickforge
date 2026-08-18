import { useCallback } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import {
  buildConnectionModel,
  DEFAULT_CONNECTION,
  initializePiStorage,
  loadInitialConfiguredModel,
  mergeAvailableModels,
  saveActiveModel,
  saveConnectionProfile,
  getSelectableConfiguredModels,
} from '@/lib/pi-chat'
import { openCustomOnlyModelSelector } from '@/lib/custom-model-selector'
import type { ModelSelectorHandle } from '@/lib/custom-model-selector'
import {
  readCachedModelList,
  readCachedModelListStale,
  writeCachedModelList,
} from '@/lib/model-list-cache'
import type { SettingsInitialTab } from '@/lib/settings-tabs'
import { t } from '@/lib/i18n'
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
  setNeedsModelSetup: React.Dispatch<React.SetStateAction<boolean>>
  setRestoredDraft: React.Dispatch<React.SetStateAction<RestoredDraft | undefined>>
  notifySettingsChanged: () => void
  openSettingsPage: (initialTab: SettingsInitialTab, customProvider?: string) => void
  loadCloudModels: () => Promise<Model<Api>[]>
  readCachedCloudModels: () => readonly Model<Api>[]
  isCloudModelsLoaded: () => boolean
}

export function useModelActions({
  storageRef,
  activeModelRef,
  agentRef,
  createAgent,
  updateCurrentAgentModel,
  setChatPanelRevision,
  setNeedsModelSetup,
  setRestoredDraft,
  notifySettingsChanged,
  openSettingsPage,
  loadCloudModels,
  readCachedCloudModels,
  isCloudModelsLoaded,
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


  const openSettingsDialog = useCallback((initialTab: SettingsInitialTab, customProvider?: string) => {
    openSettingsPage(initialTab, customProvider)
  }, [openSettingsPage])

  const openModelSettings = useCallback(() => {
    openSettingsDialog('customModels')
  }, [openSettingsDialog])

  const openDefaultOptionsSettings = useCallback(() => {
    openSettingsDialog('defaults')
  }, [openSettingsDialog])

  const openAboutSettings = useCallback(() => {
    openSettingsDialog('about')
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

  const openCustomModelSelector = useCallback((event?: Event | HTMLElement) => {
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
    const messageEditor = document.querySelector<HTMLElement & { attachments?: unknown[] }>(
      'agent-interface message-editor',
    )
    const currentInput = textarea?.value ?? ''
    const currentAttachments = messageEditor?.attachments ? [...messageEditor.attachments] : []

    const showEmptyModelConfirmation = () => {
      void showConfirm({
        description: t('addCustomModelFirst'),
        confirmLabel: t('modelSetupAddModel'),
        cancelLabel: t('cancel'),
      }).then((confirmed) => {
        if (confirmed) openModelSettings()
      })
    }

    const openSelector = (customModels: Model<Api>[]) => {
      const availableModels = mergeAvailableModels(customModels, readCachedCloudModels())

      if (availableModels.length === 0) {
        if (isCloudModelsLoaded()) {
          showEmptyModelConfirmation()
          return
        }

        void loadCloudModels()
          .then((loadedCloudModels) => {
            const loadedModels = mergeAvailableModels(customModels, loadedCloudModels)
            if (loadedModels.length === 0) {
              if (isCloudModelsLoaded()) showEmptyModelConfirmation()
              return
            }
            openSelectorWithModels(customModels, loadedModels, false)
          })
          .catch((error) => {
            logger.warn('Failed to load QuickForge Cloud models:', error)
          })
        return
      }

      openSelectorWithModels(customModels, availableModels, true)
    }

    const openSelectorWithModels = (
      customModels: Model<Api>[],
      availableModels: Model<Api>[],
      refreshCloudModels: boolean,
    ) => {
      const selector: ModelSelectorHandle | null = openCustomOnlyModelSelector(
        currentAgent.state.model ?? activeModelRef.current,
        availableModels,
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

          if (currentInput || currentAttachments.length > 0) {
            setRestoredDraft({
              id: Date.now(),
              sessionId: currentAgent.sessionId,
              text: currentInput,
              attachments: currentAttachments,
            })
          }

          setChatPanelRevision((value) => value + 1)
          void saveActiveModel(storage, nextModel).catch((error) => {
            logger.error('Failed to save active model:', error)
          })
        },
        async (model) => {
          if (model.provider === 'quickforge-cloud') return
          openSettingsDialog('customModels', model.provider)
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

      if (!refreshCloudModels) return
      void loadCloudModels()
        .then((loadedCloudModels) => {
          if (!selector?.isOpen()) return
          selector.updateModels(mergeAvailableModels(customModels, loadedCloudModels))
        })
        .catch((error) => {
          logger.warn('Failed to load QuickForge Cloud models:', error)
        })
    }

    // 有本地缓存时同步打开；否则本地目录完成后打开，不等待 Cloud 请求。
    const cachedCustomModels = readCachedModelList()
    if (cachedCustomModels) {
      openSelector(cachedCustomModels)
      return
    }

    void getSelectableConfiguredModels(storage)
      .then((customModels) => {
        writeCachedModelList(customModels)
        openSelector(customModels)
      })
      .catch((error) => {
        logger.error('Failed to load custom models, falling back to cache:', error)
        const staleCustomModels = readCachedModelListStale()
        if (staleCustomModels) openSelector(staleCustomModels)
      })
  }, [
    storageRef,
    activeModelRef,
    agentRef,
    updateCurrentAgentModel,
    setChatPanelRevision,
    setRestoredDraft,
    openModelSettings,
    openSettingsDialog,
    loadCloudModels,
    readCachedCloudModels,
    isCloudModelsLoaded,
  ])

  return {
    activateConfiguredModel,
    openModelSettings,
    openDefaultOptionsSettings,
    openAboutSettings,
    activateLiteLlmExampleModel,
    openCustomModelSelector,
  }
}

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
  selectableModelsFromProviders,
} from '@/lib/pi-chat'
import { openCustomOnlyModelSelector } from '@/lib/custom-model-selector'
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
  startGuestCloud: () => Promise<Model<Api>[]>
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
  startGuestCloud,
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

  const activateGuestCloudModel = useCallback(async () => {
    const storage = storageRef.current
    if (!storage) return false

    const cloudModels = await startGuestCloud()
    const model = cloudModels[0]
    if (!model) throw new Error('QuickForge Cloud 没有可用模型。')

    activeModelRef.current = model
    setNeedsModelSetup(false)
    await saveActiveModel(storage, model)

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
    return true
  }, [
    storageRef,
    startGuestCloud,
    activeModelRef,
    setNeedsModelSetup,
    agentRef,
    updateCurrentAgentModel,
    setChatPanelRevision,
    createAgent,
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
    const messageEditor = document.querySelector<HTMLElement & { attachments?: unknown[] }>(
      'agent-interface message-editor',
    )
    const currentInput = textarea?.value ?? ''
    const currentAttachments = messageEditor?.attachments ? [...messageEditor.attachments] : []

    // 缓存优先：TTL 内直接用缓存打开选择器，避免每次请求后端；
    // 无有效缓存时拉取后端并写入缓存；请求失败用过期缓存兜底。
    let customModels = readCachedModelList()
    if (!customModels) {
      try {
        const customProviders = await storage.customProviders.getAll()
        customModels = selectableModelsFromProviders(customProviders)
        writeCachedModelList(customModels)
      } catch (error) {
        logger.error('Failed to load custom models, falling back to cache:', error)
        customModels = readCachedModelListStale()
      }
      if (!customModels) return
    }

    const cloudModels = await loadCloudModels().catch((error) => {
      logger.warn('Failed to load QuickForge Cloud models:', error)
      return []
    })
    const availableModels = mergeAvailableModels(customModels, cloudModels)

    if (availableModels.length === 0) {
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
  ])

  return {
    activateConfiguredModel,
    activateGuestCloudModel,
    openModelSettings,
    openDefaultOptionsSettings,
    openAboutSettings,
    activateLiteLlmExampleModel,
    openCustomModelSelector,
  }
}

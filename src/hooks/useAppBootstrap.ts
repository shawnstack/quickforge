import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import {
  initializePiStorage,
  loadDefaultOptions,
  loadInitialConfiguredModel,
} from '@/lib/pi-chat'
import { initializeAppLanguage, t } from '@/lib/i18n'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { loadToolDisplaySettings } from '@/lib/tool-display-settings'
import { loadAndApplyFontSizeSettings } from '@/lib/font-size-settings'
import { loadAndApplyAppearanceSettings } from '@/lib/appearance-settings'
import type { AgentAccessMode } from '@/lib/types'
import { logger } from '@/lib/logger'
import { randomId } from '@/lib/random-id'
import { disposeAllAgentTasks } from '@/lib/agent-task-retention'

type UseAppBootstrapOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  backendRef: React.MutableRefObject<HttpStorageBackend | null>
  activeModelRef: React.MutableRefObject<Model<Api>>
  agentAccessModeRef: React.MutableRefObject<AgentAccessMode>
  taskMapRef: AgentManager['taskMapRef']
  refreshSessions: () => Promise<void>
  loadProject: () => Promise<void>
  initAgentAccessMode: (storage: Awaited<ReturnType<typeof initializePiStorage>>) => Promise<AgentAccessMode>
  createAgent: AgentManager['createAgent']
  loadSession: AgentManager['loadSession']
  loadCloudModels: () => Promise<Model<Api>[]>
  setNeedsModelSetup: React.Dispatch<React.SetStateAction<boolean>>
  onStorageReady?: (storage: Awaited<ReturnType<typeof initializePiStorage>>) => void
}

export function useAppBootstrap({
  storageRef,
  backendRef,
  activeModelRef,
  agentAccessModeRef,
  taskMapRef,
  refreshSessions,
  loadProject,
  initAgentAccessMode,
  createAgent,
  loadSession,
  loadCloudModels,
  setNeedsModelSetup,
  onStorageReady,
}: UseAppBootstrapOptions) {
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string>()
  const [retryNonce, setRetryNonce] = useState(0)

  // Keep callbacks in refs so the bootstrap effect runs exactly once
  const depsRef = useRef({
    refreshSessions,
    loadProject,
    initAgentAccessMode,
    createAgent,
    loadSession,
    loadCloudModels,
    setNeedsModelSetup,
    onStorageReady,
  })
  useEffect(() => {
    depsRef.current = {
      refreshSessions,
      loadProject,
      initAgentAccessMode,
      createAgent,
      loadSession,
      loadCloudModels,
      setNeedsModelSetup,
      onStorageReady,
    }
  })

  useEffect(() => {
    let cancelled = false

    async function boot() {
      const {
        refreshSessions: refreshSessionList,
        loadProject: loadProj,
        initAgentAccessMode: initAccessMode,
        createAgent: create,
        loadSession: restoreSession,
        loadCloudModels: loadCloud,
        setNeedsModelSetup: setModelSetup,
        onStorageReady: onReady,
      } = depsRef.current

      try {
        setReady(false)
        setStartupError(undefined)
        const storage = await initializePiStorage()
        if (cancelled) return

        storageRef.current = storage
        onReady?.(storage)
        backendRef.current = storage.backend as HttpStorageBackend
        await initializeAppLanguage(storage)
        await loadToolDisplaySettings(storage)
        await loadAndApplyAppearanceSettings(storage)
        await loadAndApplyFontSizeSettings(storage)
        await Promise.all([refreshSessionList(), loadProj()])

        const savedAccessMode = await initAccessMode(storage)
        agentAccessModeRef.current = savedAccessMode

        let cloudModels: Model<Api>[] = []
        try {
          cloudModels = await loadCloud()
        } catch (error) {
          logger.warn('Failed to restore QuickForge Cloud models:', error)
        }
        const initialModel = await loadInitialConfiguredModel(storage, cloudModels)
        const defaultOptions = await loadDefaultOptions(storage)
        if (initialModel) activeModelRef.current = defaultOptions.model ?? initialModel

        const sessionId = new URLSearchParams(window.location.search).get('session')
        if (sessionId) {
          const restored = await restoreSession(sessionId)
          if (!restored) {
            if (initialModel) {
              await create(
                { model: defaultOptions.model ?? initialModel, thinkingLevel: defaultOptions.thinkingLevel, tools: [] },
                randomId(),
                { scope: 'global', attachToView: true },
              )
            } else {
              setModelSetup(true)
            }
          }
        } else if (initialModel) {
          await create(
            { model: defaultOptions.model ?? initialModel, thinkingLevel: defaultOptions.thinkingLevel, tools: [] },
            randomId(),
            { scope: 'global', attachToView: true },
          )
        } else {
          setModelSetup(true)
        }

        setReady(true)
      } catch (error) {
        logger.error('Failed to bootstrap QuickForge:', error)
        if (!cancelled) setStartupError(t('localServiceUnavailableDescription'))
      }
    }

    boot()
    const taskMap = taskMapRef.current
    return () => {
      cancelled = true
      disposeAllAgentTasks(taskMap)
    }
  }, [
    storageRef,
    backendRef,
    activeModelRef,
    agentAccessModeRef,
    taskMapRef,
    retryNonce,
  ])

  const retryBootstrap = useCallback(() => {
    setReady(false)
    setStartupError(undefined)
    setRetryNonce((value) => value + 1)
  }, [])

  return { ready, startupError, retryBootstrap }
}

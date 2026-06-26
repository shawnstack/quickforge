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
import type {
  AgentAccessMode,
  ProjectInfo,
  QuickForgeSessionData,
  QuickForgeSessionMetadata,
} from '@/lib/types'
import { normalizeAgentAccessMode, sessionScope } from '@/lib/types'
import { logger } from '@/lib/logger'
import { randomId } from '@/lib/random-id'
import { showAlert } from '@/components/ui/confirm-dialog'

type UseAppBootstrapOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  backendRef: React.MutableRefObject<HttpStorageBackend | null>
  activeModelRef: React.MutableRefObject<Model<Api>>
  agentAccessModeRef: React.MutableRefObject<AgentAccessMode>
  activeProjectRef: React.MutableRefObject<ProjectInfo | undefined>
  setAgentAccessMode: React.Dispatch<React.SetStateAction<AgentAccessMode>>
  taskMapRef: AgentManager['taskMapRef']
  loadGlobalSessions: (offset: number) => Promise<void>
  loadProject: () => Promise<void>
  initAgentAccessMode: (storage: Awaited<ReturnType<typeof initializePiStorage>>) => Promise<AgentAccessMode>
  switchActiveProject: (projectId: string) => Promise<ProjectInfo>
  createAgent: AgentManager['createAgent']
  setNeedsModelSetup: React.Dispatch<React.SetStateAction<boolean>>
  onStorageReady?: (storage: Awaited<ReturnType<typeof initializePiStorage>>) => void
}

export function useAppBootstrap({
  storageRef,
  backendRef,
  activeModelRef,
  agentAccessModeRef,
  activeProjectRef,
  setAgentAccessMode,
  taskMapRef,
  loadGlobalSessions,
  loadProject,
  initAgentAccessMode,
  switchActiveProject,
  createAgent,
  setNeedsModelSetup,
  onStorageReady,
}: UseAppBootstrapOptions) {
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string>()
  const [retryNonce, setRetryNonce] = useState(0)

  // Keep callbacks in refs so the bootstrap effect runs exactly once
  const depsRef = useRef({
    loadGlobalSessions,
    loadProject,
    initAgentAccessMode,
    switchActiveProject,
    createAgent,
    setNeedsModelSetup,
    onStorageReady,
  })
  useEffect(() => {
    depsRef.current = {
      loadGlobalSessions,
      loadProject,
      initAgentAccessMode,
      switchActiveProject,
      createAgent,
      setNeedsModelSetup,
      onStorageReady,
    }
  })

  useEffect(() => {
    let cancelled = false

    async function boot() {
      const {
        loadGlobalSessions: loadSessions,
        loadProject: loadProj,
        initAgentAccessMode: initAccessMode,
        switchActiveProject: switchProject,
        createAgent: create,
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
        await Promise.all([loadSessions(0), loadProj()])

        const savedAccessMode = await initAccessMode(storage)
        agentAccessModeRef.current = savedAccessMode

        const initialModel = await loadInitialConfiguredModel(storage)
        const defaultOptions = await loadDefaultOptions(storage)
        if (initialModel) activeModelRef.current = defaultOptions.model ?? initialModel

        const sessionId = new URLSearchParams(window.location.search).get('session')
        if (sessionId) {
          const existing = await storage.sessions.get(sessionId)
          if (existing) {
            const metadata = (await storage.sessions.getMetadata(existing.id)) as QuickForgeSessionMetadata | null
            const scope = sessionScope(metadata ?? (existing as QuickForgeSessionData))
            let project: ProjectInfo | undefined
            if (scope === 'project' && (metadata?.projectId || (existing as QuickForgeSessionData).projectId)) {
              const projectId = (metadata?.projectId ?? (existing as QuickForgeSessionData).projectId)!
              if (activeProjectRef.current?.id !== projectId) {
                try {
                  project = await switchProject(projectId)
                } catch (error) {
                  logger.error('Failed to switch project for initial session:', error)
                  void showAlert(t('projectSwitchFailed'))
                  if (initialModel) {
                    await create(
                      { model: defaultOptions.model ?? initialModel, thinkingLevel: defaultOptions.thinkingLevel, tools: [] },
                      randomId(),
                      { scope: 'global', attachToView: true },
                    )
                  } else {
                    setModelSetup(true)
                  }
                  setReady(true)
                  return
                }
              } else {
                project = activeProjectRef.current
              }
            }
            activeModelRef.current = existing.model as Model<Api>
            const sessionAccessMode = normalizeAgentAccessMode((existing as QuickForgeSessionData).accessMode, (existing as QuickForgeSessionData).yoloMode)
            agentAccessModeRef.current = sessionAccessMode
            setAgentAccessMode(sessionAccessMode)
            await create(
              {
                model: existing.model,
                thinkingLevel: existing.thinkingLevel,
                messages: existing.messages,
                tools: [],
              },
              existing.id,
              {
                scope,
                project,
                attachToView: true,
                createdAt: existing.createdAt,
                title: existing.title,
                accessMode: sessionAccessMode,
              },
            )
          } else if (initialModel) {
            await create(
              { model: defaultOptions.model ?? initialModel, thinkingLevel: defaultOptions.thinkingLevel, tools: [] },
              randomId(),
              { scope: 'global', attachToView: true },
            )
          } else {
            setModelSetup(true)
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
      for (const task of taskMap.values()) {
        task.unsubscribe()
        task.agent.dispose()
      }
      taskMap.clear()
    }
  }, [
    storageRef,
    backendRef,
    activeModelRef,
    agentAccessModeRef,
    activeProjectRef,
    setAgentAccessMode,
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

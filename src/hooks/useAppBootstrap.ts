import { useEffect, useState } from 'react'
import type { Api, Model } from '@mariozechner/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import {
  initializePiStorage,
  loadDefaultOptions,
  loadInitialConfiguredModel,
} from '@/lib/pi-chat'
import { initializeAppLanguage, t } from '@/lib/i18n'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { loadToolDisplaySettings } from '@/lib/tool-display-settings'
import type {
  ProjectInfo,
  QuickForgeSessionData,
  QuickForgeSessionMetadata,
} from '@/lib/types'
import { sessionScope } from '@/lib/types'
import { logger } from '@/lib/logger'
import { randomId } from '@/lib/random-id'
import { showAlert } from '@/components/ui/confirm-dialog'

type UseAppBootstrapOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  backendRef: React.MutableRefObject<HttpStorageBackend | null>
  activeModelRef: React.MutableRefObject<Model<Api>>
  yoloModeRef: React.MutableRefObject<boolean>
  activeProjectRef: React.MutableRefObject<ProjectInfo | undefined>
  setYoloMode: React.Dispatch<React.SetStateAction<boolean>>
  taskMapRef: AgentManager['taskMapRef']
  loadGlobalSessions: (offset: number) => Promise<void>
  loadProject: () => Promise<void>
  initYoloMode: (storage: Awaited<ReturnType<typeof initializePiStorage>>) => Promise<boolean>
  switchActiveProject: (projectId: string) => Promise<ProjectInfo>
  createAgent: AgentManager['createAgent']
  setNeedsModelSetup: React.Dispatch<React.SetStateAction<boolean>>
}

export function useAppBootstrap({
  storageRef,
  backendRef,
  activeModelRef,
  yoloModeRef,
  activeProjectRef,
  setYoloMode,
  taskMapRef,
  loadGlobalSessions,
  loadProject,
  initYoloMode,
  switchActiveProject,
  createAgent,
  setNeedsModelSetup,
}: UseAppBootstrapOptions) {
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string>()

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        const storage = await initializePiStorage()
        if (cancelled) return

        storageRef.current = storage
        backendRef.current = storage.backend as HttpStorageBackend
        await initializeAppLanguage(storage)
        await loadToolDisplaySettings(storage)
        await Promise.all([loadGlobalSessions(0), loadProject()])

        const savedYoloMode = await initYoloMode(storage)
        yoloModeRef.current = savedYoloMode

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
                  project = await switchActiveProject(projectId)
                } catch (error) {
                  logger.error('Failed to switch project for initial session:', error)
                  void showAlert(t('projectSwitchFailed'))
                  if (initialModel) {
                    await createAgent(
                      { model: defaultOptions.model ?? initialModel, thinkingLevel: defaultOptions.thinkingLevel, tools: [] },
                      randomId(),
                      { scope: 'global', attachToView: true },
                    )
                  } else {
                    setNeedsModelSetup(true)
                  }
                  setReady(true)
                  return
                }
              } else {
                project = activeProjectRef.current
              }
            }
            activeModelRef.current = existing.model as Model<Api>
            const sessionYoloMode = (existing as QuickForgeSessionData).yoloMode === true
            yoloModeRef.current = sessionYoloMode
            setYoloMode(sessionYoloMode)
            await createAgent(
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
                yoloMode: sessionYoloMode,
              },
            )
          } else if (initialModel) {
            await createAgent(
              { model: defaultOptions.model ?? initialModel, thinkingLevel: defaultOptions.thinkingLevel, tools: [] },
              randomId(),
              { scope: 'global', attachToView: true },
            )
          } else {
            setNeedsModelSetup(true)
          }
        } else if (initialModel) {
          await createAgent(
            { model: defaultOptions.model ?? initialModel, thinkingLevel: defaultOptions.thinkingLevel, tools: [] },
            randomId(),
            { scope: 'global', attachToView: true },
          )
        } else {
          setNeedsModelSetup(true)
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
    yoloModeRef,
    activeProjectRef,
    setYoloMode,
    taskMapRef,
    loadGlobalSessions,
    loadProject,
    initYoloMode,
    switchActiveProject,
    createAgent,
    setNeedsModelSetup,
  ])

  return { ready, startupError }
}

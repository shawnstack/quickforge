import { useEffect, useState } from 'react'
import type { Api, Model } from '@mariozechner/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import {
  initializePiStorage,
  loadInitialConfiguredModel,
} from '@/lib/pi-chat'
import { initializeAppLanguage, t } from '@/lib/i18n'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import type {
  ProjectInfo,
  QuickForgeSessionData,
  QuickForgeSessionMetadata,
} from '@/lib/types'
import { sessionScope } from '@/lib/types'

type UseAppBootstrapOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  backendRef: React.MutableRefObject<HttpStorageBackend | null>
  activeModelRef: React.MutableRefObject<Model<Api>>
  yoloModeRef: React.MutableRefObject<boolean>
  activeProjectRef: React.MutableRefObject<ProjectInfo | undefined>
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
        await Promise.all([loadGlobalSessions(0), loadProject()])

        const savedYoloMode = await initYoloMode(storage)
        yoloModeRef.current = savedYoloMode

        const initialModel = await loadInitialConfiguredModel(storage)
        if (initialModel) activeModelRef.current = initialModel

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
                  console.error('Failed to switch project for initial session:', error)
                  alert(t('projectSwitchFailed'))
                  if (initialModel) {
                    await createAgent(
                      { model: initialModel, tools: [] },
                      crypto.randomUUID(),
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
              },
            )
          } else if (initialModel) {
            await createAgent(
              { model: initialModel, tools: [] },
              crypto.randomUUID(),
              { scope: 'global', attachToView: true },
            )
          } else {
            setNeedsModelSetup(true)
          }
        } else if (initialModel) {
          await createAgent(
            { model: initialModel, tools: [] },
            crypto.randomUUID(),
            { scope: 'global', attachToView: true },
          )
        } else {
          setNeedsModelSetup(true)
        }

        setReady(true)
      } catch (error) {
        console.error('Failed to bootstrap QuickForge:', error)
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

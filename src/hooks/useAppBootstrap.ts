import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import {
  getSelectableConfiguredModels,
  initializePiStorage,
  loadActiveModel,
  loadActiveThinkingLevel,
  mergeAvailableModels,
  resolveNewSessionThinkingLevel,
} from '@/lib/pi-chat'
import { initializeAppLanguage, applyAppLanguageFromSnapshot, t } from '@/lib/i18n'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { applyToolDisplaySettingsValue, loadToolDisplaySettings } from '@/lib/tool-display-settings'
import { applyFontSizeSettings, loadAndApplyFontSizeSettings, normalizeFontSizeSettings } from '@/lib/font-size-settings'
import {
  applyAppearanceSettings,
  loadAndApplyAppearanceSettings,
  normalizeAppearanceSettings,
} from '@/lib/appearance-settings'
import { readAppSettingSnapshotValue, writeAppSettingSnapshotValue } from '@/lib/app-settings-cache'
import { resolveServerCacheKey } from '@/lib/session-message-cache'
import type { AgentAccessMode } from '@/lib/types'
import { chooseStartupModel } from '@/lib/startup-model'
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
  setNeedsModelSetup: React.Dispatch<React.SetStateAction<boolean>>
  onStorageReady?: (storage: Awaited<ReturnType<typeof initializePiStorage>>) => void
}

// Startup failure shown by the error card. `detail` carries the server-side
// startupError verbatim when /api/health reports a failed startup chain.
type StartupError = {
  message: string
  detail?: string
}

// Reads the startup failure detail from /api/health. The server keeps answering
// health with { ok: false, startupError } while business /api/* routes are gated
// with 503, so this is the only way to explain *why* boot failed.
async function readStartupFailureDetail(): Promise<string | undefined> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' })
    if (!response.ok) return undefined
    const payload = await response.json() as { ok?: unknown; startupError?: unknown }
    if (payload?.ok !== false || typeof payload.startupError !== 'string') return undefined
    return payload.startupError
  } catch {
    return undefined
  }
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
  setNeedsModelSetup,
  onStorageReady,
}: UseAppBootstrapOptions) {
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<StartupError>()
  const [retryNonce, setRetryNonce] = useState(0)

  // Keep callbacks in refs so the bootstrap effect runs exactly once
  const depsRef = useRef({
    refreshSessions,
    loadProject,
    initAgentAccessMode,
    createAgent,
    loadSession,
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
        setNeedsModelSetup: setModelSetup,
        onStorageReady: onReady,
      } = depsRef.current

      try {
        setReady(false)
        setStartupError(undefined)

        // Stale-while-revalidate：启动第一步（任何 await 之前）发起本地快照
        // 读取，命中即预应用语言/外观/字号/工具展示；异步 IndexedDB 读取不
        // 阻塞下方校准序列，服务器值到达后由 initializeAppLanguage / load*
        // 自然覆盖。预应用逐键 best-effort，任何失败不影响启动。
        const settingsServerKey = resolveServerCacheKey()
        void Promise.all([
          readAppSettingSnapshotValue(settingsServerKey, 'language'),
          readAppSettingSnapshotValue(settingsServerKey, 'appearance-settings'),
          readAppSettingSnapshotValue(settingsServerKey, 'font-size-settings'),
          readAppSettingSnapshotValue(settingsServerKey, 'tool-display-settings'),
        ])
          .then(([language, appearance, fontSize, toolDisplay]) => {
            // null = 无可用快照（miss/白名单外/坏条目/IndexedDB 不可用）。
            const preapply = (value: unknown, apply: (input: unknown) => void) => {
              if (value === null) return
              try {
                apply(value)
              } catch {
                // 快照预应用失败静默，交给服务器校准兜底
              }
            }
            preapply(language, applyAppLanguageFromSnapshot)
            preapply(appearance, (input) => applyAppearanceSettings(normalizeAppearanceSettings(input)))
            preapply(fontSize, (input) => applyFontSizeSettings(normalizeFontSizeSettings(input)))
            preapply(toolDisplay, applyToolDisplaySettingsValue)
          })
          .catch(() => {
            // 快照读取失败静默（IndexedDB 不可用等）
          })

        const storage = await initializePiStorage()
        if (cancelled) return

        storageRef.current = storage
        onReady?.(storage)
        backendRef.current = storage.backend as HttpStorageBackend
        void refreshSessionList().catch((error) => {
          logger.warn('Failed to refresh startup session list:', error)
        })
        const language = await initializeAppLanguage(storage)
        const toolDisplaySettings = await loadToolDisplaySettings(storage)
        const appearanceSettings = await loadAndApplyAppearanceSettings(storage)
        const fontSizeSettings = await loadAndApplyFontSizeSettings(storage)
        await loadProj()

        const savedAccessMode = await initAccessMode(storage)
        agentAccessModeRef.current = savedAccessMode

        const configuredModels = await getSelectableConfiguredModels(storage)
        const savedModel = await loadActiveModel(storage)
        const initialModel = chooseStartupModel(
          mergeAvailableModels(configuredModels, []),
          undefined,
          savedModel,
        )
        const startupModel = initialModel
        if (initialModel) activeModelRef.current = initialModel

        // New sessions inherit the user's last explicit choice (model + thinking
        // level); the settings page no longer stores defaults.
        const savedThinkingLevel = await loadActiveThinkingLevel(storage)
        const startupThinkingLevel = resolveNewSessionThinkingLevel(initialModel ?? undefined, savedThinkingLevel)

        const createStartupSession = () => create(
          { model: startupModel!, thinkingLevel: startupThinkingLevel, tools: [] },
          randomId(),
          { scope: 'global', attachToView: true },
        )

        const sessionId = new URLSearchParams(window.location.search).get('session')
        if (sessionId) {
          const restored = await restoreSession(sessionId)
          if (!restored) {
            setModelSetup(!initialModel)
            if (startupModel) await createStartupSession()
          } else {
            setModelSetup(false)
          }
        } else {
          setModelSetup(!initialModel)
          if (startupModel) await createStartupSession()
        }

        // Revalidate 侧：把服务器校准后的值写回本地快照（best-effort、
        // fire-and-forget，不阻塞 ready），供下次启动预应用。只在成功路径
        // 写入；启动整体失败走总 catch，不落盘。
        void writeAppSettingSnapshotValue(settingsServerKey, 'language', language)
        void writeAppSettingSnapshotValue(settingsServerKey, 'appearance-settings', appearanceSettings)
        void writeAppSettingSnapshotValue(settingsServerKey, 'font-size-settings', fontSizeSettings)
        void writeAppSettingSnapshotValue(settingsServerKey, 'tool-display-settings', toolDisplaySettings)

        setReady(true)
      } catch (error) {
        logger.error('Failed to bootstrap QuickForge:', error)
        if (cancelled) return
        // A failed startup chain keeps /api/health at ok:false with the server
        // side error text, so the error card can explain the failure instead of
        // showing the generic service-unavailable wording.
        const detail = await readStartupFailureDetail()
        if (cancelled) return
        setStartupError({ message: t('localServiceUnavailableDescription'), detail })
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

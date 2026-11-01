import { useCallback, useEffect, useRef } from 'react'
import type { initializePiStorage } from '@/lib/pi-chat'
import {
  loadUpdateCheckSettings,
  saveUpdateCheckSettings,
  shouldCheckAtStartup,
} from '@/lib/update-check-settings'
import { requestUpdateCheck } from '@/lib/update-check-poll'
import { logger } from '@/lib/logger'
import { useUpdateCheckStore } from '@/stores/update-check-store'
import type { UpdateCheckResult } from '@/stores/update-check-store'

type PiStorage = Awaited<ReturnType<typeof initializePiStorage>>

type UpdateCheckInfo = {
  result: UpdateCheckResult
  /** Dismiss the current new-version reminder (persists ignoredVersion). */
  dismissUpdate: () => void
}

function isDesktopApp() {
  if (typeof document === 'undefined') return false
  const desktopWindow = window as Window & { __quickforgeDesktopApp?: boolean }
  return document.body.classList.contains('quickforge-desktop-app') || desktopWindow.__quickforgeDesktopApp === true
}

/** 更新检查结果状态已迁入 useUpdateCheckStore（zustand）。
 *  本 hook 保留为兼容层：返回结构与旧实现一致，App.tsx 接线不变；
 *  setResult 引用恒定（等价于旧 useState setter），fetch / localStorage
 *  持久化副作用逻辑仍在此处。
 */
export function useUpdateCheck(
  storageRef: React.MutableRefObject<PiStorage | null>,
  ready: boolean,
): UpdateCheckInfo {
  const result = useUpdateCheckStore((s) => s.result)
  const setResult = useUpdateCheckStore((s) => s.setResult)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!ready || startedRef.current) return
    if (isDesktopApp()) return
    const storage = storageRef.current
    if (!storage) return
    startedRef.current = true

    void (async () => {
      let settings
      try {
        settings = await loadUpdateCheckSettings(storage)
      } catch (error) {
        logger.error('Failed to load update-check settings:', error)
        return
      }
      if (!shouldCheckAtStartup(settings)) return

      setResult((prev) => ({ ...prev, status: 'checking' }))
      try {
        // 服务端立即返回状态快照，这里轮询到终态；任何失败静默处理。
        const outcome = await requestUpdateCheck()
        if (outcome.kind !== 'ok') {
          setResult((prev) => ({ ...prev, status: 'error' }))
          return
        }
        const payload = outcome.payload
        const updateAvailable =
          payload.updateAvailable === true && payload.latestVersion !== settings.ignoredVersion
        try {
          await saveUpdateCheckSettings(storage, {
            ...settings,
            lastCheckAt: new Date().toISOString(),
          })
        } catch (error) {
          logger.error('Failed to persist last update-check time:', error)
        }
        setResult({
          status: 'done',
          currentVersion: payload.currentVersion,
          latestVersion: payload.latestVersion,
          updateAvailable,
        })
      } catch (error) {
        // Silent failure: never block startup or nag the user.
        logger.error('Startup update check failed:', error)
        setResult((prev) => ({ ...prev, status: 'error' }))
      }
    })()
  }, [ready, storageRef, setResult])

  const dismissUpdate = useCallback(() => {
    const storage = storageRef.current
    const latestVersion = result.latestVersion
    if (!storage || !latestVersion) return
    setResult((prev) => ({ ...prev, updateAvailable: false }))
    void (async () => {
      try {
        const settings = await loadUpdateCheckSettings(storage)
        await saveUpdateCheckSettings(storage, {
          ...settings,
          ignoredVersion: latestVersion,
        })
      } catch (error) {
        logger.error('Failed to persist ignored update version:', error)
      }
    })()
  }, [result.latestVersion, storageRef, setResult])

  return { result, dismissUpdate }
}

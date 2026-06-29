import { useCallback, useEffect, useRef, useState } from 'react'
import type { initializePiStorage } from '@/lib/pi-chat'
import {
  loadUpdateCheckSettings,
  saveUpdateCheckSettings,
  shouldCheckAtStartup,
} from '@/lib/update-check-settings'
import { logger } from '@/lib/logger'

type PiStorage = Awaited<ReturnType<typeof initializePiStorage>>

export type UpdateCheckStatus = 'idle' | 'checking' | 'done' | 'error'

export type UpdateCheckResult = {
  status: UpdateCheckStatus
  currentVersion?: string
  latestVersion?: string
  /** true when a newer version exists and has not been dismissed by the user. */
  updateAvailable: boolean
}

export type UpdateCheckInfo = {
  result: UpdateCheckResult
  /** Dismiss the current new-version reminder (persists ignoredVersion). */
  dismissUpdate: () => void
}

type UpdateCheckResponse = {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  localVersionIsNewer?: boolean
}

const INITIAL_RESULT: UpdateCheckResult = {
  status: 'idle',
  updateAvailable: false,
}

/**
 * Background update checker. On first `ready`, reads the configured frequency
 * and — if due — fires a single non-blocking request to the backend. Any
 * failure is silent: it never blocks startup or nags the user.
 */
export function useUpdateCheck(
  storageRef: React.MutableRefObject<PiStorage | null>,
  ready: boolean,
): UpdateCheckInfo {
  const [result, setResult] = useState<UpdateCheckResult>(INITIAL_RESULT)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!ready || startedRef.current) return
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
        const response = await fetch('/api/system/update/check', { cache: 'no-store' })
        if (!response.ok) {
          setResult((prev) => ({ ...prev, status: 'error' }))
          return
        }
        const payload = (await response.json()) as UpdateCheckResponse
        const updateAvailable =
          payload.updateAvailable && payload.latestVersion !== settings.ignoredVersion
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
  }, [ready, storageRef])

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
  }, [result.latestVersion, storageRef])

  return { result, dismissUpdate }
}

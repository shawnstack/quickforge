import { Capacitor } from '@capacitor/core'
import type { BackgroundTaskStatus } from './types'
import { t } from './i18n'
import { logger } from './logger'

const ENABLED_STORAGE_KEY = 'quickforge:system-notifications-enabled'
const RECENT_STORAGE_KEY = 'quickforge:system-notifications-recent:v1'
const RECENT_WINDOW_MS = 10_000
const MAX_RECENT_ENTRIES = 100

export type SystemNotificationPermission = 'unsupported' | 'prompt' | 'granted' | 'denied'

type NativeNotificationBridge = {
  setNotificationService?: (enabled: boolean, serverUrl: string) => void
}

type NotificationPayload = {
  key: string
  sessionId?: string
  title: string
  status: BackgroundTaskStatus
  force?: boolean
}

type RecentNotifications = Record<string, number>

let nativeListenerInitialized = false

function nativeNotificationBridge(): NativeNotificationBridge | undefined {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) return undefined
  const nativeWindow = window as Window & { QuickForgeBridge?: NativeNotificationBridge }
  return nativeWindow.QuickForgeBridge
}

function registerNativeSessionOpener(): void {
  if (typeof window === 'undefined') return
  const nativeWindow = window as Window & { __quickforgeOpenSession?: (sessionId: string) => void }
  if (nativeWindow.__quickforgeOpenSession) return
  // Called by the Android shell after a task notification tap to open the session.
  nativeWindow.__quickforgeOpenSession = (sessionId: string) => {
    openSession(sessionId)
  }
}

/**
 * Keeps the native Android foreground service in sync with the user-facing
 * switch. The service polls the server while the WebView JS is paused in the
 * background, so task completion notifications still arrive on the lock screen
 * or while another app is open.
 */
export function syncNativeNotificationService(): void {
  const bridge = nativeNotificationBridge()
  if (!bridge?.setNotificationService) return
  const serverUrl = window.location.origin
  if (!serverUrl) return
  try {
    bridge.setNotificationService(isSystemNotificationsEnabled(), serverUrl)
  } catch (error) {
    logger.warn('Failed to sync native notification service:', error)
  }
}

registerNativeSessionOpener()

function isDesktopApp(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false
  const desktopWindow = window as Window & { __quickforgeDesktopApp?: boolean }
  return document.body?.classList.contains('quickforge-desktop-app') || desktopWindow.__quickforgeDesktopApp === true
}

function isNativeNotificationsAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications')
}

function notificationBody(status: BackgroundTaskStatus): string {
  const statusText = status === 'idle'
    ? t('taskCompleted')
    : status === 'error'
      ? t('taskError')
      : status === 'aborted'
        ? t('processAborted')
        : t('taskRunning')
  return `${statusText}. ${t('systemNotificationOpenDetails')}`
}

function openSession(sessionId?: string): void {
  if (typeof window === 'undefined') return
  window.focus()
  if (!sessionId) return
  window.dispatchEvent(new CustomEvent('quickforge:open-session-from-settings', {
    detail: { sessionId },
  }))
}

function stableNotificationId(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return (hash >>> 0) % 2_147_483_646 + 1
}

function readRecentNotifications(): RecentNotifications {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) || '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isFinite(entry[1])
    )))
  } catch {
    return {}
  }
}

function markNotificationIfNew(key: string): boolean {
  if (typeof localStorage === 'undefined') return true
  const now = Date.now()
  const recent = readRecentNotifications()
  const lastShownAt = recent[key]
  if (typeof lastShownAt === 'number' && now - lastShownAt < RECENT_WINDOW_MS) return false

  const next = Object.entries({ ...recent, [key]: now })
    .filter(([, shownAt]) => now - shownAt < RECENT_WINDOW_MS)
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_RECENT_ENTRIES)
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(Object.fromEntries(next)))
  } catch {
    // Notification delivery should not depend on storage availability.
  }
  return true
}

export function isSystemNotificationsEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(ENABLED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setSystemNotificationsEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (enabled) localStorage.setItem(ENABLED_STORAGE_KEY, '1')
    else localStorage.removeItem(ENABLED_STORAGE_KEY)
  } catch {
    // Device-local settings are best-effort when storage is unavailable.
  }
  syncNativeNotificationService()
}

export async function getSystemNotificationPermission(): Promise<SystemNotificationPermission> {
  try {
    if (isNativeNotificationsAvailable()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const permission = await LocalNotifications.checkPermissions()
      if (permission.display === 'granted') return 'granted'
      if (permission.display === 'prompt' || permission.display === 'prompt-with-rationale') return 'prompt'
      return 'denied'
    }

    if (isDesktopApp() || typeof Notification === 'undefined') return 'unsupported'
    if (Notification.permission === 'granted') return 'granted'
    if (Notification.permission === 'denied') return 'denied'
    return 'prompt'
  } catch (error) {
    logger.warn('Failed to check system notification permission:', error)
    return 'unsupported'
  }
}

export async function requestSystemNotificationPermission(): Promise<SystemNotificationPermission> {
  try {
    let permission: SystemNotificationPermission
    if (isNativeNotificationsAvailable()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const result = await LocalNotifications.requestPermissions()
      permission = result.display === 'granted' ? 'granted' : 'denied'
      await initializeSystemNotifications()
    } else if (!isDesktopApp() && typeof Notification !== 'undefined') {
      const result = await Notification.requestPermission()
      permission = result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'prompt'
    } else {
      permission = 'unsupported'
    }
    setSystemNotificationsEnabled(permission === 'granted')
    return permission
  } catch (error) {
    logger.warn('Failed to request system notification permission:', error)
    setSystemNotificationsEnabled(false)
    return 'denied'
  }
}

export async function initializeSystemNotifications(): Promise<void> {
  // Restore the native polling service on startup so background notifications
  // survive page reloads and app restarts.
  syncNativeNotificationService()
  if (!isNativeNotificationsAvailable() || nativeListenerInitialized) return
  nativeListenerInitialized = true
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const sessionId = action.notification.extra?.sessionId
      openSession(typeof sessionId === 'string' ? sessionId : undefined)
    })
  } catch (error) {
    nativeListenerInitialized = false
    logger.warn('Failed to initialize native notification listener:', error)
  }
}

export async function showTaskSystemNotification(payload: NotificationPayload): Promise<boolean> {
  if (!isSystemNotificationsEnabled()) return false
  // Terminal states (idle/error/aborted) always notify, even in the foreground;
  // only suppress "running" notifications while the page is visible and focused.
  const foregroundSuppressed = !payload.force
    && payload.status === 'running'
    && typeof document !== 'undefined'
    && document.visibilityState === 'visible'
    && document.hasFocus()
  if (foregroundSuppressed) return false

  try {
    const permission = await getSystemNotificationPermission()
    if (permission !== 'granted' || !markNotificationIfNew(payload.key)) return false

    const body = notificationBody(payload.status)
    if (isNativeNotificationsAvailable()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await initializeSystemNotifications()
      await LocalNotifications.schedule({
        notifications: [{
          id: stableNotificationId(payload.key),
          title: payload.title,
          body,
          extra: { sessionId: payload.sessionId },
        }],
      })
      return true
    }

    if (typeof Notification === 'undefined') return false
    const notification = new Notification(payload.title, {
      body,
      icon: '/pwa-icon-192.png',
      tag: payload.key,
    })
    notification.onclick = () => {
      notification.close()
      openSession(payload.sessionId)
    }
    return true
  } catch (error) {
    logger.warn('Failed to show system notification:', error)
    return false
  }
}

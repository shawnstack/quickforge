import { useEffect, useRef, useCallback } from 'react'

const CHANNEL_NAME = 'quickforge-sync'

type SyncMessage = {
  type: 'sessions-changed' | 'projects-changed' | 'settings-changed'
  sourceTabId: string
  timestamp: number
}

/**
 * Hook that synchronizes state across multiple browser tabs.
 *
 * - Broadcasts a message when `notifySessionsChanged` / `notifyProjectsChanged` /
 *   `notifySettingsChanged` is called, so other tabs can refresh.
 * - When the tab becomes visible again (visibilitychange), triggers a refresh callback.
 * - Listens for messages from other tabs and calls the appropriate refresh callback.
 */
export function useCrossTabSync(callbacks: {
  onSessionsChanged: () => void
  onProjectsChanged: () => void
  onSettingsChanged: () => void
}) {
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const tabId = useRef(crypto.randomUUID())

  const channelRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = channel

    const handleMessage = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data
      // Ignore messages from our own tab
      if (!msg || msg.sourceTabId === tabId.current) return

      switch (msg.type) {
        case 'sessions-changed':
          callbacksRef.current.onSessionsChanged()
          break
        case 'projects-changed':
          callbacksRef.current.onProjectsChanged()
          break
        case 'settings-changed':
          callbacksRef.current.onSettingsChanged()
          break
      }
    }

    channel.addEventListener('message', handleMessage)

    // Refresh when tab becomes visible (user switches back to this tab)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        callbacksRef.current.onSessionsChanged()
        callbacksRef.current.onProjectsChanged()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      channel.removeEventListener('message', handleMessage)
      channel.close()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const broadcast = useCallback((type: SyncMessage['type']) => {
    const msg: SyncMessage = {
      type,
      sourceTabId: tabId.current,
      timestamp: Date.now(),
    }
    channelRef.current?.postMessage(msg)
  }, [])

  const notifySessionsChanged = useCallback(() => broadcast('sessions-changed'), [broadcast])
  const notifyProjectsChanged = useCallback(() => broadcast('projects-changed'), [broadcast])
  const notifySettingsChanged = useCallback(() => broadcast('settings-changed'), [broadcast])

  return { notifySessionsChanged, notifyProjectsChanged, notifySettingsChanged }
}

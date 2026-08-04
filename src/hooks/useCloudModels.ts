import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getCloudModels, getCloudStatus, startCloudGuest } from '@/lib/cloud-client'

export const CLOUD_STATE_CHANGED_EVENT = 'quickforge:cloud-state-changed'

export function useCloudModels(enabled = true) {
  const [configured, setConfigured] = useState(false)
  const [guestStarting, setGuestStarting] = useState(false)
  const modelsRef = useRef<Model<Api>[]>([])
  const loadPromiseRef = useRef<Promise<Model<Api>[]> | null>(null)
  const startPromiseRef = useRef<Promise<Model<Api>[]> | null>(null)

  const loadCloudModels = useCallback(async (refresh = false): Promise<Model<Api>[]> => {
    if (!enabled) return []
    if (!refresh && modelsRef.current.length > 0) return modelsRef.current
    if (loadPromiseRef.current) return loadPromiseRef.current

    const pending = (async () => {
      const status = await getCloudStatus()
      setConfigured(Boolean(status.configured))
      if (!status.configured || status.mode === 'local' || !status.hasSession) {
        modelsRef.current = []
        return []
      }
      const models = await getCloudModels()
      modelsRef.current = models
      return models
    })().finally(() => { loadPromiseRef.current = null })
    loadPromiseRef.current = pending
    return pending
  }, [enabled])

  const startGuestCloud = useCallback(async (): Promise<Model<Api>[]> => {
    if (!enabled) return []
    if (startPromiseRef.current) return startPromiseRef.current
    setGuestStarting(true)
    const pending = (async () => {
      await startCloudGuest()
      setConfigured(true)
      const models = await getCloudModels()
      modelsRef.current = models
      return models
    })().finally(() => {
      startPromiseRef.current = null
      setGuestStarting(false)
    })
    startPromiseRef.current = pending
    return pending
  }, [enabled])

  useEffect(() => {
    const handleCloudStateChanged = () => {
      modelsRef.current = []
      void getCloudStatus()
        .then((status) => setConfigured(Boolean(status.configured)))
        .catch(() => undefined)
    }
    window.addEventListener(CLOUD_STATE_CHANGED_EVENT, handleCloudStateChanged)
    return () => window.removeEventListener(CLOUD_STATE_CHANGED_EVENT, handleCloudStateChanged)
  }, [])

  return {
    configured,
    guestStarting,
    loadCloudModels,
    startGuestCloud,
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getCloudModels, getCloudStatus } from '@/lib/cloud-client'

export const CLOUD_STATE_CHANGED_EVENT = 'quickforge:cloud-state-changed'

export function useCloudModels(enabled = true) {
  const [configured, setConfigured] = useState(false)
  const modelsRef = useRef<Model<Api>[]>([])
  const loadPromiseRef = useRef<Promise<Model<Api>[]> | null>(null)
  const loadAbortRef = useRef<AbortController | null>(null)
  const statusAbortRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)

  const invalidateCloudState = useCallback(() => {
    generationRef.current += 1
    loadAbortRef.current?.abort()
    statusAbortRef.current?.abort()
    loadAbortRef.current = null
    statusAbortRef.current = null
    loadPromiseRef.current = null
    modelsRef.current = []
  }, [])

  const loadCloudModels = useCallback(async (refresh = false): Promise<Model<Api>[]> => {
    if (!enabled || !mountedRef.current) return []
    if (refresh) modelsRef.current = []
    if (!refresh && modelsRef.current.length > 0) return modelsRef.current
    if (loadPromiseRef.current) return loadPromiseRef.current

    const generation = generationRef.current
    const controller = new AbortController()
    loadAbortRef.current = controller
    const pending = (async () => {
      try {
        const status = await getCloudStatus(controller.signal)
        if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return []
        setConfigured(Boolean(status.enabled !== false && status.configured))
        if (status.enabled === false || !status.configured || status.mode === 'local' || !status.hasSession) {
          modelsRef.current = []
          return []
        }
        const models = await getCloudModels(controller.signal)
        if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return []
        modelsRef.current = models
        return models
      } catch (error) {
        if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return []
        throw error
      }
    })().finally(() => {
      if (loadPromiseRef.current === pending) loadPromiseRef.current = null
      if (loadAbortRef.current === controller) loadAbortRef.current = null
    })
    loadPromiseRef.current = pending
    return pending
  }, [enabled])

  useEffect(() => {
    mountedRef.current = true
    const handleCloudStateChanged = () => {
      invalidateCloudState()
      if (!mountedRef.current) return
      const generation = generationRef.current
      const controller = new AbortController()
      statusAbortRef.current = controller
      void getCloudStatus(controller.signal)
        .then((status) => {
          if (mountedRef.current && generation === generationRef.current && !controller.signal.aborted) {
            setConfigured(Boolean(status.enabled !== false && status.configured))
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (statusAbortRef.current === controller) statusAbortRef.current = null
        })
    }
    window.addEventListener(CLOUD_STATE_CHANGED_EVENT, handleCloudStateChanged)
    return () => {
      window.removeEventListener(CLOUD_STATE_CHANGED_EVENT, handleCloudStateChanged)
      mountedRef.current = false
      invalidateCloudState()
    }
  }, [invalidateCloudState])

  useEffect(() => {
    if (!enabled) {
      invalidateCloudState()
    }
  }, [enabled, invalidateCloudState])

  return {
    configured,
    loadCloudModels,
  }
}

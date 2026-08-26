import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getCloudModels, getCloudStatus } from '@/lib/cloud-client'

export const CLOUD_STATE_CHANGED_EVENT = 'quickforge:cloud-state-changed'

// Failed catalog loads are negatively cached so a slow or unreachable Cloud
// service does not trigger a request on every model-picker interaction.
const CLOUD_MODELS_FAILURE_TTL_MS = 30_000

export function useCloudModels(enabled = true) {
  const [configured, setConfigured] = useState(false)
  const modelsRef = useRef<Model<Api>[]>([])
  const loadedRef = useRef(false)
  const lastFailedAtRef = useRef(0)
  const loadPromiseRef = useRef<Promise<Model<Api>[]> | null>(null)
  const loadAbortRef = useRef<AbortController | null>(null)
  const statusAbortRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)

  const readCachedCloudModels = useCallback((): readonly Model<Api>[] => modelsRef.current, [])
  const isCloudModelsLoaded = useCallback(() => loadedRef.current, [])

  const invalidateCloudState = useCallback(() => {
    generationRef.current += 1
    loadAbortRef.current?.abort()
    statusAbortRef.current?.abort()
    loadAbortRef.current = null
    statusAbortRef.current = null
    loadPromiseRef.current = null
    modelsRef.current = []
    loadedRef.current = false
    lastFailedAtRef.current = 0
  }, [])

  const loadCloudModels = useCallback(async (refresh = false): Promise<Model<Api>[]> => {
    if (!enabled || !mountedRef.current) return []
    if (refresh) {
      modelsRef.current = []
      loadedRef.current = false
    }
    if (!refresh && loadedRef.current) return modelsRef.current
    if (!refresh && lastFailedAtRef.current > 0 && Date.now() - lastFailedAtRef.current < CLOUD_MODELS_FAILURE_TTL_MS) return []
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
          loadedRef.current = true
          lastFailedAtRef.current = 0
          return []
        }
        const models = await getCloudModels(controller.signal)
        if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return []
        modelsRef.current = models
        loadedRef.current = true
        lastFailedAtRef.current = 0
        return models
      } catch (error) {
        if (!mountedRef.current || generation !== generationRef.current || controller.signal.aborted) return []
        lastFailedAtRef.current = Date.now()
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
    readCachedCloudModels,
    isCloudModelsLoaded,
  }
}

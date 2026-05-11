import { useState, useCallback, useRef } from 'react'
import type { AppStorage } from '@mariozechner/pi-web-ui'
import { loadYoloMode } from '@/lib/pi-chat'

export function useYoloMode() {
  const [yoloMode, setYoloMode] = useState(false)
  // Track the last project we loaded YOLO for, so we can reload on project switch
  const lastProjectIdRef = useRef<string | undefined>(undefined)

  const initialize = useCallback(async (storage: AppStorage) => {
    const saved = await loadYoloMode(storage)
    setYoloMode(saved)
    return saved
  }, [])

  /** Call when the active project changes to load its saved YOLO preference. */
  const loadForProject = useCallback(async (storage: AppStorage, projectId: string | undefined) => {
    // Avoid redundant loads for the same project
    if (lastProjectIdRef.current === projectId) return
    lastProjectIdRef.current = projectId
    const saved = await loadYoloMode(storage, projectId)
    setYoloMode(saved)
  }, [])

  return { yoloMode, setYoloMode, initialize, loadForProject }
}

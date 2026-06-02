import { useState, useCallback } from 'react'
import type { AppStorage } from '@earendil-works/pi-web-ui'
import { loadYoloMode } from '@/lib/pi-chat'

export function useYoloMode() {
  const [yoloMode, setYoloMode] = useState(false)

  const initialize = useCallback(async (storage: AppStorage) => {
    const saved = await loadYoloMode(storage)
    setYoloMode(saved)
    return saved
  }, [])

  return { yoloMode, setYoloMode, initialize }
}

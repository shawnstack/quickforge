import { useCallback } from 'react'
import type { AgentManager } from '@/hooks/useAgentManager'
import { saveYoloMode, initializePiStorage } from '@/lib/pi-chat'

type UseYoloActionsOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  yoloModeRef: React.MutableRefObject<boolean>
  setYoloMode: React.Dispatch<React.SetStateAction<boolean>>
  agentRef: AgentManager['agentRef']
  setChatPanelRevision: AgentManager['setChatPanelRevision']
  notifySettingsChanged: () => void
}

export function useYoloActions({
  storageRef,
  yoloModeRef,
  setYoloMode,
  agentRef,
  setChatPanelRevision,
  notifySettingsChanged,
}: UseYoloActionsOptions) {
  const toggleYoloMode = useCallback(() => {
    const storage = storageRef.current
    setYoloMode((prev) => {
      const next = !prev
      yoloModeRef.current = next
      if (storage) {
        void saveYoloMode(storage, next).catch((error) => {
          console.error('Failed to save YOLO mode:', error)
        })
      }
      return next
    })
    if (agentRef.current) {
      setChatPanelRevision((value) => value + 1)
    }
    notifySettingsChanged()
  }, [agentRef, notifySettingsChanged, setChatPanelRevision, setYoloMode, storageRef, yoloModeRef])

  return { toggleYoloMode }
}

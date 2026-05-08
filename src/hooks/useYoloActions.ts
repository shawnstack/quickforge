import { useCallback } from 'react'
import type { AgentManager } from '@/hooks/useAgentManager'
import type { ServerAgent } from '@/lib/server-agent'
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
  const syncAgentYoloMode = useCallback((agent: ServerAgent | null, next: boolean) => {
    if (!agent) return
    void agent.updateYoloMode(next)
      .then(() => {
        setChatPanelRevision((value) => value + 1)
      })
      .catch((error) => {
        console.error('Failed to sync YOLO mode to server:', error)
      })
  }, [setChatPanelRevision])

  const toggleYoloMode = useCallback(() => {
    const storage = storageRef.current
    const currentAgent = agentRef.current
    setYoloMode((prev) => {
      const next = !prev
      yoloModeRef.current = next
      if (storage) {
        void saveYoloMode(storage, next).catch((error) => {
          console.error('Failed to save YOLO mode:', error)
        })
      }
      syncAgentYoloMode(currentAgent, next)
      return next
    })
    notifySettingsChanged()
  }, [agentRef, notifySettingsChanged, setYoloMode, storageRef, syncAgentYoloMode, yoloModeRef])

  return { toggleYoloMode }
}

import { useCallback } from 'react'
import type { AgentManager } from '@/hooks/useAgentManager'
import { saveYoloMode, initializePiStorage } from '@/lib/pi-chat'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'

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
    const currentAgent = agentRef.current
    const previous = yoloModeRef.current
    const next = !previous

    setYoloMode(next)
    yoloModeRef.current = next

    const rollback = () => {
      yoloModeRef.current = previous
      setYoloMode(previous)
      setChatPanelRevision((value) => value + 1)
    }

    const sync = async () => {
      try {
        if (currentAgent) await currentAgent.updateYoloMode(next)
        if (storage) await saveYoloMode(storage, next)
        setChatPanelRevision((value) => value + 1)
        notifySettingsChanged()
      } catch (error) {
        logger.error('Failed to sync YOLO mode:', error)
        rollback()
        alert(error instanceof Error ? error.message : t('yoloModeSyncFailed'))
      }
    }

    void sync()
  }, [agentRef, notifySettingsChanged, setChatPanelRevision, setYoloMode, storageRef, yoloModeRef])

  return { toggleYoloMode }
}

import { useCallback } from 'react'
import type React from 'react'
import type { AgentManager } from '@/hooks/useAgentManager'
import { saveAgentAccessMode, initializePiStorage } from '@/lib/pi-chat'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { showAlert } from '@/components/ui/confirm-dialog'
import type { AgentAccessMode } from '@/lib/types'

const isFullAccessMode = (mode: AgentAccessMode) => mode === 'full-access'

export type UseAgentAccessActionsOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  agentAccessModeRef: React.MutableRefObject<AgentAccessMode>
  setAgentAccessMode: React.Dispatch<React.SetStateAction<AgentAccessMode>>
  agentRef: AgentManager['agentRef']
  setChatPanelRevision: AgentManager['setChatPanelRevision']
  notifySettingsChanged: () => void
}

export function useAgentAccessActions({
  storageRef,
  agentAccessModeRef,
  setAgentAccessMode,
  agentRef,
  setChatPanelRevision,
  notifySettingsChanged,
}: UseAgentAccessActionsOptions) {
  const setAccessMode = useCallback((next: AgentAccessMode) => {
    const storage = storageRef.current
    const currentAgent = agentRef.current
    const previous = agentAccessModeRef.current
    if (previous === next) return

    setAgentAccessMode(next)
    agentAccessModeRef.current = next

    const rollback = () => {
      agentAccessModeRef.current = previous
      setAgentAccessMode(previous)
      setChatPanelRevision((value) => value + 1)
    }

    const sync = async () => {
      try {
        if (currentAgent) await currentAgent.updateAccessMode(next)
        if (storage) await saveAgentAccessMode(storage, next)
        setChatPanelRevision((value) => value + 1)
        notifySettingsChanged()
      } catch (error) {
        logger.error('Failed to sync agent access mode:', error)
        rollback()
        void showAlert(error instanceof Error ? error.message : t('agentAccessModeSyncFailed'))
      }
    }

    void sync()
  }, [agentAccessModeRef, agentRef, notifySettingsChanged, setAgentAccessMode, setChatPanelRevision, storageRef])

  const toggleYoloMode = useCallback(() => {
    setAccessMode(isFullAccessMode(agentAccessModeRef.current) ? 'default' : 'full-access')
  }, [agentAccessModeRef, setAccessMode])

  return { setAccessMode, toggleYoloMode }
}

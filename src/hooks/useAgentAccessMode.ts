import { useState, useCallback } from 'react'
import type { AppStorage } from '@earendil-works/pi-web-ui'
import { loadAgentAccessMode } from '@/lib/pi-chat'
import type { AgentAccessMode } from '@/lib/types'

export function useAgentAccessMode() {
  const [agentAccessMode, setAgentAccessMode] = useState<AgentAccessMode>('default')

  const initialize = useCallback(async (storage: AppStorage) => {
    const saved = await loadAgentAccessMode(storage)
    setAgentAccessMode(saved)
    return saved
  }, [])

  return { agentAccessMode, setAgentAccessMode, initialize }
}

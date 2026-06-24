import type React from 'react'
import { useAgentAccessMode } from '@/hooks/useAgentAccessMode'

export function useYoloMode() {
  const { agentAccessMode, setAgentAccessMode, initialize } = useAgentAccessMode()
  const yoloMode = agentAccessMode === 'full-access'
  const setYoloMode: React.Dispatch<React.SetStateAction<boolean>> = (value) => {
    setAgentAccessMode((previous) => {
      const previousYolo = previous === 'full-access'
      const nextYolo = typeof value === 'function' ? value(previousYolo) : value
      return nextYolo ? 'full-access' : 'default'
    })
  }

  return {
    yoloMode,
    setYoloMode,
    initialize: async (...args: Parameters<typeof initialize>) => (await initialize(...args)) === 'full-access',
  }
}

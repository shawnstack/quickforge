import type React from 'react'
import { useAgentAccessActions, type UseAgentAccessActionsOptions } from '@/hooks/useAgentAccessActions'
import type { AgentAccessMode } from '@/lib/types'

type UseYoloActionsOptions = Omit<UseAgentAccessActionsOptions, 'agentAccessModeRef' | 'setAgentAccessMode'> & {
  yoloModeRef: React.MutableRefObject<boolean>
  setYoloMode: React.Dispatch<React.SetStateAction<boolean>>
}

export function useYoloActions({
  yoloModeRef,
  setYoloMode,
  ...rest
}: UseYoloActionsOptions) {
  const agentAccessModeRef = {
    get current(): AgentAccessMode {
      return yoloModeRef.current ? 'full-access' : 'default'
    },
    set current(value: AgentAccessMode) {
      yoloModeRef.current = value === 'full-access'
    },
  } as React.MutableRefObject<AgentAccessMode>

  const setAgentAccessMode: React.Dispatch<React.SetStateAction<AgentAccessMode>> = (value) => {
    setYoloMode((previous) => {
      const previousMode: AgentAccessMode = previous ? 'full-access' : 'default'
      const nextMode = typeof value === 'function' ? value(previousMode) : value
      return nextMode === 'full-access'
    })
  }

  return useAgentAccessActions({
    ...rest,
    agentAccessModeRef,
    setAgentAccessMode,
  })
}

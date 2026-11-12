export type AgentAccessMode = 'default' | 'full-access'

export function agentAccessModeFromYoloMode(yoloMode: unknown): AgentAccessMode {
  return yoloMode === true || yoloMode === 'true' ? 'full-access' : 'default'
}

export function normalizeAgentAccessMode(value: unknown, fallback: unknown = 'default'): AgentAccessMode {
  if (value === 'default' || value === 'full-access') return value
  if (value === true || value === 'true') return 'full-access'
  if (value === false || value === 'false') return 'default'
  if (fallback !== value) return normalizeAgentAccessMode(fallback, 'default')
  return 'default'
}

export function agentAccessModeToYoloMode(mode: AgentAccessMode): boolean {
  return mode === 'full-access'
}

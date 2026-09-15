export const AGENT_ACCESS_MODE_DEFAULT = 'default'
export const AGENT_ACCESS_MODE_FULL_ACCESS = 'full-access'

export function normalizeAccessMode(value, fallback = AGENT_ACCESS_MODE_DEFAULT) {
  if (value === AGENT_ACCESS_MODE_DEFAULT || value === AGENT_ACCESS_MODE_FULL_ACCESS) return value
  if (value === true || value === 'true') return AGENT_ACCESS_MODE_FULL_ACCESS
  if (value === false || value === 'false') return AGENT_ACCESS_MODE_DEFAULT
  if (fallback !== value) return normalizeAccessMode(fallback, AGENT_ACCESS_MODE_DEFAULT)
  return AGENT_ACCESS_MODE_DEFAULT
}

export function yoloModeFromAccessMode(accessMode) {
  return normalizeAccessMode(accessMode) === AGENT_ACCESS_MODE_FULL_ACCESS
}

export function hasFullAccess(session) {
  return normalizeAccessMode(session?.accessMode, session?.yoloMode) === AGENT_ACCESS_MODE_FULL_ACCESS
}

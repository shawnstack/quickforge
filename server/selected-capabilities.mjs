export const MAX_SELECTED_CAPABILITIES = 4
export const SELECTED_CAPABILITY_PLUGIN_NAME_MAX_LENGTH = 120
export const SELECTED_CAPABILITY_NAME_MAX_LENGTH = 120
export const SELECTED_CAPABILITY_LABEL_MAX_LENGTH = 160
export const SELECTED_CAPABILITY_DESCRIPTION_MAX_LENGTH = 400
export const SELECTED_CAPABILITIES_DETAILS_KEY = 'selectedCapabilities'

const SELECTED_CAPABILITY_TYPES = new Set(['plugin', 'skill', 'tool', 'command'])

function normalizedText(value, maxLength) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().slice(0, maxLength)
  return normalized || undefined
}

export function selectedCapabilityKey(capability) {
  return `${capability.type}:${capability.pluginName}:${capability.name}`
}

export function normalizeSelectedCapabilities(value) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !SELECTED_CAPABILITY_TYPES.has(item.type)) continue
    const pluginName = normalizedText(item.pluginName, SELECTED_CAPABILITY_PLUGIN_NAME_MAX_LENGTH)
    const name = normalizedText(item.name, SELECTED_CAPABILITY_NAME_MAX_LENGTH)
    const label = normalizedText(item.label, SELECTED_CAPABILITY_LABEL_MAX_LENGTH)
    if (!pluginName || !name || !label) continue
    const capability = { type: item.type, pluginName, name, label }
    const description = normalizedText(item.description, SELECTED_CAPABILITY_DESCRIPTION_MAX_LENGTH)
    if (description) capability.description = description
    const key = selectedCapabilityKey(capability)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(capability)
    if (result.length >= MAX_SELECTED_CAPABILITIES) break
  }
  return result
}

export function selectedCapabilitySnapshots(value) {
  return normalizeSelectedCapabilities(value).map(({ type, pluginName, name, label }) => ({ type, pluginName, name, label }))
}

export function selectedCapabilitiesFromMessage(message) {
  const details = message?.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return []
  return selectedCapabilitySnapshots(details[SELECTED_CAPABILITIES_DETAILS_KEY])
}

export function withCanonicalSelectedCapabilities(message, capabilities) {
  if (!message || typeof message !== 'object') return message
  const snapshots = selectedCapabilitySnapshots(capabilities)
  const details = message.details && typeof message.details === 'object' && !Array.isArray(message.details)
    ? message.details
    : {}
  const nextDetails = { ...details }
  if (snapshots.length > 0) nextDetails[SELECTED_CAPABILITIES_DETAILS_KEY] = snapshots
  else delete nextDetails[SELECTED_CAPABILITIES_DETAILS_KEY]
  const next = { ...message }
  if (Object.keys(nextDetails).length > 0) next.details = nextDetails
  else delete next.details
  return next
}

export function selectedCapabilityPrompt(capabilities) {
  const normalized = normalizeSelectedCapabilities(capabilities)
  if (normalized.length === 0) return null
  const lines = normalized.map((capability) => {
    const toolHint = capability.type === 'tool' ? ` Tool name: plugin__${capability.pluginName}__${capability.name}.` : ''
    const description = capability.description ? ` Description: ${capability.description}` : ''
    return `- ${capability.label} (${capability.type}, plugin: ${capability.pluginName}, name: ${capability.name}).${toolHint}${description}`
  }).join('\n')
  return `The user selected the following QuickForge plugin capability mentions for this turn. Treat them as an explicit preference for routing and context. Use the selected capability when relevant, but do not force it if it is unrelated to the actual request.\n\n${lines}`
}

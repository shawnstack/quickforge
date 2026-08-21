export const MAX_SELECTED_CAPABILITIES = 4
export const SELECTED_CAPABILITY_PLUGIN_NAME_MAX_LENGTH = 120
export const SELECTED_CAPABILITY_NAME_MAX_LENGTH = 120
export const SELECTED_CAPABILITY_LABEL_MAX_LENGTH = 160
export const SELECTED_CAPABILITY_DESCRIPTION_MAX_LENGTH = 400

export type SelectedCapability = {
  type: 'plugin' | 'skill' | 'tool' | 'command'
  pluginName: string
  name: string
  label: string
  description?: string
}

export type SelectedCapabilitySnapshot = Omit<SelectedCapability, 'description'>

const SELECTED_CAPABILITY_TYPES = new Set<SelectedCapability['type']>(['plugin', 'skill', 'tool', 'command'])

function normalizedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().slice(0, maxLength)
  return normalized || undefined
}

export function selectedCapabilityKey(capability: SelectedCapabilitySnapshot): string {
  return `${capability.type}:${capability.pluginName}:${capability.name}`
}

export function normalizeSelectedCapabilities(value: unknown): SelectedCapability[] {
  if (!Array.isArray(value)) return []
  const result: SelectedCapability[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (!SELECTED_CAPABILITY_TYPES.has(record.type as SelectedCapability['type'])) continue
    const pluginName = normalizedText(record.pluginName, SELECTED_CAPABILITY_PLUGIN_NAME_MAX_LENGTH)
    const name = normalizedText(record.name, SELECTED_CAPABILITY_NAME_MAX_LENGTH)
    const label = normalizedText(record.label, SELECTED_CAPABILITY_LABEL_MAX_LENGTH)
    if (!pluginName || !name || !label) continue
    const capability: SelectedCapability = {
      type: record.type as SelectedCapability['type'],
      pluginName,
      name,
      label,
    }
    const description = normalizedText(record.description, SELECTED_CAPABILITY_DESCRIPTION_MAX_LENGTH)
    if (description) capability.description = description
    const key = selectedCapabilityKey(capability)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(capability)
    if (result.length >= MAX_SELECTED_CAPABILITIES) break
  }
  return result
}

export function selectedCapabilitySnapshots(value: unknown): SelectedCapabilitySnapshot[] {
  return normalizeSelectedCapabilities(value).map(({ type, pluginName, name, label }) => ({ type, pluginName, name, label }))
}

export function selectedCapabilitiesFromDetails(details: unknown): SelectedCapabilitySnapshot[] {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return []
  return selectedCapabilitySnapshots((details as Record<string, unknown>).selectedCapabilities)
}

export function withSelectedCapabilitiesSnapshot<T extends Record<string, unknown>>(
  message: T,
  capabilities: unknown,
): T {
  const snapshots = selectedCapabilitySnapshots(capabilities)
  const details = message.details && typeof message.details === 'object' && !Array.isArray(message.details)
    ? message.details as Record<string, unknown>
    : {}
  const nextDetails = { ...details }
  if (snapshots.length > 0) nextDetails.selectedCapabilities = snapshots
  else delete nextDetails.selectedCapabilities
  const next = { ...message } as T & { details?: Record<string, unknown> }
  if (Object.keys(nextDetails).length > 0) next.details = nextDetails
  else delete next.details
  return next as T
}

export function isManagedQuickForgeCloudModel(model: unknown): boolean {
  if (!model || typeof model !== 'object') return false
  const candidate = model as { provider?: unknown; quickforgeModelSource?: unknown }
  return candidate.provider === 'quickforge-cloud'
    && candidate.quickforgeModelSource === 'cloud'
}

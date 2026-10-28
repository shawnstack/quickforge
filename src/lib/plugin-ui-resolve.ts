// Pure `$slot.*` / `$state.*` substitution for declarative plugin UI.
//
// Lives outside the component file so the renderer stays a component-only
// module (react-refresh) and so the resolution rules can be unit-tested without
// React.
import type { PluginUiEvent, PluginUiSlotProps } from './plugin-ui-types'

export function resolvePluginUiPayload(
  event: PluginUiEvent,
  scope: { props?: PluginUiSlotProps; state?: Record<string, unknown> },
): PluginUiEvent {
  const payload = event.payload
  if (!payload) return event
  const props = scope.props || {}
  const state = scope.state || {}
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' && value.startsWith('$')) {
      const [root, ...segments] = value.slice(1).split('.')
      let current: unknown = root === 'slot' ? props : root === 'state' ? state : undefined
      for (const segment of segments) {
        if (!current || typeof current !== 'object') {
          current = undefined
          break
        }
        current = (current as Record<string, unknown>)[segment]
      }
      if (current !== undefined) resolved[key] = current
      continue
    }
    resolved[key] = value
  }
  return { action: event.action, payload: resolved }
}

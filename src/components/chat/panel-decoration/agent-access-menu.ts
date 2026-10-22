import type { AgentAccessMode } from '@/lib/types'

/**
 * Agent-access menu cleanup.
 *
 * The trigger and the menu are rendered by React now
 * (`surface/ComposerAccessControls.tsx`), so this module must NOT remove any
 * node: doing so makes React's later unmount throw
 * `NotFoundError: The node to be removed is not a child of this node`, which
 * takes down the whole chat panel through the error boundary. (Probed against
 * react-dom 19: an externally removed child always fails the unmount.)
 *
 * What remains here is the *request* to close. The surface owns the open state,
 * so it exposes a close callback through the same send-hooks ref the other
 * composer hooks use; the decoration calls it and React removes the node itself.
 */

export type AgentAccessMenuCloser = () => void

let closeRequested: AgentAccessMenuCloser | null = null

/**
 * Register the surface's close callback. Called by `ChatSurface` on mount and
 * cleared on unmount, so a decoration pass in one panel can never close another
 * panel's menu (each surface registers its own).
 */
export function registerAgentAccessMenuCloser(closer: AgentAccessMenuCloser | null): void {
  closeRequested = closer
}

/**
 * Ask the surface to close its agent-access menu.
 *
 * `scoped` keeps the original panel-scoped semantics: it is a no-op for a panel
 * that is not the registered owner. There is only one registered owner per
 * surface, and the side-chat surface never renders the menu, so the scoped
 * check reduces to "is there a menu open at all".
 */
export function removeAgentAccessMenu(_panel?: HTMLElement | null, scoped = false): void {
  if (scoped && !closeRequested) return
  closeRequested?.()
}

/**
 * The access-mode vocabulary the trigger/menu labels use. Kept next to the close
 * path so callers that only need the label key do not pull in the React
 * component.
 */
export function agentAccessModeLabelKey(mode: AgentAccessMode): 'agentAccessFullLabel' | 'agentAccessDefaultLabel' {
  return mode === 'full-access' ? 'agentAccessFullLabel' : 'agentAccessDefaultLabel'
}

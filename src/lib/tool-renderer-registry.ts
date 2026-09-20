import type { ReactNode } from 'react'
import type { ToolResultMessage } from '@earendil-works/pi-ai'

/** React-only renderer contract shared by chat, side chat and subagent traces. */
export interface ToolRenderResult {
  content: ReactNode
  isCustom: boolean
}

export interface ToolRenderer<TParams = unknown, TDetails = unknown> {
  render(params: TParams | undefined, result: ToolResultMessage<TDetails> | undefined, isStreaming?: boolean): ToolRenderResult
}

// Renderers are stateless factories. Each consumer owns its React tree; no
// package registry, DOM host or session-specific renderer is shared here.
const localToolRenderers = new Map<string, ToolRenderer>()

/** Registering the same tool name again replaces its renderer. */
export function registerToolRenderer(toolName: string, renderer: ToolRenderer): void {
  localToolRenderers.set(toolName, renderer)
}

export function getToolRenderer(toolName: string): ToolRenderer | undefined {
  return localToolRenderers.get(toolName)
}

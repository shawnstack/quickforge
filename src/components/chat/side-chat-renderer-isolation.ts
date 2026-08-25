import {
  getToolRenderer,
  registerToolRenderer,
  type ToolRenderer,
} from '@earendil-works/pi-web-ui'

/**
 * ChatPanel.setAgent() synchronously installs an artifacts renderer before its
 * first await. Side Chat shares ChatPanel but must leave the process-wide
 * renderer registry exactly as it found it so the main panel keeps ownership.
 */
export function withPreservedArtifactsRenderer<T>(initialize: () => T): T {
  const existingRenderer = getToolRenderer('artifacts')
  if (!existingRenderer) {
    throw new Error('Side Chat requires the main artifacts renderer to be initialized first.')
  }
  try {
    return initialize()
  } finally {
    registerToolRenderer('artifacts', existingRenderer as ToolRenderer)
  }
}

import type { AgentHarness } from '@/lib/types'
import { randomId } from '@/lib/random-id'

export const DEFAULT_HARNESS_CHANGED_EVENT = 'quickforge:default-harness-changed'
const SYNC_CHANNEL_NAME = 'quickforge-sync'
const syncSourceId = randomId()

export function getCrossTabSyncSourceId() {
  return syncSourceId
}

export function notifyDefaultHarnessChanged(harness: AgentHarness) {
  window.dispatchEvent(new CustomEvent(DEFAULT_HARNESS_CHANGED_EVENT, { detail: { harness } }))

  if (typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(SYNC_CHANNEL_NAME)
    channel.postMessage({
      type: 'settings-changed',
      settings: {
        defaultHarness: harness,
      },
      sourceTabId: syncSourceId,
      timestamp: Date.now(),
    })
    channel.close()
  } catch {
    // Cross-tab refresh is best-effort only.
  }
}

import { randomId } from '@/lib/random-id'

/**
 * Stable per-tab id used to ignore our own BroadcastChannel messages in the
 * shared 'quickforge-sync' cross-tab channel.
 */
const syncSourceId = randomId()

export function getCrossTabSyncSourceId() {
  return syncSourceId
}

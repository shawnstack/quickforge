// Plugin UI audit log.
//
// Every dispatched UI action and every rejected one is appended to a bounded,
// newest-first array store (`plugin-audit.json`) so the plugins page can answer
// "what did this plugin actually do". This mirrors the hook engine's execution
// log: a root-array store under storage/, written through the shared serialized
// queue, trimmed to a fixed size.
import { readStore, writeStore } from '../storage.mjs'
import { logger } from '../utils/logger.mjs'

export const PLUGIN_AUDIT_STORE = 'plugin-audit'
export const PLUGIN_AUDIT_LIMIT = 300
export const PLUGIN_AUDIT_SCHEMA_VERSION = 1

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeEntries(value) {
  if (!Array.isArray(value)) return []
  return value.filter((entry) => isPlainObject(entry) && typeof entry.plugin === 'string').slice(0, PLUGIN_AUDIT_LIMIT)
}

export async function listPluginAudit(filter = {}) {
  const entries = normalizeEntries(await readStore(PLUGIN_AUDIT_STORE))
  const plugin = typeof filter.plugin === 'string' ? filter.plugin : ''
  const limit = Number.isFinite(filter.limit) ? Math.max(1, Math.min(filter.limit, PLUGIN_AUDIT_LIMIT)) : 50
  const filtered = plugin ? entries.filter((entry) => entry.plugin === plugin) : entries
  return filtered.slice(0, limit)
}

/**
 * Appends one audit entry (newest first). Never throws: auditing must not be
 * able to break an action that already succeeded.
 */
export async function recordPluginAudit(entry) {
  if (!isPlainObject(entry) || typeof entry.plugin !== 'string') return
  const record = {
    schemaVersion: PLUGIN_AUDIT_SCHEMA_VERSION,
    at: new Date().toISOString(),
    plugin: entry.plugin,
    kind: typeof entry.kind === 'string' ? entry.kind : 'ui',
    slot: typeof entry.slot === 'string' ? entry.slot : null,
    action: typeof entry.action === 'string' ? entry.action : null,
    outcome: typeof entry.outcome === 'string' ? entry.outcome : 'ok',
    reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 300) : null,
    durationMs: Number.isFinite(entry.durationMs) ? Math.round(entry.durationMs) : null,
  }
  try {
    const current = normalizeEntries(await readStore(PLUGIN_AUDIT_STORE))
    await writeStore(PLUGIN_AUDIT_STORE, [record, ...current].slice(0, PLUGIN_AUDIT_LIMIT))
  } catch (error) {
    logger.warn('Failed to record plugin audit entry:', error)
  }
}

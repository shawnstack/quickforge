export const EXPANDED_PROJECT_IDS_STORAGE_KEY = 'quickforge:expanded-project-ids:v1'

function getLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) ids.push(item)
  }
  return ids
}

/** Safely read expanded project IDs from localStorage. Returns empty Set on missing/invalid data. */
export function loadExpandedProjectIds(): Set<string> {
  const storage = getLocalStorage()
  if (!storage) return new Set()

  try {
    const raw = storage.getItem(EXPANDED_PROJECT_IDS_STORAGE_KEY)
    if (!raw) return new Set()
    return new Set(normalizeIds(JSON.parse(raw)))
  } catch {
    return new Set()
  }
}

/** Safely write expanded project IDs to localStorage. Swallows storage errors. */
export function saveExpandedProjectIds(ids: Iterable<string>): void {
  const storage = getLocalStorage()
  if (!storage) return

  try {
    const unique = [...new Set(Array.from(ids).filter((id) => typeof id === 'string' && id.length > 0))]
    storage.setItem(EXPANDED_PROJECT_IDS_STORAGE_KEY, JSON.stringify(unique))
  } catch {
    // Ignore quota / access errors — expanded state is non-critical.
  }
}

/** Keep only IDs that still exist in the valid project list. */
export function pruneExpandedProjectIds(
  expandedIds: Iterable<string>,
  validProjectIds: Iterable<string>,
): Set<string> {
  const valid = new Set(validProjectIds)
  const next = new Set<string>()
  for (const id of expandedIds) {
    if (valid.has(id)) next.add(id)
  }
  return next
}

import type { SidebarSessionSortMode, SidebarSessionViewMode } from '@/lib/types'

export const SIDEBAR_SESSION_VIEW_MODE_STORAGE_KEY = 'quickforge:sidebar-session-view-mode:v1'
export const SIDEBAR_SESSION_SORT_MODE_STORAGE_KEY = 'quickforge:sidebar-session-sort-mode:v1'

const DEFAULT_SIDEBAR_SESSION_VIEW_MODE: SidebarSessionViewMode = 'project'
const DEFAULT_SIDEBAR_SESSION_SORT_MODE: SidebarSessionSortMode = 'updatedAt'

function getLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** Safely read the sidebar session view preference from localStorage. */
export function loadSidebarSessionViewMode(): SidebarSessionViewMode {
  const storage = getLocalStorage()
  if (!storage) return DEFAULT_SIDEBAR_SESSION_VIEW_MODE

  try {
    const value = storage.getItem(SIDEBAR_SESSION_VIEW_MODE_STORAGE_KEY)
    return value === 'timeline' || value === 'project'
      ? value
      : DEFAULT_SIDEBAR_SESSION_VIEW_MODE
  } catch {
    return DEFAULT_SIDEBAR_SESSION_VIEW_MODE
  }
}

/** Safely persist the sidebar session view preference to localStorage. */
export function saveSidebarSessionViewMode(mode: SidebarSessionViewMode): void {
  const storage = getLocalStorage()
  if (!storage) return

  try {
    storage.setItem(SIDEBAR_SESSION_VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    // Ignore quota / access errors — this preference is non-critical.
  }
}

/** Safely read the sidebar session sort preference from localStorage. */
export function loadSidebarSessionSortMode(): SidebarSessionSortMode {
  const storage = getLocalStorage()
  if (!storage) return DEFAULT_SIDEBAR_SESSION_SORT_MODE

  try {
    const value = storage.getItem(SIDEBAR_SESSION_SORT_MODE_STORAGE_KEY)
    return value === 'createdAt' || value === 'updatedAt'
      ? value
      : DEFAULT_SIDEBAR_SESSION_SORT_MODE
  } catch {
    return DEFAULT_SIDEBAR_SESSION_SORT_MODE
  }
}

/** Safely persist the sidebar session sort preference to localStorage. */
export function saveSidebarSessionSortMode(mode: SidebarSessionSortMode): void {
  const storage = getLocalStorage()
  if (!storage) return

  try {
    storage.setItem(SIDEBAR_SESSION_SORT_MODE_STORAGE_KEY, mode)
  } catch {
    // Ignore quota / access errors — this preference is non-critical.
  }
}

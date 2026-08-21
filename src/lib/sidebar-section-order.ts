export const SIDEBAR_SECTION_ORDER_STORAGE_KEY = 'quickforge:sidebar-section-order:v1'

export const SIDEBAR_SECTION_IDS = ['projects', 'tasks'] as const

export type SidebarSectionId = (typeof SIDEBAR_SECTION_IDS)[number]
export type SidebarSectionOrder = SidebarSectionId[]

const DEFAULT_SIDEBAR_SECTION_ORDER: SidebarSectionOrder = [...SIDEBAR_SECTION_IDS]

function isSidebarSectionId(value: unknown): value is SidebarSectionId {
  return SIDEBAR_SECTION_IDS.includes(value as SidebarSectionId)
}

function getLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** Normalize unknown persisted data into a complete, duplicate-free section order. */
export function normalizeSidebarSectionOrder(value: unknown): SidebarSectionOrder {
  const normalized: SidebarSectionOrder = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isSidebarSectionId(item) && !normalized.includes(item)) normalized.push(item)
    }
  }
  for (const sectionId of DEFAULT_SIDEBAR_SECTION_ORDER) {
    if (!normalized.includes(sectionId)) normalized.push(sectionId)
  }
  return normalized
}

/** Safely read the sidebar section order from browser-local storage. */
export function loadSidebarSectionOrder(storage: Storage | undefined = getLocalStorage()): SidebarSectionOrder {
  if (!storage) return [...DEFAULT_SIDEBAR_SECTION_ORDER]
  try {
    const raw = storage.getItem(SIDEBAR_SECTION_ORDER_STORAGE_KEY)
    return normalizeSidebarSectionOrder(raw ? JSON.parse(raw) : undefined)
  } catch {
    return [...DEFAULT_SIDEBAR_SECTION_ORDER]
  }
}

/** Safely persist a normalized sidebar section order to browser-local storage. */
export function saveSidebarSectionOrder(
  order: unknown,
  storage: Storage | undefined = getLocalStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(SIDEBAR_SECTION_ORDER_STORAGE_KEY, JSON.stringify(normalizeSidebarSectionOrder(order)))
  } catch {
    // Ignore quota / access errors — this preference is non-critical.
  }
}

/** Move one known section relative to another without admitting foreign item ids. */
export function reorderSidebarSections(
  order: unknown,
  activeId: unknown,
  overId: unknown,
): SidebarSectionOrder {
  const normalized = normalizeSidebarSectionOrder(order)
  if (!isSidebarSectionId(activeId) || !isSidebarSectionId(overId) || activeId === overId) return normalized

  const activeIndex = normalized.indexOf(activeId)
  const overIndex = normalized.indexOf(overId)
  if (activeIndex < 0 || overIndex < 0) return normalized

  const reordered = [...normalized]
  const [activeSection] = reordered.splice(activeIndex, 1)
  reordered.splice(overIndex, 0, activeSection)
  return reordered
}

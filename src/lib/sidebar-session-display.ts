export const SIDEBAR_SESSION_DISPLAY_STEP = 5

export type SidebarSessionShowMoreInput = {
  visibleCount: number
  loadedCount: number
  hasMore: boolean
}

export type SidebarSessionShowMoreAction = {
  targetVisibleCount: number
  requiresLoad: boolean
}

export type SidebarSessionShowMoreState = {
  generations: Map<string, number>
  pendingGenerations: Map<string, number>
}

export function createSidebarSessionShowMoreState(): SidebarSessionShowMoreState {
  return {
    generations: new Map(),
    pendingGenerations: new Map(),
  }
}

export function invalidateSidebarSessionShowMore(
  state: SidebarSessionShowMoreState,
  key: string,
): void {
  state.generations.set(key, (state.generations.get(key) ?? 0) + 1)
  state.pendingGenerations.delete(key)
}

export function invalidateSidebarSessionShowMoreByPrefix(
  state: SidebarSessionShowMoreState,
  prefix: string,
): void {
  const keys = new Set([
    ...state.generations.keys(),
    ...state.pendingGenerations.keys(),
  ])
  for (const key of keys) {
    if (key.startsWith(prefix)) invalidateSidebarSessionShowMore(state, key)
  }
}

export function sidebarSessionShowMoreAction({
  visibleCount,
  loadedCount,
  hasMore,
}: SidebarSessionShowMoreInput): SidebarSessionShowMoreAction | undefined {
  const targetVisibleCount = visibleCount + SIDEBAR_SESSION_DISPLAY_STEP
  if (targetVisibleCount <= loadedCount) {
    return { targetVisibleCount, requiresLoad: false }
  }
  if (!hasMore) return undefined
  return { targetVisibleCount, requiresLoad: true }
}

export async function runSidebarSessionShowMore({
  key,
  state,
  input,
  loadMore,
}: {
  key: string
  state: SidebarSessionShowMoreState
  input: SidebarSessionShowMoreInput
  loadMore: () => Promise<boolean>
}): Promise<number | undefined> {
  const generation = state.generations.get(key) ?? 0
  if (state.pendingGenerations.get(key) === generation) return undefined
  const action = sidebarSessionShowMoreAction(input)
  if (!action) return undefined

  state.pendingGenerations.set(key, generation)
  try {
    if (action.requiresLoad && !(await loadMore())) return undefined
    if ((state.generations.get(key) ?? 0) !== generation) return undefined
    return action.targetVisibleCount
  } finally {
    if (state.pendingGenerations.get(key) === generation) {
      state.pendingGenerations.delete(key)
    }
  }
}

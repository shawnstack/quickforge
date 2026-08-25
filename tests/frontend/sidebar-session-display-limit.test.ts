import { describe, expect, it, vi } from 'vitest'
import {
  createSidebarSessionShowMoreState,
  invalidateSidebarSessionShowMore,
  invalidateSidebarSessionShowMoreByPrefix,
  runSidebarSessionShowMore,
  SIDEBAR_SESSION_DISPLAY_STEP,
  sidebarSessionShowMoreAction,
} from '../../src/lib/sidebar-session-display'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('sidebar session display behavior', () => {
  it('uses five-item steps and avoids loading while the next step is already loaded', () => {
    expect(SIDEBAR_SESSION_DISPLAY_STEP).toBe(5)
    expect(sidebarSessionShowMoreAction({ visibleCount: 5, loadedCount: 20, hasMore: true })).toEqual({
      targetVisibleCount: 10,
      requiresLoad: false,
    })
  })

  it('requires a load only when the next step exceeds loaded data', () => {
    expect(sidebarSessionShowMoreAction({ visibleCount: 20, loadedCount: 20, hasMore: true })).toEqual({
      targetVisibleCount: 25,
      requiresLoad: true,
    })
    expect(sidebarSessionShowMoreAction({ visibleCount: 20, loadedCount: 20, hasMore: false })).toBeUndefined()
  })

  it('keeps the visible count unchanged when loading fails and allows retry', async () => {
    const state = createSidebarSessionShowMoreState()
    const failedLoad = vi.fn(async () => false)

    await expect(runSidebarSessionShowMore({
      key: 'global',
      state,
      input: { visibleCount: 20, loadedCount: 20, hasMore: true },
      loadMore: failedLoad,
    })).resolves.toBeUndefined()
    expect(failedLoad).toHaveBeenCalledTimes(1)
    expect(state.pendingGenerations.size).toBe(0)

    await expect(runSidebarSessionShowMore({
      key: 'global',
      state,
      input: { visibleCount: 20, loadedCount: 20, hasMore: true },
      loadMore: async () => true,
    })).resolves.toBe(25)
  })

  it('deduplicates rapid repeated clicks while one load is pending', async () => {
    const state = createSidebarSessionShowMoreState()
    const request = deferred<boolean>()
    const loadMore = vi.fn(() => request.promise)
    const input = { visibleCount: 20, loadedCount: 20, hasMore: true }

    const first = runSidebarSessionShowMore({ key: 'project:p1', state, input, loadMore })
    const second = runSidebarSessionShowMore({ key: 'project:p1', state, input, loadMore })

    await expect(second).resolves.toBeUndefined()
    expect(loadMore).toHaveBeenCalledTimes(1)
    request.resolve(true)
    await expect(first).resolves.toBe(25)
    expect(state.pendingGenerations.size).toBe(0)
  })

  it.each(['timeline', 'global', 'project:p1'])('does not commit a stale %s count after reset while loading', async (key) => {
    const state = createSidebarSessionShowMoreState()
    const request = deferred<boolean>()
    let visibleCount = 20

    const showMore = runSidebarSessionShowMore({
      key,
      state,
      input: { visibleCount, loadedCount: 20, hasMore: true },
      loadMore: () => request.promise,
    }).then((nextVisibleCount) => {
      if (nextVisibleCount !== undefined) visibleCount = nextVisibleCount
    })

    invalidateSidebarSessionShowMore(state, key)
    visibleCount = SIDEBAR_SESSION_DISPLAY_STEP
    request.resolve(true)
    await showMore

    expect(visibleCount).toBe(5)
    expect(state.pendingGenerations.size).toBe(0)
  })

  it('invalidates all pending project lists without affecting timeline or global keys', async () => {
    const state = createSidebarSessionShowMoreState()
    const projectOne = deferred<boolean>()
    const projectTwo = deferred<boolean>()
    const timeline = deferred<boolean>()
    const input = { visibleCount: 20, loadedCount: 20, hasMore: true }

    const projectOneShowMore = runSidebarSessionShowMore({ key: 'project:p1', state, input, loadMore: () => projectOne.promise })
    const projectTwoShowMore = runSidebarSessionShowMore({ key: 'project:p2', state, input, loadMore: () => projectTwo.promise })
    const timelineShowMore = runSidebarSessionShowMore({ key: 'timeline', state, input, loadMore: () => timeline.promise })

    invalidateSidebarSessionShowMoreByPrefix(state, 'project:')
    projectOne.resolve(true)
    projectTwo.resolve(true)
    timeline.resolve(true)

    await expect(projectOneShowMore).resolves.toBeUndefined()
    await expect(projectTwoShowMore).resolves.toBeUndefined()
    await expect(timelineShowMore).resolves.toBe(25)
  })
})

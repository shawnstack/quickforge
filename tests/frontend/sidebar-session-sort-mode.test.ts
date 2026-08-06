import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SIDEBAR_SESSION_SORT_MODE_STORAGE_KEY,
  SIDEBAR_SESSION_VIEW_MODE_STORAGE_KEY,
  loadSidebarSessionSortMode,
  loadSidebarSessionViewMode,
  saveSidebarSessionSortMode,
  saveSidebarSessionViewMode,
} from '../../src/lib/sidebar-session-sort-mode'

function createLocalStorageMock(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, String(value))
    },
  }
}

describe('sidebar session sort mode storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock())
  })

  it('defaults to project when no valid view preference is stored', () => {
    expect(loadSidebarSessionViewMode()).toBe('project')

    globalThis.localStorage.setItem(SIDEBAR_SESSION_VIEW_MODE_STORAGE_KEY, 'invalid')
    expect(loadSidebarSessionViewMode()).toBe('project')
  })

  it.each(['project', 'timeline'] as const)('loads the stored %s view preference', (mode) => {
    globalThis.localStorage.setItem(SIDEBAR_SESSION_VIEW_MODE_STORAGE_KEY, mode)

    expect(loadSidebarSessionViewMode()).toBe(mode)
  })

  it('saves the selected view preference', () => {
    saveSidebarSessionViewMode('timeline')

    expect(globalThis.localStorage.getItem(SIDEBAR_SESSION_VIEW_MODE_STORAGE_KEY)).toBe('timeline')
  })

  it('defaults to updatedAt when no valid sort preference is stored', () => {
    expect(loadSidebarSessionSortMode()).toBe('updatedAt')

    globalThis.localStorage.setItem(SIDEBAR_SESSION_SORT_MODE_STORAGE_KEY, 'invalid')
    expect(loadSidebarSessionSortMode()).toBe('updatedAt')
  })

  it.each(['updatedAt', 'createdAt'] as const)('loads the stored %s preference', (mode) => {
    globalThis.localStorage.setItem(SIDEBAR_SESSION_SORT_MODE_STORAGE_KEY, mode)

    expect(loadSidebarSessionSortMode()).toBe(mode)
  })

  it('saves the selected preference', () => {
    saveSidebarSessionSortMode('createdAt')

    expect(globalThis.localStorage.getItem(SIDEBAR_SESSION_SORT_MODE_STORAGE_KEY)).toBe('createdAt')
  })

  it('does not throw when storage reads or writes fail', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } satisfies Storage)

    expect(() => loadSidebarSessionViewMode()).not.toThrow()
    expect(loadSidebarSessionViewMode()).toBe('project')
    expect(() => saveSidebarSessionViewMode('timeline')).not.toThrow()
    expect(() => loadSidebarSessionSortMode()).not.toThrow()
    expect(loadSidebarSessionSortMode()).toBe('updatedAt')
    expect(() => saveSidebarSessionSortMode('createdAt')).not.toThrow()
  })
})

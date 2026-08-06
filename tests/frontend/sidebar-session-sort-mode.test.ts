import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SIDEBAR_SESSION_SORT_MODE_STORAGE_KEY,
  loadSidebarSessionSortMode,
  saveSidebarSessionSortMode,
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

  it('defaults to updatedAt when no valid preference is stored', () => {
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

    expect(() => loadSidebarSessionSortMode()).not.toThrow()
    expect(loadSidebarSessionSortMode()).toBe('updatedAt')
    expect(() => saveSidebarSessionSortMode('createdAt')).not.toThrow()
  })
})

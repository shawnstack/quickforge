import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXPANDED_PROJECT_IDS_STORAGE_KEY,
  loadExpandedProjectIds,
  pruneExpandedProjectIds,
  saveExpandedProjectIds,
} from '../../src/lib/project-expanded-ids'

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

describe('project expanded ids storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock())
  })

  it('returns an empty set when nothing is stored', () => {
    expect([...loadExpandedProjectIds()]).toEqual([])
  })

  it('loads valid stored project ids', () => {
    globalThis.localStorage.setItem(
      EXPANDED_PROJECT_IDS_STORAGE_KEY,
      JSON.stringify(['project-a', 'project-b']),
    )

    expect([...loadExpandedProjectIds()].sort()).toEqual(['project-a', 'project-b'])
  })

  it('filters invalid entries and falls back on parse errors', () => {
    globalThis.localStorage.setItem(
      EXPANDED_PROJECT_IDS_STORAGE_KEY,
      JSON.stringify(['ok', '', 123, null, 'also-ok']),
    )
    expect([...loadExpandedProjectIds()].sort()).toEqual(['also-ok', 'ok'])

    globalThis.localStorage.setItem(EXPANDED_PROJECT_IDS_STORAGE_KEY, '{broken')
    expect([...loadExpandedProjectIds()]).toEqual([])

    globalThis.localStorage.setItem(EXPANDED_PROJECT_IDS_STORAGE_KEY, JSON.stringify({ not: 'array' }))
    expect([...loadExpandedProjectIds()]).toEqual([])
  })

  it('prunes deleted ids without auto-adding new projects', () => {
    const pruned = pruneExpandedProjectIds(
      ['old-a', 'old-b', 'deleted'],
      ['old-a', 'new-c'],
    )

    expect([...pruned]).toEqual(['old-a'])
    expect(pruned.has('new-c')).toBe(false)
    expect(pruned.has('deleted')).toBe(false)
  })

  it('saves expanded ids as a JSON string array', () => {
    saveExpandedProjectIds(new Set(['project-b', 'project-a', 'project-b', '']))

    const raw = globalThis.localStorage.getItem(EXPANDED_PROJECT_IDS_STORAGE_KEY)
    expect(JSON.parse(raw ?? 'null')).toEqual(['project-b', 'project-a'])
  })

  it('does not throw when storage access or writes fail', () => {
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

    expect(() => loadExpandedProjectIds()).not.toThrow()
    expect([...loadExpandedProjectIds()]).toEqual([])
    expect(() => saveExpandedProjectIds(['project-a'])).not.toThrow()
  })
})

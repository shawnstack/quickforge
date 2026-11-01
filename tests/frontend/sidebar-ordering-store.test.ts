import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SIDEBAR_SECTION_ORDER_STORAGE_KEY,
} from '../../src/lib/sidebar-section-order'
import {
  SIDEBAR_SESSION_SORT_MODE_STORAGE_KEY,
  SIDEBAR_SESSION_VIEW_MODE_STORAGE_KEY,
} from '../../src/lib/sidebar-session-sort-mode'
import { useSidebarOrderingStore } from '../../src/stores/sidebar-ordering-store'

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>()
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

describe('sidebarOrderingStore', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock())
    useSidebarOrderingStore.setState({
      sidebarSectionOrder: ['projects', 'tasks'],
      sidebarSessionViewMode: 'project',
      sidebarSessionSortMode: 'updatedAt',
    })
  })

  it('handleSidebarSectionReorder 更新共享顺序并持久化', () => {
    useSidebarOrderingStore.getState().handleSidebarSectionReorder('projects', 'tasks')

    expect(useSidebarOrderingStore.getState().sidebarSectionOrder).toEqual(['tasks', 'projects'])
    expect(globalThis.localStorage.getItem(SIDEBAR_SECTION_ORDER_STORAGE_KEY)).toBe('["tasks","projects"]')
  })

  it('非法/相同 id 的 reorder 不改变顺序', () => {
    useSidebarOrderingStore.getState().handleSidebarSectionReorder('tasks', 'tasks')

    expect(useSidebarOrderingStore.getState().sidebarSectionOrder).toEqual(['projects', 'tasks'])
  })

  it('setSidebarSessionViewMode 更新状态并持久化', () => {
    useSidebarOrderingStore.getState().setSidebarSessionViewMode('timeline')

    expect(useSidebarOrderingStore.getState().sidebarSessionViewMode).toBe('timeline')
    expect(globalThis.localStorage.getItem(SIDEBAR_SESSION_VIEW_MODE_STORAGE_KEY)).toBe('timeline')
  })

  it('setSidebarSessionSortMode 更新状态并持久化', () => {
    useSidebarOrderingStore.getState().setSidebarSessionSortMode('createdAt')

    expect(useSidebarOrderingStore.getState().sidebarSessionSortMode).toBe('createdAt')
    expect(globalThis.localStorage.getItem(SIDEBAR_SESSION_SORT_MODE_STORAGE_KEY)).toBe('createdAt')
  })

  it('action 引用恒定，桌面/移动两个消费者共享同一实例', () => {
    const { handleSidebarSectionReorder } = useSidebarOrderingStore.getState()
    handleSidebarSectionReorder('projects', 'tasks')

    expect(useSidebarOrderingStore.getState().handleSidebarSectionReorder).toBe(handleSidebarSectionReorder)
  })
})

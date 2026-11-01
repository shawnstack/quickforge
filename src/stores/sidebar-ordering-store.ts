import { create } from 'zustand'
import {
  loadSidebarSectionOrder,
  reorderSidebarSections,
  saveSidebarSectionOrder,
  type SidebarSectionId,
  type SidebarSectionOrder,
} from '@/lib/sidebar-section-order'
import {
  loadSidebarSessionSortMode,
  loadSidebarSessionViewMode,
  saveSidebarSessionSortMode,
  saveSidebarSessionViewMode,
} from '@/lib/sidebar-session-sort-mode'
import type { SidebarSessionSortMode, SidebarSessionViewMode } from '@/lib/types'

interface SidebarOrderingStore {
  sidebarSectionOrder: SidebarSectionOrder
  sidebarSessionViewMode: SidebarSessionViewMode
  sidebarSessionSortMode: SidebarSessionSortMode
  handleSidebarSectionReorder: (activeId: SidebarSectionId, overId: SidebarSectionId) => void
  setSidebarSessionViewMode: (mode: SidebarSessionViewMode) => void
  setSidebarSessionSortMode: (mode: SidebarSessionSortMode) => void
}

/** 侧栏「区块顺序 + 视图/排序模式」的 App 级单一数据源，
 *  桌面与移动两处 ChatSidebar 实例共享；每次变更同步写 localStorage。
 *
 *  与旧 useSidebarOrdering 的行为差异：初始加载不再把默认值写回
 *  localStorage（无变化不落盘），持久化语义不变。
 */
export const useSidebarOrderingStore = create<SidebarOrderingStore>((set) => ({
  sidebarSectionOrder: loadSidebarSectionOrder(),
  sidebarSessionViewMode: loadSidebarSessionViewMode(),
  sidebarSessionSortMode: loadSidebarSessionSortMode(),

  handleSidebarSectionReorder: (activeId: SidebarSectionId, overId: SidebarSectionId) => {
    const next = reorderSidebarSections(useSidebarOrderingStore.getState().sidebarSectionOrder, activeId, overId)
    set({ sidebarSectionOrder: next })
    saveSidebarSectionOrder(next)
  },

  setSidebarSessionViewMode: (mode: SidebarSessionViewMode) => {
    set({ sidebarSessionViewMode: mode })
    saveSidebarSessionViewMode(mode)
  },

  setSidebarSessionSortMode: (mode: SidebarSessionSortMode) => {
    set({ sidebarSessionSortMode: mode })
    saveSidebarSessionSortMode(mode)
  },
}))

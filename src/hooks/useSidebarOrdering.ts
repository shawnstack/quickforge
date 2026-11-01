import { useSidebarOrderingStore } from '@/stores/sidebar-ordering-store'

/** 侧栏排序/视图模式状态已迁入 useSidebarOrderingStore（zustand，含 localStorage 持久化）。
 *  本 hook 保留为兼容层：返回结构与旧实现一致，App.tsx 接线不变；
 *  setter / reorder 回调引用恒定（等价于旧 useCallback([])）。
 */
export function useSidebarOrdering() {
  const sidebarSectionOrder = useSidebarOrderingStore((s) => s.sidebarSectionOrder)
  const handleSidebarSectionReorder = useSidebarOrderingStore((s) => s.handleSidebarSectionReorder)
  const sidebarSessionViewMode = useSidebarOrderingStore((s) => s.sidebarSessionViewMode)
  const setSidebarSessionViewMode = useSidebarOrderingStore((s) => s.setSidebarSessionViewMode)
  const sidebarSessionSortMode = useSidebarOrderingStore((s) => s.sidebarSessionSortMode)
  const setSidebarSessionSortMode = useSidebarOrderingStore((s) => s.setSidebarSessionSortMode)

  return {
    sidebarSectionOrder,
    handleSidebarSectionReorder,
    sidebarSessionViewMode,
    setSidebarSessionViewMode,
    sidebarSessionSortMode,
    setSidebarSessionSortMode,
  }
}

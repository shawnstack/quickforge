import { useCallback, useEffect, useState } from 'react'
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

/** 侧栏「区块顺序 + 视图/排序模式」的 App 级状态，全部带 localStorage 持久化；
 *  桌面与移动两处 ChatSidebar 实例共享同一份。 */
export function useSidebarOrdering() {
  const [sidebarSectionOrder, setSidebarSectionOrder] = useState<SidebarSectionOrder>(loadSidebarSectionOrder)
  const [sidebarSessionViewMode, setSidebarSessionViewMode] = useState<SidebarSessionViewMode>(
    loadSidebarSessionViewMode,
  )
  const [sidebarSessionSortMode, setSidebarSessionSortMode] = useState<SidebarSessionSortMode>(
    loadSidebarSessionSortMode,
  )

  const handleSidebarSectionReorder = useCallback((activeId: SidebarSectionId, overId: SidebarSectionId) => {
    setSidebarSectionOrder((current) => reorderSidebarSections(current, activeId, overId))
  }, [])

  useEffect(() => {
    saveSidebarSectionOrder(sidebarSectionOrder)
  }, [sidebarSectionOrder])

  useEffect(() => {
    saveSidebarSessionViewMode(sidebarSessionViewMode)
  }, [sidebarSessionViewMode])

  useEffect(() => {
    saveSidebarSessionSortMode(sidebarSessionSortMode)
  }, [sidebarSessionSortMode])

  return {
    sidebarSectionOrder,
    handleSidebarSectionReorder,
    sidebarSessionViewMode,
    setSidebarSessionViewMode,
    sidebarSessionSortMode,
    setSidebarSessionSortMode,
  }
}

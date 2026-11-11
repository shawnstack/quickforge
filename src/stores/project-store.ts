import { create } from 'zustand'
import type { Dispatch, SetStateAction } from 'react'
import type { ProjectInfo } from '@/lib/types'
import { loadExpandedProjectIds, saveExpandedProjectIds } from '@/lib/project-expanded-ids'

/** bot 的专属目录也是注册项目，但对用户不可见——它只服务于那个 bot 的文件工具。 */
function visibleProjects(projects: ProjectInfo[]): ProjectInfo[] {
  return projects.filter((project) => project.kind !== 'bot')
}

interface ProjectStore {  activeProject: ProjectInfo | undefined
  projects: ProjectInfo[]
  /** 全局对话默认工作目录的合成 project（id=`default`），由 useProject 依据
   *  /api/project 的 defaultWorkspaceRoot 构造后写入。 */
  defaultWorkspace: ProjectInfo | undefined
  expandedProjectIds: Set<string>
  selectingProject: boolean
  projectPickerOpen: boolean

  setActiveProject: Dispatch<SetStateAction<ProjectInfo | undefined>>
  setProjects: Dispatch<SetStateAction<ProjectInfo[]>>
  setDefaultWorkspace: Dispatch<SetStateAction<ProjectInfo | undefined>>
  setExpandedProjectIds: Dispatch<SetStateAction<Set<string>>>
  setSelectingProject: Dispatch<SetStateAction<boolean>>
  setProjectPickerOpen: Dispatch<SetStateAction<boolean>>
}

/** 项目域状态的 App 级单一数据源（activeProject / projects / defaultWorkspace /
 *  expandedProjectIds / selectingProject / projectPickerOpen）。
 *
 *  - setter 与 useState 的 Dispatch<SetStateAction<T>> 签名兼容（支持函数式更新），
 *    App.tsx 与 useProjectActions 的既有接线/类型引用不变；action 引用恒定，
 *    等价于旧 useProject 中的 useCallback 固定依赖。
 *  - expandedProjectIds 的 localStorage 持久化采用 action 内直写（参照
 *    sidebar-ordering-store）：每次 set 后同步落盘，不再依赖 useEffect 回写；
 *    与旧实现的唯一差异是初始加载不把已存值重写回 localStorage（无变化不落盘）。
 *  - fetch / api-cache 读写与 switch/path/create/reorder 等 POST 副作用编排
 *    刻意保留在 useProject hook（行为等价、改动最小），store 只承载状态与
 *    setter，不引入网络层依赖。
 */
export const useProjectStore = create<ProjectStore>((set, get) => ({
  activeProject: undefined,
  projects: [],
  defaultWorkspace: undefined,
  expandedProjectIds: loadExpandedProjectIds(),
  selectingProject: false,
  projectPickerOpen: false,

  setActiveProject: (value) =>
    set((s) => ({ activeProject: typeof value === 'function' ? value(s.activeProject) : value })),
  // bot 目录也是注册过的项目（文件工具要靠它），但它不该出现在项目切换器里。
  // 在这里一次过滤掉：useProject 里有 6 处 setProjects 调用点，分散过滤必然会漏。
  setProjects: (value) =>
    set((s) => ({
      projects: visibleProjects(typeof value === 'function' ? value(s.projects) : value),
    })),
  setDefaultWorkspace: (value) =>
    set((s) => ({ defaultWorkspace: typeof value === 'function' ? value(s.defaultWorkspace) : value })),
  setExpandedProjectIds: (value) => {
    const next = typeof value === 'function' ? value(get().expandedProjectIds) : value
    set({ expandedProjectIds: next })
    saveExpandedProjectIds(next)
  },
  setSelectingProject: (value) =>
    set((s) => ({ selectingProject: typeof value === 'function' ? value(s.selectingProject) : value })),
  setProjectPickerOpen: (value) =>
    set((s) => ({ projectPickerOpen: typeof value === 'function' ? value(s.projectPickerOpen) : value })),
}))

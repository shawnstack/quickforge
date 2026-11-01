import { useCallback } from 'react'
import type { ProjectInfo } from '@/lib/types'
import { logger } from '@/lib/logger'
import { invalidateApiCache, readApiCache, writeApiCache } from '@/lib/api-cache'
import { pruneExpandedProjectIds } from '@/lib/project-expanded-ids'
import { useProjectStore } from '@/stores/project-store'

const PROJECT_LIST_CACHE_KEY = '/api/project'
const PROJECT_LIST_CACHE_TTL_MS = 15 * 1000

type ProjectListPayload = {
  project?: ProjectInfo
  projects?: ProjectInfo[]
  workspaceRoot?: string
  defaultWorkspaceRoot?: string
}

/** 项目域兼容层：activeProject / projects / defaultWorkspace / expandedProjectIds /
 *  selectingProject / projectPickerOpen 已迁入 useProjectStore（zustand，含
 *  expandedProjectIds 的 localStorage 持久化，见 store 注释）。
 *
 *  返回结构与签名和旧实现完全一致（含 useState 风格的 setter 签名），唯一
 *  调用方 App.tsx 接线不变；store 的 action 引用恒定（等价于旧 useCallback
 *  固定依赖），下游依赖数组的稳定性不受影响。
 *
 *  fetch / api-cache 读写与 switch/path/create/reorder 等 POST 副作用编排
 *  刻意保留在本 hook 而非迁为 store action（行为等价、改动最小）：store 只
 *  承载状态与 setter，不引入网络层依赖。
 */
export function useProject() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const projects = useProjectStore((s) => s.projects)
  const defaultWorkspace = useProjectStore((s) => s.defaultWorkspace)
  const expandedProjectIds = useProjectStore((s) => s.expandedProjectIds)
  const selectingProject = useProjectStore((s) => s.selectingProject)
  const projectPickerOpen = useProjectStore((s) => s.projectPickerOpen)

  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const setProjects = useProjectStore((s) => s.setProjects)
  const setDefaultWorkspace = useProjectStore((s) => s.setDefaultWorkspace)
  const setExpandedProjectIds = useProjectStore((s) => s.setExpandedProjectIds)
  const setSelectingProject = useProjectStore((s) => s.setSelectingProject)
  const setProjectPickerOpen = useProjectStore((s) => s.setProjectPickerOpen)

  const applyProjectListPayload = useCallback(
    (payload: ProjectListPayload) => {
      setActiveProject(payload.project)
      setProjects(Array.isArray(payload.projects) ? payload.projects : [])
      // Default workspace used as the synthetic project for global conversations.
      setDefaultWorkspace(
        typeof payload.defaultWorkspaceRoot === 'string' && payload.defaultWorkspaceRoot
          ? { id: 'default', name: 'workspace', path: payload.defaultWorkspaceRoot, lastOpenedAt: '' }
          : undefined,
      )
      setExpandedProjectIds((current) =>
        pruneExpandedProjectIds(
          current,
          (Array.isArray(payload.projects) ? payload.projects : []).map((project: ProjectInfo) => project.id),
        ),
      )
    },
    [setActiveProject, setDefaultWorkspace, setExpandedProjectIds, setProjects],
  )

  const loadProject = useCallback(
    async (forceRefresh = false) => {
      try {
        if (!forceRefresh) {
          const cached = readApiCache<ProjectListPayload>(PROJECT_LIST_CACHE_KEY, PROJECT_LIST_CACHE_TTL_MS)
          if (cached) {
            applyProjectListPayload(cached)
            return
          }
        }
        const response = await fetch('/api/project')
        if (!response.ok) return
        const payload = (await response.json()) as ProjectListPayload
        writeApiCache(PROJECT_LIST_CACHE_KEY, payload)
        applyProjectListPayload(payload)
      } catch (error) {
        logger.error('Failed to load project:', error)
      }
    },
    [applyProjectListPayload],
  )

  const switchActiveProject = useCallback(
    async (projectId: string) => {
      const response = await fetch('/api/project/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: projectId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Project switch failed with HTTP ${response.status}`)

      setActiveProject(payload.project)
      setProjects(Array.isArray(payload.projects) ? payload.projects : [])
      setExpandedProjectIds(new Set([projectId]))
      invalidateApiCache(PROJECT_LIST_CACHE_KEY)
      return payload.project as ProjectInfo
    },
    [setActiveProject, setExpandedProjectIds, setProjects],
  )

  const handleSelectProjectPath = useCallback(
    async (projectPath: string) => {
      setSelectingProject(true)
      try {
        const response = await fetch('/api/project/path', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: projectPath }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || `Project selection failed with HTTP ${response.status}`)
        if (payload?.project) {
          setActiveProject(payload.project)
          setProjects(Array.isArray(payload.projects) ? payload.projects : [])
          invalidateApiCache(PROJECT_LIST_CACHE_KEY)
          setExpandedProjectIds((current) =>
            pruneExpandedProjectIds(
              current,
              (Array.isArray(payload.projects) ? payload.projects : []).map((project: ProjectInfo) => project.id),
            ),
          )
        }
      } catch (error) {
        logger.error('Failed to select project:', error)
        throw error
      } finally {
        setSelectingProject(false)
      }
    },
    [setActiveProject, setExpandedProjectIds, setProjects, setSelectingProject],
  )

  const selectProjectDirectory = useCallback(() => {
    setProjectPickerOpen(true)
  }, [setProjectPickerOpen])

  const createProjectInWorkspace = useCallback(
    async (name: string) => {
      setSelectingProject(true)
      try {
        const response = await fetch('/api/project/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          const error = new Error(payload?.error || `Project creation failed with HTTP ${response.status}`) as Error & {
            code?: string
          }
          if (typeof payload?.code === 'string') error.code = payload.code
          throw error
        }
        if (payload?.project) {
          setActiveProject(payload.project)
          setProjects(Array.isArray(payload.projects) ? payload.projects : [])
          invalidateApiCache(PROJECT_LIST_CACHE_KEY)
          setExpandedProjectIds((current) =>
            pruneExpandedProjectIds(
              current,
              (Array.isArray(payload.projects) ? payload.projects : []).map((project: ProjectInfo) => project.id),
            ),
          )
        }
        return payload?.project as ProjectInfo
      } finally {
        setSelectingProject(false)
      }
    },
    [setActiveProject, setExpandedProjectIds, setProjects, setSelectingProject],
  )

  const toggleProjectExpanded = useCallback(
    (projectId: string) => {
      setExpandedProjectIds((current) => {
        const next = new Set(current)
        if (next.has(projectId)) next.delete(projectId)
        else next.add(projectId)
        return next
      })
    },
    [setExpandedProjectIds],
  )

  const toggleAllProjectsExpanded = useCallback(() => {
    setExpandedProjectIds((current) => {
      if (current.size === projects.length && projects.length > 0) {
        // All expanded → collapse all
        return new Set()
      }
      // Not all expanded (or empty) → expand all
      return new Set(projects.map((p) => p.id))
    })
  }, [projects, setExpandedProjectIds])

  const reorderProjects = useCallback(
    async (orderedIds: string[]) => {
      // Optimistic update
      setProjects((current) => {
        const idToProject = new Map(current.map((p) => [p.id, p]))
        const reordered: ProjectInfo[] = []
        for (const id of orderedIds) {
          const p = idToProject.get(id)
          if (p) {
            reordered.push(p)
            idToProject.delete(id)
          }
        }
        return reordered
      })

      try {
        const response = await fetch('/api/project/reorder', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderedIds }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || `Reorder failed with HTTP ${response.status}`)
        if (Array.isArray(payload?.projects)) setProjects(payload.projects)
        invalidateApiCache(PROJECT_LIST_CACHE_KEY)
      } catch (error) {
        logger.error('Failed to reorder projects:', error)
      }
    },
    [setProjects],
  )

  return {
    activeProject,
    projects,
    defaultWorkspace,
    expandedProjectIds,
    selectingProject,
    projectPickerOpen,
    loadProject,
    switchActiveProject,
    handleSelectProjectPath,
    selectProjectDirectory,
    createProjectInWorkspace,
    setProjectPickerOpen,
    toggleProjectExpanded,
    toggleAllProjectsExpanded,
    reorderProjects,
    setActiveProject,
    setProjects,
    setExpandedProjectIds,
  }
}

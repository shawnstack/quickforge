import { useCallback, useEffect, useState } from 'react'
import type { ProjectInfo } from '@/lib/types'
import { logger } from '@/lib/logger'
import { invalidateApiCache, readApiCache, writeApiCache } from '@/lib/api-cache'
import {
  loadExpandedProjectIds,
  pruneExpandedProjectIds,
  saveExpandedProjectIds,
} from '@/lib/project-expanded-ids'

const PROJECT_LIST_CACHE_KEY = '/api/project'
const PROJECT_LIST_CACHE_TTL_MS = 15 * 1000

type ProjectListPayload = {
  project?: ProjectInfo
  projects?: ProjectInfo[]
  workspaceRoot?: string
  defaultWorkspaceRoot?: string
}

export function useProject() {
  const [activeProject, setActiveProject] = useState<ProjectInfo>()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [defaultWorkspace, setDefaultWorkspace] = useState<ProjectInfo>()
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => loadExpandedProjectIds())
  const [selectingProject, setSelectingProject] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)

  useEffect(() => {
    saveExpandedProjectIds(expandedProjectIds)
  }, [expandedProjectIds])

  const applyProjectListPayload = useCallback((payload: ProjectListPayload) => {
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
  }, [])

  const loadProject = useCallback(async (forceRefresh = false) => {
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
  }, [applyProjectListPayload])

  const switchActiveProject = useCallback(async (projectId: string) => {
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
  }, [])

  const handleSelectProjectPath = useCallback(async (projectPath: string) => {
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
  }, [])

  const selectProjectDirectory = useCallback(() => {
    setProjectPickerOpen(true)
  }, [])

  const toggleProjectExpanded = useCallback((projectId: string) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }, [])

  const toggleAllProjectsExpanded = useCallback(() => {
    setExpandedProjectIds((current) => {
      if (current.size === projects.length && projects.length > 0) {
        // All expanded → collapse all
        return new Set()
      }
      // Not all expanded (or empty) → expand all
      return new Set(projects.map((p) => p.id))
    })
  }, [projects])

  const reorderProjects = useCallback(async (orderedIds: string[]) => {
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
  }, [])

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
    setProjectPickerOpen,
    toggleProjectExpanded,
    toggleAllProjectsExpanded,
    reorderProjects,
    setActiveProject,
    setProjects,
    setExpandedProjectIds,
  }
}

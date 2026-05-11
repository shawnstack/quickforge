import { useCallback, useState } from 'react'
import type { ProjectInfo } from '@/lib/types'
import { logger } from '@/lib/logger'

export function useProject() {
  const [activeProject, setActiveProject] = useState<ProjectInfo>()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set())
  const [selectingProject, setSelectingProject] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)

  const loadProject = useCallback(async () => {
    try {
      const response = await fetch('/api/project')
      if (!response.ok) return
      const payload = await response.json()
      setActiveProject(payload.project)
      setProjects(Array.isArray(payload.projects) ? payload.projects : [])
      setExpandedProjectIds((current) => {
        const next = new Set(current)
        for (const project of Array.isArray(payload.projects) ? payload.projects : []) next.add(project.id)
        return next
      })
    } catch (error) {
      logger.error('Failed to load project:', error)
    }
  }, [])

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
    setExpandedProjectIds((current) => {
      const next = new Set(current)
      for (const project of Array.isArray(payload.projects) ? payload.projects : []) next.add(project.id)
      return next
    })
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
        setExpandedProjectIds((current) => {
          const next = new Set(current)
          for (const project of Array.isArray(payload.projects) ? payload.projects : []) next.add(project.id)
          return next
        })
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

  return {
    activeProject,
    projects,
    expandedProjectIds,
    selectingProject,
    projectPickerOpen,
    loadProject,
    switchActiveProject,
    handleSelectProjectPath,
    selectProjectDirectory,
    setProjectPickerOpen,
    toggleProjectExpanded,
    setActiveProject,
    setProjects,
    setExpandedProjectIds,
  }
}

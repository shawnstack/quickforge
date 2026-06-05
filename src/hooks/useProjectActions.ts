import { useCallback } from 'react'
import type { AgentManager } from '@/hooks/useAgentManager'
import type { ProjectInfo } from '@/lib/types'

type UseProjectActionsOptions = {
  activeProjectRef: React.MutableRefObject<ProjectInfo | undefined>
  refreshSessions: (opts?: { broadcast?: boolean }) => Promise<void>
  notifyProjectsChanged: () => void
  setActiveProject: React.Dispatch<React.SetStateAction<ProjectInfo | undefined>>
  setProjects: React.Dispatch<React.SetStateAction<ProjectInfo[]>>
  setExpandedProjectIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setChatPanelRevision: AgentManager['setChatPanelRevision']
}

export function useProjectActions({
  activeProjectRef,
  refreshSessions,
  notifyProjectsChanged,
  setActiveProject,
  setProjects,
  setExpandedProjectIds,
  setChatPanelRevision,
}: UseProjectActionsOptions) {
  const deleteProjectInline = useCallback(
    async (projectId: string) => {
      const response = await fetch(`/api/project/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Failed to delete project`)
      setActiveProject(payload.project)
      setProjects(payload.projects)
      setExpandedProjectIds((current) => {
        const next = new Set(current)
        next.delete(projectId)
        return next
      })
      await refreshSessions({ broadcast: true })
      notifyProjectsChanged()
      if (activeProjectRef.current?.id === projectId) {
        activeProjectRef.current = payload.project
        setChatPanelRevision((value) => value + 1)
      }
    },
    [
      activeProjectRef,
      refreshSessions,
      notifyProjectsChanged,
      setActiveProject,
      setProjects,
      setExpandedProjectIds,
      setChatPanelRevision,
    ],
  )

  return { deleteProjectInline }
}

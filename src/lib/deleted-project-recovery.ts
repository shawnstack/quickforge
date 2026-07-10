import type { ProjectInfo } from '@/lib/types'

export type DeletedProjectRecoveryDecision =
  | { type: 'none' }
  | { type: 'project'; deletedProjectId: string; project: ProjectInfo }
  | { type: 'global'; deletedProjectId: string }

export type DeletedProjectRecoveryInput = {
  ready: boolean
  currentToolProjectId?: string
  projects: readonly ProjectInfo[]
  activeProject?: ProjectInfo
  recoveringProjectId?: string
}

export function getDeletedProjectRecoveryDecision({
  ready,
  currentToolProjectId,
  projects,
  activeProject,
  recoveringProjectId,
}: DeletedProjectRecoveryInput): DeletedProjectRecoveryDecision {
  if (!ready || !currentToolProjectId || currentToolProjectId === 'default') {
    return { type: 'none' }
  }
  if (projects.some((project) => project.id === currentToolProjectId)) {
    return { type: 'none' }
  }
  if (recoveringProjectId === currentToolProjectId) {
    return { type: 'none' }
  }
  if (activeProject) {
    return { type: 'project', deletedProjectId: currentToolProjectId, project: activeProject }
  }
  return { type: 'global', deletedProjectId: currentToolProjectId }
}

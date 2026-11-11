import { isBotProject } from '@/lib/bot-project'
import type { ProjectInfo } from '@/lib/types'

type DeletedProjectRecoveryDecision =
  | { type: 'none' }
  | { type: 'project'; deletedProjectId: string; project: ProjectInfo }
  | { type: 'global'; deletedProjectId: string }

type DeletedProjectRecoveryInput = {
  ready: boolean
  /** 当前会话正在用的项目（可能不存在，比如还没开会话）。 */
  currentToolProject?: ProjectInfo
  /** 项目切换器里的列表——注意它刻意不含 bot 目录。 */
  projects: readonly ProjectInfo[]
  activeProject?: ProjectInfo
  recoveringProjectId?: string
}

export function getDeletedProjectRecoveryDecision({
  ready,
  currentToolProject,
  projects,
  activeProject,
  recoveringProjectId,
}: DeletedProjectRecoveryInput): DeletedProjectRecoveryDecision {
  // bot 的目录是注册项目，但前端项目列表按设计把 `kind === 'bot'` 过滤掉了
  // （它不该出现在项目切换器里）。所以「不在列表里」对 bot 是常态，不是被删除。
  // 不在这里挡住的话：每次点开 bot 都会被判成「当前项目已删除」，随即新建一条
  // 空会话顶掉 bot 的对话——表现就是「bot 的历史对话不见了」，早先还会把这条
  // 新会话建进 bot 目录（见 session-handoff 的「会话逃逸到 bot 项目桶」）。
  if (isBotProject(currentToolProject)) return { type: 'none' }

  if (!ready || !currentToolProject?.id || currentToolProject.id === 'default') {
    return { type: 'none' }
  }
  if (projects.some((project) => project.id === currentToolProject.id)) {
    return { type: 'none' }
  }
  if (recoveringProjectId === currentToolProject.id) {
    return { type: 'none' }
  }
  if (activeProject) {
    return { type: 'project', deletedProjectId: currentToolProject.id, project: activeProject }
  }
  return { type: 'global', deletedProjectId: currentToolProject.id }
}

import { useEffect } from 'react'
import { useRef } from 'react'
import type { RefObject } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { PendingTerminalCommand } from '@/components/terminal/terminal-api'
import type { WorkspaceInspectorOpenRequest } from '@/components/workspace/workspace-types'
import { getDeletedProjectRecoveryDecision } from '@/lib/deleted-project-recovery'
import { logger } from '@/lib/logger'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import type { ProjectInfo } from '@/lib/types'

export type CurrentSessionArtifactsState = {
  projectId?: string
  sessionId?: string
  artifacts: AiTurnArtifact[]
}

export type StartDeferredSessionOptions =
  | { scope: 'project'; project: ProjectInfo }
  | { scope: 'global' }

/** 「当前会话的项目已被删除」的恢复策略（原 MainApp 内联 effect）。
 *
 *  判据来自 `src/lib/deleted-project-recovery.ts`（纯函数）；这里负责执行：
 *  发现当前工具项目从列表里消失时，收起所有挂在该项目上的瞬态 UI
 *  （inspector 请求 / 产物预览 / 终端面板与待执行命令 / 会话产物状态 /
 *  文件打开请求序号），再按「有其它激活项目 → 该项目的空会话，否则全局
 *  空会话」新建对话兜底；新建失败时清掉恢复标记，等下一次判据触发重试。
 */
export function useDeletedProjectRecovery(context: {
  ready: boolean
  currentToolProject: ProjectInfo | undefined
  projects: readonly ProjectInfo[]
  activeProject: ProjectInfo | undefined
  startDeferredSession: (options: StartDeferredSessionOptions) => Promise<unknown>
  setCurrentSessionArtifactsState: Dispatch<SetStateAction<CurrentSessionArtifactsState>>
  setWorkspaceInspectorRequest: Dispatch<SetStateAction<WorkspaceInspectorOpenRequest | undefined>>
  setArtifactPreviewOpen: Dispatch<SetStateAction<boolean>>
  setPendingTerminalCommand: Dispatch<SetStateAction<PendingTerminalCommand | null>>
  setTerminalDockOpen: Dispatch<SetStateAction<boolean>>
  chatFileRequestIdRef: RefObject<number>
}) {
  const {
    ready,
    currentToolProject,
    projects,
    activeProject,
    startDeferredSession,
    setCurrentSessionArtifactsState,
    setWorkspaceInspectorRequest,
    setArtifactPreviewOpen,
    setPendingTerminalCommand,
    setTerminalDockOpen,
    chatFileRequestIdRef,
  } = context
  const recoveringDeletedToolProjectIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const recovery = getDeletedProjectRecoveryDecision({
      ready,
      currentToolProject,
      projects,
      activeProject,
      recoveringProjectId: recoveringDeletedToolProjectIdRef.current,
    })
    if (recovery.type === 'none') {
      const toolProjectId = currentToolProject?.id
      if (recoveringDeletedToolProjectIdRef.current && recoveringDeletedToolProjectIdRef.current !== toolProjectId) {
        recoveringDeletedToolProjectIdRef.current = undefined
      }
      return
    }
    recoveringDeletedToolProjectIdRef.current = recovery.deletedProjectId

    setCurrentSessionArtifactsState({ artifacts: [] })
    setWorkspaceInspectorRequest(undefined)
    setArtifactPreviewOpen(false)
    setPendingTerminalCommand(null)
    setTerminalDockOpen(false)
    chatFileRequestIdRef.current += 1

    void startDeferredSession(recovery.type === 'project'
      ? { scope: 'project', project: recovery.project }
      : { scope: 'global' })
      .catch((error) => {
        recoveringDeletedToolProjectIdRef.current = undefined
        logger.error('Failed to recover after the current project was deleted:', error)
      })
  }, [activeProject, chatFileRequestIdRef, currentToolProject, projects, ready, setArtifactPreviewOpen, setCurrentSessionArtifactsState, setPendingTerminalCommand, setTerminalDockOpen, setWorkspaceInspectorRequest, startDeferredSession])
}

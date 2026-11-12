import { useCallback, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { WorkspaceExternalOpenTarget } from '@/components/workspace/workspace-api'
import { openWorkspaceExternal } from '@/components/workspace/workspace-api'
import type { WorkspaceInspectorOpenRequest, WorkspaceInspectorOpenRequestInput, WorkspaceInspectorRuntimeScope } from '@/components/workspace/workspace-types'
import { artifactPreviewMode, documentFormatFromPath, findBestPreviewableArtifact, workspaceArtifactDiskPath } from '@/components/workspace/artifact-preview-utils'
import { t } from '@/lib/i18n'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import type { ProjectInfo } from '@/lib/types'
import { useUIStore } from '@/stores/ui-store'
import type { AddToast } from '@/hooks/useAgentSessionEvents'

/** 产物预览 / 打开的统一规则（原 MainApp 内联的回调组）。
 *
 *  - `openArtifactPreview`：产物列表与工具卡片预览的统一入口，按类型分流
 *    Reader / Document / Browser（iframe + 磁盘路径）；
 *  - `openLivePresentedArtifacts`：自动预览的唯一入口。`ChatPanelHost` 在
 *    `tool_execution_end` 时上报「本次工具执行刚刚产出的文件」，且只由当前
 *    活跃视图上报。这是事件而不是状态差分，因此历史补齐、缓存校准、SSE
 *    重连、回滚都不会误触发打开右侧面板；
 *  - 文件卡三动作：预览 / 审查（git 工作区 diff）/ 外部打开（explorer /
 *    vscode / idea，走服务端带安全校验的 open-external 路由）；
 *  - 工具卡片预览桥接（tool-renderers/shared.tsx 经 useUIStore 发起）与
 *    项目切换时的预览收起，也挂在这里。
 */
export function useArtifactPreviewActions(context: {
  currentToolProject: ProjectInfo | undefined
  currentSessionId: string | undefined
  addToast: AddToast
  requestWorkspaceInspector: (request: WorkspaceInspectorOpenRequestInput, scope?: WorkspaceInspectorRuntimeScope) => boolean
  setArtifactPreviewOpen: Dispatch<SetStateAction<boolean>>
  setWorkspaceInspectorRequest: Dispatch<SetStateAction<WorkspaceInspectorOpenRequest | undefined>>
}) {
  const {
    currentToolProject,
    currentSessionId,
    addToast,
    requestWorkspaceInspector,
    setArtifactPreviewOpen,
    setWorkspaceInspectorRequest,
  } = context

  const openArtifactPreview = useCallback((projectId: string, path: string, kind?: Parameters<typeof artifactPreviewMode>[1]) => {
    const project = currentToolProject
    const mode = artifactPreviewMode(path, kind)
    if (!project || project.id !== projectId || !mode) return
    setArtifactPreviewOpen(false)
    if (mode === 'reader') {
      requestWorkspaceInspector({ projectId, kind: 'reader', path })
      return
    }
    if (mode === 'document') {
      const format = documentFormatFromPath(path)
      if (format) requestWorkspaceInspector({ projectId, kind: 'document', path, format })
      return
    }
    requestWorkspaceInspector({
      projectId,
      kind: 'browser',
      url: workspaceArtifactDiskPath(project.path, path),
    })
  }, [currentToolProject, requestWorkspaceInspector, setArtifactPreviewOpen])

  // 助手回复文件卡片预览：复用产物预览统一入口，按类型分流 Reader/Document/Browser，
  // 与产物列表点开同一文件的行为完全同源。
  const openFilePreviewFromArtifactCard = useCallback((relativePath: string) => {
    const projectId = currentToolProject?.id
    if (!projectId) return
    openArtifactPreview(projectId, relativePath)
  }, [currentToolProject?.id, openArtifactPreview])

  // 助手回复文件卡片「审查」：打开工作区 Review 面板并直达该文件的 diff tab
  // （git 工作区 diff，与会话影子备份口径无关；文件卡上的 ±行数才是会话口径）。
  const reviewFileChangesFromArtifactCard = useCallback((relativePath: string) => {
    const projectId = currentToolProject?.id
    if (!projectId) return
    requestWorkspaceInspector({ projectId, kind: 'review', view: 'changes', path: relativePath })
  }, [currentToolProject?.id, requestWorkspaceInspector])

  // 助手回复文件卡片「打开 ▾」外部打开：走工作区 open-external 路由（服务端带
  // 工作区路径安全校验、仅限本机请求）。explorer 定位文件所在目录（默认），
  // vscode / idea 用对应编辑器打开文件；失败提示按目标区分。
  const revealFileFromArtifactCard = useCallback(async (relativePath: string, target: WorkspaceExternalOpenTarget = 'explorer') => {
    const projectId = currentToolProject?.id
    if (!projectId) return
    try {
      await openWorkspaceExternal(projectId, relativePath, target)
    } catch (error) {
      const failureKey = target === 'vscode' ? 'openInVSCodeFailed' : target === 'idea' ? 'openInIDEAFailed' : 'assistantArtifactRevealFailed'
      addToast({
        sessionId: currentSessionId ?? '',
        title: t(failureKey),
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [addToast, currentSessionId, currentToolProject?.id])

  const openLivePresentedArtifacts = useCallback((sessionId: string, artifacts: AiTurnArtifact[]) => {
    const project = currentToolProject
    const projectId = project?.id
    if (!projectId || !sessionId || sessionId !== currentSessionId) return
    const artifact = findBestPreviewableArtifact(artifacts)
    if (!artifact?.path) return
    const mode = artifactPreviewMode(artifact.path, artifact.kind)
    if (!mode) return
    setArtifactPreviewOpen(false)
    if (mode === 'reader') {
      // Markdown、代码、配置和文本走 Reader；Markdown 使用富文本预览，其余使用 Monaco 只读查看。
      requestWorkspaceInspector({ projectId, kind: 'reader', path: artifact.path })
      return
    }
    if (mode === 'document') {
      const format = documentFormatFromPath(artifact.path)
      if (format) requestWorkspaceInspector({ projectId, kind: 'document', path: artifact.path, format })
      return
    }
    // HTML 和支持的图片走 Browser iframe。
    requestWorkspaceInspector({
      projectId,
      kind: 'browser',
      url: workspaceArtifactDiskPath(project.path, artifact.path),
    })
  }, [currentSessionId, currentToolProject, requestWorkspaceInspector, setArtifactPreviewOpen])

  useEffect(() => {
    setArtifactPreviewOpen(false)
    setWorkspaceInspectorRequest(undefined)
  }, [currentToolProject?.id, setArtifactPreviewOpen, setWorkspaceInspectorRequest])

  // 监听工具卡片预览按钮的桥接请求（tool-renderers/shared.tsx 经 useUIStore 发起，
  // 原 window CustomEvent 桥已由 ui-store 的请求信号替代），转调 openArtifactPreview，
  // 复用与自动预览完全一致的逻辑。
  const artifactPreviewRequest = useUIStore((s) => s.artifactPreviewRequest)
  useEffect(() => {
    const request = artifactPreviewRequest
    if (!request) return
    if (openArtifactPreview) {
      const projectId = currentToolProject?.id
      if (projectId && typeof request.path === 'string') {
        openArtifactPreview(projectId, request.path, request.kind)
      }
    }
    useUIStore.getState().clearArtifactPreviewRequest()
  }, [artifactPreviewRequest, currentToolProject?.id, openArtifactPreview])

  return {
    openArtifactPreview,
    openFilePreviewFromArtifactCard,
    reviewFileChangesFromArtifactCard,
    revealFileFromArtifactCard,
    openLivePresentedArtifacts,
  }
}

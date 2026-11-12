import { useCallback } from 'react'
import type { RefObject } from 'react'
import { resolveWorkspacePath } from '@/components/workspace/workspace-api'
import { workspaceInspectorRuntimeScopeMatches } from '@/components/workspace/workspace-inspector-request'
import type { WorkspaceInspectorOpenRequestInput, WorkspaceInspectorRuntimeScope } from '@/components/workspace/workspace-types'
import { isCurrentProjectRequest } from '@/lib/project-request-guard'
import type { AddToast } from '@/hooks/useAgentSessionEvents'

/** 对话里的本地文件路径打开规则（原 MainApp 内联的 openLocalFilePathFromChat）。
 *
 *  聊天里点文件路径链接时按路径来源分流：
 *  - QuickForge 自己的临时文本附件（`<dataDir>/cache/global/tmp/conversations/`，
 *    工作区之外）走 `/open-text-attachment`，由服务端用系统默认程序打开；
 *  - 其余路径视为工作区相对路径：先经 `/resolve-path` 归一化，再打开 Reader tab。
 *  打开前后做「请求仍是当前项目 / 当前 inspector scope」双重守卫，跨会话、
 *  跨项目的迟到响应一律丢弃；失败给出带 sessionId 的错误 toast。
 */
export function useChatFileOpener(context: {
  currentSessionId: string | undefined
  currentToolProjectId: string | undefined
  addToast: AddToast
  requestWorkspaceInspector: (request: WorkspaceInspectorOpenRequestInput, scope?: WorkspaceInspectorRuntimeScope) => boolean
  workspaceInspectorScopeRef: RefObject<WorkspaceInspectorRuntimeScope>
  currentToolProjectIdRef: RefObject<string | undefined>
  chatFileRequestIdRef: RefObject<number>
}) {
  const { currentSessionId, currentToolProjectId, addToast, requestWorkspaceInspector, workspaceInspectorScopeRef, currentToolProjectIdRef, chatFileRequestIdRef } = context

  const openLocalFilePathFromChat = useCallback(async (filePath: string) => {
    const sessionId = currentSessionId ?? 'local'
    const normalizedPath = filePath.replace(/[\\\\/]+/g, '/').toLowerCase()
    const isQuickForgeTextAttachment = normalizedPath.includes('/cache/global/tmp/conversations/')
    if (isQuickForgeTextAttachment) {
      try {
        const response = await fetch(`/api/agents/${encodeURIComponent(sessionId)}/open-text-attachment`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: filePath }),
        })
        if (response.ok) return
        const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : '打开临时附件失败'
        addToast({ sessionId: currentSessionId ?? '', title: '无法打开文件', status: 'error', message })
        return
      }
    }
    const projectId = currentToolProjectId
    const requestScope = workspaceInspectorScopeRef.current
    if (!projectId) {
      addToast({ sessionId: currentSessionId ?? '', title: '无法打开文件', status: 'error', message: '当前对话没有关联项目。' })
      return
    }
    const requestId = chatFileRequestIdRef.current + 1
    chatFileRequestIdRef.current = requestId

    try {
      const resolved = await resolveWorkspacePath(projectId, filePath)
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, chatFileRequestIdRef.current)) return
      if (!workspaceInspectorRuntimeScopeMatches(requestScope, workspaceInspectorScopeRef.current)) return
      requestWorkspaceInspector({ projectId, kind: 'reader', path: resolved.relativePath }, requestScope)
    } catch (error) {
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, chatFileRequestIdRef.current)) return
      if (!workspaceInspectorRuntimeScopeMatches(requestScope, workspaceInspectorScopeRef.current)) return
      const message = error instanceof Error ? error.message : '打开文件失败'
      addToast({ sessionId: currentSessionId ?? '', title: '无法打开文件', status: 'error', message })
    }
  }, [addToast, chatFileRequestIdRef, currentSessionId, currentToolProjectId, currentToolProjectIdRef, requestWorkspaceInspector, workspaceInspectorScopeRef])

  return { openLocalFilePathFromChat }
}

import { useCallback, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { WorkspaceInspectorOpenRequestInput, WorkspaceInspectorRuntimeScope } from '@/components/workspace/workspace-types'
import { OPEN_BACKGROUND_TASKS_EVENT, normalizeOpenBackgroundTasksRequest } from '@/lib/background-tasks-open'
import type { GoalState } from '@/lib/goal'
import { OPEN_GOAL_SUMMARY_EVENT } from '@/lib/goal-ui'
import { subscribeToAgentEvents } from '@/lib/server-agent'
import {
  OPEN_SUBAGENT_RUN_EVENT,
  normalizeOpenSubagentRunRequest,
  type SubagentRunPayload,
} from '@/lib/subagent-run-detail'
import { OPEN_WORKFLOW_RUN_EVENT, normalizeOpenWorkflowRunRequest, workflowRunStore, type WorkflowRunPayload } from '@/lib/workflow-run-payload'

/** Inspector 子树之外到 Workspace Inspector 的「意图桥」（原 MainApp 内联 effects）。
 *
 *  入口分散在 Inspector 子树之外（工具卡片、Composer 命令图标、置顶摘要、
 *  goal 控制条、subagent / workflow 摘要卡），它们拿不到 requestWorkspaceInspector，
 *  统一用 window 事件把「打开某个 tab」的意图交到这里；另外监听 agent 事件里的
 *  desktop-browser 工具启动，自动把右侧面板切到内嵌浏览器标签。
 */
export function useAppEventBridges(context: {
  currentSessionId: string | undefined
  currentToolProjectId: string | undefined
  pinnedSummaryGoal: GoalState | null
  pinnedSummaryGoalSessionId: string
  requestWorkspaceInspector: (request: WorkspaceInspectorOpenRequestInput, scope?: WorkspaceInspectorRuntimeScope) => boolean
  setArtifactPreviewOpen: Dispatch<SetStateAction<boolean>>
}) {
  const {
    currentSessionId,
    currentToolProjectId,
    pinnedSummaryGoal,
    pinnedSummaryGoalSessionId,
    requestWorkspaceInspector,
    setArtifactPreviewOpen,
  } = context

  // 内嵌 AI 浏览器：Agent 一旦开始驱动桌面浏览器，就把右侧面板切到浏览器标签，
  // 让用户始终看得见它在点什么。非桌面端不会收到这类工具事件，这段对 Web 端无感。
  const requestAgentBrowserPanel = useCallback(() => {
    setArtifactPreviewOpen(false)
    requestWorkspaceInspector({ projectId: currentToolProjectId, kind: 'agent-browser' })
  }, [currentToolProjectId, requestWorkspaceInspector, setArtifactPreviewOpen])

  useEffect(() => subscribeToAgentEvents((event) => {
    if (event?.type !== 'tool_execution_start') return
    const toolName = typeof event.toolName === 'string' ? event.toolName : ''
    if (!toolName.startsWith('mcp__desktop-browser__')) return
    if (event.sessionId !== currentSessionId) return
    requestAgentBrowserPanel()
  }), [currentSessionId, requestAgentBrowserPanel])

  // 「查看完整日志」桥接（tool-renderers/shared.tsx 的 VIEW_COMMAND_LOG_EVENT）：
  // 命令日志在 <dataDir>/logs/commands 下（工作区外），走 command-log reader tab。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown; path?: unknown; label?: unknown }>).detail
      // 与 Inspector 的兜底保持一致：后台任务面板在没有关联项目时也可用，
      // 此时 currentToolProject 为空，仍需把 command-log 打开到 global-workspace。
      const projectId = currentToolProjectId ?? 'global-workspace'
      const logSessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : ''
      const logPath = typeof detail?.path === 'string' ? detail.path : ''
      if (!logSessionId || !logPath) return
      requestWorkspaceInspector({
        projectId,
        kind: 'command-log',
        sessionId: logSessionId,
        path: logPath,
        label: typeof detail?.label === 'string' && detail.label ? detail.label : undefined,
      })
    }
    window.addEventListener('quickforge:view-command-log', handler as EventListener)
    return () => window.removeEventListener('quickforge:view-command-log', handler as EventListener)
  }, [currentToolProjectId, requestWorkspaceInspector])

  // 「打开后台任务面板」桥接（src/lib/background-tasks-open.ts）：
  // 入口分散在 Inspector 子树之外（Composer 命令图标、置顶摘要），它们拿不到
  // requestWorkspaceInspector，因此统一用窗口事件把意图交到这里。
  // requestWorkspaceInspector 内部已登记打开 scope，不需要再调 onOpenChange。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      const request = normalizeOpenBackgroundTasksRequest(detail)
      // 跨会话残留事件不应把面板切走：只接受当前会话或缺省。
      if (request.sessionId && request.sessionId !== currentSessionId) return
      requestWorkspaceInspector({ projectId: currentToolProjectId ?? 'global-workspace', kind: 'background-tasks' })
    }
    window.addEventListener(OPEN_BACKGROUND_TASKS_EVENT, handler as EventListener)
    return () => window.removeEventListener(OPEN_BACKGROUND_TASKS_EVENT, handler as EventListener)
  }, [currentSessionId, currentToolProjectId, requestWorkspaceInspector])

  // 其它 Goal surface（控制条/卡片）请求打开摘要：只认当前会话 + 当前 Goal，
  // 打开前复用现有收起 Inspector 入口解除 suspension，不新增全局模式。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown; goalId?: unknown; view?: unknown }>).detail
      const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : ''
      const goalId = typeof detail?.goalId === 'string' ? detail.goalId : ''
      if (!sessionId || !goalId) return
      if (!pinnedSummaryGoalSessionId || sessionId !== pinnedSummaryGoalSessionId) return
      if (!pinnedSummaryGoal || pinnedSummaryGoal.id !== goalId) return
      requestWorkspaceInspector({ projectId: currentToolProjectId ?? 'global-workspace', kind: 'goal', sessionId, goalId, view: detail.view === 'edit' ? 'edit' : 'progress' })
    }
    window.addEventListener(OPEN_GOAL_SUMMARY_EVENT, handler as EventListener)
    return () => window.removeEventListener(OPEN_GOAL_SUMMARY_EVENT, handler as EventListener)
  }, [currentToolProjectId, pinnedSummaryGoal, pinnedSummaryGoalSessionId, requestWorkspaceInspector])

  const openSubagentRun = useCallback((payload: SubagentRunPayload) => {
    setArtifactPreviewOpen(false)
    requestWorkspaceInspector({ projectId: currentToolProjectId, kind: 'subagent', payload })
  }, [currentToolProjectId, requestWorkspaceInspector, setArtifactPreviewOpen])

  const openWorkflowRun = useCallback((payload: WorkflowRunPayload) => {
    setArtifactPreviewOpen(false)
    requestWorkspaceInspector({ projectId: currentToolProjectId, kind: 'workflow', payload })
  }, [currentToolProjectId, requestWorkspaceInspector, setArtifactPreviewOpen])

  // 点击 subagent 摘要时，在 Workspace Inspector 中打开或激活该次运行的独立 Tab。
  useEffect(() => {
    const handler = (event: Event) => {
      const request = normalizeOpenSubagentRunRequest((event as CustomEvent).detail)
      if (!request?.payload) return
      openSubagentRun(request.payload)
    }
    window.addEventListener(OPEN_SUBAGENT_RUN_EVENT, handler as EventListener)
    return () => window.removeEventListener(OPEN_SUBAGENT_RUN_EVENT, handler as EventListener)
  }, [openSubagentRun])

  // 点击工作流摘要卡时，在 Workspace Inspector 中打开或激活该次运行详情 Tab。
  useEffect(() => {
    const handler = (event: Event) => {
      const request = normalizeOpenWorkflowRunRequest((event as CustomEvent).detail)
      if (!request) return
      const payload = request.payload ?? workflowRunStore.get(request.runId)
      if (!payload) return
      openWorkflowRun(payload)
    }
    window.addEventListener(OPEN_WORKFLOW_RUN_EVENT, handler as EventListener)
    return () => window.removeEventListener(OPEN_WORKFLOW_RUN_EVENT, handler as EventListener)
  }, [openWorkflowRun])

  return { openSubagentRun, openWorkflowRun }
}

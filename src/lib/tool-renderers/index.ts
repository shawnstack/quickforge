/**
 * QuickForge 工具渲染器（React）——src/lib/local-tools.ts 注册入口使用的实现集。
 *
 * T4（self-hosted-chat-ui）将原 html`` 模板渲染器迁为 React：
 * 各渲染器 render(params, result, isStreaming) 仍返回 { content, isCustom }，
 * content 由 html`` TemplateResult 改为 ReactNode，由 React ChatSurface 的
 * ToolMessage 直接渲染。class 链与 DOM 结构逐字复刻原模板。
 */
export {
  LocalWorkspaceToolRenderer,
} from './local-workspace-tool-renderer'
export {
  SubagentToolRenderer,
  renderSubagentRunSummary,
} from './subagent-tool-renderer'
export { GenerateImageToolRenderer } from './generate-image-tool-renderer'
export { AskUserToolRenderer, askUserReviewRowsFromDetails } from './ask-user-tool-renderer'
export type { AskUserReviewRows } from './ask-user-tool-renderer'
export { GoalReportToolRenderer } from './goal-report-tool-renderer'
export { TodoWriteToolRenderer } from './todo-write-tool-renderer'
export { McpToolRenderer, parseMcpToolName } from './mcp-tool-renderer'
export { elapsedMsFromTiming, formatDuration } from './shared'
export type { ToolResultLike, ToolStatusKey } from './shared'

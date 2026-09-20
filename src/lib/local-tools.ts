import { registerToolRenderer } from '@/lib/tool-renderer-registry'
import type { AppTextKey } from '@/lib/i18n'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  LocalWorkspaceToolRenderer,
  SubagentToolRenderer,
  GenerateImageToolRenderer,
  AskUserToolRenderer,
  GoalReportToolRenderer,
  TodoWriteToolRenderer,
  McpToolRenderer,
  parseMcpToolName,
} from '@/lib/tool-renderers'

/**
 * QuickForge React 工具渲染器注册入口与服务端工具元数据透传。
 * 定义与执行仅在服务端；聊天、side chat 和 subagent 详情共用本地 registry。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

// MCP 渲染器先到先得：getLocalWorkspaceTools 随每次状态同步重复调用，Set
// 去重避免重建渲染器实例；已注册工具的 label 不随后续元数据刷新（有意与
// registerToolRenderer 的“同名覆盖”语义不同），页面刷新后才会取新 label。
const registeredMcpToolRenderers = new Set<string>()

function registerMcpToolRenderers(tools: unknown[]) {
  for (const tool of tools) {
    if (!isRecord(tool) || typeof tool.name !== 'string') continue
    if (!parseMcpToolName(tool.name) || registeredMcpToolRenderers.has(tool.name)) continue
    const label = typeof tool.label === 'string'
      ? tool.label
      : typeof tool.description === 'string'
        ? tool.description.replace(/^\[MCP:[^\]]+\]\s*/, '')
        : undefined
    registerToolRenderer(tool.name, new McpToolRenderer(tool.name, label))
    registeredMcpToolRenderers.add(tool.name)
  }
}

// Register renderers at import time
for (const [name, label] of [
  ['manage_global_memory', 'manageGlobalMemory'],
  ['read_file', 'readFile'],
  ['grep_files', 'searchFiles'],
  ['write_file', 'writeFile'],
  ['edit_file', 'editFile'],
  ['run_command', 'runCommand'],
  ['present_files', 'presentFiles'],
  ['activate_skill', 'activateSkill'],
  ['read_skill_resource', 'readSkillResource'],
] as Array<[string, AppTextKey]>) {
  registerToolRenderer(name, new LocalWorkspaceToolRenderer(name, label))
}

registerToolRenderer('run_subagent', new SubagentToolRenderer())
registerToolRenderer('generate_image', new GenerateImageToolRenderer())
const todoWriteToolRenderer = new TodoWriteToolRenderer()
registerToolRenderer('todo_write', todoWriteToolRenderer)
registerToolRenderer('ask_user', new AskUserToolRenderer())
registerToolRenderer('goal_report', new GoalReportToolRenderer())

// Tool execution is entirely server-side. The chat surface never calls
// .execute() on client-side tools — it only reads state.tools for display
// purposes. Returning tool metadata is enough for the renderer to resolve
// names/labels.
export function getLocalWorkspaceTools(tools: unknown[] = []): AgentTool[] {
  registerMcpToolRenderers(tools)
  return tools as AgentTool[]
}

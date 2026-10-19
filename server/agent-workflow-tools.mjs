// run_workflow 的 tool() 执行入口。
//
// Workflow 脚本不仅能把任务委派给 Agent，也可以直接调用当前会话可见的工作区
// 工具（读/搜/写/编辑/命令/文件展示/Skill/MCP/Plugin）。这里复用主 Agent 的
// 工具定义与包装（createServerTools），因此参数校验、命令权限、workspace 沙箱、
// 写入归因与 MCP/Plugin 执行都与会话内直接调用一致；审批由本模块按会话权限
// 显式发起（createApprovalPromise），与主 Agent 的 beforeToolCall 同语义。
//
// 不支持的工具：run_subagent / run_workflow（递归）、ask_user（会阻塞脚本）、
// todo_write / manage_global_memory / goal_report（控制面状态，不属于工作流步骤）。

import { createServerTools, currentSessionTurnId } from './agent-manager.mjs'
import { sessionSkillsContext } from './tool-wiring.mjs'
import { createApprovalPromise } from './agent-approval-orchestrator.mjs'
import { commandToolPermissionError, createCommandToolPermissions, safeReadTools } from './approval-store.mjs'
import { hasFullAccess } from './agent-access-mode.mjs'

const WORKFLOW_EXCLUDED_TOOLS = new Set([
  'run_subagent',
  'run_workflow',
  'ask_user',
  'todo_write',
  'manage_global_memory',
  'goal_report',
])

// Skill loading is read-only instruction loading, auto-approved in the main
// agent loop as well.
const AUTO_APPROVED_TOOLS = new Set(['activate_skill', 'read_skill_resource'])

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function toolError(message) {
  const error = new Error(message)
  error.errorCode = 'WORKFLOW_TOOL_FAILED'
  return error
}

export async function createWorkflowToolset(parentSession) {
  const tools = await createServerTools(
    parentSession.projectId,
    parentSession.projectContext,
    sessionSkillsContext(parentSession),
    true,
    createCommandToolPermissions(parentSession),
    {
      includeSubagentTool: false,
      includeWorkflowTool: false,
      includeGoalTool: false,
      parentSessionId: parentSession.sessionId,
      sessionId: parentSession.sessionId,
      scope: parentSession.scope,
      // Tool calls inside a workflow are part of the parent turn and must stay
      // rollback-addressable exactly like writes made by a subagent.
      getTurnId: () => currentSessionTurnId(parentSession.sessionId),
    },
  )
  const toolset = new Map()
  for (const tool of tools) {
    if (!tool?.name || WORKFLOW_EXCLUDED_TOOLS.has(tool.name)) continue
    toolset.set(tool.name, tool)
  }
  return toolset
}

/**
 * Execute one tool() call with the parent session's approval policy.
 *
 * `request` shape: { name, args, label, phase, workflowLabel }.
 * Returns { content, details } on success; throws on unknown/blocked tools.
 */
export async function runWorkflowTool(parentSession, toolset, toolCallId, request, signal, onUpdate) {
  const name = typeof request?.name === 'string' ? request.name.trim() : ''
  if (!name) throw toolError('tool(name, args) requires a non-empty tool name')
  if (WORKFLOW_EXCLUDED_TOOLS.has(name)) throw toolError(`Tool ${name} is not available inside a workflow.`)
  const tool = toolset?.get?.(name)
  if (!tool) throw toolError(`Tool ${name} is not available in this session's tool set.`)

  const args = request?.args === undefined || request?.args === null ? {} : request.args
  if (!isPlainObject(args)) throw toolError(`Tool ${name} arguments must be a plain object.`)
  if (name === 'run_command' && args.run_in_background === true) {
    throw toolError('run_command with run_in_background is not supported inside run_workflow; run it as a foreground command or use run_subagent.')
  }
  const commandError = commandToolPermissionError(parentSession, name)
  if (commandError) throw toolError(commandError)
  if (signal?.aborted) throw toolError('Workflow aborted before the tool call started.')

  if (!hasFullAccess(parentSession) && !safeReadTools.has(name) && !AUTO_APPROVED_TOOLS.has(name)) {
    const decision = await createApprovalPromise(parentSession, toolCallId, name, args, {
      type: 'workflow-tool',
      label: typeof request?.label === 'string' && request.label.trim() ? request.label.trim() : name,
      workflowLabel: request?.workflowLabel,
      sessionId: parentSession.sessionId,
    }, { signal })
    if (decision?.block) throw toolError(decision.reason || `User rejected ${name}`)
  }

  const result = await tool.execute(toolCallId, args, signal, onUpdate)
  const content = Array.isArray(result?.content)
    ? result.content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
    : ''
  if (result?.isError === true) throw toolError(content || `${name} failed`)
  return { content, details: result?.details }
}

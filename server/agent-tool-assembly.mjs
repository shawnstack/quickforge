// agent-manager 模块拆分（god-module-decomposition ⑤）工具装配：
// createServerTools、toolContext/turnId 装配、workspace 工具包装
// （run_subagent / run_workflow / ask_user）与 goal 工具挂载、
// rebuildSessionTools 从 agent-manager.mjs 逐字搬移至此。
// createServerTools / attachTurnIdGetter 仍由 agent-manager.mjs facade
// re-export（契约测试 INTERNAL_SHARED_EXPORTS 锁定），行为与注释语义不变。

import {
  agentSessions,
  stashSubagentErrorDetails,
} from './agent-session-store.mjs'
import { runSubagent } from './agent-subagent-runner.mjs'
import { runWorkflow } from './agent-workflow-runner.mjs'
import { createAskUserPromise } from './agent-approval-orchestrator.mjs'
import { loadSkillToolContext } from './tools/index.mjs'
import { createSkillTools, globalMemoryTool, memoryNoteTools, workspaceTools } from './tools/definitions.mjs'
import { createMcpToolDefinitions } from './mcp/registry.mjs'
import { createPluginToolDefinitions } from './plugins/registry.mjs'
import { mergeSkills } from './skills.mjs'
import { isGlobalMemoryEnabled } from './global-memory.mjs'
import { isWorkingMemoryEnabled } from './working-memory.mjs'
import { wrapToolDefinition, wrapMcpToolDefinition, wrapPluginToolDefinition, sessionSkillsContext } from './tool-wiring.mjs'
import { createCommandToolPermissions } from './approval-store.mjs'
import { createGoalControlTools, createGoalReportTool, activeGoalStatus } from './goal/engine.mjs'
import { currentSessionTurnId } from './agent-turn-ids.mjs'
import { deliverBackgroundCommandNotification } from './agent-background-commands.mjs'

// ---------------------------------------------------------------------------
// Tool definitions (server-side, no REST roundtrip)
// ---------------------------------------------------------------------------

function wrapSubagentToolDefinition(definition, parentSessionId) {
  return {
    ...definition,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const parentSession = agentSessions.get(parentSessionId)
      if (!parentSession) throw new Error('Parent session is no longer active.')
      try {
        const result = await runSubagent(parentSession, toolCallId, params || {}, signal, onUpdate)
        return {
          content: [{ type: 'text', text: result.content }],
          details: result.details,
        }
      } catch (error) {
        // 超时等错误附带的 quickforgeSubagentDetails 由 afterToolCall 取回注入
        // toolResult（pi-agent-core 对抛错 execute 只保留错误文本）。
        if (error && typeof error === 'object' && error.quickforgeSubagentDetails) {
          stashSubagentErrorDetails(toolCallId, error.quickforgeSubagentDetails)
        }
        throw error
      }
    },
  }
}

export function workflowApprovalArgs(args) {
  const record = args && typeof args === 'object' ? args : {}
  const script = typeof record.script === 'string' ? record.script : ''
  // The runner caps scripts at 20 KB, so the approval card can show the exact
  // code that will execute instead of a truncated preview.
  return {
    script,
    ...(record.args !== undefined ? { args: record.args } : {}),
    ...(record.options !== undefined ? { options: record.options } : {}),
  }
}

function wrapWorkflowToolDefinition(definition, parentSessionId) {
  return {
    ...definition,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const parentSession = agentSessions.get(parentSessionId)
      if (!parentSession) throw new Error('Parent session is no longer active.')
      try {
        const result = await runWorkflow(parentSession, toolCallId, params || {}, signal, onUpdate)
        return {
          content: [{ type: 'text', text: result.content }],
          details: result.details,
        }
      } catch (error) {
        // Failed workflows carry their partial phases/agents/logs; pi-agent-core
        // only keeps the error text, so stash the details for afterToolCall.
        if (error && typeof error === 'object' && error.quickforgeWorkflowDetails) {
          stashSubagentErrorDetails(toolCallId, error.quickforgeWorkflowDetails)
        }
        throw error
      }
    },
  }
}

function wrapAskUserToolDefinition(definition, parentSessionId) {
  return {
    ...definition,
    execute: async (toolCallId, params) => {
      const session = agentSessions.get(parentSessionId)
      if (!session) {
        return {
          content: [{ type: 'text', text: 'No active session for ask_user.' }],
          details: { askId: null, skipped: true },
        }
      }
      return createAskUserPromise(session, toolCallId, params || {})
    },
  }
}

function wrapWorkspaceToolDefinition(definition, context, toolPermissions, options = {}) {
  if (definition.name === 'run_subagent') return wrapSubagentToolDefinition(definition, options.parentSessionId)
  if (definition.name === 'run_workflow') return wrapWorkflowToolDefinition(definition, options.parentSessionId)
  if (definition.name === 'ask_user') return wrapAskUserToolDefinition(definition, options.parentSessionId)
  return wrapToolDefinition(definition, context, toolPermissions)
}

// 内部共享导出：给 toolContext 装「活」的 turnId 访问器，供测试做行为断言。
// 注意不能用对象展开 `...{ get turnId() {...} }`——展开会立即求值 getter
// 并把结果固化成普通属性，使每会话构建一次的 toolContext 永久停在构建时的
// turnId（主 Agent 路径恒为 null，轮级撤销因此不可见）。
export function attachTurnIdGetter(context, getTurnId) {
  if (!getTurnId) return context
  Object.defineProperty(context, 'turnId', {
    get: () => getTurnId() || null,
    enumerable: true,
    configurable: true,
  })
  return context
}

// 内部共享导出（模块拆分临时暴露给 agent-subagent-runner，工具构建块迁移后收回）
export async function createServerTools(projectId, projectContext, skillsContext, includeWorkspaceTools, toolPermissions, options = {}) {
  const {
    allowedToolNames = null,
    includeSubagentTool = true,
    includeWorkflowTool = true,
    includeMcpTools = true,
    includePluginTools = true,
    includeSkillTools = true,
    mcpWaitForConnections = true,
    parentSessionId = null,
    sessionId = null,
    scope = 'global',
    getTurnId = null,
  } = options
  const allowedTools = allowedToolNames ? new Set(allowedToolNames) : null
  const isAllowed = (definition) => !allowedTools || allowedTools.has(definition.name)

  // Load the active skills once and reuse the result for both the tool
  // definitions and the tool context. These used to be two independent scans of
  // the same skill directories on every agent creation: identical inputs,
  // identical output, doubled IO.
  const skillToolContext = await loadSkillToolContext({
    globalSkillNames: skillsContext.globalSkillNames,
    projectSkillNames: skillsContext.projectSkillNames,
    workspaceRoot: projectContext?.workspaceRoot,
  })
  const skillTools = includeSkillTools
    ? await createSkillTools({
        globalSkillNames: skillsContext.globalSkillNames,
        projectSkillNames: skillsContext.projectSkillNames,
        workspaceRoot: projectContext?.workspaceRoot,
        resolvedSkills: mergeSkills(skillToolContext.globalSkills, skillToolContext.projectSkills),
      })
    : []
  const toolContext = {
    ...projectContext,
    ...skillToolContext,
    ...(sessionId ? { sessionId, scope, projectId } : {}),
    onBackgroundCommandExit: (notification) => {
      const session = agentSessions.get(notification?.sessionId || sessionId)
      if (!session || notification?.sessionId !== session.sessionId) return
      deliverBackgroundCommandNotification(session, notification)
    },
  }
  // Live view of the session's current turn: the context object is built
  // once per session, while the turn changes on every runPrompt run.
  attachTurnIdGetter(toolContext, getTurnId)
  const tools = skillTools
    .filter(isAllowed)
    .map((definition) => wrapToolDefinition(definition, toolContext, toolPermissions))

  if (!allowedTools && await isGlobalMemoryEnabled()) {
    tools.push(wrapToolDefinition(globalMemoryTool, toolContext, toolPermissions))
  }

  // Memory notes are global: the two folders live outside every project, so they
  // are added whether or not a workspace is bound. The tools are the only way in
  // — they are locked to those folders and have no delete, which is why they can
  // be handed to an unattended agent without an approval prompt.
  //
  // 关闭工作记忆时读写一起不注册：设置页显示「已关闭」而 agent 还能往磁盘写
  // 笔记是最糟的组合。读也不给——读一个被关掉的目录没有意义，而且和「看不到
  // 索引却拿得到读工具」的半开状态保持一致更简单。
  if (await isWorkingMemoryEnabled()) {
    for (const definition of memoryNoteTools) {
      if (isAllowed(definition)) tools.push(wrapToolDefinition(definition, toolContext, toolPermissions))
    }
  }

  if (includeWorkspaceTools && projectContext) {
    const definitions = workspaceTools.filter((definition) => (
      (includeSubagentTool || definition.name !== 'run_subagent')
      && (includeWorkflowTool || definition.name !== 'run_workflow')
    ))
    tools.push(...definitions
      .filter(isAllowed)
      .map((definition) => wrapWorkspaceToolDefinition(definition, toolContext, toolPermissions, { parentSessionId })))
  }

  if (includeMcpTools) {
    const mcpTools = await createMcpToolDefinitions({ waitForConnections: mcpWaitForConnections })
    tools.push(...mcpTools.filter(isAllowed).map((definition) => wrapMcpToolDefinition(definition, toolPermissions)))
  }

  if (includePluginTools) {
    const pluginTools = await createPluginToolDefinitions(projectContext)
    tools.push(...pluginTools.filter(isAllowed).map((definition) => wrapPluginToolDefinition(definition, toolContext, toolPermissions)))
  }

  return tools
}

/**
 * Mount the goal tools that belong to this session's engine.
 *
 * Always runs against a registered session: the engine is decided from the live
 * goal, so a not-yet-registered resolver used to fall back to `legacy` and leak
 * the v1 `goal_report` tool into restored v2 sessions (where every `goal_report`
 * action is rejected, which made the model's completion report disappear while
 * the round driver kept scheduling rounds).
 */
export function appendGoalTools(session) {
  if (!session || (session.source && session.source !== 'scheduled')) return
  const tools = session.agent?.state?.tools
  if (!Array.isArray(tools)) return
  const names = new Set(tools.map((tool) => tool?.name).filter(Boolean))
  // Legacy (v1) reporting is only meaningful while the goal is still running;
  // `createGoalReportTool` returns null for v2 sessions.
  const reportTool = activeGoalStatus(session) ? createGoalReportTool(session) : null
  if (reportTool && !names.has(reportTool.name)) {
    tools.push(reportTool)
    names.add(reportTool.name)
  }
  // v2 control tools stay mounted for any v2 goal phase (create_goal is how the
  // user replaces a completed goal).
  if (!(session.goalEngine === 'v2' || session.goal?.phase)) return
  for (const tool of createGoalControlTools(session)) {
    if (!names.has(tool.name)) {
      tools.push(tool)
      names.add(tool.name)
    }
  }
}

export async function rebuildSessionTools(session) {
  const profileToolNames = Array.isArray(session.agentProfile?.allowedTools) ? session.agentProfile.allowedTools : null
  session.agent.state.tools = await createServerTools(
    session.projectId,
    session.projectContext,
    sessionSkillsContext(session),
    !!session.projectContext,
    createCommandToolPermissions(session),
    session.agentProfile
      ? {
          allowedToolNames: profileToolNames,
          includeSubagentTool: false,
          includeWorkflowTool: false,
          includeMcpTools: false,
          parentSessionId: session.sessionId,
          sessionId: session.sessionId,
          scope: session.scope,
          getTurnId: () => currentSessionTurnId(session.sessionId),
        }
      : {
          parentSessionId: session.sessionId,
          sessionId: session.sessionId,
          scope: session.scope,
          getTurnId: () => currentSessionTurnId(session.sessionId),
        },
  )
  appendGoalTools(session)
}

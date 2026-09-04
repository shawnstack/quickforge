// agent-manager 模块拆分（agent-manager-module-split）：run_subagent 生命周期
// （临时 subagent profile、超时/中止摘要、错误 details、trace 截尾）从
// agent-manager.mjs 逐字符搬移至此；行为与注释语义保持不变。
// createServerTools 仍由 agent-manager.mjs 提供（内部共享导出）。

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Agent } from '@earendil-works/pi-agent-core'
import { streamSimpleWithAiHttpLogging } from './ai-http-logger.mjs'
import { composeSubagentSystemPrompt, formatSubagentTask } from './subagents.mjs'
import { isMcpToolName } from './mcp/registry.mjs'
import { getAgentProfile } from './agent-profiles.mjs'
import { agentProfileFromMarkdown } from './agent-profile-files.mjs'
import {
  applyCapabilityPolicy,
  inferCapabilityPolicy,
  normalizeCapabilityPolicy,
  normalizeModelReference,
  resolveAgentProfileModel,
  resolveAgentProfileThinkingLevel,
  validateAgentProfileTools,
  validateModelReference,
} from './agent-profile-schema.mjs'
import { ensureStorage, readStore, tempAgentsDir } from './storage.mjs'
import { logger } from './utils/logger.mjs'
import { lastAssistantText, serverConvertToLlm } from './message-converters.mjs'
import { restoreReasoningContentInPayload } from './reasoning-cache.mjs'
import { sessionSkillsContext } from './tool-wiring.mjs'
import { safeReadTools, commandToolPermissionError } from './approval-store.mjs'
import { hasFullAccess } from './agent-harness.mjs'
import { createApprovalPromise } from './agent-approval-orchestrator.mjs'
import { emitSessionEvent } from './agent-session-events.mjs'
import { createServerTools } from './agent-manager.mjs'

const SUBAGENT_DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 hours
const SUBAGENT_MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000
const SUBAGENT_TRACE_THROTTLE_MS = 150
// 运行期 trace update 的 details.messages 只携带最近 N 条消息（截尾），
// 并附 messagesTotal 总条数；终态 toolResult.details.messages 保持全量。
const SUBAGENT_TRACE_MESSAGES_LIMIT = 50
// 超时错误正文中最后一条 assistant 文本的截断长度（半角字符）。
const SUBAGENT_TIMEOUT_LAST_MESSAGE_LIMIT = 600

const tempSubagentNameRegex = /^[a-z][a-z0-9_-]{1,39}$/

function frontmatterString(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '\\"')
}

function normalizeTemporarySubagentSpec(input) {
  const spec = input && typeof input === 'object' && !Array.isArray(input) ? input : null
  if (!spec || spec.type !== 'temporary') return null
  const name = String(spec.name || '').trim().toLowerCase()
  if (!tempSubagentNameRegex.test(name)) {
    const error = new Error('Temporary subagent name must start with a letter and contain only lowercase letters, numbers, underscores, or hyphens')
    error.statusCode = 400
    throw error
  }
  const instructions = String(spec.instructions || '').trim()
  if (!instructions) {
    const error = new Error('Temporary subagent instructions are required')
    error.statusCode = 400
    throw error
  }
  const requestedTools = Array.isArray(spec.tools)
    ? [...new Set(spec.tools.map((toolName) => String(toolName || '').trim()).filter(Boolean))]
    : ['read_file', 'grep_files', 'run_command']
  const capabilityPolicy = normalizeCapabilityPolicy(spec.capabilityPolicy || 'readonly-research', requestedTools)
  validateAgentProfileTools(requestedTools, capabilityPolicy)
  const allowedTools = applyCapabilityPolicy(requestedTools, capabilityPolicy)
  const model = validateModelReference(normalizeModelReference(spec.model))
  return {
    name,
    label: String(spec.label || spec.description || name).trim().slice(0, 80) || name,
    description: String(spec.description || '').trim().slice(0, 500),
    systemPrompt: instructions,
    allowedTools,
    capabilityPolicy,
    model,
    maxRuntimeMs: spec.maxRuntimeMs,
    maxToolCalls: spec.maxToolCalls,
    allowMcpTools: spec.allowMcpTools === true,
    allowAgentSkills: spec.allowAgentSkills === true,
  }
}

function safeTempPathSegment(value, fallback) {
  const text = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  return text || fallback
}

function temporarySubagentMarkdown(spec, parentSession, runId, expiresAt) {
  return `---
name: ${spec.name}
label: "${frontmatterString(spec.label)}"
description: "${frontmatterString(spec.description)}"
source: temporary
lifecycle: temporary
createdBy: ai
createdAt: ${new Date().toISOString()}
parentSessionId: ${frontmatterString(parentSession.sessionId)}
runId: ${runId}
expiresAt: ${expiresAt}
enabled-as-subagent: true
capabilityPolicy: ${spec.capabilityPolicy}
tools: ${spec.allowedTools.join(', ')}
model:
  mode: ${spec.model?.mode === 'fixed' ? 'fixed' : 'inherit'}${spec.model?.mode === 'fixed' ? `
  provider: ${frontmatterString(spec.model.provider)}
  modelId: ${frontmatterString(spec.model.modelId)}${spec.model.api ? `
  api: ${frontmatterString(spec.model.api)}` : ''}${spec.model.baseUrl ? `
  baseUrl: ${frontmatterString(spec.model.baseUrl)}` : ''}` : ''}
max-runtime-ms: ${Math.max(1000, Math.min(Number(spec.maxRuntimeMs || SUBAGENT_DEFAULT_TIMEOUT_MS), SUBAGENT_MAX_TIMEOUT_MS))}
max-tool-calls: ${Math.max(1, Math.min(Number(spec.maxToolCalls || 300), 300))}
allow-mcp-tools: ${spec.allowMcpTools === true ? 'true' : 'false'}
allow-agent-skills: ${spec.allowAgentSkills === true ? 'true' : 'false'}
---
${spec.systemPrompt}
`
}

async function createTemporarySubagentProfile(parentSession, spec) {
  await ensureStorage()
  const runId = `run_${Date.now()}_${randomUUID().slice(0, 8)}`
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const dir = path.join(tempAgentsDir, safeTempPathSegment(parentSession.sessionId, 'session'), runId)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${spec.name}.md`)
  const markdown = temporarySubagentMarkdown(spec, parentSession, runId, expiresAt)
  await fs.writeFile(file, markdown, 'utf8')
  const profile = agentProfileFromMarkdown(file, markdown, {
    source: 'temporary',
    idPrefix: `temporary:${safeTempPathSegment(parentSession.sessionId, 'session')}:${runId}`,
    relativePath: path.relative(tempAgentsDir, file).replace(/\\/g, '/'),
  })
  if (!profile) throw new Error('Failed to create temporary subagent profile')
  profile.readonly = true
  return profile
}

async function resolveSubagentProfile(parentSession, requestedSubagent) {
  const temporarySpec = normalizeTemporarySubagentSpec(requestedSubagent)
  if (temporarySpec) return createTemporarySubagentProfile(parentSession, temporarySpec)
  return getAgentProfile(requestedSubagent, { workspaceRoot: parentSession.projectContext?.workspaceRoot })
}

function formatTimeoutMinutes(timeoutMs) {
  const minutes = Number((timeoutMs / (60 * 1000)).toFixed(2))
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

/**
 * 从 subagent 消息历史提取仍在 pendingToolCalls 中的工具名（与前端
 * currentSubagentToolSummaries 相同的交集算法：assistant toolCall 块 × pending id），
 * 按出现顺序去重返回，用于超时错误摘要中的「被中断时仍在执行」。
 */
function pendingSubagentToolNames(messages, pendingToolCalls) {
  const pending = new Set(pendingToolCalls || [])
  if (pending.size === 0) return []
  const names = []
  for (const message of messages) {
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block || block.type !== 'toolCall' || !pending.has(block.id)) continue
      pending.delete(block.id)
      if (typeof block.name === 'string' && block.name && !names.includes(block.name)) names.push(block.name)
    }
    if (pending.size === 0) break
  }
  return names
}

/**
 * 终止类错误正文的进度摘要分段：工具调用数、被中断时仍在执行的工具、
 * 最后一条 assistant 文本（压缩空白并截断）。details 不进入 LLM 上下文
 * （omitDetailsForLlm），父模型只能通过这段文字了解 subagent 被中止前
 * 完成了什么、部分成果是否可用；超时与父运行中止共用。
 */
function subagentProgressSegments({ toolCalls, messages, pendingToolCalls }) {
  const segments = [`${toolCalls} tool call${toolCalls === 1 ? '' : 's'}`]
  const runningTools = pendingSubagentToolNames(messages, pendingToolCalls)
  if (runningTools.length > 0) segments.push(`still running: ${runningTools.join(', ')}`)
  const lastMessage = String(lastAssistantText(messages) || '').trim().replace(/\s+/g, ' ')
  if (lastMessage) {
    const truncated = lastMessage.length > SUBAGENT_TIMEOUT_LAST_MESSAGE_LIMIT
      ? `${lastMessage.slice(0, SUBAGENT_TIMEOUT_LAST_MESSAGE_LIMIT)}…`
      : lastMessage
    segments.push(`last assistant message: ${truncated}`)
  }
  return segments
}

/** 超时错误正文：保持既有首句不变（兼容既有断言与用户认知），其后追加进度摘要。 */
function buildSubagentTimeoutErrorMessage(name, timeoutMs, progress) {
  return `Subagent ${name} timed out after ${formatTimeoutMinutes(timeoutMs)}. Progress before timeout: ${subagentProgressSegments(progress).join('; ')}.`
}

/** 父运行中止错误正文：首句保持既有文案，其后追加与超时同构的进度摘要。 */
function buildSubagentAbortedErrorMessage(name, progress) {
  return `Subagent ${name} aborted with parent run. Progress before abort: ${subagentProgressSegments(progress).join('; ')}.`
}

/**
 * run_subagent 抛错时附带的结构化 details 暂存（toolCallId → { stashedAt, details }）。
 * pi-agent-core 将抛错的 execute 收口为纯文本错误结果（details 为空对象），父 Agent
 * 的 afterToolCall 从这里取回 details 注入 toolResult，使超时错误也携带完整过程
 * （messages/toolCalls/pendingToolCalls 等）持久化并在 Inspector 中可见。正常路径
 * afterToolCall 立即取走并删除；遗留条目仅按 TTL 兜底清理，防异常销毁泄漏。
 */
export async function runSubagent(parentSession, toolCallId, params, parentSignal, onUpdate) {
  const profile = await resolveSubagentProfile(parentSession, params?.subagent)
  if (!profile || !profile.enabledAsSubagent) {
    const error = new Error(`Unknown or disabled subagent: ${typeof params?.subagent === 'string' ? params.subagent : params?.subagent?.name || ''}`)
    error.statusCode = 400
    throw error
  }
  const definition = profile

  const task = String(params?.task || '').trim()
  if (!task) {
    const error = new Error('task is required')
    error.statusCode = 400
    throw error
  }
  if (!parentSession.projectContext?.workspaceRoot) {
    throw new Error('Subagents require an active workspace.')
  }
  if (!parentSession.model) {
    throw new Error('No active model is configured for the parent session.')
  }

  const timeoutMs = Math.max(1000, Math.min(Number(definition.maxRuntimeMs || SUBAGENT_DEFAULT_TIMEOUT_MS), SUBAGENT_MAX_TIMEOUT_MS))
  definition.capabilityPolicy ||= inferCapabilityPolicy(definition.allowedTools || [])
  definition.allowedTools = applyCapabilityPolicy(definition.allowedTools || [], definition.capabilityPolicy)
  const parentToolNames = new Set(
    (Array.isArray(parentSession.agent?.state?.tools) ? parentSession.agent.state.tools : [])
      .map((tool) => tool?.name)
      .filter((toolName) => typeof toolName === 'string'),
  )
  const inheritedToolNames = [...parentToolNames].filter((toolName) => (
    (definition.allowMcpTools === true && isMcpToolName(toolName))
    || (definition.allowAgentSkills === true && (toolName === 'activate_skill' || toolName === 'read_skill_resource'))
  ))
  const effectiveAllowedTools = [...new Set([...definition.allowedTools, ...inheritedToolNames])]
  const subagentSessionId = `${parentSession.sessionId}:subagent:${definition.name}:${randomUUID()}`
  const startedAt = Date.now()
  const lifecycleContext = {
    parentSessionId: parentSession.sessionId,
    subagentSessionId,
    toolCallId,
    subagent: definition.name,
    timeoutMs,
  }
  let toolCalls = 0
  let terminalLifecycleLogged = false
  const logLifecycle = (level, lifecycleEvent, extra = {}) => {
    logger[level](`Subagent lifecycle: ${lifecycleEvent}`, {
      lifecycleEvent,
      ...lifecycleContext,
      durationMs: Date.now() - startedAt,
      toolCalls,
      ...extra,
    })
  }
  const logTerminalLifecycle = (level, lifecycleEvent, extra = {}) => {
    if (terminalLifecycleLogged) return
    terminalLifecycleLogged = true
    logLifecycle(level, lifecycleEvent, extra)
  }

  logLifecycle('info', 'started')

  try {
    const { model: subagentModel, info: subagentModelInfo } = await resolveAgentProfileModel(
      definition,
      parentSession.model,
      readStore,
      parentSession.modelAccessContext || {},
    )
    const subagentThinkingLevel = resolveAgentProfileThinkingLevel(definition, parentSession.thinkingLevel, subagentModel)
    let latestMessages = []
    let latestPendingToolCalls = []
    let toolsForClient = []
    let lastTraceAt = 0
    let tracePending = false
    let traceTimer = null

    const tools = await createServerTools(
      parentSession.projectId,
      parentSession.projectContext,
      sessionSkillsContext(parentSession),
      true,
      (toolName) => {
        if (!effectiveAllowedTools.includes(toolName)) return `Subagent ${definition.name} is not allowed to use ${toolName}.`
        return commandToolPermissionError(parentSession, toolName)
      },
      {
        allowedToolNames: effectiveAllowedTools,
        includeSubagentTool: false,
        includeMcpTools: definition.allowMcpTools === true,
        includePluginTools: false,
        includeSkillTools: definition.allowAgentSkills === true,
      },
    )
    toolsForClient = tools.map(({ execute: _execute, prepareArguments: _prepareArguments, ...tool }) => tool)

    const emitSubagentTrace = () => {
      if (traceTimer) {
        clearTimeout(traceTimer)
        traceTimer = null
      }
      tracePending = false
      lastTraceAt = Date.now()
      onUpdate?.({
        content: [],
        details: {
          subagent: definition.name,
          label: definition.label,
          sessionId: subagentSessionId,
          parentSessionId: parentSession.sessionId,
          toolCalls,
          allowedTools: effectiveAllowedTools,
          timeoutMs,
          source: definition.source,
          lifecycle: definition.lifecycle,
          profilePath: definition.filePath,
          capabilityPolicy: definition.capabilityPolicy,
          model: subagentModelInfo,
          durationMs: Date.now() - startedAt,
          messages: Array.isArray(latestMessages) ? latestMessages.slice(-SUBAGENT_TRACE_MESSAGES_LIMIT) : [],
          messagesTotal: Array.isArray(latestMessages) ? latestMessages.length : 0,
          tools: toolsForClient,
          pendingToolCalls: latestPendingToolCalls,
        },
      })
    }

    const emitSubagentTraceThrottled = () => {
      const elapsed = Date.now() - lastTraceAt
      if (elapsed >= SUBAGENT_TRACE_THROTTLE_MS) {
        emitSubagentTrace()
        return
      }
      tracePending = true
      if (traceTimer) return
      traceTimer = setTimeout(() => {
        if (tracePending) emitSubagentTrace()
      }, SUBAGENT_TRACE_THROTTLE_MS - elapsed)
    }

    // 终止类错误（超时/父运行中止）共用的终态 details：与成功终态同构并附
    // timedOut/aborted 标记，经 quickforgeSubagentDetails → stash →
    // afterToolCall 注入错误 toolResult 持久化。
    const buildTerminalSubagentDetails = (extra) => ({
      subagent: definition.name,
      label: definition.label,
      sessionId: subagentSessionId,
      parentSessionId: parentSession.sessionId,
      toolCallId,
      toolCalls,
      allowedTools: effectiveAllowedTools,
      timeoutMs,
      source: definition.source,
      lifecycle: definition.lifecycle,
      profilePath: definition.filePath,
      capabilityPolicy: definition.capabilityPolicy,
      model: subagentModelInfo,
      durationMs: Date.now() - startedAt,
      messages: latestMessages,
      tools: toolsForClient,
      pendingToolCalls: latestPendingToolCalls,
      ...extra,
    })

    const systemPrompt = composeSubagentSystemPrompt({
      definition,
      parentSystemPrompt: parentSession.agent.state.systemPrompt,
      projectContext: parentSession.projectContext,
      effectiveAllowedTools,
    })
    const userMessage = {
      role: 'user',
      content: [{ type: 'text', text: formatSubagentTask(params) }],
      timestamp: Date.now(),
    }
    const subagent = new Agent({
      initialState: {
        systemPrompt,
        model: subagentModel,
        thinkingLevel: subagentThinkingLevel,
        messages: [],
        tools,
      },
      streamFn: (streamModel, streamContext, streamOptions) => streamSimpleWithAiHttpLogging(streamModel, streamContext, {
        ...streamOptions,
        onStreamRetry: (info) => emitSessionEvent(parentSession, { type: 'model_stream_retry', ...info }),
        quickforgeInternalLogContext: lifecycleContext,
      }),
      getApiKey: parentSession.getApiKey,
      sessionId: subagentSessionId,
      convertToLlm: serverConvertToLlm,
      onPayload: (payload) => {
        restoreReasoningContentInPayload(payload, subagent.state.messages, subagent.state.model)
      },
      beforeToolCall: async (context) => {
        const toolName = context.toolCall?.name
        toolCalls += 1
        emitSubagentTrace()
        if (toolCalls > Number(definition.maxToolCalls || 300)) {
          return { block: true, reason: `Subagent ${definition.name} exceeded its tool-call budget.` }
        }
        if (!effectiveAllowedTools.includes(toolName)) {
          return { block: true, reason: `Subagent ${definition.name} is not allowed to use ${toolName}.` }
        }
        const commandPermissionError = commandToolPermissionError(parentSession, toolName)
        if (commandPermissionError) return { block: true, reason: commandPermissionError }
        if (toolName === 'activate_skill' || toolName === 'read_skill_resource') return undefined
        if (!hasFullAccess(parentSession)) {
          if (safeReadTools.has(toolName)) return undefined
          return createApprovalPromise(parentSession, context.toolCall?.id, toolName, context.args, {
            type: 'subagent',
            subagent: definition.name,
            label: definition.label,
            sessionId: subagentSessionId,
          })
        }
        return undefined
      },
    })

    subagent.subscribe((event) => {
      latestMessages = subagent.state.messages.slice()
      latestPendingToolCalls = Array.from(subagent.state.pendingToolCalls || [])
      if (event.type === 'message_start' || event.type === 'message_update') {
        if (event.message?.role === 'assistant') {
          latestMessages = [...latestMessages, event.message]
        }
      }
      if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end' || event.type === 'message_end') {
        emitSubagentTrace()
      } else {
        emitSubagentTraceThrottled()
      }
    })

    let abortTrigger = null
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      abortTrigger ||= { type: 'timeout', triggeredAt: Date.now() }
      logLifecycle('warn', 'timeout_triggered')
      subagent.abort()
    }, timeoutMs)
    const onParentAbort = () => {
      abortTrigger ||= { type: 'parent_abort', triggeredAt: Date.now() }
      logLifecycle('warn', 'parent_aborted')
      subagent.abort()
    }
    parentSignal?.addEventListener?.('abort', onParentAbort, { once: true })

    try {
      let promptOutcome = 'resolved'
      try {
        await subagent.prompt(userMessage)
      } catch (error) {
        promptOutcome = 'rejected'
        throw error
      } finally {
        if (abortTrigger) {
          logLifecycle('warn', 'settled_after_abort', {
            abortReason: abortTrigger.type,
            waitAfterAbortMs: Date.now() - abortTrigger.triggeredAt,
            outcome: promptOutcome,
          })
        }
      }
      const terminalProgress = { toolCalls, messages: latestMessages, pendingToolCalls: latestPendingToolCalls }
      if (timedOut) {
        const timeoutError = new Error(buildSubagentTimeoutErrorMessage(definition.name, timeoutMs, terminalProgress))
        timeoutError.quickforgeSubagentDetails = buildTerminalSubagentDetails({ timedOut: true })
        throw timeoutError
      }
      if (parentSignal?.aborted) {
        const abortedError = new Error(buildSubagentAbortedErrorMessage(definition.name, terminalProgress))
        abortedError.quickforgeSubagentDetails = buildTerminalSubagentDetails({ aborted: true })
        throw abortedError
      }

      const content = lastAssistantText(subagent.state.messages) || `Subagent ${definition.name} completed without a text response.`
      logTerminalLifecycle('info', 'completed')
      return {
        content,
        details: {
          subagent: definition.name,
          label: definition.label,
          sessionId: subagentSessionId,
          parentSessionId: parentSession.sessionId,
          toolCalls,
          allowedTools: effectiveAllowedTools,
          timeoutMs,
          source: definition.source,
          lifecycle: definition.lifecycle,
          profilePath: definition.filePath,
          capabilityPolicy: definition.capabilityPolicy,
          model: subagentModelInfo,
          durationMs: Date.now() - startedAt,
          messages: latestMessages,
          tools: toolsForClient,
          pendingToolCalls: latestPendingToolCalls,
        },
      }
    } catch (error) {
      // 其余运行期失败（模型流错误等）统一附带终态 details：错误正文保持上游
      // 原文（前端 stripTerminalErrorFromTrace 依赖 errorMessage 与 trace 终态
      // 错误文本精确相等来去重），过程信息只进 details 供 toolResult 持久化与
      // Inspector 恢复展示；不带 timedOut/aborted 标记，状态由 isError 驱动。
      if (error && typeof error === 'object' && !error.quickforgeSubagentDetails) {
        error.quickforgeSubagentDetails = buildTerminalSubagentDetails({})
      }
      logTerminalLifecycle('warn', 'failed', {
        outcome: timedOut ? 'timeout' : parentSignal?.aborted ? 'parent_aborted' : 'error',
        errorName: error instanceof Error ? error.name : typeof error,
      })
      throw error
    } finally {
      clearTimeout(timeout)
      parentSignal?.removeEventListener?.('abort', onParentAbort)
      emitSubagentTrace()
    }
  } catch (error) {
    logTerminalLifecycle('warn', 'failed', {
      outcome: 'error',
      errorName: error instanceof Error ? error.name : typeof error,
    })
    throw error
  }
}

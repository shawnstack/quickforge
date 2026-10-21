// run_workflow — scripted subagent orchestration.
//
// The model submits a short JavaScript orchestration script plus optional args.
// The script runs in a dedicated worker thread (agent-workflow-worker.mjs) and
// drives named QuickForge Agent Profiles and workspace tools through the
// documented hooks:
//   agent(prompt, options?) / tool(name, args, options?) /
//   parallel(thunks) / pipeline(items, ...stages) /
//   phase(title) / log(message) / args
//
// This module owns everything the script must not do itself:
// - worker lifecycle, overall deadline and parent-abort propagation
// - a bounded step queue (maxAgents / maxTools / concurrency)
// - the normal subagent lifecycle for every agent() call and the normal tool
//   lifecycle for every tool() call (approvals, budgets, workspace attribution)
// - optional JSON-Schema validation of an agent's final text
// - a bounded progress/details payload for the SSE tool card and persistence
//
// Security boundary: this tool is approval-gated in default access mode before
// the worker starts. The worker's vm context exposes no Node.js globals, but it
// is still a worker thread in the server process; the approval prompt (and
// full-access mode) is the explicit trust boundary, exactly like run_command.

import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { Value } from 'typebox/value'
import { runWorkflowSubagent } from './agent-subagent-runner.mjs'
import { createWorkflowToolset, runWorkflowTool } from './agent-workflow-tools.mjs'
import { hasFullAccess } from './agent-access-mode.mjs'
import { logger } from './utils/logger.mjs'

export const WORKFLOW_DEFAULT_MAX_AGENTS = 24
export const WORKFLOW_MAX_AGENTS_LIMIT = 64
export const WORKFLOW_DEFAULT_MAX_TOOLS = 64
export const WORKFLOW_MAX_TOOLS_LIMIT = 128
export const WORKFLOW_DEFAULT_CONCURRENCY = 4
export const WORKFLOW_CONCURRENCY_LIMIT = 8
export const WORKFLOW_DEFAULT_MAX_RUNTIME_MS = 60 * 60 * 1000
export const WORKFLOW_MAX_RUNTIME_MS = 2 * 60 * 60 * 1000
export const WORKFLOW_MIN_RUNTIME_MS = 1000
const MAX_SCRIPT_LENGTH = 20_000
const MAX_ARGS_JSON_LENGTH = 20_000
// Total details budget. Running frames stay smaller because they are emitted
// every PROGRESS_THROTTLE_MS; terminal frames get more room so the Inspector can
// keep the same full-tail trace a direct run_subagent persists. Logs have their
// own budget: they are metadata, not the agent process users open the detail for.
const MAX_DETAILS_TEXT = 500_000
const MAX_DETAILS_TEXT_STREAMING = 240_000
const MAX_LOG_TEXT = 50_000
// Per-agent Inspector trace. Direct run_subagent persists the full message list;
// a workflow card carries one trace per agent. Keep the same 50-message tail for
// streaming frames and allow the full tail on terminal frames, with enough room
// for a normal tool call plus its result. The old 6KB cap dropped
// toolCall/toolResult before the final reply, so the shared Inspector opened
// with task and output only.
const MAX_SUBAGENT_RUN_JSON = 80_000
const MAX_SUBAGENT_RUN_JSON_TERMINAL = 200_000
const MAX_SUBAGENT_TRACE_MESSAGES = 50
const MAX_SUBAGENT_TRACE_MESSAGES_TERMINAL = 200
const PROGRESS_THROTTLE_MS = 200
const AGENT_RESULT_PREVIEW_LIMIT = 2000
const TOOL_ARGS_PREVIEW_LIMIT = 4000
const TOOL_RESULT_PREVIEW_LIMIT = 2000
const WORKFLOW_RESULT_PREVIEW_LIMIT = 20_000
const CONTENT_RESULT_LIMIT = 50_000
const ERROR_TEXT_LIMIT = 2000
const MAX_LOG_ENTRIES = 200

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.round(number)))
}

function truncateText(value, limit) {
  const text = String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function formatDuration(ms) {
  const value = Math.max(0, Math.round(Number(ms) || 0))
  if (value < 1000) return `${value}ms`
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`
  const minutes = Math.floor(value / 60_000)
  const seconds = Math.round((value % 60_000) / 1000)
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function normalizeWorkflowOptions(raw) {
  if (raw === undefined || raw === null) raw = {}
  if (!isPlainObject(raw)) {
    const error = new Error('run_workflow options must be an object')
    error.statusCode = 400
    throw error
  }
  return {
    maxAgents: clampInteger(raw.maxAgents, 1, WORKFLOW_MAX_AGENTS_LIMIT, WORKFLOW_DEFAULT_MAX_AGENTS),
    maxTools: clampInteger(raw.maxTools, 1, WORKFLOW_MAX_TOOLS_LIMIT, WORKFLOW_DEFAULT_MAX_TOOLS),
    concurrency: clampInteger(raw.concurrency, 1, WORKFLOW_CONCURRENCY_LIMIT, WORKFLOW_DEFAULT_CONCURRENCY),
    maxRuntimeMs: clampInteger(raw.maxRuntimeMs, WORKFLOW_MIN_RUNTIME_MS, WORKFLOW_MAX_RUNTIME_MS, WORKFLOW_DEFAULT_MAX_RUNTIME_MS),
  }
}

function validationError(message) {
  const error = new Error(message)
  error.statusCode = 400
  error.errorCode = 'WORKFLOW_INVALID'
  return error
}

/** Extract a JSON value from a subagent's final text (raw, fenced, or embedded). */
export function parseStructuredAgentResult(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { ok: false, error: 'Agent returned no text to validate against the requested schema.' }
  const candidates = [raw]
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) candidates.push(fenced[1].trim())
  const objectStart = raw.indexOf('{')
  const objectEnd = raw.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(raw.slice(objectStart, objectEnd + 1))
  const arrayStart = raw.indexOf('[')
  const arrayEnd = raw.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(raw.slice(arrayStart, arrayEnd + 1))
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) }
    } catch {
      // try the next candidate
    }
  }
  return { ok: false, error: 'Agent response is not valid JSON, so it cannot satisfy the requested schema.' }
}

function validateAgainstSchema(schema, value) {
  let valid
  try {
    valid = Value.Check(schema, value)
  } catch (error) {
    return { ok: false, error: `Agent schema could not be evaluated: ${error?.message || 'unknown schema error'}` }
  }
  if (valid) return { ok: true }
  let detail = ''
  try {
    const first = Value.Errors(schema, value).next?.().value
    if (first) {
      const pathText = Array.isArray(first.path) && first.path.length ? first.path.join('.') : '/'
      detail = ` (${pathText}: ${first.message || 'invalid value'})`
    }
  } catch {
    // best effort only
  }
  return { ok: false, error: `Agent result did not match the requested schema${detail}.` }
}

function stringifyResult(value) {
  try {
    const json = JSON.stringify(value, null, 2)
    return json === undefined ? 'null' : json
  } catch {
    return String(value)
  }
}

function compactJsonValue(value, maxString = 1000, depth = 0) {
  if (typeof value === 'string') return truncateText(value, maxString)
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => compactJsonValue(entry, maxString, depth + 1))
  if (isPlainObject(value) && depth < 4) {
    const output = {}
    for (const [key, entry] of Object.entries(value).slice(0, 30)) {
      output[key] = compactJsonValue(entry, maxString, depth + 1)
    }
    return output
  }
  return value
}

function compactSubagentMessage(message) {
  if (!isPlainObject(message)) return null
  const compact = { role: message.role, timestamp: message.timestamp }
  if (Array.isArray(message.content)) {
    compact.content = message.content.map((block) => {
      if (!isPlainObject(block)) return block
      if (block.type === 'text') return { ...block, text: truncateText(block.text, 2000) }
      if (block.type === 'toolCall') return { ...block, arguments: compactJsonValue(block.arguments, 2000) }
      // Thinking blocks have no tool card body; cap them so a long reasoning
      // stream cannot crowd out the tool calls/results that make up the trace.
      if (block.type === 'thinking') {
        return {
          ...block,
          ...(typeof block.thinking === 'string' ? { thinking: truncateText(block.thinking, 2000) } : {}),
          ...(typeof block.text === 'string' ? { text: truncateText(block.text, 2000) } : {}),
        }
      }
      return block
    })
  } else {
    compact.content = truncateText(message.content, 2000)
  }
  for (const key of ['toolCallId', 'toolName', 'isError', 'stopReason', 'errorMessage']) {
    if (message[key] !== undefined) compact[key] = message[key]
  }
  // Tool cards in the Inspector read timing, diffs, and command state from
  // toolResult.details. Keep that object, bounded, instead of dropping it.
  if (message.role === 'toolResult' && message.details !== undefined) {
    compact.details = compactJsonValue(message.details, 4000, 0)
  }
  return compact
}

/**
 * Slice the tail without separating a toolResult from its assistant toolCall.
 * A plain slice(-N) can start between the two, so the Inspector drops the result
 * (subagentProcessTraceMessages only keeps paired results) even though the tool
 * call happened. Walk backwards until the window contains the matching calls.
 */
function sliceMessagesWithToolPairs(messages, limit) {
  if (!Array.isArray(messages)) return []
  if (messages.length <= limit) return messages
  let start = messages.length - limit
  let previousStart = -1
  while (start !== previousStart && start > 0) {
    previousStart = start
    const needed = new Set()
    for (let index = start; index < messages.length; index += 1) {
      const message = messages[index]
      if (message?.role === 'toolResult' && typeof message.toolCallId === 'string') needed.add(message.toolCallId)
    }
    for (let index = start - 1; index >= 0 && needed.size > 0; index -= 1) {
      const message = messages[index]
      if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
      for (const block of message.content) {
        if (block?.type === 'toolCall' && typeof block.id === 'string' && needed.has(block.id)) {
          needed.delete(block.id)
          start = index
        }
      }
    }
  }
  return messages.slice(start)
}

/** Drop results whose toolCall fell outside the compacted window. */
function dropOrphanToolResults(messages) {
  const known = new Set()
  for (const message of messages) {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block?.type === 'toolCall' && typeof block.id === 'string') known.add(block.id)
    }
  }
  return messages.filter((message) => message?.role !== 'toolResult'
    || typeof message.toolCallId !== 'string'
    || known.has(message.toolCallId))
}

function compactSubagentRunDetails(details, options = {}) {
  if (!isPlainObject(details)) return null
  const terminal = options.mode === 'terminal'
  const maxMessages = options.maxMessages ?? (terminal ? MAX_SUBAGENT_TRACE_MESSAGES_TERMINAL : MAX_SUBAGENT_TRACE_MESSAGES)
  const maxJson = options.maxJson ?? (terminal ? MAX_SUBAGENT_RUN_JSON_TERMINAL : MAX_SUBAGENT_RUN_JSON)
  const messages = Array.isArray(details.messages)
    ? sliceMessagesWithToolPairs(details.messages, maxMessages).map(compactSubagentMessage).filter(Boolean)
    : []
  const tools = Array.isArray(details.tools)
    ? details.tools.slice(0, 30).map((tool) => (isPlainObject(tool)
      ? {
          name: tool.name,
          label: tool.label,
          ...(tool.description ? { description: truncateText(tool.description, 300) } : {}),
        }
      : null)).filter(Boolean)
    : []
  const compact = {
    subagent: details.subagent,
    label: details.label,
    sessionId: details.sessionId,
    parentSessionId: details.parentSessionId,
    toolCalls: details.toolCalls,
    allowedTools: Array.isArray(details.allowedTools) ? details.allowedTools.slice(0, 30) : [],
    model: compactJsonValue(details.model, 200),
    thinkingLevel: details.thinkingLevel,
    source: details.source,
    lifecycle: details.lifecycle,
    profilePath: details.profilePath,
    capabilityPolicy: details.capabilityPolicy,
    durationMs: details.durationMs,
    pendingToolCalls: Array.isArray(details.pendingToolCalls) ? details.pendingToolCalls.slice(0, 30) : [],
    messages,
    tools,
  }
  while (compact.messages.length > 0 && JSON.stringify(compact).length > maxJson) {
    // Shrink in batches; stringifying the whole run once per dropped message is
    // quadratic for long traces. Pair-aware slicing may keep the same length
    // (the window expanded to include a toolCall), so fall back to one shift.
    const nextLength = Math.max(0, compact.messages.length - 10)
    if (nextLength === 0) {
      compact.messages = []
      break
    }
    const nextMessages = sliceMessagesWithToolPairs(compact.messages, nextLength)
    if (nextMessages.length >= compact.messages.length) compact.messages.shift()
    else compact.messages = nextMessages
  }
  if (JSON.stringify(compact).length > maxJson) compact.tools = []
  if (JSON.stringify(compact).length > maxJson) compact.messages = []
  // A shift can remove the assistant toolCall while keeping its toolResult;
  // such orphan results can never render as a tool card, so drop them.
  compact.messages = dropOrphanToolResults(compact.messages)
  return compact
}

function normalizeToolRequest(message, runId) {
  const options = isPlainObject(message?.options) ? message.options : {}
  const args = isPlainObject(message?.args) ? message.args : {}
  let argsJson
  try {
    argsJson = JSON.stringify(args)
  } catch {
    argsJson = ''
  }
  return {
    name: String(message?.name || '').trim(),
    args,
    argsJson,
    label: typeof options.label === 'string' && options.label.trim() ? options.label.trim() : '',
    phase: typeof options.phase === 'string' && options.phase.trim() ? options.phase.trim() : '',
    workflowLabel: runId,
  }
}

function normalizeAgentRequest(message, runId) {
  const options = isPlainObject(message?.options) ? message.options : {}
  return {
    prompt: String(message?.prompt || ''),
    profile: typeof options.profile === 'string' && options.profile.trim() ? options.profile.trim() : 'general',
    label: typeof options.label === 'string' && options.label.trim() ? options.label.trim() : '',
    phase: typeof options.phase === 'string' && options.phase.trim() ? options.phase.trim() : '',
    context: typeof options.context === 'string' ? options.context : undefined,
    expectedOutput: typeof options.expectedOutput === 'string' ? options.expectedOutput : undefined,
    schema: options.schema === undefined || options.schema === null ? null : options.schema,
    maxRuntimeMs: options.maxRuntimeMs,
    maxToolCalls: options.maxToolCalls,
    model: options.model,
    workflowLabel: runId,
  }
}

/**
 * Run one workflow script to completion.
 *
 * `dependencies.runAgent` is injectable for tests; production uses the normal
 * subagent lifecycle. The injected function has the same contract as
 * runWorkflowSubagent: (parentSession, toolCallId, params, signal, onUpdate).
 */
export async function runWorkflow(parentSession, toolCallId, params, parentSignal, onUpdate, dependencies = {}) {
  if (!parentSession?.projectContext?.workspaceRoot) throw new Error('Workflows require an active workspace.')
  if (!parentSession.model) throw new Error('No active model is configured for the parent session.')

  const script = typeof params?.script === 'string' ? params.script : ''
  if (!script.trim()) throw validationError('script is required')
  if (script.length > MAX_SCRIPT_LENGTH) throw validationError(`script is too large (max ${MAX_SCRIPT_LENGTH} characters)`)
  const options = normalizeWorkflowOptions(params?.options)
  // Approvals are one at a time in the UI (single pending card), so agents run
  // one at a time in default access mode; full access can use the configured
  // concurrency.
  const effectiveConcurrency = hasFullAccess(parentSession) ? options.concurrency : 1
  let workflowArgs = params?.args === undefined ? null : params.args
  try {
    workflowArgs = structuredClone(workflowArgs)
  } catch {
    throw validationError('args must be JSON-serializable')
  }
  try {
    if (JSON.stringify(workflowArgs).length > MAX_ARGS_JSON_LENGTH) {
      throw validationError(`args is too large (max ${MAX_ARGS_JSON_LENGTH} characters of JSON)`)
    }
  } catch (error) {
    if (error?.errorCode === 'WORKFLOW_INVALID') throw error
    throw validationError('args must be JSON-serializable')
  }

  const runAgent = dependencies.runAgent || runWorkflowSubagent
  const runTool = dependencies.runTool || runWorkflowTool
  const createToolset = dependencies.createToolset || createWorkflowToolset
  const runId = typeof toolCallId === 'string' && toolCallId ? toolCallId : `workflow-${randomUUID()}`
  const startedAt = Date.now()
  const controller = new AbortController()
  const state = {
    status: 'running',
    phases: [],
    phaseNames: new Set(),
    agents: [],
    tools: [],
    logs: [],
    nextSeq: 0,
    resultJson: '',
    error: null,
    timedOut: false,
    aborted: false,
  }

  let currentPhase = ''
  let worker = null
  let deadlineTimer = null
  let progressTimer = null
  let progressPending = false
  let lastProgressAt = 0
  let settled = false
  let resolveWorkflow = null
  let rejectWorkflow = null
  const completion = new Promise((resolve, reject) => {
    resolveWorkflow = resolve
    rejectWorkflow = reject
  })
  // The early-abort path rejects before the caller has awaited completion;
  // keep that rejection from being reported as unhandled, while still
  // propagating it to the caller.
  void completion.catch(() => {})
  const queue = []
  let activeSteps = 0
  let toolsetPromise = null

  function ensurePhase(title) {
    if (!title || state.phaseNames.has(title)) return
    state.phaseNames.add(title)
    state.phases.push({ title, startedAt: Date.now() })
  }

  function appendLog(message, level = 'info', phase = currentPhase) {
    const text = truncateText(message, ERROR_TEXT_LIMIT)
    if (!text) return
    state.logs.push({ at: Date.now(), phase, message: text, level })
    if (state.logs.length > MAX_LOG_ENTRIES) state.logs.splice(0, state.logs.length - MAX_LOG_ENTRIES)
  }

  function agentRecordPayload(record) {
    const resultText = record.resultText || ''
    return {
      id: record.id,
      seq: record.seq,
      label: record.label,
      profile: record.profile,
      phase: record.phase,
      status: record.status,
      startedAt: record.startedAt,
      durationMs: record.durationMs,
      toolCalls: record.toolCalls,
      ...(record.schemaValidated ? { schemaValidated: true } : {}),
      ...(record.subagentRun ? { subagentRun: record.subagentRun } : {}),
      promptPreview: truncateText(record.promptPreview, AGENT_RESULT_PREVIEW_LIMIT),
      ...((record.promptPreview?.length ?? 0) > AGENT_RESULT_PREVIEW_LIMIT ? { promptTruncated: true } : {}),
      // run_subagent 的详情直接来自参数；workflow Agent 也把 context/expectedOutput
      // 带进 details，让 Inspector 的任务说明与直接调用保持同一份内容。
      ...(record.context ? { context: truncateText(record.context, AGENT_RESULT_PREVIEW_LIMIT) } : {}),
      ...(record.expectedOutput ? { expectedOutput: truncateText(record.expectedOutput, AGENT_RESULT_PREVIEW_LIMIT) } : {}),
      resultPreview: truncateText(resultText, AGENT_RESULT_PREVIEW_LIMIT),
      ...(resultText.length > AGENT_RESULT_PREVIEW_LIMIT ? { resultTruncated: true } : {}),
      ...(record.error ? { error: truncateText(record.error, ERROR_TEXT_LIMIT) } : {}),
    }
  }

  function toolRecordPayload(record) {
    const resultText = record.resultText || ''
    const argsJson = record.argsJson || ''
    return {
      id: record.id,
      seq: record.seq,
      name: record.name,
      label: record.label,
      phase: record.phase,
      status: record.status,
      startedAt: record.startedAt,
      durationMs: record.durationMs,
      ...(argsJson.length <= TOOL_ARGS_PREVIEW_LIMIT
        ? { args: record.args }
        : { argsPreview: truncateText(argsJson, TOOL_ARGS_PREVIEW_LIMIT) }),
      resultPreview: truncateText(resultText, TOOL_RESULT_PREVIEW_LIMIT),
      ...(resultText.length > TOOL_RESULT_PREVIEW_LIMIT ? { resultTruncated: true } : {}),
      ...(record.error ? { error: truncateText(record.error, ERROR_TEXT_LIMIT) } : {}),
    }
  }

  function detailsTextSize(details) {
    let size = details.resultPreview?.length ?? 0
    for (const log of details.logs) size += log.message.length
    for (const agent of details.agents) {
      size += (agent.promptPreview?.length ?? 0) + (agent.resultPreview?.length ?? 0) + (agent.error?.length ?? 0)
        + (agent.context?.length ?? 0) + (agent.expectedOutput?.length ?? 0)
      if (agent.subagentRun) size += JSON.stringify(agent.subagentRun).length
    }
    for (const tool of details.tools) {
      size += (tool.resultPreview?.length ?? 0) + (tool.error?.length ?? 0) + (tool.argsPreview?.length ?? 0)
      if (tool.args) size += JSON.stringify(tool.args).length
    }
    return size
  }

  function trimSubagentTraces(details, budget) {
    let size = detailsTextSize(details)
    if (size <= budget) return false
    const priority = (agent) => {
      if (agent.status === 'running' || agent.status === 'queued') return 3
      if (agent.status === 'error' || agent.status === 'aborted') return 2
      return 1
    }
    // Oldest/lowest-priority traces shrink first; running agents are what the
    // user is currently watching, so they are only touched as a last resort.
    const order = [...details.agents].sort((a, b) => priority(a) - priority(b) || (a.seq ?? 0) - (b.seq ?? 0))
    let changed = false
    const shrink = (agent, drop) => {
      if (!agent.subagentRun) return
      const before = JSON.stringify(agent.subagentRun).length
      if (drop) {
        delete agent.subagentRun
        agent.subagentRunDropped = true
      } else {
        const reduced = compactSubagentRunDetails(agent.subagentRun, { mode: 'streaming', maxMessages: 10, maxJson: 20_000 })
        if (reduced) {
          agent.subagentRun = reduced
        } else {
          delete agent.subagentRun
          agent.subagentRunDropped = true
        }
      }
      const after = agent.subagentRun ? JSON.stringify(agent.subagentRun).length : 0
      size -= Math.max(0, before - after)
      // A partial shrink is not a full drop, but the Inspector must still keep
      // the longer trace the user was already watching and show the same
      // "incomplete" notice instead of silently losing earlier tool cards.
      if (!drop && after < before) agent.subagentRunTruncated = true
      changed = true
    }
    for (const agent of order) {
      if (size <= budget) return changed
      if (priority(agent) >= 3) continue
      shrink(agent, false)
    }
    for (const agent of order) {
      if (size <= budget) return changed
      if (priority(agent) >= 3) continue
      shrink(agent, true)
    }
    for (const agent of order) {
      if (size <= budget) return changed
      shrink(agent, false)
    }
    for (const agent of order) {
      if (size <= budget) return changed
      shrink(agent, true)
    }
    return changed
  }

  function trimDetails(details) {
    const budget = details.status === 'running' ? MAX_DETAILS_TEXT_STREAMING : MAX_DETAILS_TEXT
    let truncated = false
    const logsTextSize = details.logs.reduce((sum, log) => sum + (typeof log?.message === 'string' ? log.message.length : 0), 0)
    if (logsTextSize > MAX_LOG_TEXT) {
      // Keep the newest lines up to both the entry and the character budget:
      // 50 large lines alone can exceed the 50K log cap.
      const kept = []
      let keptSize = 0
      for (let index = details.logs.length - 1; index >= 0; index -= 1) {
        const length = typeof details.logs[index]?.message === 'string' ? details.logs[index].message.length : 0
        if (kept.length >= 50 || keptSize + length > MAX_LOG_TEXT) break
        kept.push(details.logs[index])
        keptSize += length
      }
      details.logs = kept.reverse()
      truncated = true
    }
    if (detailsTextSize(details) <= budget && !truncated) return details
    if (detailsTextSize(details) > budget) {
      details.agents = details.agents.map((agent) => ({
        ...agent,
        promptPreview: truncateText(agent.promptPreview, 400),
        ...(agent.context ? { context: truncateText(agent.context, 400) } : {}),
        ...(agent.expectedOutput ? { expectedOutput: truncateText(agent.expectedOutput, 400) } : {}),
        resultPreview: truncateText(agent.resultPreview, 400),
        ...(agent.error ? { error: truncateText(agent.error, 400) } : {}),
      }))
      details.tools = details.tools.map((tool) => {
        const { args, ...rest } = tool
        return {
          ...rest,
          ...(args ? { argsPreview: truncateText(JSON.stringify(args), 1000) } : {}),
          resultPreview: truncateText(tool.resultPreview, 400),
          ...(tool.error ? { error: truncateText(tool.error, 400) } : {}),
        }
      })
    }
    if (detailsTextSize(details) > budget) {
      // Shrink the largest optional payload incrementally instead of dropping
      // every agent trace at once. A direct run_subagent always shows its trace;
      // a multi-agent workflow should not lose all of them just because the sum
      // exceeded one global budget.
      trimSubagentTraces(details, budget)
    }
    if (detailsTextSize(details) > budget) {
      details.logs = details.logs.slice(-10)
      details.resultPreview = truncateText(details.resultPreview, 4000)
    }
    details.detailsTruncated = true
    return details
  }

  function buildDetails(status = state.status) {
    const durationMs = Math.max(0, Date.now() - startedAt)
    return trimDetails({
      workflow: true,
      runId,
      status,
      startedAt,
      durationMs,
      maxAgents: options.maxAgents,
      maxTools: options.maxTools,
      concurrency: effectiveConcurrency,
      maxRuntimeMs: options.maxRuntimeMs,
      agentCount: state.agents.length,
      failedAgentCount: state.agents.filter((agent) => agent.status === 'error' || agent.status === 'aborted').length,
      toolCount: state.tools.length,
      failedToolCount: state.tools.filter((tool) => tool.status === 'error' || tool.status === 'aborted').length,
      phases: state.phases.map((phase) => ({ title: phase.title, startedAt: phase.startedAt })),
      agents: state.agents.map(agentRecordPayload),
      tools: state.tools.map(toolRecordPayload),
      logs: state.logs.slice(),
      ...(state.resultJson ? { resultPreview: truncateText(state.resultJson, WORKFLOW_RESULT_PREVIEW_LIMIT) } : {}),
      ...(state.resultJson.length > WORKFLOW_RESULT_PREVIEW_LIMIT ? { resultTruncated: true } : {}),
      ...(state.error ? { error: state.error } : {}),
      ...(state.timedOut ? { timedOut: true } : {}),
      ...(state.aborted ? { aborted: true } : {}),
    })
  }

  function emitProgress(force = false) {
    if (!onUpdate || settled) return
    const elapsed = Date.now() - lastProgressAt
    if (!force && elapsed < PROGRESS_THROTTLE_MS) {
      progressPending = true
      if (!progressTimer) {
        progressTimer = setTimeout(() => {
          progressTimer = null
          if (progressPending) {
            progressPending = false
            emitProgress(true)
          }
        }, PROGRESS_THROTTLE_MS - elapsed)
        progressTimer.unref?.()
      }
      return
    }
    if (progressTimer) {
      clearTimeout(progressTimer)
      progressTimer = null
    }
    progressPending = false
    lastProgressAt = Date.now()
    try {
      onUpdate({ content: [], details: buildDetails() })
    } catch (error) {
      logger.warn(`Failed to emit workflow progress for ${runId}:`, error, { sessionId: parentSession.sessionId, runId })
    }
  }

  function stopWorker() {
    if (!worker) return
    const current = worker
    worker = null
    current.removeAllListeners()
    current.terminate().catch(() => {})
  }

  function clearTimers() {
    if (deadlineTimer) {
      clearTimeout(deadlineTimer)
      deadlineTimer = null
    }
    if (progressTimer) {
      clearTimeout(progressTimer)
      progressTimer = null
    }
  }

  function cleanupParentListener() {
    parentSignal?.removeEventListener?.('abort', onParentAbort)
  }

  function abortQueuedSteps() {
    while (queue.length > 0) {
      const job = queue.shift()
      const kind = job.kind === 'tool' ? 'tool call' : 'agent'
      job.record.status = 'aborted'
      job.record.error = `Workflow stopped before this ${kind} started.`
      job.resolve({ ok: false, aborted: true, error: job.record.error })
    }
  }

  function markRunningStepsStopped(message) {
    for (const record of [...state.agents, ...state.tools]) {
      if (record.status !== 'running' && record.status !== 'queued') continue
      record.status = 'aborted'
      record.error = message
      if (record.startedAt) record.durationMs = Math.max(0, Date.now() - record.startedAt)
    }
  }

  function failWorkflow(message, { status = 'error', timedOut = false, aborted = false } = {}) {
    if (settled) return
    state.status = status
    state.error = message
    state.timedOut = timedOut
    state.aborted = aborted
    controller.abort()
    abortQueuedSteps()
    // Active steps settle asynchronously after controller.abort(); record their
    // terminal state now so the final frame and persisted details never show a
    // permanently "running" step.
    markRunningStepsStopped('Workflow stopped while this step was running.')
    clearTimers()
    stopWorker()
    cleanupParentListener()
    emitProgress(true)
    settled = true
    const completed = [
      ...state.agents
        .filter((agent) => agent.status === 'done' && agent.resultText)
        .map((agent) => `- agent ${agent.label}: ${truncateText(agent.resultText.replace(/\s+/g, ' '), 300)}`),
      ...state.tools
        .filter((tool) => tool.status === 'done' && tool.resultText)
        .map((tool) => `- tool ${tool.name}${tool.label && tool.label !== tool.name ? ` (${tool.label})` : ''}: ${truncateText(tool.resultText.replace(/\s+/g, ' '), 300)}`),
    ].slice(0, 8)
    const error = new Error(completed.length > 0
      ? `${message}\nCompleted steps before failure:\n${completed.join('\n')}`
      : message)
    error.errorCode = aborted ? 'WORKFLOW_ABORTED' : timedOut ? 'WORKFLOW_TIMEOUT' : 'WORKFLOW_FAILED'
    error.quickforgeWorkflowDetails = buildDetails(status)
    rejectWorkflow(error)
  }

  function completeWorkflow(result) {
    if (settled) return
    state.status = 'done'
    state.resultJson = stringifyResult(result)
    // Orphaned agent()/tool() calls (started without awaiting) must not keep
    // running.
    controller.abort()
    abortQueuedSteps()
    markRunningStepsStopped('Workflow completed before this step settled.')
    clearTimers()
    stopWorker()
    cleanupParentListener()
    emitProgress(true)
    settled = true
    const failedLabels = [
      ...state.agents
        .filter((agent) => agent.status === 'error' || agent.status === 'aborted')
        .map((agent) => agent.label),
      ...state.tools
        .filter((tool) => tool.status === 'error' || tool.status === 'aborted')
        .map((tool) => tool.name),
    ]
    const lines = [
      `Workflow completed · ${state.agents.length} agent(s) · ${state.tools.length} tool call(s) · ${state.phases.length} phase(s) · ${formatDuration(Date.now() - startedAt)}.`,
      failedLabels.length > 0
        ? `Steps that did not complete successfully: ${failedLabels.join(', ')}.`
        : null,
      '',
      '<workflow_result>',
      truncateText(state.resultJson, CONTENT_RESULT_LIMIT),
      '</workflow_result>',
    ].filter((line) => line !== null)
    resolveWorkflow({ content: lines.join('\n'), details: buildDetails('done') })
  }

  function sendAgentResult(requestId, response) {
    if (!worker || settled) return
    try {
      worker.postMessage({ type: 'agent-result', requestId, ...response })
    } catch (error) {
      logger.warn(`Failed to deliver workflow agent result for ${runId}:`, error, { sessionId: parentSession.sessionId, runId })
    }
  }

  async function executeAgent(job) {
    const { request, record } = job
    record.status = 'running'
    record.startedAt = Date.now()
    ensurePhase(record.phase)
    emitProgress(true)
    const signalParts = [controller.signal]
    if (parentSignal) signalParts.push(parentSignal)
    const signal = AbortSignal.any(signalParts)
    try {
      const response = await runAgent(parentSession, `workflow:${runId}:${record.index}`, {
        prompt: request.prompt,
        profile: request.profile,
        label: record.label,
        context: request.context,
        expectedOutput: request.expectedOutput,
        workflowLabel: request.workflowLabel,
        maxRuntimeMs: request.maxRuntimeMs,
        maxToolCalls: request.maxToolCalls,
        model: request.model,
      }, signal, (update) => {
        const toolCalls = Number(update?.details?.toolCalls)
        const toolCallsChanged = Number.isFinite(toolCalls) && toolCalls !== record.toolCalls
        const subagentRun = compactSubagentRunDetails(update?.details)
        if (subagentRun) record.subagentRun = subagentRun
        if (toolCallsChanged) record.toolCalls = toolCalls
        if (subagentRun || toolCallsChanged) emitProgress()
      })
      const subagentRun = compactSubagentRunDetails(response?.details, { mode: 'terminal' })
      if (subagentRun) record.subagentRun = subagentRun
      const text = String(response?.content ?? '')
      if (request.schema !== null && request.schema !== undefined) {
        const parsed = parseStructuredAgentResult(text)
        if (!parsed.ok) throw new Error(parsed.error)
        const validation = validateAgainstSchema(request.schema, parsed.value)
        if (!validation.ok) throw new Error(validation.error)
        record.schemaValidated = true
        record.resultText = stringifyResult(parsed.value)
        job.resolve({ ok: true, hasValue: true, value: parsed.value })
      } else {
        record.resultText = text
        job.resolve({ ok: true, hasValue: false, text })
      }
      record.status = 'done'
    } catch (error) {
      const message = error?.message || 'Agent run failed.'
      const stopped = state.aborted || state.timedOut || signal.aborted
      const terminalSubagentRun = compactSubagentRunDetails(error?.quickforgeSubagentDetails, { mode: 'terminal' })
      if (terminalSubagentRun) record.subagentRun = terminalSubagentRun
      record.status = stopped ? 'aborted' : 'error'
      record.error = message
      if (!stopped) appendLog(`${record.label} failed: ${message}`, 'error', record.phase)
      job.resolve({ ok: false, aborted: stopped, error: message })
    } finally {
      record.durationMs = record.startedAt ? Date.now() - record.startedAt : 0
      emitProgress(true)
    }
  }

  async function getWorkflowToolset() {
    if (!toolsetPromise) {
      toolsetPromise = Promise.resolve()
        .then(() => createToolset(parentSession))
        .catch((error) => {
          toolsetPromise = null
          throw error
        })
    }
    return toolsetPromise
  }

  async function executeTool(job) {
    const { record } = job
    record.status = 'running'
    record.startedAt = Date.now()
    ensurePhase(record.phase)
    emitProgress(true)
    const signalParts = [controller.signal]
    if (parentSignal) signalParts.push(parentSignal)
    const signal = AbortSignal.any(signalParts)
    try {
      const toolset = await getWorkflowToolset()
      const response = await runTool(parentSession, toolset, `workflow:tool:${runId}:${record.index}`, {
        name: record.name,
        args: record.args,
        label: record.label,
        phase: record.phase,
        workflowLabel: runId,
      }, signal, (update) => {
        const partial = Array.isArray(update?.content)
          ? update.content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
          : ''
        if (partial && partial !== record.resultText) {
          record.resultText = partial
          emitProgress()
        }
      })
      record.resultText = String(response?.content ?? '')
      record.status = 'done'
      job.resolve({ ok: true, content: record.resultText })
    } catch (error) {
      const message = error?.message || 'Tool call failed.'
      const stopped = state.aborted || state.timedOut || signal.aborted
      record.status = stopped ? 'aborted' : 'error'
      record.error = message
      if (!stopped) appendLog(`${record.name} failed: ${message}`, 'error', record.phase)
      job.resolve({ ok: false, aborted: stopped, error: message })
    } finally {
      record.durationMs = record.startedAt ? Date.now() - record.startedAt : 0
      emitProgress(true)
    }
  }

  function drainQueue() {
    while (!settled && activeSteps < effectiveConcurrency && queue.length > 0) {
      const job = queue.shift()
      activeSteps += 1
      const execute = job.kind === 'tool' ? executeTool : executeAgent
      void execute(job).finally(() => {
        activeSteps -= 1
        drainQueue()
      })
    }
  }

  function enqueueAgent(message) {
    const request = normalizeAgentRequest(message, runId)
    if (settled) return Promise.resolve({ ok: false, aborted: true, error: 'Workflow is not running.' })
    if (state.agents.length >= options.maxAgents) {
      const error = `Agent budget exhausted (${options.maxAgents}); this agent() call was skipped.`
      appendLog(error, 'error', request.phase || currentPhase)
      return Promise.resolve({ ok: false, error })
    }
    const index = state.agents.length + 1
    const record = {
      id: `agent-${index}`,
      index,
      seq: ++state.nextSeq,
      label: request.label || `${request.profile} #${index}`,
      profile: request.profile,
      phase: request.phase || currentPhase,
      status: 'queued',
      startedAt: null,
      durationMs: 0,
      toolCalls: 0,
      promptPreview: truncateText(request.prompt, AGENT_RESULT_PREVIEW_LIMIT),
      context: truncateText(request.context, AGENT_RESULT_PREVIEW_LIMIT),
      expectedOutput: truncateText(request.expectedOutput, AGENT_RESULT_PREVIEW_LIMIT),
      resultText: '',
      error: '',
      schemaValidated: false,
    }
    state.agents.push(record)
    ensurePhase(record.phase)
    emitProgress()
    return new Promise((resolve) => {
      queue.push({ kind: 'agent', request, record, resolve })
      drainQueue()
    })
  }

  function enqueueTool(message) {
    const request = normalizeToolRequest(message, runId)
    if (settled) return Promise.resolve({ ok: false, aborted: true, error: 'Workflow is not running.' })
    if (!request.name) return Promise.resolve({ ok: false, error: 'tool name is required' })
    if (state.tools.length >= options.maxTools) {
      const error = `Tool budget exhausted (${options.maxTools}); this tool() call was skipped.`
      appendLog(error, 'error', request.phase || currentPhase)
      return Promise.resolve({ ok: false, error })
    }
    const index = state.tools.length + 1
    const record = {
      id: `tool-${index}`,
      index,
      seq: ++state.nextSeq,
      name: request.name,
      label: request.label || request.name,
      args: request.args,
      argsJson: request.argsJson,
      phase: request.phase || currentPhase,
      status: 'queued',
      startedAt: null,
      durationMs: 0,
      resultText: '',
      error: '',
    }
    state.tools.push(record)
    ensurePhase(record.phase)
    emitProgress()
    return new Promise((resolve) => {
      queue.push({ kind: 'tool', request, record, resolve })
      drainQueue()
    })
  }

  function onWorkerMessage(message) {
    if (!message || settled) return
    if (message.type === 'phase') {
      const title = typeof message.title === 'string' ? message.title : ''
      if (!title) return
      currentPhase = title
      ensurePhase(title)
      emitProgress()
      return
    }
    if (message.type === 'log') {
      appendLog(message.message, 'info', typeof message.phase === 'string' ? message.phase : currentPhase)
      emitProgress()
      return
    }
    if (message.type === 'agent') {
      void enqueueAgent(message).then((response) => sendAgentResult(message.requestId, response))
      return
    }
    if (message.type === 'tool') {
      void enqueueTool(message).then((response) => sendAgentResult(message.requestId, response))
      return
    }
    if (message.type === 'done') {
      completeWorkflow(message.result)
      return
    }
    if (message.type === 'error') {
      failWorkflow(`Workflow script failed: ${message.error || 'unknown error'}`)
    }
  }

  function onParentAbort() {
    failWorkflow('Workflow aborted with parent run.', { status: 'aborted', aborted: true })
  }

  if (parentSignal) {
    if (parentSignal.aborted) {
      failWorkflow('Workflow aborted with parent run.', { status: 'aborted', aborted: true })
      return completion
    }
    parentSignal.addEventListener('abort', onParentAbort, { once: true })
  }

  deadlineTimer = setTimeout(() => {
    failWorkflow(`Workflow timed out after ${formatDuration(options.maxRuntimeMs)}.`, { timedOut: true })
  }, options.maxRuntimeMs)
  deadlineTimer.unref?.()

  try {
    worker = new Worker(new URL('./agent-workflow-worker.mjs', import.meta.url), {
      type: 'module',
      workerData: { script, args: workflowArgs },
      // Keep a runaway orchestration script from exhausting the server process.
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64 },
    })
  } catch (error) {
    failWorkflow(`Failed to start workflow worker: ${error?.message || 'unknown error'}`)
    return completion
  }
  worker.on('message', onWorkerMessage)
  worker.on('error', (error) => {
    failWorkflow(`Workflow worker failed: ${error?.message || 'unknown error'}`)
  })
  worker.on('exit', (code) => {
    if (settled) return
    failWorkflow(`Workflow worker exited unexpectedly (code ${code}).`)
  })
  emitProgress(true)
  return completion
}

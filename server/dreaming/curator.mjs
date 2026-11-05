import { Agent } from '@earendil-works/pi-agent-core'
import { streamSimpleWithAiHttpLogging } from '../ai-http-logger.mjs'
import { readStore } from '../storage.mjs'
import { serverConvertToLlm, lastAssistantText } from '../message-converters.mjs'
import { logger } from '../utils/logger.mjs'
import {
  MEMORY_NOTE_TOOL_NAMES,
  memoryNoteTools,
  toolListMemoryNotes,
  toolMoveMemoryNote,
  toolReadMemoryNote,
  toolWriteMemoryNote,
} from '../tools/memory-notes.mjs'
import { CURATOR_SYSTEM_PROMPT, buildCuratorUserPrompt } from './prompt.mjs'

/**
 * One curator turn: a real agent, given one session and the memory folders.
 *
 * This deliberately does not go through `AgentManager`. The manager exists for
 * conversations a human is watching: it persists sessions, generates titles, and
 * asks for approval on writes. A background curator needs the opposite of all
 * three, and `run_subagent` already established that a bare `Agent` with
 * `beforeToolCall` is the supported way to get it. The tools are the four memory
 * tools and nothing else — with no shell, "it can only touch the two folders" is
 * enforced by the tool list rather than by a prompt asking nicely.
 */

export const CURATOR_MAX_TOOL_CALLS = 60
export const CURATOR_TIMEOUT_MS = 10 * 60 * 1000

const CURATOR_HANDLERS = {
  list_memory_notes: toolListMemoryNotes,
  read_memory_note: toolReadMemoryNote,
  write_memory_note: toolWriteMemoryNote,
  move_memory_note: toolMoveMemoryNote,
}

async function getApiKey(provider) {
  const keys = await readStore('provider-keys')
  return keys?.[provider] || undefined
}

/**
 * Turn the shared definitions into Agent tools.
 *
 * `wrapToolDefinition` would do this too, but it needs a project context and a
 * permission callback, neither of which exists in a background run. Wrapping by
 * hand keeps the curator free of the chat wiring.
 */
function buildCuratorTools(record) {
  return memoryNoteTools.map((definition) => ({
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    execute: async (_toolCallId, params) => {
      const handler = CURATOR_HANDLERS[definition.name]
      const result = await handler(params || {})
      record.action(definition.name, params || {}, result.details)
      return {
        content: [{ type: 'text', text: result.content }],
        details: result.details,
      }
    },
  }))
}

/**
 * What the run reports afterwards.
 *
 * Kept as "the tool calls that had an effect" rather than "the diff of the
 * folder": the folders are restored from a snapshot if anything goes wrong, so
 * this is for the human reading the run page, not for rollback.
 */
function createRecord() {
  const actions = []
  return {
    actions,
    action(name, params, details) {
      const type = details?.type
      if (type === 'memory_note_written') {
        actions.push({
          kind: 'write',
          scope: details.scope,
          name: details.name,
          title: details.title,
          chars: details.chars,
        })
        return
      }
      if (type === 'memory_note_moved') {
        actions.push({
          kind: details.archived ? 'archive' : 'rename',
          scope: details.scope,
          from: String(params.from ?? ''),
          name: details.name,
        })
      }
    },
  }
}

export function curatorSessionIdFor(runId, sessionId) {
  return `dreaming:${runId}:${sessionId}`
}

/**
 * The curator's only safety gate.
 *
 * Two rules, both enforced here rather than in the prompt: it may use the memory
 * tools and nothing else, and it has a tool-call budget. Exported so the rules can
 * be tested without driving a model: a gate that only works when the model
 * behaves is not a gate.
 */
export function createCuratorToolGuard({ maxToolCalls = CURATOR_MAX_TOOL_CALLS } = {}) {
  const state = { toolCalls: 0, blocked: [] }
  return {
    state,
    beforeToolCall: async (context) => {
      const toolName = context?.toolCall?.name
      if (!MEMORY_NOTE_TOOL_NAMES.includes(toolName)) {
        state.blocked.push({ tool: toolName, reason: 'not_allowed' })
        return { block: true, reason: `The memory curator may only use ${MEMORY_NOTE_TOOL_NAMES.join(', ')}.` }
      }
      state.toolCalls += 1
      if (state.toolCalls > maxToolCalls) {
        state.blocked.push({ tool: toolName, reason: 'over_budget' })
        return { block: true, reason: `Tool-call budget of ${maxToolCalls} exhausted for this session.` }
      }
      // No approval prompt: nobody is awake at 03:00, and the tools cannot reach
      // anything except the two memory folders.
      return undefined
    },
  }
}

/**
 * Run one curator turn and return what it did.
 *
 * Never throws for "the model misbehaved": the caller processes sessions one at
 * a time precisely so that one bad session is a line in the report instead of a
 * failed night. Real infrastructure errors (no API key, aborted run) are also
 * returned, because the caller decides whether to stop the whole run.
 */
export async function runCuratorTurn({
  runId,
  model,
  session,
  transcript,
  periodFrom,
  periodTo,
  contentLanguage = null,
  allowSensitive = true,
  maxToolCalls = CURATOR_MAX_TOOL_CALLS,
  timeoutMs = CURATOR_TIMEOUT_MS,
} = {}) {
  if (!model) return { ok: false, error: '未配置任何模型' }
  const record = createRecord()
  const startedAt = Date.now()
  const sessionId = curatorSessionIdFor(runId, session.sessionId)
  const guard = createCuratorToolGuard({ maxToolCalls })

  const agent = new Agent({
    initialState: {
      systemPrompt: CURATOR_SYSTEM_PROMPT,
      model,
      messages: [],
      tools: buildCuratorTools(record),
    },
    streamFn: (streamModel, streamContext, streamOptions) => streamSimpleWithAiHttpLogging(
      streamModel,
      streamContext,
      {
        ...streamOptions,
        metadata: { ...(streamOptions?.metadata || {}), quickforgePurpose: 'dreaming' },
      },
    ),
    getApiKey,
    sessionId,
    convertToLlm: serverConvertToLlm,
    beforeToolCall: guard.beforeToolCall,
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      agent.abort()
    } catch {
      // Aborting an already-finished run is not an error.
    }
  }, timeoutMs)
  timer.unref?.()

  try {
    await agent.prompt({
      role: 'user',
      content: [{
        type: 'text',
        text: buildCuratorUserPrompt({
          session,
          transcript,
          periodFrom,
          periodTo,
          contentLanguage,
          allowSensitive,
        }),
      }],
      timestamp: Date.now(),
    })
    const reply = lastAssistantText(agent.state.messages) || ''
    return {
      ok: true,
      sessionId: session.sessionId,
      agentSessionId: sessionId,
      reply: reply.slice(0, 4000),
      toolCalls: guard.state.toolCalls,
      blockedCalls: guard.state.blocked,
      actions: record.actions,
      counts: {
        written: record.actions.filter((action) => action.kind === 'write' && action.scope === 'working').length,
        experiences: record.actions.filter((action) => action.scope === 'experience').length,
        archived: record.actions.filter((action) => action.kind === 'archive').length,
      },
      timedOut,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Dreaming curator turn failed:', message)
    return {
      ok: false,
      sessionId: session.sessionId,
      agentSessionId: sessionId,
      error: timedOut ? `单会话处理超时（>${Math.round(timeoutMs / 60000)} 分钟）` : message,
      toolCalls: guard.state.toolCalls,
      blockedCalls: guard.state.blocked,
      actions: record.actions,
      timedOut,
      durationMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timer)
  }
}

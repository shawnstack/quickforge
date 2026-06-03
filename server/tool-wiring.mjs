/**
 * Tool definition wrapping and execution wiring.
 *
 * Wraps raw tool definitions with execution handlers that inject
 * timing metadata, permission checks, and context.
 */

import { toolHandlers } from './tools/index.mjs'
import { callMcpTool } from './mcp/registry.mjs'
import { callPluginTool } from './plugins/registry.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function mergeQuickForgeTiming(details, timing) {
  if (!isPlainObject(details)) return { quickforgeTiming: timing }
  return { ...details, quickforgeTiming: timing }
}

// ---------------------------------------------------------------------------
// Tool wrappers
// ---------------------------------------------------------------------------

export function wrapToolDefinition(definition, context, toolPermissions) {
  const handler = toolHandlers[definition.name]
  if (!handler) throw new Error(`Missing handler for tool: ${definition.name}`)
  return {
    ...definition,
    execute: async (_toolCallId, params, signal, onUpdate) => {
      if (toolPermissions) {
        const permissionError = toolPermissions(definition.name)
        if (permissionError) throw new Error(permissionError)
      }

      const startedAt = Date.now()
      const startedAtPerf = performance.now()
      const result = await handler(params || {}, context, { signal, onUpdate, toolCallId: _toolCallId })
      const finishedAt = Date.now()
      const durationMs = Math.max(0, Math.round(performance.now() - startedAtPerf))
      const details = mergeQuickForgeTiming(result.details, { startedAt, finishedAt, durationMs })
      return {
        content: [{ type: 'text', text: result.content }],
        details: isPlainObject(details) ? { ...details, toolCallId: _toolCallId } : details,
      }
    },
  }
}

export function wrapMcpToolDefinition(definition, toolPermissions) {
  return {
    ...definition,
    execute: async (_toolCallId, params) => {
      if (toolPermissions) {
        const permissionError = toolPermissions(definition.name)
        if (permissionError) throw new Error(permissionError)
      }

      const startedAt = Date.now()
      const startedAtPerf = performance.now()
      const result = await callMcpTool(definition.name, params || {})
      const finishedAt = Date.now()
      const durationMs = Math.max(0, Math.round(performance.now() - startedAtPerf))
      if (result.isError) {
        throw new Error(result.content || `MCP tool failed: ${definition.name}`)
      }
      return {
        content: [{ type: 'text', text: result.content }],
        details: mergeQuickForgeTiming(result.details, { startedAt, finishedAt, durationMs }),
      }
    },
  }
}

export function wrapPluginToolDefinition(definition, context, toolPermissions) {
  return {
    ...definition,
    execute: async (_toolCallId, params, signal, onUpdate) => {
      if (toolPermissions) {
        const permissionError = toolPermissions(definition.name)
        if (permissionError) throw new Error(permissionError)
      }

      const startedAt = Date.now()
      const startedAtPerf = performance.now()
      const result = await callPluginTool(definition.name, params || {}, { ...context, signal, onUpdate, toolCallId: _toolCallId })
      const finishedAt = Date.now()
      const durationMs = Math.max(0, Math.round(performance.now() - startedAtPerf))
      if (result.isError) {
        throw new Error(result.content || `Plugin tool failed: ${definition.name}`)
      }
      return {
        content: [{ type: 'text', text: result.content }],
        details: mergeQuickForgeTiming(result.details, { startedAt, finishedAt, durationMs }),
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Skill context
// ---------------------------------------------------------------------------

export function sessionSkillsContext(session) {
  return {
    globalSkillNames: session.globalSkillNames,
    projectSkillNames: session.projectSkillNames,
  }
}

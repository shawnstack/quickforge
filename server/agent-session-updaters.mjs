// agent-manager 模块拆分（god-module-decomposition ⑤）会话 setter 组：
// updateSessionTitle / updateSessionAccessMode / updateSessionYoloMode /
// updateSessionModel / updateSessionThinkingLevel 与模型/工具全量刷新
// （refreshAllSessionModels / refreshAllSessionTools 及 MCP 工具集变化
// 订阅接线）从 agent-manager.mjs 逐字搬移至此；全部为公共 API 经
// agent-manager.mjs facade re-export，行为与注释语义不变。

import { agentSessions } from './agent-session-store.mjs'
import { restoreAgent, refreshSessionModelBinding } from './agent-session-lifecycle.mjs'
import { rebuildSessionTools } from './agent-tool-assembly.mjs'
import { persistSession } from './agent-persistence.mjs'
import { emitSessionEvent } from './agent-session-events.mjs'
import {
  AGENT_ACCESS_MODE_DEFAULT,
  AGENT_ACCESS_MODE_FULL_ACCESS,
  normalizeAccessMode,
  yoloModeFromAccessMode,
} from './agent-access-mode.mjs'
import { subscribeMcpToolsetChanged } from './mcp/registry.mjs'
// getSessionState 是 agent-manager.mjs 里唯一的查询工厂实例（组合根），
// 这里经 facade 取同一实例，避免第二份闭包状态。
import { getSessionState } from './agent-manager.mjs'
import { logger } from './utils/logger.mjs'

export async function updateSessionTitle(sessionId, title) {
  let session = agentSessions.get(sessionId)
  if (!session) session = await restoreAgent(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  const normalizedTitle = typeof title === 'string' ? title.trim() : ''
  if (!normalizedTitle) {
    throw Object.assign(new Error('Title must not be empty'), { statusCode: 400 })
  }
  if (normalizedTitle.length > 200) {
    throw Object.assign(new Error('Title is too long'), { statusCode: 400 })
  }

  session.titleGenerationId += 1
  session.title = normalizedTitle
  session.titleSource = 'manual'
  await persistSession(session)
  emitSessionEvent(session, { type: 'title_updated', title: normalizedTitle, titleSource: 'manual' })
  return { sessionId, title: normalizedTitle, titleSource: 'manual' }
}

export async function updateSessionAccessMode(sessionId, accessMode) {
  let session = agentSessions.get(sessionId)
  if (!session) session = await restoreAgent(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  session.accessMode = normalizeAccessMode(accessMode, session.accessMode)
  session.yoloMode = yoloModeFromAccessMode(session.accessMode)
  await rebuildSessionTools(session)
  await persistSession(session)

  const state = getSessionState(sessionId)
  emitSessionEvent(session, { type: 'state', ...state })

  return { sessionId, accessMode: session.accessMode, yoloMode: session.yoloMode }
}

export async function updateSessionYoloMode(sessionId, yoloMode) {
  return updateSessionAccessMode(sessionId, yoloMode ? AGENT_ACCESS_MODE_FULL_ACCESS : AGENT_ACCESS_MODE_DEFAULT)
}

/**
 * Update the model for an existing session.
 * Syncs the model to both the session record (for persistence) and the agent state (for API calls).
 * Does NOT force persistence — normal lifecycle events (message_end, agent_end) will persist
 * the updated model.
 */
export async function updateSessionModel(sessionId, model, modelRef = null) {
  let session = agentSessions.get(sessionId)
  if (!session) session = await restoreAgent(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (!model) {
    throw Object.assign(new Error('Missing model'), { statusCode: 400 })
  }

  session.model = model
  session.modelRef = modelRef
  session.resolvePersistedModel = true
  session.agent.state.model = model

  return { sessionId, model, modelRef: modelRef || undefined }
}

/**
 * Update the thinking level for an existing session.
 */
export async function updateSessionThinkingLevel(sessionId, thinkingLevel) {
  let session = agentSessions.get(sessionId)
  if (!session) session = await restoreAgent(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (!thinkingLevel) {
    throw Object.assign(new Error('Missing thinkingLevel'), { statusCode: 400 })
  }

  session.thinkingLevel = thinkingLevel
  session.agent.state.thinkingLevel = thinkingLevel

  return { sessionId, thinkingLevel }
}

export async function refreshAllSessionTools() {
  const result = []
  for (const [sessionId, session] of agentSessions) {
    try {
      await rebuildSessionTools(session)
      const state = getSessionState(sessionId)
      emitSessionEvent(session, { type: 'state', ...state })
      result.push({ sessionId, ok: true, toolCount: session.agent.state.tools?.length || 0 })
    } catch (error) {
      logger.error(`Failed to refresh tools for session ${sessionId}:`, error, { sessionId })
      result.push({ sessionId, ok: false, error: error?.message || 'Failed to refresh tools' })
    }
  }
  return result
}

// MCP toolset changes (background reconnects, startup warmup) rebuild tools
// for all active sessions so restored sessions that took a cached MCP tool
// snapshot converge without ever blocking POST /restore. refreshAllSessionTools
// rebuilds via the default await path — with servers already connected it only
// reuses connections, and an unchanged toolset signature does not notify
// again, so this never loops. registry.mjs never imports agent-manager.mjs
// (no circular dependency).
subscribeMcpToolsetChanged(() => {
  if (agentSessions.size === 0) return
  refreshAllSessionTools().catch((error) => {
    logger.warn(`Failed to refresh session tools after MCP toolset change: ${error?.message || error}`)
  })
})

/**
 * Refresh the model binding of every active session after model
 * configuration changes (custom providers, maxTokens, ...). Streaming sessions
 * are skipped (runPrompt re-resolves the binding on the next message). Only
 * sessions whose model actually changed get a state event.
 */
export async function refreshAllSessionModels() {
  for (const [sessionId, session] of agentSessions) {
    if (session.agent?.state?.isStreaming) continue
    try {
      const before = JSON.stringify(session.model ?? null)
      await refreshSessionModelBinding(session)
      const after = JSON.stringify(session.model ?? null)
      if (before === after) continue
      const state = getSessionState(sessionId)
      emitSessionEvent(session, { type: 'state', ...state })
    } catch (error) {
      // The model may have been deleted (model_not_configured); runPrompt will
      // surface the same error on the next message. Log and keep other
      // sessions refreshing.
      logger.error(`Failed to refresh model for session ${sessionId}:`, error, { sessionId })
    }
  }
}

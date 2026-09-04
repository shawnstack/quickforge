// agent-manager 模块拆分（agent-manager-module-split）：会话压缩/摘要/清空业务
// （/summary、/compact、/clear）从 agent-manager.mjs 逐字符搬移至此；
// agent-manager.mjs 继续作为 facade，公共行为与注释语义保持不变。

import { randomUUID } from 'node:crypto'
import { AGENT_HARNESS_OPENCODE } from './agent-harness.mjs'
import {
  assistantTextMessage,
  userTextMessage,
  compactedSessionTitle,
  estimateTokenReduction,
  emitSessionEvent,
  updateSessionMessages,
  getSessionContextUsage,
} from './agent-session-events.mjs'
import {
  compactConversation,
  compactionMessageDetails,
  parseCompactArgs,
  saveCompactBackup,
} from './conversation-compaction.mjs'
import {
  compactSessionInPlace,
  DEFAULT_AUTO_COMPACT_SETTINGS,
  readAutoCompactSettings,
} from './auto-compaction.mjs'
import { generateAiTitle } from './session-utils.mjs'
// createAgent/persistSession/resetIdleTimer 属会话生命周期编排，仍由 agent-manager.mjs
// 提供（函数作用域引用，ESM live binding 安全）。
import { createAgent, resetIdleTimer } from './agent-manager.mjs'
import { persistSession } from './agent-persistence.mjs'

export function resetSessionCompaction(session) {
  session.contextCompaction = null
  session.lastAutoCompactAt = null
  session.lastAutoCompactRejected = null
  session.lastTransformedContextMessages = null
  session.autoCompacting = false
}

function finishManualSessionRun(session, status, errorMessage) {
  session.status = status
  session.finishedAt = new Date().toISOString()
  session.agent.state.isStreaming = false
  session.agent.state.streamingMessage = undefined
  session.agent.state.errorMessage = errorMessage
}

export async function summarySession(session, initialUserMessage, summaryOptions) {
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('OpenCode Harness does not support QuickForge summary derivation yet.'), { statusCode: 409 })
  }
  if (session.agent.state.isStreaming) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      initialUserMessage,
      assistantTextMessage('Cannot summarize while a generation is still running. Stop it or wait until it finishes, then run /summary again.', session.model),
    ]
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'agent_end', messages })
    return { sessionId: session.sessionId, status: session.status }
  }

  const sourceStatus = session.status
  const sourceStartedAt = session.startedAt
  const sourceFinishedAt = session.finishedAt
  const sourceErrorMessage = session.agent.state.errorMessage

  resetIdleTimer(session)
  session.status = 'running'
  session.startedAt = session.startedAt ?? new Date().toISOString()
  session.finishedAt = null
  session.agent.state.isStreaming = true
  session.agent.state.errorMessage = undefined
  emitSessionEvent(session, { type: 'agent_start' })

  try {
    const originalMessages = session.agent.state.messages.slice()
    const options = parseCompactArgs(summaryOptions?.args || '')

    if (options.unsupported?.length) {
      session.agent.state.messages = [
        ...originalMessages,
        initialUserMessage,
        assistantTextMessage(`Unsupported /summary option(s): ${options.unsupported.join(', ')}\n\nSupported usage: /summary or /summary keep=0`, session.model),
      ]
      finishManualSessionRun(session, 'idle')
      await persistSession(session)
      const messages = session.agent.state.messages
      emitSessionEvent(session, { type: 'message_end', messages })
      emitSessionEvent(session, { type: 'agent_end', messages })
      return { sessionId: session.sessionId, status: session.status }
    }

    const result = await compactConversation({
      messages: originalMessages,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      getApiKey: session.getApiKey,
      keepTurns: options.keepTurns,
    })

    if (result.skipped) {
      session.agent.state.messages = [
        ...originalMessages,
        initialUserMessage,
        assistantTextMessage('Not enough earlier history to summarize. Continue chatting and run /summary again later.', session.model),
      ]
      finishManualSessionRun(session, 'idle')
      await persistSession(session)
      const messages = session.agent.state.messages
      emitSessionEvent(session, { type: 'message_end', messages })
      emitSessionEvent(session, { type: 'agent_end', messages })
      return { sessionId: session.sessionId, status: session.status }
    }

    await saveCompactBackup(session.sessionId, originalMessages)

    const reduction = estimateTokenReduction(result.originalApproxChars, result.finalApproxChars)
    const summaryMessage = userTextMessage([
      'The previous conversation has been compacted. Treat the following summary as the authoritative replacement for earlier history. If information is missing, ask for clarification instead of guessing.',
      '',
      '<compact_summary>',
      result.summary,
      '</compact_summary>',
    ].join('\n'), compactionMessageDetails('summary'))
    const notice = assistantTextMessage([
      `已基于当前对话创建压缩后的新对话：原 ${result.originalCount} 条消息 → ${result.recentTail.length + 2} 条消息。`,
      `当前原对话已完整保留，保留最近 ${result.keepTurns} 个用户回合原文，估算新对话上下文减少约 ${reduction}%。`,
      '压缩前历史已保存到本地备份。',
    ].join('\n'), session.model, compactionMessageDetails('notice'))

    const compactedMessages = [summaryMessage, notice, ...result.recentTail]
    const titleSourceMessages = [summaryMessage, ...result.recentTail]
    const aiTitle = await generateAiTitle(titleSourceMessages, session.model, session.thinkingLevel, session.getApiKey)
    const compactedTitle = aiTitle && aiTitle !== 'New chat'
      ? aiTitle
      : compactedSessionTitle(session.title)
    const compactedSessionId = randomUUID()
    const compactedSession = await createAgent(compactedSessionId, {
      scope: session.scope,
      projectId: session.projectId,
      accessMode: session.accessMode,
      harness: session.harness,
      sourceHarnessSessionId: session.harness === AGENT_HARNESS_OPENCODE ? session.agent.harnessSessionId : null,
      yoloMode: session.yoloMode,
      model: session.model,
      modelRef: session.modelRef,
      modelAccessContext: session.modelAccessContext,
      resolvePersistedModel: true,
      thinkingLevel: session.thinkingLevel,
      messages: compactedMessages,
      title: compactedTitle,
      createdAt: new Date().toISOString(),
    })
    updateSessionMessages(compactedSession, compactedMessages)
    await persistSession(compactedSession)

    session.status = sourceStatus
    session.startedAt = sourceStartedAt
    session.finishedAt = sourceFinishedAt
    session.agent.state.isStreaming = false
    session.agent.state.streamingMessage = undefined
    session.agent.state.errorMessage = sourceErrorMessage
    await persistSession(session)

    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'agent_end', messages })
    emitSessionEvent(session, {
      type: 'session_forked',
      sourceSessionId: session.sessionId,
      targetSessionId: compactedSessionId,
      title: compactedSession.title,
      createdAt: compactedSession.createdAt,
      scope: compactedSession.scope,
      projectId: compactedSession.projectId,
      messages: compactedSession.agent.state.messages,
    })
    emitSessionEvent(compactedSession, { type: 'message_end', messages: compactedSession.agent.state.messages })
    emitSessionEvent(compactedSession, { type: 'agent_end', messages: compactedSession.agent.state.messages })
    return { sessionId: session.sessionId, status: session.status, compactedSessionId }
  } catch (err) {
    const errorMessage = err?.message || 'Conversation compaction failed'
    session.agent.state.messages = [
      ...session.agent.state.messages,
      initialUserMessage,
      assistantTextMessage(`Conversation compaction failed: ${errorMessage}`, session.model),
    ]
    finishManualSessionRun(session, 'error', errorMessage)
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'error', error: errorMessage })
    emitSessionEvent(session, { type: 'agent_end', messages, errorMessage })
    return { sessionId: session.sessionId, status: session.status }
  }
}

export async function compactSession(session, initialUserMessage, compactOptions) {
  if (session.agent.state.isStreaming) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      initialUserMessage,
      assistantTextMessage('Cannot compact while a generation is still running. Stop it or wait until it finishes, then run /compact again.', session.model),
    ]
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'agent_end', messages })
    return { sessionId: session.sessionId, status: session.status }
  }

  const args = String(compactOptions?.args || '').trim()
  if (args) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      initialUserMessage,
      assistantTextMessage('Unsupported /compact option(s). Supported usage: /compact', session.model),
    ]
    session.status = 'idle'
    session.finishedAt = new Date().toISOString()
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'agent_end', messages })
    return { sessionId: session.sessionId, status: session.status }
  }

  resetIdleTimer(session)
  session.status = 'running'
  session.startedAt = session.startedAt ?? new Date().toISOString()
  session.finishedAt = null
  session.agent.state.isStreaming = true
  session.agent.state.errorMessage = undefined
  emitSessionEvent(session, { type: 'agent_start' })

  try {
    const messages = session.agent.state.messages.slice()
    const settings = await readAutoCompactSettings().catch(() => DEFAULT_AUTO_COMPACT_SETTINGS)
    const usage = getSessionContextUsage(session)
    const result = await compactSessionInPlace({
      session,
      messages,
      keepRecentTurns: 0,
      minSourceChars: 0,
      usage,
      thresholdPercent: settings.thresholdPercent,
      emitSessionEvent,
      persistSession,
      reason: 'manual_compact',
      onBeforePersist: () => {
        finishManualSessionRun(session, 'idle')
      },
    })

    if (!result.compacted) {
      session.agent.state.messages = [
        ...messages,
        initialUserMessage,
        assistantTextMessage('Not enough earlier history to compact. Continue chatting and run /compact again later.', session.model),
      ]
      finishManualSessionRun(session, 'idle')
      await persistSession(session)
      const nextMessages = session.agent.state.messages
      emitSessionEvent(session, { type: 'message_end', messages: nextMessages })
      emitSessionEvent(session, { type: 'agent_end', messages: nextMessages })
      return { sessionId: session.sessionId, status: session.status }
    }

    const nextMessages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages: nextMessages })
    emitSessionEvent(session, { type: 'agent_end', messages: nextMessages })
    return { sessionId: session.sessionId, status: session.status }
  } catch (err) {
    const errorMessage = err?.message || 'Conversation compaction failed'
    session.agent.state.messages = [
      ...session.agent.state.messages,
      initialUserMessage,
      assistantTextMessage(`Conversation compaction failed: ${errorMessage}`, session.model),
    ]
    finishManualSessionRun(session, 'error', errorMessage)
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'error', error: errorMessage })
    emitSessionEvent(session, { type: 'agent_end', messages, errorMessage })
    return { sessionId: session.sessionId, status: session.status }
  }
}

export async function clearSession(session) {
  if (session.agent.state.isStreaming) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      assistantTextMessage('Cannot clear while a generation is still running. Stop it or wait until it finishes, then run /clear again.', session.model),
    ]
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'agent_end', messages })
    return { sessionId: session.sessionId, status: session.status }
  }

  updateSessionMessages(session, [])
  resetSessionCompaction(session)
  session.status = 'idle'
  session.startedAt = null
  session.finishedAt = new Date().toISOString()
  session.title = 'New chat'
  session.titleSource = 'default'
  session.titleGenerationId += 1
  session.agent.state.isStreaming = false
  session.agent.state.streamingMessage = undefined
  session.agent.state.errorMessage = undefined

  await persistSession(session)
  const messages = session.agent.state.messages
  emitSessionEvent(session, { type: 'message_end', messages })
  emitSessionEvent(session, { type: 'agent_end', messages })
  emitSessionEvent(session, { type: 'title_updated', title: session.title })
  return { sessionId: session.sessionId, status: session.status, cleared: true }
}

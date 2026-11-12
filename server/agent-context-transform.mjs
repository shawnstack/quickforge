// agent-manager 模块拆分（god-module-decomposition ⑤）上下文压缩接线：
// 模型请求前的上下文变换（自动压缩触发与跳过日志、压缩摘要切片、
// 命令/能力/瞬态提示改写最后一条 user 消息）从 agent-manager.mjs 逐字
// 搬移至此；transformSessionContext 由 createAgent 作为 transformContext
// 注入，对外行为与注释语义不变。

import { isCompactSummaryMessage } from './conversation-compaction.mjs'
import {
  buildAutoCompactLoopMessages,
  maybeAutoCompactSession,
} from './auto-compaction.mjs'
import { emitSessionEvent } from './agent-session-events.mjs'
import { persistSession } from './agent-persistence.mjs'
import { logger } from './utils/logger.mjs'

function applyActiveCommandPrompt(messages, commandPrompt) {
  if (!commandPrompt) return messages

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'user' && message?.role !== 'user-with-attachments') continue

    const transformed = messages.slice()
    transformed[index] = {
      ...message,
      content: commandPrompt,
    }
    return transformed
  }

  return messages
}

function textFromMessageContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join('\n')
  }
  return ''
}

function applyActiveCapabilityPrompt(messages, capabilityPrompt) {
  if (!capabilityPrompt) return messages

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'user' && message?.role !== 'user-with-attachments') continue

    const visibleText = textFromMessageContent(message.content)
    const transformed = messages.slice()
    transformed[index] = {
      ...message,
      content: `${capabilityPrompt}\n\nUser request:\n${visibleText}`,
    }
    return transformed
  }

  return messages
}

function activeTurnContextPrompt(session) {
  return [session?.activeTransientContextPrompt, session?.activeCapabilityPrompt]
    .filter((prompt) => typeof prompt === 'string' && prompt.trim())
    .join('\n\n') || null
}

function compactSummaryIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (isCompactSummaryMessage(messages[index])) return index
  }
  return -1
}

function compactedContextMessages(messages) {
  const index = compactSummaryIndex(messages)
  return index >= 0 ? messages.slice(index) : messages
}

export async function transformSessionContext(session, messages, signal) {
  const autoCompactResult = await maybeAutoCompactSession({
    session,
    messages,
    signal,
    emitSessionEvent,
    persistSession,
    logger,
  })
  if (!autoCompactResult.compacted && autoCompactResult.usage && autoCompactResult.reason) {
    const reason = autoCompactResult.reason
    if (reason === 'unknown_usage') {
      // 每次模型请求前都会命中这里（没有可用用量时自动压缩不会发生），
      // 只提示一次，否则一轮对话里每次工具调用都会刷一条。
      if (!session._unknownUsageWarningLogged) {
        session._unknownUsageWarningLogged = true
        logger.warn(`Auto compact cannot measure context: no usable provider usage for session ${session.sessionId}; auto compaction stays off until usage arrives`, {
          sessionId: session.sessionId,
          reason,
        })
      }
    } else if (reason !== 'below_threshold') {
      logger.info(`Auto compact skipped for session ${session.sessionId}: ${reason}`, {
        sessionId: session.sessionId,
        reason,
        usage: autoCompactResult.usage,
      })
    }
  }
  const transformedMessages = buildAutoCompactLoopMessages(session, messages)
  session.lastTransformedContextMessages = transformedMessages
  return applyActiveCapabilityPrompt(
    applyActiveCommandPrompt(compactedContextMessages(transformedMessages), session?.activeCommandPrompt),
    activeTurnContextPrompt(session),
  )
}

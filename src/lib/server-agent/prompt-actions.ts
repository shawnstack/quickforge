import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { withSelectedCapabilitiesSnapshot } from '@/lib/selected-capabilities'
import { selectedCapabilitiesFromDetails } from '@/lib/selected-capabilities'
import { logger } from '@/lib/logger'
import type { FileContextReference } from '../server-agent-types'
import type { ServerAgentCore } from './core'
import { appendAssistantErrorMessageOnce, serverErrorMessage, type ServerErrorPayload } from './errors'

/**
 * 发送一条用户消息（原 `ServerAgent.prompt`，逐字迁出）。
 *
 * 返回值是「这条消息到底有没有交给服务端」的唯一权威信号：
 * - `true`：请求已被服务端接受（HTTP 2xx），消息进入本轮。
 * - `false`：**没有发出去**（已销毁 / 没有写租约 / 已在流式 / HTTP 失败）。
 *   调用方（排队消息、后台续发）必须保留这条消息，绝不能因为
 *   「promise 没有 reject」就当成发送成功。
 */
export async function serverAgentPrompt(
  core: ServerAgentCore,
  input: string | AgentMessage | AgentMessage[],
  options?: { messageAlreadyInState?: boolean },
): Promise<boolean> {
  if (core.disposed) return false

  if (!core.canWrite()) {
    // Another window holds the write lease. The server would reject the
    // request anyway (SESSION_LEASE_HELD); failing here keeps the optimistic
    // user message out of the transcript.
    logger.warn('Ignored prompt while another window holds the session lease')
    return false
  }

  if (core.state.isStreaming) {
    logger.warn('Ignored prompt while agent is already streaming')
    return false
  }

  // Normalize input to a message
  let message: Record<string, unknown>
  if (typeof input === 'string') {
    message = { role: 'user', content: input, timestamp: Date.now() }
  } else if (Array.isArray(input)) {
    const lastUser = [...input].reverse().find(
      (m: AgentMessage) => m.role === 'user' || m.role === 'user-with-attachments',
    )
    message = (lastUser ?? input[input.length - 1]) as unknown as Record<string, unknown>
  } else {
    message = input as unknown as Record<string, unknown>
  }

  const { selectedCapabilities, contextReferences, selectedCommand } = core.consumePromptStash()

  // 交接消息：Deferred 会话把乐观消息原样交给了真实 agent，引用相等才复用；
  // 其它任何情况（字符串输入、提前创建的真实 agent）都按新消息处理。
  const handedOffMessage = options?.messageAlreadyInState === true
    ? core.state.messages[core.state.messages.length - 1]
    : undefined
  const reusesExistingMessage = handedOffMessage !== undefined
    && handedOffMessage === (message as unknown as AgentMessage)

  const msgCountBeforeOptimistic = reusesExistingMessage
    ? core.state.messages.length - 1
    : core.state.messages.length

  let agentMessage: AgentMessage
  if (reusesExistingMessage) {
    agentMessage = handedOffMessage
  } else {
    // Add to local state immediately for optimistic UI.
    const optimisticDetailsMessage = withSelectedCapabilitiesSnapshot(message, selectedCapabilities)
    agentMessage = (contextReferences.length > 0
      ? {
          ...optimisticDetailsMessage,
          details: {
            ...(optimisticDetailsMessage.details && typeof optimisticDetailsMessage.details === 'object' && !Array.isArray(optimisticDetailsMessage.details) ? optimisticDetailsMessage.details : {}),
            contextReferences,
          },
        }
      : optimisticDetailsMessage) as unknown as AgentMessage
    core.state.messages = [...core.state.messages, agentMessage]
  }
  core.state.contextUsage = null
  core.emitToListeners({ type: 'message_start', message: agentMessage })

  if (!core.state.isStreaming) {
    // 本地乐观 + 未确认标记：服务端确认本轮开跑之前，任何「结束」都不属于它。
    core.pendingPrompt = true
    core.state.isStreaming = true
    core.state.errorMessage = undefined
    core.emitToListeners({ type: 'agent_start' })
  }

  // Send to server (with timeout to avoid hanging indefinitely)
  const PROMPT_TIMEOUT_MS = 30_000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS)
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/prompt`
  core.startStateWatchdog()
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...core.writeHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ message: agentMessage, selectedCapabilities, contextReferences, command: selectedCommand }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as ServerErrorPayload | null
      throw new Error(serverErrorMessage(payload, `Failed to send prompt: HTTP ${response.status}`))
    }
    // 服务端已接受（2xx）：这是「发出去了」的唯一依据。
    return true
  } catch (err) {
    clearTimeout(timeoutId)
    const errorText = err instanceof Error ? err.message : String(err)
    logger.error('Failed to send prompt:', err)
    // Roll back the optimistic message so the UI doesn't show a message
    // that was never received by the server.
    if (core.state.messages.length === msgCountBeforeOptimistic + 1 && core.state.messages[core.state.messages.length - 1] === agentMessage) {
      core.state.messages = core.state.messages.slice(0, -1)
    }
    core.state.messages = appendAssistantErrorMessageOnce(core.state.messages, errorText, core.state.model, agentMessage)
    core.state.errorMessage = errorText
    // 本地已知失败：这是本地结算的事实，不受「未确认回合」规则限制。
    core.pendingPrompt = false
    core.applyServerStreaming(false)
    core.state.streamingMessage = undefined
    core.stopStateWatchdog()
    core.emitToListeners({ type: 'error', error: errorText })
    core.emitToListeners({
      type: 'agent_end',
      messages: core.state.messages,
      errorMessage: errorText,
      status: 'error',
    })
    return false
  }
}

/**
 * 重试一条「发送失败」的错误消息（prompt HTTP 失败时乐观 user 消息已回滚，
 * 错误消息上挂有原始 quickforgeFailedPrompt）。移除该错误消息后原样重发；
 * 重发前把 stash 里的 capabilities/contextReferences 预置回 nextPrompt*，
 * 否则 prompt 的空快照逻辑会把它们从消息 details 中剥掉。
 */
export async function retryFailedPrompt(core: ServerAgentCore, errorEntry: AgentMessage): Promise<boolean> {
  if (core.disposed || core.state.isStreaming) return false
  const failedPrompt = (errorEntry as unknown as Record<string, unknown>).quickforgeFailedPrompt as AgentMessage | undefined
  if (!failedPrompt) return false
  const details = (failedPrompt as unknown as { details?: unknown }).details
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const capabilities = selectedCapabilitiesFromDetails(details)
    if (capabilities.length > 0) core.setNextPromptCapabilities(capabilities)
    const references = (details as Record<string, unknown>).contextReferences
    if (Array.isArray(references) && references.length > 0) {
      core.setNextPromptContextReferences(references as FileContextReference[])
    }
  }
  const messages = core.state.messages
  const index = messages.lastIndexOf(errorEntry)
  if (index >= 0 && index === messages.length - 1) {
    core.state.messages = messages.slice(0, index)
  }
  return await core.prompt(failedPrompt)
}

export function abortAgentRun(core: ServerAgentCore): void {
  if (!core.canWrite()) return
  // 用户主动停止是本地明确的结束意图：随后的 agent_end 属于本轮，照常采纳。
  core.pendingPrompt = false
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/abort`
  // The abort route is guarded by assertSessionWriteAccess, so it must carry
  // the lease owner header like every other write entry; without it the
  // server sees an anonymous client and answers 409 SESSION_LEASE_HELD,
  // silently leaving the run alive.
  fetch(url, { method: 'POST', headers: core.writeHeaders() })
    .then((response) => {
      if (!response.ok) {
        logger.warn('Abort request rejected:', { status: response.status })
      }
    })
    .catch((err) => {
      logger.error('Failed to abort:', err)
    })
}

/**
 * Queue a steering message and show it in the conversation immediately.
 * The server injects the message at the next tool-round boundary and echoes
 * the identical message (same role+timestamp) via message_end, which
 * upsertMessage reconciles with this optimistic copy in place.
 */
export async function steerAgentMessage(core: ServerAgentCore, message: AgentMessage): Promise<boolean> {
  // 与 prompt 同一契约：false = 没有交给服务端，调用方必须保留这条消息
  // （排队消息的「立即」按钮就靠这个判断，不能把没发出去的消息删掉）。
  if (core.disposed || !core.canWrite()) return false
  core.state.messages = [...core.state.messages, message]
  core.emitToListeners({ type: 'message_start', message })
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/steer`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...core.writeHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    if (!response.ok) {
      throw new Error(`Failed to steer: HTTP ${response.status}`)
    }
    return true
  } catch (err) {
    logger.error('Failed to send steer:', err)
    // Roll back the optimistic copy so the UI never shows a message the
    // server never accepted.
    const index = core.state.messages.indexOf(message)
    if (index >= 0) {
      core.state.messages = [...core.state.messages.slice(0, index), ...core.state.messages.slice(index + 1)]
      core.emitToListeners({ type: 'message_start' })
    }
    throw err
  }
}

export function followUpAgentMessage(core: ServerAgentCore, message: AgentMessage): void {
  if (!core.canWrite()) return
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/follow-up`
  fetch(url, {
    method: 'POST',
    headers: { ...core.writeHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  }).catch((err) => {
    logger.error('Failed to send follow-up:', err)
  })
}

/**
 * Continue generation from the current last message (retry / regenerate).
 * The last message must be a user or tool-result message.
 *
 * Passing `appendMessage` retries by appending that user message instead of
 * trimming the failed turn, so tool calls the failed turn already completed
 * stay in the model transcript. The optimistic copy is reconciled in place by
 * `upsertMessage` via role+timestamp, exactly like `steer()`.
 */
export async function continueAgentRun(core: ServerAgentCore, appendMessage?: AgentMessage): Promise<void> {
  // Retry is a write entry like every other one: a non-owner tab must not
  // optimistically append the "continue" message only to have it rejected.
  if (!core.canWrite()) throw new Error('Another window is writing to this session')
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/continue`
  const optimistic: AgentMessage | undefined = appendMessage
  if (optimistic) {
    core.state.messages = [...core.state.messages, optimistic]
    core.emitToListeners({ type: 'message_start', message: optimistic })
  }
  try {
    // The continue route is guarded by assertSessionWriteAccess, so the lease
    // owner header must be sent on *both* retry shapes. Without it the server
    // sees an anonymous client and answers 409 SESSION_LEASE_HELD even though
    // this tab owns the lease — the "retry always fails, this session is open
    // for writing in another window" false alarm.
    const res = await fetch(url, {
      method: 'POST',
      headers: optimistic
        ? { ...core.writeHeaders(), 'content-type': 'application/json' }
        : core.writeHeaders(),
      ...(optimistic ? { body: JSON.stringify({ message: optimistic }) } : {}),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as ServerErrorPayload | null
      throw new Error(serverErrorMessage(payload, `Failed to continue: HTTP ${res.status}`))
    }
  } catch (error) {
    // Roll back the optimistic copy so the UI never shows a message the
    // server never accepted.
    if (optimistic) {
      const index = core.state.messages.indexOf(optimistic)
      if (index >= 0) {
        core.state.messages = [...core.state.messages.slice(0, index), ...core.state.messages.slice(index + 1)]
        core.emitToListeners({ type: 'message_start' })
      }
    }
    throw error
  }
  // 本地乐观 + 未确认标记，同 prompt()。
  core.pendingPrompt = true
  core.state.isStreaming = true
  core.state.errorMessage = undefined
  core.startStateWatchdog()
}

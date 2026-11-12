import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { fetchJsonWithTimeout } from '../server-agent-http'
import { STATE_REQUEST_TIMEOUT_MS } from './core'

// ---------------------------------------------------------------------------
// Split-session message reconciliation — 分页消息拉取
// ---------------------------------------------------------------------------

// 消息窗口合并：统一收口到 `message-log.ts`。
//
// 旧实现有两条并行的合并通道——`mergeIncrementalMessages`（假设本地从服务端
// 索引 0 开始）和 `mergeWindowedMessages`（只有它在处理窗口偏移）。SSE 的
// message_end / agent_end / messages_replaced 三个调用点走的是前者，于是
// 「尾部窗口 + 增量帧」必然写错位置。现在两者都删除，所有路径统一走
// `applyMessageLogOp`：坐标只有 `baseSeq + index`，缺口显式返回 `gap`。

export type SessionMessagesPage = { messages: AgentMessage[]; count: number; hasMore: boolean }

export async function fetchSessionMessagesPage(baseUrl: string, sessionId: string, after: number): Promise<SessionMessagesPage | null> {
  const url = `${baseUrl}/api/agents/${encodeURIComponent(sessionId)}/messages?after=${after}`
  const { response, body } = await fetchJsonWithTimeout<{ messages?: AgentMessage[]; count?: number; hasMore?: boolean }>(url, STATE_REQUEST_TIMEOUT_MS)
  if (!response.ok) return null
  return { messages: body?.messages ?? [], count: body?.count ?? after, hasMore: Boolean(body?.hasMore) }
}

export async function fetchAllSessionMessages(baseUrl: string, sessionId: string): Promise<AgentMessage[]> {
  const all: AgentMessage[] = []
  let after = 0
  for (let guard = 0; guard < 128; guard += 1) {
    const page = await fetchSessionMessagesPage(baseUrl, sessionId, after)
    if (!page) break
    all.push(...page.messages)
    if (!page.hasMore || page.messages.length === 0) break
    after += page.messages.length
  }
  return all
}

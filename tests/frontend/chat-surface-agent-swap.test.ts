// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatSurface } from '../../src/components/chat/surface/ChatSurface'
import type { AgentEvent, AgentMessage } from '../../src/components/chat/surface/ChatTypes'

/**
 * Deferred→Real 会话提升的 React 契约（R1「重新加载」修复）：新会话首条消息
 * 发送时，useAgentManager 会把 DeferredSessionAgent 换成真实 ServerAgent
 * （agent.sessionId 从 `pending-*` 变成真实 id）。ChatPanelHost 以
 * `agentRuntimeScopeId ?? agent.sessionId` 作为 ChatSurface 的 key，提升时
 * runtimeScopeId 保持 `pending-*` 不变，因此表面是**同 key 的 agent prop
 * 更新**——用户消息的 DOM 节点必须原地保留（不 remount、不闪空列表），
 * 订阅切换到新 agent，编辑器状态延续。
 *
 * 与 chat-surface-streaming-handoff.test.ts 同一模式：真实 react-dom/client
 * 渲染 + DOM 节点身份断言。
 */

const userMessage: AgentMessage = { role: 'user', content: 'first message', timestamp: 1 }

type FakeAgent = {
  sessionId: string
  subscribe: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  state: Record<string, unknown>
}

function fakeAgent(sessionId: string, messages: AgentMessage[]): FakeAgent {
  const listeners = new Set<(event: AgentEvent) => void>()
  return {
    sessionId,
    subscribe: vi.fn((listener: (event: AgentEvent) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }),
    prompt: vi.fn(async () => {}),
    abort: vi.fn(),
    state: {
      systemPrompt: '',
      messages,
      tools: [],
      pendingToolCalls: new Set<string>(),
      isStreaming: false,
      model: undefined,
      thinkingLevel: 'off',
    },
  }
}

describe('agent swap at Deferred→Real promotion (stable surface key)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderSurface(agent: FakeAgent): void {
    act(() => {
      root.render(createElement(ChatSurface, { agent: agent as never }))
    })
  }

  it('keeps the optimistic user row DOM node when the agent is swapped in place', () => {
    const deferred = fakeAgent('pending-abc', [userMessage])
    renderSurface(deferred)
    const deferredRow = container.querySelector<HTMLElement>('.qf-user-message')
    expect(deferredRow).not.toBeNull()

    // Promotion: same runtime scope (same React key at the host), new agent
    // object whose state already contains the optimistic message — the exact
    // ordering DeferredSessionAgent.prompt guarantees (realAgent.prompt appends
    // synchronously before React flushes the setAgent remount-less update).
    const real = fakeAgent('session-123', [userMessage])
    renderSurface(real)

    const promotedRow = container.querySelector<HTMLElement>('.qf-user-message')
    expect(promotedRow).toBe(deferredRow)
    expect(container.querySelectorAll('.qf-user-message')).toHaveLength(1)
    // 订阅与命令面切换到新 agent。
    expect(real.subscribe).toHaveBeenCalled()
    expect(deferred.subscribe.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('follows new agent events after the swap (no stale subscription)', () => {
    const deferred = fakeAgent('pending-abc', [userMessage])
    renderSurface(deferred)

    const real = fakeAgent('session-123', [userMessage])
    renderSurface(real)

    // A committed assistant row arriving through the real agent's state.
    const assistantMessage: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
      timestamp: 2,
    } as AgentMessage
    const realState = real.state as { messages: AgentMessage[] }
    realState.messages = [...realState.messages, assistantMessage]
    const emit = (real.subscribe as unknown as { mock: { calls: Array<[(event: AgentEvent) => void]> } })
      .mock.calls.map((call) => call[0])
    act(() => {
      emit.forEach((listener) => listener({ type: 'message_end', message: assistantMessage } as unknown as AgentEvent))
    })

    const rows = container.querySelectorAll('.qf-assistant-message')
    expect(rows.length).toBe(1)
    expect(rows[0]?.textContent).toContain('answer')
  })
})

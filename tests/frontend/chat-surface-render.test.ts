import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { ChatSurface, isSnapshotRefreshEvent, readAgentSnapshot } from '../../src/components/chat/surface/ChatSurface'
import type { Agent, AgentMessage, AssistantMessage as AssistantMessageType } from '../../src/components/chat/surface/ChatTypes'

// Surface copy comes from i18n (language falls back to navigator.language).
beforeEach(() => applyAppLanguageFromSnapshot('en'))

function assistantMessage(): AssistantMessageType {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'assistant reply body' }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
    },
    stopReason: 'stop',
    timestamp: 1,
  }
}

function fakeAgent(messages: AgentMessage[], overrides: Record<string, unknown> = {}): Agent {
  return {
    state: {
      systemPrompt: '',
      model: { id: 'claude-test', provider: 'anthropic', reasoning: false },
      thinkingLevel: 'off',
      tools: [],
      messages,
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
    },
    subscribe: vi.fn(() => () => {}),
    abort: vi.fn(),
    prompt: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Agent
}

describe('chat surface snapshot', () => {
  it('copies the mutable agent state into an immutable snapshot', () => {
    const messages: AgentMessage[] = [{ role: 'user', content: 'hi', timestamp: 1 }]
    const agent = fakeAgent(messages)

    const snapshot = readAgentSnapshot(agent)

    expect(snapshot.messages).toEqual(messages)
    expect(snapshot.messages).not.toBe(agent.state.messages)
    expect(snapshot.isStreaming).toBe(false)
    expect(snapshot.model?.id).toBe('claude-test')
    expect(snapshot.thinkingLevel).toBe('off')
    expect(snapshot.pendingToolCalls.size).toBe(0)
  })

  it('captures the streaming assistant message and pending tool calls', () => {
    const streaming = assistantMessage()
    const agent = fakeAgent([], {
      state: {
        systemPrompt: '',
        model: { id: 'm', provider: 'anthropic' },
        thinkingLevel: 'off',
        tools: [],
        messages: [],
        isStreaming: true,
        pendingToolCalls: new Set(['call-1']),
        streamingMessage: streaming,
      },
    })

    const snapshot = readAgentSnapshot(agent as Agent)

    expect(snapshot.isStreaming).toBe(true)
    expect(snapshot.streamingMessage).toEqual(streaming)
    expect(snapshot.pendingToolCalls.has('call-1')).toBe(true)
  })
})

describe('chat surface snapshot identity reuse (R1 F1a)', () => {
  it('reuses the previous array/Set identities when nothing observably changed', () => {
    const messages: AgentMessage[] = [{ role: 'user', content: 'hi', timestamp: 1 }]
    const agent = fakeAgent(messages, {
      state: {
        systemPrompt: '',
        model: { id: 'm', provider: 'anthropic' },
        thinkingLevel: 'off',
        tools: [],
        messages,
        isStreaming: false,
        pendingToolCalls: new Set(['call-1']),
      },
    })

    const first = readAgentSnapshot(agent as Agent)
    const second = readAgentSnapshot(agent as Agent, first)

    // Stable identities keep every downstream memo comparison valid across
    // events that only touch state.streamingMessage.
    expect(second.messages).toBe(first.messages)
    expect(second.tools).toBe(first.tools)
    expect(second.pendingToolCalls).toBe(first.pendingToolCalls)
    expect(second).toBe(first)
  })

  it('reuses the previous messages identity for a fresh container with the same element references', () => {
    // Agent writers always swap in fresh containers (upsertMessage etc.); the
    // reuse check is element-wise, not container-identity based.
    const agent = fakeAgent([{ role: 'user', content: 'hi', timestamp: 1 }])
    const first = readAgentSnapshot(agent)
    agent.state.messages = [...agent.state.messages]

    const second = readAgentSnapshot(agent, first)

    expect(second.messages).toBe(first.messages)
  })

  it('publishes a new messages identity when an element reference or the length changes', () => {
    const agent = fakeAgent([{ role: 'user', content: 'hi', timestamp: 1 }])
    const first = readAgentSnapshot(agent)

    agent.state.messages = [...agent.state.messages, { role: 'user', content: 'again', timestamp: 2 }]
    const second = readAgentSnapshot(agent, first)
    expect(second.messages).not.toBe(first.messages)
    expect(second.messages).toHaveLength(2)

    agent.state.messages = [...agent.state.messages.slice(0, 1), { role: 'user', content: 'edited', timestamp: 1 }]
    const third = readAgentSnapshot(agent, second)
    expect(third.messages).not.toBe(second.messages)
  })

  it('keeps copying the streaming partial body so the streaming container re-renders per event', () => {
    const streaming = assistantMessage()
    const agent = fakeAgent([], {
      state: {
        systemPrompt: '',
        model: { id: 'm', provider: 'anthropic' },
        thinkingLevel: 'off',
        tools: [],
        messages: [],
        isStreaming: true,
        pendingToolCalls: new Set<string>(),
        streamingMessage: streaming,
      },
    })

    const first = readAgentSnapshot(agent as Agent)
    const second = readAgentSnapshot(agent as Agent, first)

    expect(second.streamingMessage).not.toBe(first.streamingMessage)
    expect(second.streamingMessage).toEqual(streaming)
    expect(second).not.toBe(first)
  })
})

describe('chat surface snapshot refresh events', () => {
  it('refreshes for streaming lifecycle events', () => {
    for (const type of ['message_start', 'message_update', 'message_end', 'turn_start', 'turn_end', 'agent_start', 'agent_end']) {
      expect(isSnapshotRefreshEvent(type)).toBe(true)
    }
  })

  it('refreshes on messages_replaced (rollback/clear/compaction) and message_metadata_updated', () => {
    // ServerAgent mutates state.messages in place for messages_replaced and
    // emits a local message_metadata_updated for metadata-only changes; both
    // must re-run readAgentSnapshot or the surface renders a stale list.
    expect(isSnapshotRefreshEvent('messages_replaced')).toBe(true)
    expect(isSnapshotRefreshEvent('message_metadata_updated')).toBe(true)
  })

  it('refreshes on tool_execution frames so tool cards appear while running', () => {
    // ServerAgent upserts tool results into state.messages / pendingToolCalls
    // on these frames; without a snapshot refresh the React surface would not
    // re-render until the next message event.
    for (const type of ['tool_execution_start', 'tool_execution_update', 'tool_execution_end']) {
      expect(isSnapshotRefreshEvent(type)).toBe(true)
    }
  })

  it('ignores events that never change the rendered snapshot', () => {
    for (const type of ['title_updated', 'goal_updated', 'error', 'session_forked', 'unknown_event']) {
      expect(isSnapshotRefreshEvent(type)).toBe(false)
    }
  })
})

describe('chat surface rendering', () => {
  it('renders an empty state without an agent', () => {
    const markup = renderToStaticMarkup(createElement(ChatSurface, {}))

    expect(markup).toContain('No session set')

    applyAppLanguageFromSnapshot('zh')
    expect(renderToStaticMarkup(createElement(ChatSurface, {}))).toContain('未设置会话')
  })

  it('renders messages, composer and usage bar for an agent session', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'user asks something', timestamp: 1 },
      assistantMessage(),
    ]
    const agent = fakeAgent(messages)

    const markup = renderToStaticMarkup(createElement(ChatSurface, { agent }))

    expect(markup).toContain('qf-chat-panel')
    expect(markup).toContain('qf-message-list')
    // 窗口化接线：窗口偏移必须透传成 `data-window-start`（消息序号与面板装饰层
    // 共用该偏移）；`data-message-index` 由 useLayoutEffect 在提交后写入，SSR
    // 标记里不会出现，故只锁定列表根上的偏移。
    expect(markup).toContain('data-window-start="0"')
    expect(markup).toContain('user asks something')
    expect(markup).toContain('assistant reply body')
    expect(markup).toContain('qf-message-editor')
    expect(markup).toContain('claude-test')
    expect(markup).toContain('qf-usage-bar')
    expect(markup).toContain('↑10 ↓20')
  })

  it('renders the streaming container with the pulsing cursor while streaming', () => {
    const agent = fakeAgent([{ role: 'user', content: 'go', timestamp: 1 }], {
      state: {
        systemPrompt: '',
        model: { id: 'm', provider: 'anthropic' },
        thinkingLevel: 'off',
        tools: [],
        messages: [{ role: 'user', content: 'go', timestamp: 1 }],
        isStreaming: true,
        streamingMessage: assistantMessage(),
        pendingToolCalls: new Set<string>(),
      },
    })

    const markup = renderToStaticMarkup(createElement(ChatSurface, { agent: agent as Agent }))

    expect(markup).toContain('qf-streaming-message')
    expect(markup).toContain('animate-pulse')
    // Usage footer is hidden while the assistant message is still streaming.
    expect(markup).not.toContain('↑10')
  })

  it('renders streaming text but no pending tool cards in the streaming container', () => {
    // The streaming container owns text/thinking output only: its pending tool
    // calls stay hidden (hidePendingToolCalls) so the row mounts once in the
    // message list at message_end instead of migrating between subtrees — the
    // migration unmounted/remounted the row and restarted its spinner.
    const streaming: AssistantMessageType = {
      ...assistantMessage(),
      content: [
        { type: 'text', text: 'delegating to the subagent' },
        { type: 'toolCall', id: 'run-subagent-1', name: 'run_subagent', arguments: { task: 'explore' } },
      ],
    }
    const agent = fakeAgent([{ role: 'user', content: 'go', timestamp: 1 }], {
      state: {
        systemPrompt: '',
        model: { id: 'm', provider: 'anthropic' },
        thinkingLevel: 'off',
        tools: [],
        messages: [{ role: 'user', content: 'go', timestamp: 1 }],
        isStreaming: true,
        streamingMessage: streaming,
        pendingToolCalls: new Set(['run-subagent-1']),
      },
    })

    const markup = renderToStaticMarkup(createElement(ChatSurface, { agent: agent as Agent }))

    expect(markup).toContain('qf-streaming-message')
    expect(markup).toContain('delegating to the subagent')
    // Not rendered anywhere yet: the call is still part of the streaming
    // partial and the message list does not have the message.
    expect(markup).not.toContain('qf-tool-message')
  })

  it('renders the committed pending tool card from the message list while the turn keeps streaming', () => {
    // message_end committed the assistant into `messages`; the turn is still
    // live (isStreaming stays true until agent_end) and the next assistant
    // message streams. The pending card must live in the message list — the
    // same container that rendered rows before and renders them after — so its
    // DOM node (and the spinner) survives every subsequent round.
    const committed: AssistantMessageType = {
      ...assistantMessage(),
      timestamp: 2,
      content: [{ type: 'toolCall', id: 'run-subagent-1', name: 'run_subagent', arguments: { task: 'explore' } }],
    }
    const nextPartial: AssistantMessageType = {
      ...assistantMessage(),
      timestamp: 3,
      content: [{ type: 'text', text: 'waiting on the tool' }],
    }
    const agent = fakeAgent([
      { role: 'user', content: 'go', timestamp: 1 },
      committed,
    ], {
      state: {
        systemPrompt: '',
        model: { id: 'm', provider: 'anthropic' },
        thinkingLevel: 'off',
        tools: [],
        messages: [
          { role: 'user', content: 'go', timestamp: 1 },
          committed,
        ],
        isStreaming: true,
        streamingMessage: nextPartial,
        pendingToolCalls: new Set(['run-subagent-1']),
      },
    })

    const markup = renderToStaticMarkup(createElement(ChatSurface, { agent: agent as Agent }))

    const cardIndex = markup.indexOf('qf-tool-message')
    const streamingIndex = markup.indexOf('qf-streaming-message')
    expect(cardIndex).toBeGreaterThanOrEqual(0)
    // The card is owned by the message list, before the streaming container.
    expect(cardIndex).toBeLessThan(streamingIndex)
    // Pending call renders with the running spinner state.
    expect(markup).toContain('animate-spin')
    expect(markup).toContain('waiting on the tool')
  })

  it('renders only the thinking header by default (reasoning body collapsed)', () => {
    const thinking: AssistantMessageType = {
      ...assistantMessage(),
      content: [
        { type: 'thinking', thinking: 'internal reasoning trace' },
        { type: 'text', text: 'assistant reply body' },
      ],
    }
    const agent = fakeAgent([{ role: 'user', content: 'go', timestamp: 1 }, thinking])

    const markup = renderToStaticMarkup(createElement(ChatSurface, { agent }))

    expect(markup).toContain('qf-thinking-block')
    // ThinkingBlock defaults to collapsed: the header label (thinkingBlockLabel)
    // is part of the default render, the reasoning markdown is not — the
    // header click remains the opt-in.
    expect(markup).toContain('Thinking...')
    expect(markup).not.toContain('internal reasoning trace')
  })
})

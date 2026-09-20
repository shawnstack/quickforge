import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

// SharedServerAgent only references `streamSimple` as its default streamFn;
// stub the pi-ai compat module so the test stays hermetic in node.
vi.mock('@earendil-works/pi-ai/compat', () => ({ streamSimple: vi.fn() }))

import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { toolStatus, type ToolStatusKey } from '../../src/lib/tool-renderers/shared'
import { toolCallIdsWithoutToolResult } from '../../src/lib/tool-execution-events'
import { SharedServerAgent } from '../../src/lib/shared-server-agent'

class MockEventSource {
  static instances: MockEventSource[] = []

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>()

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    let listeners = this.listeners.get(type)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(type, listeners)
    }
    listeners.add(listener)
  }

  emit(type: string, data: Record<string, unknown>): void {
    const event = { data: JSON.stringify(data) } as MessageEvent
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }

  close(): void {}
}

function assistantWithToolCall(id: string, name = 'read_file'): AgentMessage {
  return {
    role: 'assistant',
    timestamp: Date.now(),
    content: [
      { type: 'text', text: 'Reading the file' },
      { type: 'toolCall', id, name, arguments: { path: 'a.ts' } },
    ],
  } as unknown as AgentMessage
}

function toolResultMessage(toolCallId: string, isError = false): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: 'read_file',
    content: [{ type: 'text', text: isError ? 'boom' : 'ok' }],
    isError,
    timestamp: 1,
  } as unknown as AgentMessage
}

/**
 * The status a committed tool row renders, computed exactly the way
 * MessageList/AssistantMessage/ToolMessage do: `pending` from
 * pendingToolCalls, the result from the toolCallId → toolResult lookup, and
 * `toolStatus(result, !aborted && pending)` (MessageList rows pass
 * isStreaming=false, so only `pending` feeds the streaming flag).
 */
function renderedToolStatus(agent: SharedServerAgent, toolCallId: string): ToolStatusKey {
  const result = agent.state.messages.find(
    (message) => message.role === 'toolResult' && (message as { toolCallId?: unknown }).toolCallId === toolCallId,
  )
  const pending = agent.state.pendingToolCalls.has(toolCallId)
  return toolStatus(result as never, pending)
}

beforeEach(() => {
  applyAppLanguageFromSnapshot('en')
  MockEventSource.instances = []
  vi.stubGlobal('EventSource', MockEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toolCallIdsWithoutToolResult', () => {
  it('returns tool-call ids from an assistant message that have no toolResult yet', () => {
    const message = assistantWithToolCall('call-new')
    expect(toolCallIdsWithoutToolResult(message, [message])).toEqual(['call-new'])
  })

  it('excludes ids that already have a toolResult (partial, final, or error)', () => {
    const message = {
      role: 'assistant',
      timestamp: 1,
      content: [
        { type: 'toolCall', id: 'call-partial', name: 'read_file', arguments: {} },
        { type: 'toolCall', id: 'call-final', name: 'read_file', arguments: {} },
        { type: 'toolCall', id: 'call-error', name: 'read_file', arguments: {} },
        { type: 'toolCall', id: 'call-none', name: 'read_file', arguments: {} },
      ],
    } as unknown as AgentMessage
    const messages: AgentMessage[] = [
      message,
      toolResultMessage('call-partial'),
      toolResultMessage('call-final'),
      toolResultMessage('call-error', true),
    ]
    expect(toolCallIdsWithoutToolResult(message, messages)).toEqual(['call-none'])
  })

  it('ignores non-assistant messages and tool-call chunks without a usable id', () => {
    const user = { role: 'user', content: 'hi' } as unknown as AgentMessage
    expect(toolCallIdsWithoutToolResult(user, [])).toEqual([])
    const toolResult = toolResultMessage('call-x')
    expect(toolCallIdsWithoutToolResult(toolResult, [toolResult])).toEqual([])
    const malformed = {
      role: 'assistant',
      timestamp: 1,
      content: [{ type: 'toolCall', name: 'read_file', arguments: {} }, 'raw text'],
    } as unknown as AgentMessage
    expect(toolCallIdsWithoutToolResult(malformed, [malformed])).toEqual([])
  })
})

describe('SharedServerAgent pending across interleaved message_end/tool frames', () => {
  function createAgent() {
    return new SharedServerAgent('share-1', { permission: 'read' })
  }

  function latestSource(): MockEventSource {
    const source = MockEventSource.instances.at(-1)
    if (!source) throw new Error('Expected an EventSource instance')
    return source
  }

  it('keeps the tool row running when message_end commits the call before tool_execution_start', () => {
    const agent = createAgent()
    try {
      const source = latestSource()
      const statuses: ToolStatusKey[] = []
      const record = () => statuses.push(renderedToolStatus(agent, 'call-1'))

      // Interleaved frame: the assistant message (with the toolCall chunk)
      // is committed while no tool_execution_* event has arrived yet. Before
      // the fix this frame rendered the idle 'called' gray dot for one frame.
      source.emit('message_end', { message: assistantWithToolCall('call-1') })
      record()

      source.emit('tool_execution_start', { toolCallId: 'call-1', toolName: 'read_file', args: { path: 'a.ts' } })
      record()

      source.emit('tool_execution_end', {
        toolCallId: 'call-1',
        toolName: 'read_file',
        result: { content: [{ type: 'text', text: 'file body' }] },
      })
      record()

      expect(statuses).toEqual(['running', 'running', 'done'])
      expect(agent.state.pendingToolCalls.has('call-1')).toBe(false)
    } finally {
      agent.dispose()
    }
  })

  it('does not re-mark a finished (done) call as pending when its message_end lands late', () => {
    const agent = createAgent()
    try {
      const source = latestSource()
      // tool_execution_end arrived before message_end (the other interleave):
      // the call already has a final result, so committing the assistant
      // message must keep it done instead of bouncing back to running.
      source.emit('tool_execution_start', { toolCallId: 'call-2', toolName: 'read_file', args: {} })
      source.emit('tool_execution_end', {
        toolCallId: 'call-2',
        toolName: 'read_file',
        result: { content: [{ type: 'text', text: 'ok' }] },
      })
      source.emit('message_end', { message: assistantWithToolCall('call-2') })

      expect(agent.state.pendingToolCalls.has('call-2')).toBe(false)
      expect(renderedToolStatus(agent, 'call-2')).toBe('done')
    } finally {
      agent.dispose()
    }
  })

  it('keeps the error path intact: a failed tool renders error and stays non-pending on late message_end', () => {
    const agent = createAgent()
    try {
      const source = latestSource()
      source.emit('message_end', { message: assistantWithToolCall('call-3', 'run_command') })
      source.emit('tool_execution_start', { toolCallId: 'call-3', toolName: 'run_command', args: {} })
      source.emit('tool_execution_end', {
        toolCallId: 'call-3',
        toolName: 'run_command',
        isError: true,
        result: { content: [] },
      })
      expect(renderedToolStatus(agent, 'call-3')).toBe('error')

      // A late/repeated message_end for the same assistant message must not
      // push the failed call back to a running state.
      source.emit('message_end', { message: assistantWithToolCall('call-3', 'run_command') })
      expect(agent.state.pendingToolCalls.has('call-3')).toBe(false)
      expect(renderedToolStatus(agent, 'call-3')).toBe('error')
    } finally {
      agent.dispose()
    }
  })
})

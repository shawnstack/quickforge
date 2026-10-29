import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `background_commands` 帧的消息守卫。
 *
 * 服务端这个帧只带 `messages`（不含 `messagesSummary`），而本地可能刚乐观
 * 追加了一条 user 消息。快照更短时整表替换会吞掉乐观消息，因此改为按
 * `toolCallId` 就地合并：后台命令退出帧的唯一作用是把对应 toolResult 的
 * details 落成终态，不需要整表覆盖。
 */
const wire = vi.hoisted(() => ({
  handler: undefined as ((event: Record<string, unknown>) => void) | undefined,
}))

vi.mock('../../src/lib/global-agent-sse-client', () => ({
  globalAgentSseClient: {
    subscribe: (_sessionId: string, _baseUrl: string, handler: (event: Record<string, unknown>) => void) => {
      wire.handler = handler
      return () => {}
    },
  },
}))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/session-message-cache', () => ({
  SESSION_MESSAGE_CACHE_TAIL_MESSAGES: 200,
  resolveServerCacheKey: () => 'test',
  readSessionMessageSnapshot: async () => null,
  writeSessionMessageSnapshot: vi.fn(),
  flushPendingSessionMessageWrites: async () => {},
  cancelPendingSessionMessageWrites: () => {},
}))

import { ServerAgent } from '../../src/lib/server-agent'

function send(event: Record<string, unknown>): void {
  if (!wire.handler) throw new Error('Expected a wire subscriber')
  wire.handler(event)
}

const userMessage = (text: string): AgentMessage => ({ role: 'user', content: text, timestamp: 1 })

const toolResultMessage = (toolCallId: string, text: string): AgentMessage => ({
  role: 'toolResult',
  toolCallId,
  toolName: 'bash',
  content: [{ type: 'text', text }],
  isError: false,
  timestamp: 2,
})

const backgroundCommand = (taskId: string) => ({
  taskId,
  toolCallId: taskId,
  command: 'sleep 1',
  status: 'running' as const,
})

describe('ServerAgent background_commands frame message guard', () => {
  let agent: ServerAgent

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    agent = new ServerAgent({ sessionId: 'background-frame', initialState: { messages: [] } })
  })

  afterEach(() => {
    agent.dispose()
    vi.unstubAllGlobals()
  })

  it('replaces the whole list when the snapshot is longer', () => {
    // 本地 1 条，快照 2 条：服务端领先，可以整表覆盖。
    agent.state.messages = [userMessage('local')]
    const incoming: AgentMessage[] = [userMessage('local'), userMessage('server extra')]

    send({ type: 'background_commands', messages: incoming })

    expect(agent.state.messages).toBe(incoming)
  })

  it('replaces the whole list when the snapshot has the same length', () => {
    agent.state.messages = [userMessage('local')]
    const incoming: AgentMessage[] = [userMessage('local updated')]

    send({ type: 'background_commands', messages: incoming })

    expect(agent.state.messages).toBe(incoming)
  })

  it('merges a terminal toolResult by toolCallId when the snapshot is shorter', () => {
    // 场景：用户刚发消息（本地乐观追加），同期后台命令退出，快照还没登记
    // 这条 user 消息。终态 toolResult 必须落进本地列表，user 消息必须保留。
    const optimisticUser = userMessage('just sent')
    const runningResult = toolResultMessage('call-1', 'running')
    agent.state.messages = [optimisticUser, runningResult, userMessage('older')]
    const terminalResult = toolResultMessage('call-1', 'exit 0')
    const incoming: AgentMessage[] = [userMessage('older'), terminalResult]

    expect(incoming.length).toBeLessThan(agent.state.messages.length)

    send({ type: 'background_commands', messages: incoming })

    expect(agent.state.messages).toHaveLength(3)
    expect(agent.state.messages[0]).toBe(optimisticUser)
    expect(agent.state.messages[1]).toBe(terminalResult)
    expect((agent.state.messages[2] as { content: unknown }).content).toBe('older')
  })

  it('leaves the local list untouched when no toolCallId matches', () => {
    const local = [userMessage('a'), toolResultMessage('call-1', 'running')]
    const localRef = local.slice()
    agent.state.messages = local
    const incoming: AgentMessage[] = [toolResultMessage('call-other', 'done')]

    send({ type: 'background_commands', messages: incoming })

    expect(agent.state.messages).toBe(local)
    expect(agent.state.messages).toEqual(localRef)
    expect(agent.state.messages[1]).toBe(localRef[1])
  })

  it('leaves the local list untouched when the snapshot carries no toolResult', () => {
    const local = [userMessage('a'), toolResultMessage('call-1', 'running')]
    agent.state.messages = local

    send({ type: 'background_commands', messages: [userMessage('a')] })

    expect(agent.state.messages).toBe(local)
    expect(agent.state.messages[1]).toBe(local[1])
  })

  it('always replaces backgroundCommands regardless of snapshot length', () => {
    const longer = [backgroundCommand('t1'), backgroundCommand('t2')]
    send({ type: 'background_commands', backgroundCommands: longer })
    expect(agent.state.backgroundCommands).toBe(longer)

    // 后台命令退出：运行列表变短（甚至为空）也必须无条件落地。
    const shorter = [backgroundCommand('t1')]
    send({ type: 'background_commands', backgroundCommands: shorter })
    expect(agent.state.backgroundCommands).toBe(shorter)

    const empty: ReturnType<typeof backgroundCommand>[] = []
    send({ type: 'background_commands', backgroundCommands: empty })
    expect(agent.state.backgroundCommands).toBe(empty)

    // `backgroundCommands` 缺席时保留原值（帧只带 messages）。
    send({ type: 'background_commands', messages: [] })
    expect(agent.state.backgroundCommands).toBe(empty)
  })
})

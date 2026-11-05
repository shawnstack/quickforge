import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const wire = vi.hoisted(() => ({
  handler: undefined as ((event: Record<string, unknown>) => void) | undefined,
  unsubscribe: vi.fn(),
}))

vi.mock('../../src/lib/global-agent-sse-client', () => ({
  globalAgentSseClient: {
    subscribe: (_sessionId: string, _baseUrl: string, handler: (event: Record<string, unknown>) => void) => {
      wire.handler = handler
      return wire.unsubscribe
    },
  },
}))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
import { ServerAgent } from '../../src/lib/server-agent'

function send(event: Record<string, unknown>): void {
  if (!wire.handler) throw new Error('Expected a wire subscriber')
  wire.handler(event)
}

function userMessage(content: string, timestamp: number): AgentMessage {
  return { role: 'user', content, timestamp } as unknown as AgentMessage
}

function assistantMessage(content: string, timestamp: number): AgentMessage {
  return { role: 'assistant', content, timestamp } as unknown as AgentMessage
}

/**
 * 运行状态（`state.isStreaming`）的单一权威回归。
 *
 * 场景来源：回滚后的 HTTP 响应先回到客户端、用户立刻点发送，而回滚广播的
 * `agent_end` 还在这条 SSE 连接上飞。那条帧描述的是**上一个回合**结束了，
 * 客户端却已经开了新的一轮——它不能把新回合的按钮打回「发送」。
 */
describe('ServerAgent run-state authority', () => {
  let agent: ServerAgent

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    agent = new ServerAgent({ sessionId: 'stale-run-completion', initialState: { messages: [] } })
  })

  afterEach(() => {
    agent.dispose()
    vi.unstubAllGlobals()
  })

  it('ignores an agent_end that belongs to the previous run while a new prompt is unconfirmed', async () => {
    const rollbackHistory = [userMessage('old question', 1), assistantMessage('old answer', 2)]
    agent.state.messages = rollbackHistory

    const events: string[] = []
    agent.subscribe((event) => events.push(event.type))

    await agent.prompt('edited question')
    expect(agent.state.isStreaming).toBe(true)

    const messageCountBefore = agent.state.messages.length
    // 回滚广播的收尾帧：只带截断后的旧历史，比本地少一条（本地已有乐观 user 消息）。
    send({ type: 'agent_end', messages: rollbackHistory })

    expect(agent.state.isStreaming).toBe(true)
    expect(agent.state.messages.length).toBe(messageCountBefore)
    expect(events.filter((type) => type === 'agent_end')).toHaveLength(0)
  })

  it('adopts the run completion once the server confirmed the new run', async () => {
    const events: string[] = []
    agent.subscribe((event) => events.push(event.type))

    await agent.prompt('hello')
    send({ type: 'agent_start' })
    send({
      type: 'agent_end',
      messages: [...agent.state.messages, assistantMessage('hi', 3)],
    })

    expect(agent.state.isStreaming).toBe(false)
    expect(events.filter((type) => type === 'agent_end').length).toBeGreaterThan(0)
  })

  it('ignores a state frame reporting idle until the new run is confirmed', async () => {
    await agent.prompt('hello')
    expect(agent.state.isStreaming).toBe(true)

    send({ type: 'state', isStreaming: false })
    expect(agent.state.isStreaming).toBe(true)

    send({ type: 'state', isStreaming: true })
    expect(agent.state.isStreaming).toBe(true)

    send({ type: 'state', isStreaming: false })
    expect(agent.state.isStreaming).toBe(false)
  })

  it('treats a streaming delta as proof the new run started', async () => {
    await agent.prompt('hello')
    send({ type: 'message_update', message: assistantMessage('partial', 4) })

    send({ type: 'agent_end', messages: [...agent.state.messages, assistantMessage('done', 5)] })
    expect(agent.state.isStreaming).toBe(false)
  })

  it('still settles a run after a local abort', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    await agent.prompt('hello')
    agent.abort()

    send({ type: 'agent_end', status: 'aborted', messages: agent.state.messages })
    expect(agent.state.isStreaming).toBe(false)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamSideChat } from '../../src/components/workspace/side-chat-client'

const modelRef = {
  version: 1 as const,
  source: 'custom' as const,
  providerId: 'provider-1',
  modelId: 'model-1',
}

function streamResponse(chunks: Uint8Array[], status = 200) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  }), {
    status,
    headers: { 'content-type': status === 200 ? 'application/x-ndjson' : 'application/json' },
  })
}

function requestBody() {
  const call = vi.mocked(fetch).mock.calls[0]
  return JSON.parse(String((call?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('side chat stream client', () => {
  it('parses delta across arbitrary UTF-8 boundaries', async () => {
    const bytes = new TextEncoder().encode([
      JSON.stringify({ type: 'meta', model: { id: 'model-1' }, tools: [] }),
      JSON.stringify({ type: 'delta', delta: '你' }),
      JSON.stringify({ type: 'delta', delta: '好' }),
      JSON.stringify({ type: 'done' }),
      '',
    ].join('\n'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([
      bytes.slice(0, 19),
      bytes.slice(19, 57),
      bytes.slice(57, 60),
      bytes.slice(60),
    ])))
    const deltas: string[] = []

    await streamSideChat({
      sessionId: 'session-1',
      modelRef,
      messages: [{ role: 'user', content: '问题' }],
    }, { onDelta: (delta) => deltas.push(delta) })

    expect(deltas.join('')).toBe('你好')
  })

  it('serializes only plain text request fields and drops unsupported top-level data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([
      new TextEncoder().encode(`${JSON.stringify({ type: 'done' })}\n`),
    ])))

    await streamSideChat({
      sessionId: ' session-1 ',
      modelRef,
      messages: [
        { role: 'user', content: 'inspect', timestamp: 3 },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'continue' },
      ],
      ...({
        thinkingLevel: 'high',
        selectedCapabilities: [{ label: 'Documents' }],
        contextReferences: [{ path: 'src/main.ts' }],
        promptMode: 'plan',
        accessMode: 'full-access',
        yoloMode: true,
      } as Record<string, unknown>),
    }, {})

    expect(requestBody()).toEqual({
      sessionId: 'session-1',
      modelRef,
      messages: [
        { role: 'user', content: 'inspect', timestamp: 3 },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'continue' },
      ],
    })
  })

  it('rejects advanced or malformed stream events instead of parsing them', async () => {
    const encoder = new TextEncoder()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(streamResponse([
      encoder.encode(`${JSON.stringify({ type: 'agent_event', event: { type: 'agent_end', messages: [] } })}\n`),
    ])))
    await expect(streamSideChat({ messages: [{ role: 'user', content: 'question' }] }))
      .rejects.toThrow('unsupported stream data')

    vi.mocked(fetch).mockResolvedValueOnce(streamResponse([
      encoder.encode(`${JSON.stringify({ type: 'meta', tools: ['read_file'] })}\n`),
    ]))
    await expect(streamSideChat({ messages: [{ role: 'user', content: 'question' }] }))
      .rejects.toThrow('unsupported tools')
  })

  it('surfaces streamed and HTTP errors and rejects missing done', async () => {
    const encoder = new TextEncoder()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(streamResponse([
      encoder.encode(`${JSON.stringify({ type: 'error', error: 'blocked', code: 'SIDE_CHAT_TOOL_CALL_BLOCKED' })}\n`),
    ])))
    await expect(streamSideChat({ messages: [{ role: 'user', content: 'question' }] }))
      .rejects.toMatchObject({ message: 'blocked', code: 'SIDE_CHAT_TOOL_CALL_BLOCKED' })

    vi.mocked(fetch).mockResolvedValueOnce(streamResponse([
      encoder.encode(`${JSON.stringify({ type: 'delta', delta: 'partial' })}\n`),
    ]))
    await expect(streamSideChat({ messages: [{ role: 'user', content: 'question' }] }))
      .rejects.toThrow('Side chat stream ended unexpectedly')

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad request', code: 'BAD' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }))
    await expect(streamSideChat({ messages: [{ role: 'user', content: 'question' }] }))
      .rejects.toMatchObject({ message: 'bad request', code: 'BAD' })
  })

  it('forwards AbortSignal to fetch', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    vi.stubGlobal('fetch', fetchMock)
    controller.abort()

    await expect(streamSideChat({ messages: [{ role: 'user', content: 'question' }] }, {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledWith('/api/side-chat/stream', expect.objectContaining({ signal: controller.signal }))
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// 分页拉消息：唯一的风险是**循环条件**——页码推错了会拉重、拉漏，或者
// 服务端一直说「还有」时不设上限地转圈。这里把 fetchJsonWithTimeout 桩掉，
// 只验请求怎么拼、循环怎么收。
const mocks = vi.hoisted(() => ({
  fetchJsonWithTimeout: vi.fn(),
}))

vi.mock('../../src/lib/server-agent-http', () => ({ fetchJsonWithTimeout: mocks.fetchJsonWithTimeout }))
vi.mock('../../src/lib/server-agent/core', () => ({ STATE_REQUEST_TIMEOUT_MS: 1234 }))

const { fetchSessionMessagesPage, fetchAllSessionMessages } = await import('../../src/lib/server-agent/messages-channel')

function ok(messages: unknown[], hasMore: boolean, count?: number) {
  return { response: { ok: true }, body: { messages, hasMore, count } }
}

describe('fetchSessionMessagesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests the page after the given offset and encodes the session id', async () => {
    mocks.fetchJsonWithTimeout.mockResolvedValue(ok([{ role: 'user' }], false, 7))

    const page = await fetchSessionMessagesPage('http://host:5176', 'bot/session 1', 5)

    const url = mocks.fetchJsonWithTimeout.mock.calls[0][0] as string
    expect(url).toBe('http://host:5176/api/agents/bot%2Fsession%201/messages?after=5')
    expect(mocks.fetchJsonWithTimeout.mock.calls[0][1]).toBe(1234)
    expect(page).toEqual({ messages: [{ role: 'user' }], count: 7, hasMore: false })
  })

  it('defaults the count to the offset and the flag to false when the body is empty', async () => {
    mocks.fetchJsonWithTimeout.mockResolvedValue({ response: { ok: true }, body: {} })

    const page = await fetchSessionMessagesPage('http://host', 's1', 9)

    expect(page).toEqual({ messages: [], count: 9, hasMore: false })
  })

  it('returns null instead of throwing on a non-ok response', async () => {
    mocks.fetchJsonWithTimeout.mockResolvedValue({ response: { ok: false }, body: null })

    expect(await fetchSessionMessagesPage('http://host', 's1', 0)).toBeNull()
  })
})

describe('fetchAllSessionMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('walks pages until the server says there is no more', async () => {
    mocks.fetchJsonWithTimeout
      .mockResolvedValueOnce(ok([{ id: 0 }, { id: 1 }], true, 2))
      .mockResolvedValueOnce(ok([{ id: 2 }], false, 3))

    const all = await fetchAllSessionMessages('http://host', 's1')

    expect(all.map((message) => (message as { id: number }).id)).toEqual([0, 1, 2])
    // 第二次请求的 offset 必须等于已拉到的条数。
    expect(mocks.fetchJsonWithTimeout.mock.calls[1][0]).toBe('http://host/api/agents/s1/messages?after=2')
  })

  it('stops on the first failed page and keeps what it has', async () => {
    mocks.fetchJsonWithTimeout
      .mockResolvedValueOnce(ok([{ id: 0 }], true, 1))
      .mockResolvedValueOnce({ response: { ok: false }, body: null })

    expect(await fetchAllSessionMessages('http://host', 's1')).toEqual([{ id: 0 }])
  })

  it('stops when a page claims more but is empty', async () => {
    mocks.fetchJsonWithTimeout.mockResolvedValue(ok([], true))

    expect(await fetchAllSessionMessages('http://host', 's1')).toEqual([])
    expect(mocks.fetchJsonWithTimeout).toHaveBeenCalledTimes(1)
  })

  it('does not loop forever when the server keeps claiming more', async () => {
    mocks.fetchJsonWithTimeout.mockResolvedValue(ok([{ id: 'x' }], true))

    const all = await fetchAllSessionMessages('http://host', 's1')

    expect(mocks.fetchJsonWithTimeout).toHaveBeenCalledTimes(128)
    expect(all).toHaveLength(128)
  })
})

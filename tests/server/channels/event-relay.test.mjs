import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishChannelSessionChanged } from '../../../server/channels/event-relay.mjs'

describe('channel event relay', () => {
  const previousUrl = process.env.QUICKFORGE_CHANNEL_EVENTS_URL

  afterEach(() => {
    if (previousUrl === undefined) delete process.env.QUICKFORGE_CHANNEL_EVENTS_URL
    else process.env.QUICKFORGE_CHANNEL_EVENTS_URL = previousUrl
    vi.unstubAllGlobals()
  })

  it('posts session changes to the local channel event endpoint', async () => {
    process.env.QUICKFORGE_CHANNEL_EVENTS_URL = 'http://127.0.0.1:32176/api/channels/events'
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(publishChannelSessionChanged({
      channelId: 'wechat',
      sessionId: 'session-1',
      projectId: null,
    })).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32176/api/channels/events',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-quickforge-action': 'channel-event',
        },
      }),
    )
    const request = fetchMock.mock.calls[0][1]
    expect(JSON.parse(request.body)).toEqual(expect.objectContaining({
      type: 'sessions-changed',
      channelId: 'wechat',
      sessionId: 'session-1',
      projectId: null,
      timestamp: expect.any(String),
    }))
  })

  it('does nothing when no relay endpoint is configured', async () => {
    delete process.env.QUICKFORGE_CHANNEL_EVENTS_URL
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(publishChannelSessionChanged({ sessionId: 'session-1' })).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

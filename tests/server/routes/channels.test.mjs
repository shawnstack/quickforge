import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { channelEvents } from '../../../server/channels/registry.mjs'
import { handleChannelsApi } from '../../../server/routes/channels.mjs'

function request(body, headers = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  req.headers = headers
  return req
}

function response() {
  return {
    status: undefined,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body = '') {
      this.body += body
    },
  }
}

describe('channels event relay route', () => {
  it('forwards a local validated session event to SSE subscribers', async () => {
    const event = {
      type: 'sessions-changed',
      channelId: 'wechat',
      sessionId: 'session-1',
      projectId: null,
    }
    const received = new Promise((resolve) => channelEvents.once('channel_event', resolve))
    const req = request(event, { 'x-quickforge-action': 'channel-event' })
    const res = response()

    await handleChannelsApi(req, res, new URL('http://localhost/api/channels/events'), { isLocalRequest: true })

    await expect(received).resolves.toEqual(event)
    expect(res.status).toBe(202)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
  })

  it('rejects non-local event relay requests', async () => {
    const req = request(
      { type: 'sessions-changed', sessionId: 'session-1' },
      { 'x-quickforge-action': 'channel-event' },
    )
    const res = response()

    await expect(handleChannelsApi(req, res, new URL('http://localhost/api/channels/events'), {
      isLocalRequest: false,
    })).rejects.toMatchObject({ statusCode: 403 })
  })
})

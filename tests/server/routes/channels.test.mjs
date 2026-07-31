import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { channelEvents, initializeChannels } from '../../../server/channels/registry.mjs'
import { handleChannelsApi } from '../../../server/routes/channels.mjs'

function request(body = {}, headers = {}) {
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

let logsDir

beforeAll(async () => {
  logsDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-channel-route-'))
  initializeChannels({ projectRoot: process.cwd(), logsDir })
})

afterAll(async () => {
  await rm(logsDir, { recursive: true, force: true })
})

describe('channel log directory route', () => {
  it('opens the registered channel log directory for a local authorized request', async () => {
    const openPathInFileManager = vi.fn(async () => {})
    const req = request({}, { 'x-quickforge-action': 'channel-action' })
    const res = response()

    await handleChannelsApi(req, res, new URL('http://localhost/api/channels/wechat/open-logs'), {
      isLocalRequest: true,
      logsDir,
      openPathInFileManager,
    })

    const expectedDirectory = path.join(logsDir, 'channels', 'wechat')
    expect(openPathInFileManager).toHaveBeenCalledWith(expectedDirectory)
    await expect(stat(expectedDirectory)).resolves.toMatchObject({})
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
  })

  it('rejects unknown channels before opening a directory', async () => {
    const openPathInFileManager = vi.fn(async () => {})
    const req = request({}, { 'x-quickforge-action': 'channel-action' })

    await expect(handleChannelsApi(req, response(), new URL('http://localhost/api/channels/unknown/open-logs'), {
      isLocalRequest: true,
      logsDir,
      openPathInFileManager,
    })).rejects.toMatchObject({ statusCode: 404 })
    expect(openPathInFileManager).not.toHaveBeenCalled()
  })

  it('rejects non-local requests', async () => {
    const req = request({}, { 'x-quickforge-action': 'channel-action' })

    await expect(handleChannelsApi(req, response(), new URL('http://localhost/api/channels/wechat/open-logs'), {
      isLocalRequest: false,
      logsDir,
      openPathInFileManager: vi.fn(),
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects requests without the channel action header', async () => {
    await expect(handleChannelsApi(request(), response(), new URL('http://localhost/api/channels/wechat/open-logs'), {
      isLocalRequest: true,
      logsDir,
      openPathInFileManager: vi.fn(),
    })).rejects.toMatchObject({ statusCode: 403 })
  })
})

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

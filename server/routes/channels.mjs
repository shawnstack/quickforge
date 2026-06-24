import { sendJson, decodeSegment, readJsonBody } from '../utils/response.mjs'
import {
  channelEvents,
  getChannelStatus,
  listChannels,
  restartChannel,
  runChannelAction,
  startChannel,
  stopChannel,
} from '../channels/registry.mjs'

function assertLocal(context) {
  if (!context.isLocalRequest) {
    const error = new Error('Channel management is only allowed from this computer')
    error.statusCode = 403
    throw error
  }
}

function assertActionHeader(req) {
  if (req.headers['x-quickforge-action'] !== 'channel-action') {
    const error = new Error('Forbidden action')
    error.statusCode = 403
    throw error
  }
}

async function readActionOptions(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method || '')) return {}
  const contentType = String(req.headers['content-type'] || '')
  if (!contentType.toLowerCase().includes('application/json')) return {}
  return await readJsonBody(req, 64 * 1024) || {}
}

export async function handleChannelsApi(req, res, url, context = {}) {
  const pathname = url.pathname
  const parts = pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && pathname === '/api/channels') {
    sendJson(res, 200, { channels: listChannels() })
    return
  }

  if (req.method === 'GET' && pathname === '/api/channels/events') {
    handleChannelEvents(req, res)
    return
  }

  if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'channels') {
    const error = new Error('Not found')
    error.statusCode = 404
    throw error
  }

  const channelId = decodeSegment(parts[2])
  const subPath = parts.slice(3).map(decodeSegment)

  if (req.method === 'GET' && subPath.length === 0) {
    sendJson(res, 200, getChannelStatus(channelId))
    return
  }

  if (req.method === 'GET' && subPath[0] === 'status') {
    sendJson(res, 200, getChannelStatus(channelId))
    return
  }

  assertLocal(context)

  if (req.method === 'POST' && subPath[0] === 'start') {
    assertActionHeader(req)
    sendJson(res, 202, await startChannel(channelId, await readActionOptions(req)))
    return
  }

  if (req.method === 'POST' && subPath[0] === 'stop') {
    assertActionHeader(req)
    sendJson(res, 202, await stopChannel(channelId))
    return
  }

  if (req.method === 'POST' && subPath[0] === 'restart') {
    assertActionHeader(req)
    sendJson(res, 202, await restartChannel(channelId, await readActionOptions(req)))
    return
  }

  if (req.method === 'POST' && subPath[0] === 'actions' && subPath[1]) {
    assertActionHeader(req)
    sendJson(res, 202, await runChannelAction(channelId, subPath[1], await readActionOptions(req)))
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

function handleChannelEvents(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })

  writeSseEvent(res, 'snapshot', { type: 'snapshot', channels: listChannels(), timestamp: new Date().toISOString() })

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      cleanup()
    }
  }, 15000)

  const onChannelEvent = (event) => {
    try {
      writeSseEvent(res, event.type || 'channel_event', event)
    } catch {
      cleanup()
    }
  }

  const cleanup = () => {
    clearInterval(keepAlive)
    channelEvents.removeListener('channel_event', onChannelEvent)
    if (!res.writableEnded) res.end()
  }

  channelEvents.on('channel_event', onChannelEvent)
  req.on('close', cleanup)
  req.on('error', cleanup)
  res.on('error', cleanup)
}

function writeSseEvent(res, event, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  const lines = payload.split('\n')
  res.write(`event: ${event}\n`)
  for (const line of lines) {
    res.write(`data: ${line}\n`)
  }
  res.write('\n')
}

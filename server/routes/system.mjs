import { sendJson } from '../utils/response.mjs'
import { getLanUrls } from '../utils/network.mjs'

export async function handleSystemApi(req, res, url, context) {
  if (req.method === 'POST' && url.pathname === '/api/system/restart') {
    if (req.headers['x-quickforge-action'] !== 'restart') {
      const error = new Error('Forbidden action')
      error.statusCode = 403
      throw error
    }

    const result = await context.requestRestart()
    sendJson(res, 202, result)
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/system/status') {
    sendJson(res, 200, await context.getSystemStatus())
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/system/network') {
    sendJson(res, 200, {
      host: context.host,
      port: context.port,
      lanUrls: getLanUrls(context.port),
      remoteEnabled: context.remoteEnabled === true,
    })
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

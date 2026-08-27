import { sendJson, readJsonBody } from '../utils/response.mjs'
import { getLanUrls } from '../utils/network.mjs'
import { isAuthenticatedAppClient } from '../access-policy.mjs'

export async function handleSystemApi(req, res, url, context) {
  if (req.method === 'GET' && url.pathname === '/api/system/about') {
    sendJson(res, 200, await context.getPackageInfo())
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/system/update/check') {
    // 非阻塞：立即返回检查状态快照，registry 请求在后台刷新，网络失败不再返回 500。
    sendJson(res, 200, context.getUpdateCheckState(url.searchParams.get('force') === '1'))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/system/update/desktop') {
    sendJson(res, 200, await context.checkDesktopRelease())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/system/update') {
    if (!isAuthenticatedAppClient(context)) {
      const error = new Error('Update requires a local or authenticated remote client')
      error.statusCode = 403
      error.errorCode = 'system_update_requires_auth'
      throw error
    }

    if (req.headers['x-quickforge-action'] !== 'update') {
      const error = new Error('Forbidden action')
      error.statusCode = 403
      throw error
    }

    const result = await context.updateQuickForge()
    sendJson(res, result.updateStarted ? 202 : 200, result)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/system/restart') {
    if (!isAuthenticatedAppClient(context)) {
      const error = new Error('Restart requires a local or authenticated remote client')
      error.statusCode = 403
      error.errorCode = 'system_restart_requires_auth'
      throw error
    }

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

  if (url.pathname === '/api/system/terminal-shell') {
    if (req.method === 'GET') {
      sendJson(res, 200, await context.getTerminalShellConfig())
      return
    }

    if (req.method === 'PUT') {
      if (!context.isLocalRequest) {
        const error = new Error('Terminal shell settings can only be changed from this computer')
        error.statusCode = 403
        throw error
      }
      const body = await readJsonBody(req, 64 * 1024) || {}
      if (Array.isArray(body.profiles) || typeof body.defaultProfileId === 'string') {
        sendJson(res, 200, await context.updateTerminalShellConfig(body))
      } else {
        const terminalShell = await context.updateTerminalShellSetting(body.terminalShell)
        sendJson(res, 200, await context.getTerminalShellConfig({ terminalShell }))
      }
      return
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/system/network-proxy') {
    sendJson(res, 200, await context.getNetworkProxyConfig())
    return
  }

  if (req.method === 'PUT' && url.pathname === '/api/system/network-proxy') {
    if (!context.isLocalRequest) {
      const error = new Error('Network proxy settings can only be changed from this computer')
      error.statusCode = 403
      throw error
    }
    const body = await readJsonBody(req, 64 * 1024) || {}
    sendJson(res, 200, await context.updateNetworkProxyConfig(body))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/system/network-proxy/refresh') {
    if (!context.isLocalRequest) {
      const error = new Error('System proxy can only be refreshed from this computer')
      error.statusCode = 403
      throw error
    }
    sendJson(res, 200, await context.refreshSystemProxy())
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

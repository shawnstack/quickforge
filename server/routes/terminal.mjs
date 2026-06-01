import path from 'node:path'
import { WebSocketServer } from 'ws'
import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { projectContextFromId, readProjectConfig, getActiveProject, resolveTerminalShellProfile } from '../project-config.mjs'
import { getWorkspaceRoot, assertDirectory } from '../utils/workspace.mjs'
import {
  attachTerminalClient,
  createTerminalSession,
  destroyTerminalSession,
  listTerminalSessions,
  platformInfo,
  terminalCapabilities,
  writeTerminalInput,
} from '../terminal/terminal-manager.mjs'

const wsServer = new WebSocketServer({ noServer: true })

function error(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

async function assertLocalTerminalRequest(req, isLocalRequest) {
  if (!isLocalRequest) throw error('Terminal is only available from localhost', 403)
  const capabilities = await terminalCapabilities()
  if (!capabilities.enabled) throw error(capabilities.reason || 'Terminal is disabled', 403)
}

async function resolveTerminalCwd(projectId) {
  if (projectId) {
    const context = await projectContextFromId(projectId)
    return { cwd: context.workspaceRoot, projectId: context.project.id }
  }

  const config = await readProjectConfig()
  const activeProject = getActiveProject(config)
  if (activeProject?.id) {
    const context = await projectContextFromId(activeProject.id)
    return { cwd: context.workspaceRoot, projectId: context.project.id }
  }

  const workspaceRoot = path.resolve(getWorkspaceRoot() || process.cwd())
  await assertDirectory(workspaceRoot)
  return { cwd: workspaceRoot, projectId: null }
}

function sessionIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/terminal\/sessions\/([^/]+)$/)
  return match ? decodeSegment(match[1]) : null
}

function inputSessionIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/terminal\/sessions\/([^/]+)\/input$/)
  return match ? decodeSegment(match[1]) : null
}

export async function handleTerminalApi(req, res, url, options = {}) {
  await assertLocalTerminalRequest(req, options.isLocalRequest)

  if (req.method === 'GET' && url.pathname === '/api/terminal/capabilities') {
    sendJson(res, 200, { ...await terminalCapabilities(), ...await platformInfo() })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/terminal/sessions') {
    const projectId = url.searchParams.get('projectId') || undefined
    sendJson(res, 200, { sessions: listTerminalSessions(projectId) })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/terminal/sessions') {
    const body = await readJsonBody(req, 16 * 1024) || {}
    const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
    const { cwd, projectId: resolvedProjectId } = await resolveTerminalCwd(projectId)
    const shellProfileId = typeof body.shellProfileId === 'string' ? body.shellProfileId : undefined
    const profile = await resolveTerminalShellProfile(shellProfileId)
    const session = await createTerminalSession({
      cwd,
      projectId: resolvedProjectId,
      name: typeof body.name === 'string' ? body.name : undefined,
      cols: Number(body.cols) || 120,
      rows: Number(body.rows) || 30,
      shellProfileId: profile?.id,
      shellProfileName: profile?.name,
    })
    sendJson(res, 201, session)
    return
  }

  const inputSessionId = inputSessionIdFromPath(url.pathname)
  if ((req.method === 'POST' || req.method === 'PUT') && inputSessionId) {
    const body = await readJsonBody(req, 256 * 1024) || {}
    if (typeof body.data !== 'string') throw error('Terminal input data is required', 400)
    writeTerminalInput(inputSessionId, body.data)
    sendJson(res, 200, { ok: true })
    return
  }

  const sessionId = sessionIdFromPath(url.pathname)
  if (sessionId) {
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readJsonBody(req, 256 * 1024) || {}
      if (typeof body.data !== 'string') throw error('Terminal input data is required', 400)
      writeTerminalInput(sessionId, body.data)
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'DELETE') {
      destroyTerminalSession(sessionId)
      sendJson(res, 200, { ok: true })
      return
    }
  }

  throw error('Not found', 404)
}

export function handleTerminalUpgrade(req, socket, head, url, options = {}) {
  void handleTerminalUpgradeAsync(req, socket, head, url, options)
}

async function handleTerminalUpgradeAsync(req, socket, head, url, options = {}) {
  try {
    await assertLocalTerminalRequest(req, options.isLocalRequest)
    const match = url.pathname.match(/^\/api\/terminal\/sessions\/([^/]+)\/ws$/)
    if (!match) throw error('Not found', 404)
    const sessionId = decodeSegment(match[1])

    wsServer.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {
        // The terminal manager installs its own handler after a successful attach.
        // Keep this fallback so attach failures do not leave an unhandled ws error.
      })
      try {
        attachTerminalClient(sessionId, ws)
      } catch (err) {
        try {
          ws.send(JSON.stringify({ type: 'error', message: err?.message || 'Terminal connection failed' }), () => ws.close())
        } catch {
          ws.close()
        }
      }
    })
  } catch (err) {
    socket.on('error', () => {})
    if (!socket.destroyed) {
      try { socket.write(`HTTP/1.1 ${err.statusCode || 500} ${err.message || 'Terminal upgrade failed'}\r\n\r\n`) } catch { /* ignore */ }
    }
    socket.destroy()
  }
}

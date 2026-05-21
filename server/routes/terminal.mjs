import path from 'node:path'
import { WebSocketServer } from 'ws'
import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { projectContextFromId, readProjectConfig, getActiveProject } from '../project-config.mjs'
import { getWorkspaceRoot, assertDirectory } from '../utils/workspace.mjs'
import {
  attachTerminalClient,
  createTerminalSession,
  destroyTerminalSession,
  listTerminalSessions,
  platformInfo,
  terminalCapabilities,
} from '../terminal/terminal-manager.mjs'

const wsServer = new WebSocketServer({ noServer: true })

function error(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

function assertLocalTerminalRequest(req, isLocalRequest) {
  if (!isLocalRequest) throw error('Terminal is only available from localhost', 403)
  const capabilities = terminalCapabilities()
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

export async function handleTerminalApi(req, res, url, options = {}) {
  assertLocalTerminalRequest(req, options.isLocalRequest)

  if (req.method === 'GET' && url.pathname === '/api/terminal/capabilities') {
    sendJson(res, 200, { ...terminalCapabilities(), ...platformInfo() })
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
    const session = createTerminalSession({
      cwd,
      projectId: resolvedProjectId,
      name: typeof body.name === 'string' ? body.name : undefined,
      cols: Number(body.cols) || 120,
      rows: Number(body.rows) || 30,
    })
    sendJson(res, 201, session)
    return
  }

  const sessionId = sessionIdFromPath(url.pathname)
  if (req.method === 'DELETE' && sessionId) {
    destroyTerminalSession(sessionId)
    sendJson(res, 200, { ok: true })
    return
  }

  throw error('Not found', 404)
}

export function handleTerminalUpgrade(req, socket, head, url, options = {}) {
  try {
    assertLocalTerminalRequest(req, options.isLocalRequest)
    const match = url.pathname.match(/^\/api\/terminal\/sessions\/([^/]+)\/ws$/)
    if (!match) throw error('Not found', 404)
    const sessionId = decodeSegment(match[1])

    wsServer.handleUpgrade(req, socket, head, (ws) => {
      try {
        attachTerminalClient(sessionId, ws)
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: err?.message || 'Terminal connection failed' }))
        ws.close()
      }
    })
  } catch (err) {
    socket.write(`HTTP/1.1 ${err.statusCode || 500} ${err.message || 'Terminal upgrade failed'}\r\n\r\n`)
    socket.destroy()
  }
}

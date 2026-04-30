import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { getActiveProject, setActiveProjectPath, readProjectConfig, writeProjectConfig } from '../project-config.mjs'
import { getWorkspaceRoot, setWorkspaceRoot } from '../utils/workspace.mjs'
import { selectDirectoryDialog } from '../utils/platform.mjs'
import path from 'node:path'

export async function handleProjectApi(req, res, url) {
  const config = await readProjectConfig()

  if (req.method === 'GET' && url.pathname === '/api/project') {
    sendJson(res, 200, { project: getActiveProject(config), projects: config.projects, workspaceRoot: getWorkspaceRoot() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/project/select-directory') {
    console.log('[project] Opening directory picker dialog...')
    const selectedPath = await selectDirectoryDialog()
    console.log('[project] Directory picker result:', selectedPath ? `"${selectedPath}"` : '(cancelled/empty)')
    if (!selectedPath) {
      sendJson(res, 200, { cancelled: true, project: getActiveProject(config), projects: config.projects })
      return
    }
    const result = await setActiveProjectPath(selectedPath)
    sendJson(res, 200, { cancelled: false, ...result, workspaceRoot: getWorkspaceRoot() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/project/path') {
    const body = await readJsonBody(req)
    const result = await setActiveProjectPath(body?.path)
    sendJson(res, 200, { ...result, workspaceRoot: getWorkspaceRoot() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/project/active') {
    const body = await readJsonBody(req)
    const selected = config.projects.find((project) => project.id === body?.id)
    if (!selected) {
      const error = new Error('Unknown project')
      error.statusCode = 404
      throw error
    }
    const result = await setActiveProjectPath(selected.path)
    sendJson(res, 200, { ...result, workspaceRoot: getWorkspaceRoot() })
    return
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/project/')) {
    const id = decodeSegment(url.pathname.split('/').filter(Boolean)[2])
    const nextProjects = config.projects.filter((project) => project.id !== id)
    if (nextProjects.length === config.projects.length) {
      const error = new Error('Unknown project')
      error.statusCode = 404
      throw error
    }
    config.projects = nextProjects.length ? nextProjects : defaultProjectConfigFallback().projects
    if (config.activeProjectId === id) config.activeProjectId = config.projects[0].id
    await writeProjectConfig(config)
    const active = getActiveProject(config)
    setWorkspaceRoot(path.resolve(active.path))
    sendJson(res, 200, { project: active, projects: config.projects, workspaceRoot: getWorkspaceRoot() })
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

function defaultProjectConfigFallback() {
  const fallbackPath = getWorkspaceRoot()
  return {
    activeProjectId: 'default',
    projects: [{ id: 'default', name: path.basename(fallbackPath) || 'QuickForge', path: fallbackPath, lastOpenedAt: new Date().toISOString() }],
  }
}

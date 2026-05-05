import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureProjectCache, readProjectConfigData, atomicProjectConfigUpdate, dataDir } from './storage.mjs'
import { promises as fs } from 'node:fs'
import { setWorkspaceRoot, getWorkspaceRoot, assertDirectory } from './utils/workspace.mjs'

let defaultWorkspaceRoot = ''

export function setDefaultWorkspaceRoot(root) {
  defaultWorkspaceRoot = path.resolve(root)
}

function projectNameFromPath(dir) {
  return path.basename(dir) || dir
}

function defaultProjectConfig() {
  return {
    activeProjectId: null,
    projects: [],
  }
}

export async function readProjectConfig() {
  const parsed = await readProjectConfigData()
  if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) return defaultProjectConfig()
  return parsed
}

export function getActiveProject(config) {
  return config.projects.find((project) => project.id === config.activeProjectId) || config.projects[0]
}

export async function setActiveProjectPath(inputPath) {
  const resolved = path.resolve(String(inputPath || ''))
  await assertDirectory(resolved)

  const now = new Date().toISOString()
  let project

  const updated = await atomicProjectConfigUpdate((config) => {
    project = config.projects.find((item) => path.resolve(item.path) === resolved)
    if (!project) {
      project = {
        id: randomUUID(),
        name: projectNameFromPath(resolved),
        path: resolved,
        lastOpenedAt: now,
      }
      config.projects.unshift(project)
    } else {
      project.name = projectNameFromPath(resolved)
      project.path = resolved
      project.lastOpenedAt = now
    }

    config.activeProjectId = project.id
    config.projects = [project, ...config.projects.filter((item) => item.id !== project.id)].slice(0, 20)
    return config
  })

  await ensureProjectCache(project.id)
  setWorkspaceRoot(resolved)
  return { project, projects: updated.projects }
}

export async function initializeActiveProject() {
  const config = await readProjectConfig()
  const activeProject = getActiveProject(config)
  if (activeProject?.path) {
    try {
      await assertDirectory(activeProject.path)
      await ensureProjectCache(activeProject.id)
      setWorkspaceRoot(path.resolve(activeProject.path))
      return
    } catch {
      // Fall back to the app project if the stored project was removed.
    }
  }

  // No project configured — leave workspace unset, user will be prompted to add one.
}

export async function projectContextFromId(projectId) {
  const config = await readProjectConfig()
  const project = config.projects.find((item) => item.id === projectId)
  if (!project) {
    const error = new Error('Unknown project')
    error.statusCode = 404
    throw error
  }

  await assertDirectory(project.path)
  await ensureProjectCache(project.id)
  return { project, workspaceRoot: path.resolve(project.path) }
}

export async function readInstructionsFile(filePath) {
  const candidates = filePath.endsWith('AGENTS.md')
    ? [filePath, path.join(path.dirname(filePath), 'agents.md')]
    : [filePath]

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, 'utf8')
      const trimmed = content.trim()
      if (trimmed) return trimmed
    } catch {
      // try next candidate
    }
  }
  return null
}

export async function buildInstructionsPayload(projectId) {
  let projectInstructions = null

  if (projectId) {
    try {
      const { workspaceRoot } = await projectContextFromId(projectId)
      projectInstructions = await readInstructionsFile(path.join(workspaceRoot, 'AGENTS.md'))
    } catch {
      // project not found or inaccessible — leave projectInstructions null
    }
  }

  const globalInstructions = await readInstructionsFile(path.join(dataDir, 'AGENTS.md'))

  return {
    global: globalInstructions,
    project: projectInstructions,
  }
}

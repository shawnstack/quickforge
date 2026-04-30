import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureStorage, projectConfigFile, dataDir } from './storage.mjs'
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
  await ensureStorage()
  const file = projectConfigFile()
  try {
    const text = await fs.readFile(file, 'utf8')
    const parsed = text.trim() ? JSON.parse(text) : defaultProjectConfig()
    if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) return defaultProjectConfig()
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultProjectConfig()
    throw error
  }
}

export async function writeProjectConfig(config) {
  await ensureStorage()
  const file = projectConfigFile()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, file)
}

export function getActiveProject(config) {
  return config.projects.find((project) => project.id === config.activeProjectId) || config.projects[0]
}

export async function setActiveProjectPath(inputPath) {
  const resolved = path.resolve(String(inputPath || ''))
  await assertDirectory(resolved)

  const config = await readProjectConfig()
  const now = new Date().toISOString()
  let project = config.projects.find((item) => path.resolve(item.path) === resolved)
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
  await writeProjectConfig(config)
  setWorkspaceRoot(resolved)
  return { project, projects: config.projects }
}

export async function initializeActiveProject() {
  const config = await readProjectConfig()
  const activeProject = getActiveProject(config)
  if (activeProject?.path) {
    try {
      await assertDirectory(activeProject.path)
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
  return { project, workspaceRoot: path.resolve(project.path) }
}

export async function readInstructionsFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    const trimmed = content.trim()
    return trimmed || null
  } catch {
    return null
  }
}

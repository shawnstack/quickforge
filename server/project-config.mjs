import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureProjectCache, readProjectConfigData, atomicProjectConfigUpdate, dataDir } from './storage.mjs'
import { promises as fs } from 'node:fs'
import { setWorkspaceRoot, getWorkspaceRoot, assertDirectory } from './utils/workspace.mjs'
import { loadSelectedGlobalSkills, loadSelectedProjectSkills, mergeSkills } from './skills.mjs'

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
    globalSkills: [],
    projects: [],
  }
}

function normalizeProjectConfig(config) {
  if (!config || typeof config !== 'object') return defaultProjectConfig()
  return {
    activeProjectId: typeof config.activeProjectId === 'string' ? config.activeProjectId : null,
    globalSkills: Array.isArray(config.globalSkills) ? config.globalSkills : [],
    projects: Array.isArray(config.projects) ? config.projects : [],
  }
}

export async function readProjectConfig() {
  return normalizeProjectConfig(await readProjectConfigData())
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
        skills: [],
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
  const config = await readProjectConfig()
  let projectInstructions = null
  let project = projectId ? config.projects.find((item) => item.id === projectId) ?? null : null

  if (projectId) {
    try {
      const context = await projectContextFromId(projectId)
      project = context.project
      projectInstructions = await readInstructionsFile(path.join(context.workspaceRoot, 'AGENTS.md'))
    } catch {
      // project not found or inaccessible — leave projectInstructions null
    }
  }

  const globalInstructions = await readInstructionsFile(path.join(dataDir, 'AGENTS.md'))
  const globalSkills = await loadSelectedGlobalSkills(config.globalSkills)
  const projectSkills = project?.skills && project?.path
    ? await loadSelectedProjectSkills(project.skills, project.path)
    : []
  const activeSkills = mergeSkills(globalSkills, projectSkills)
  const stripRuntimeFields = ({ rootDir: _rootDir, instructions: _instructions, location: _location, ...skill }) => skill

  return {
    workspace: project
      ? {
          id: project.id,
          name: project.name,
          root: project.path,
        }
      : null,
    global: globalInstructions,
    project: projectInstructions,
    globalSkills: globalSkills.map(stripRuntimeFields),
    projectSkills: projectSkills.map(stripRuntimeFields),
    skills: activeSkills.map(stripRuntimeFields),
  }
}

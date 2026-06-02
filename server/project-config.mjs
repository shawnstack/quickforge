import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { ensureProjectCache, readProjectConfigData, atomicProjectConfigUpdate, dataDir, readStore, atomicUpdate } from './storage.mjs'
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

const TERMINAL_SHELL_PROFILE_CANDIDATES = [
  { id: 'cmd', name: 'Command Prompt', command: 'cmd.exe', platforms: ['win32'] },
  { id: 'powershell', name: 'Windows PowerShell', command: 'powershell.exe', platforms: ['win32'] },
  { id: 'pwsh', name: 'PowerShell 7+', command: 'pwsh.exe', platforms: ['win32', 'darwin', 'linux', 'freebsd', 'openbsd'] },
  { id: 'zsh', name: 'Zsh', command: '/bin/zsh', platforms: ['darwin'] },
  { id: 'bash', name: 'Bash', command: '/bin/bash', platforms: ['darwin', 'linux', 'freebsd', 'openbsd'] },
  { id: 'fish', name: 'Fish', command: 'fish', platforms: ['darwin', 'linux', 'freebsd', 'openbsd'] },
  { id: 'sh', name: 'Sh', command: '/bin/sh', platforms: ['darwin', 'linux', 'freebsd', 'openbsd'] },
]

const BUILTIN_TERMINAL_SHELL_PROFILES = terminalShellProfileCandidatesForPlatform()

function isWindows() {
  return process.platform === 'win32'
}

function commandExists(command) {
  if (!command) return true
  if (command.includes('/') || command.includes('\\')) return existsSync(command)
  const probe = isWindows() ? 'where' : 'command'
  const args = isWindows() ? [command] : ['-v', command]
  const result = spawnSync(probe, args, { shell: !isWindows(), stdio: 'ignore', windowsHide: true })
  return result.status === 0
}

function terminalShellProfileCandidatesForPlatform(platform = os.platform()) {
  const profiles = TERMINAL_SHELL_PROFILE_CANDIDATES
    .filter((profile) => profile.platforms.includes(platform))
    .filter((profile) => commandExists(profile.command))
    .map(({ platforms, ...profile }) => ({ ...profile, builtin: true, detected: true }))

  return profiles
}

function nameFromTerminalShellCommand(command) {
  const normalized = String(command || '').trim().replace(/^"|"$/g, '')
  const executable = normalized.split(/[\\/]/).pop()?.replace(/^"|"$/g, '') || normalized
  if (/^bash(\.exe)?$/i.test(executable)) return 'Bash'
  if (/^zsh$/i.test(executable)) return 'Zsh'
  if (/^fish$/i.test(executable)) return 'Fish'
  if (/^cmd(\.exe)?$/i.test(executable)) return 'Command Prompt'
  if (/^powershell(\.exe)?$/i.test(executable)) return 'Windows PowerShell'
  if (/^pwsh(\.exe)?$/i.test(executable)) return 'PowerShell 7+'
  if (/^sh$/i.test(executable)) return 'Sh'
  return executable || 'Custom Shell'
}

function normalizeTerminalShell(value) {
  const shell = String(value || '').trim()
  if (!shell || shell === 'auto') return 'auto'
  if (shell.length > 500 || /[\r\n\0]/.test(shell)) return 'auto'
  return shell
}

function normalizeTerminalShellName(value) {
  const name = String(value || '').trim()
  if (!name || name.length > 80 || /[\r\n\0]/.test(name)) return ''
  return name
}

function normalizeTerminalShellProfileId(value) {
  const id = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  if (!id || BUILTIN_TERMINAL_SHELL_PROFILES.some((profile) => profile.id === id)) {
    return `custom_${randomUUID().slice(0, 8)}`
  }
  return id
}

function normalizeCustomTerminalShellProfiles(value) {
  if (!Array.isArray(value)) return []
  const profiles = []
  const usedIds = new Set(BUILTIN_TERMINAL_SHELL_PROFILES.map((profile) => profile.id))

  for (const item of value.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue
    const command = normalizeTerminalShell(item.command)
    if (command === 'auto') continue
    const name = normalizeTerminalShellName(item.name) || nameFromTerminalShellCommand(command)
    let id = normalizeTerminalShellProfileId(item.id)
    while (usedIds.has(id)) id = `custom_${randomUUID().slice(0, 8)}`
    usedIds.add(id)
    profiles.push({ id, name, command, builtin: false, detected: false })
  }

  return profiles
}

function terminalShellConfigFromSettings(settings = {}) {
  const customProfiles = normalizeCustomTerminalShellProfiles(settings.terminalShellProfiles)
  const profiles = [...BUILTIN_TERMINAL_SHELL_PROFILES, ...customProfiles]
  const legacyShell = normalizeTerminalShell(settings.terminalShell)
  let defaultProfileId = typeof settings.defaultTerminalShellProfileId === 'string'
    ? settings.defaultTerminalShellProfileId
    : 'auto'

  if ((!defaultProfileId || defaultProfileId === 'auto') && legacyShell !== 'auto') {
    const legacyBuiltin = BUILTIN_TERMINAL_SHELL_PROFILES.find((profile) => profile.command === legacyShell)
    if (legacyBuiltin) {
      defaultProfileId = legacyBuiltin.id
    } else if (!customProfiles.some((profile) => profile.command === legacyShell)) {
      profiles.push({ id: 'custom_legacy', name: nameFromTerminalShellCommand(legacyShell), command: legacyShell, builtin: false, detected: false })
      defaultProfileId = 'custom_legacy'
    }
  }

  if (!profiles.some((profile) => profile.id === defaultProfileId)) defaultProfileId = 'auto'
  const selectedProfile = profiles.find((profile) => profile.id === defaultProfileId) || profiles[0]

  return {
    terminalShell: selectedProfile.command,
    defaultProfileId,
    profiles,
  }
}

export async function readTerminalShellConfig() {
  return terminalShellConfigFromSettings(await readStore('settings'))
}

export async function updateTerminalShellConfig(input = {}) {
  let result
  await atomicUpdate('settings', (settings) => {
    const current = terminalShellConfigFromSettings(settings)
    const customProfiles = normalizeCustomTerminalShellProfiles(
      Array.isArray(input.profiles) ? input.profiles : current.profiles.filter((profile) => !profile.builtin),
    )
    const profiles = [...BUILTIN_TERMINAL_SHELL_PROFILES, ...customProfiles]
    let defaultProfileId = typeof input.defaultProfileId === 'string' ? input.defaultProfileId : current.defaultProfileId
    if (!profiles.some((profile) => profile.id === defaultProfileId)) defaultProfileId = 'auto'
    const selectedProfile = profiles.find((profile) => profile.id === defaultProfileId) || profiles[0]

    if (customProfiles.length > 0) settings.terminalShellProfiles = customProfiles
    else delete settings.terminalShellProfiles
    if (defaultProfileId === 'auto') delete settings.defaultTerminalShellProfileId
    else settings.defaultTerminalShellProfileId = defaultProfileId
    if (selectedProfile.command === 'auto') delete settings.terminalShell
    else settings.terminalShell = selectedProfile.command

    result = { terminalShell: selectedProfile.command, defaultProfileId, profiles }
    return settings
  })
  return result
}

export async function readTerminalShellSetting() {
  const config = await readTerminalShellConfig()
  return normalizeTerminalShell(config.terminalShell)
}

export async function updateTerminalShellSetting(value) {
  const terminalShell = normalizeTerminalShell(value)
  const builtin = BUILTIN_TERMINAL_SHELL_PROFILES.find((profile) => profile.command === terminalShell)
  const customProfiles = terminalShell === 'auto' || builtin
    ? []
    : [{ id: `custom_${randomUUID().slice(0, 8)}`, name: nameFromTerminalShellCommand(terminalShell), command: terminalShell, builtin: false, detected: false }]
  const config = await updateTerminalShellConfig({
    defaultProfileId: builtin?.id || customProfiles[0]?.id || 'auto',
    profiles: customProfiles,
  })
  return config.terminalShell
}

export async function resolveTerminalShellProfile(profileId) {
  const config = await readTerminalShellConfig()
  const selectedId = typeof profileId === 'string' && profileId ? profileId : config.defaultProfileId
  const profile = config.profiles.find((item) => item.id === selectedId)
    || config.profiles.find((item) => item.command === selectedId)
    || config.profiles.find((item) => item.id === config.defaultProfileId)
    || config.profiles[0]
  return profile
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
        commandDir: '',
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

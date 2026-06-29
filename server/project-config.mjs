import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { ensureProjectCache, readProjectConfigData, atomicProjectConfigUpdate, dataDir, readStore, atomicUpdate } from './storage.mjs'
import { setWorkspaceRoot, assertDirectory } from './utils/workspace.mjs'
import { loadSelectedGlobalSkills, loadSelectedProjectSkills, mergeSkills } from './skills.mjs'

let defaultWorkspaceRoot = ''

export function setDefaultWorkspaceRoot(root) {
  defaultWorkspaceRoot = path.resolve(root)
}

export function getDefaultWorkspaceRoot() {
  return defaultWorkspaceRoot
}

// Synthetic workspace context for global conversations (no projectId).
// Gives global chats the same file-tool capabilities as project chats, rooted
// at the default workspace directory (~/.quickforge/workspace by default). The
// synthetic `project` object (id 'default') lets workspace/git/terminal REST
// endpoints and subagents keep working without a real registered project.
export function defaultGlobalWorkspaceContext() {
  return {
    project: {
      id: 'default',
      name: 'workspace',
      path: defaultWorkspaceRoot,
      lastOpenedAt: '',
      sortOrder: 0,
      skills: [],
      commandDir: '',
    },
    workspaceRoot: defaultWorkspaceRoot,
  }
}

function projectNameFromPath(dir) {
  return path.basename(dir) || dir
}

// Compare two project paths for equality in a cross-platform way.
// On Windows (and other case-insensitive filesystems) drive-letter casing and
// path separators can differ while pointing at the same directory. Normalize
// both sides to a resolved lowercase form so the same directory always matches
// an existing project instead of being re-registered with a new id.
export function sameProjectPath(a, b) {
  if (!a || !b) return false
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
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
    .map(({ platforms: _platforms, ...profile }) => ({ ...profile, builtin: true, detected: true }))

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
    project = config.projects.find((item) => sameProjectPath(item.path, resolved))
    if (!project) {
      project = {
        id: randomUUID(),
        name: projectNameFromPath(resolved),
        path: resolved,
        lastOpenedAt: now,
        sortOrder: config.projects.length,
        skills: [],
        commandDir: '',
      }
      config.projects.push(project)
    } else {
      project.name = projectNameFromPath(resolved)
      project.path = resolved
      project.lastOpenedAt = now
    }

    config.activeProjectId = project.id
    if (config.projects.length > 20) config.projects = config.projects.slice(-20)
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

  // No project configured — fall back to the default workspace root so global
  // conversations still have a working directory and the filesystem browser works.
  setWorkspaceRoot(defaultWorkspaceRoot)
}

export async function projectContextFromId(projectId) {
  const config = await readProjectConfig()
  const project = config.projects.find((item) => item.id === projectId)
  if (!project) {
    // Unknown or removed project (e.g. a global conversation's synthetic id) —
    // fall back to the default workspace so workspace/git REST endpoints keep
    // working for global conversations.
    return defaultGlobalWorkspaceContext()
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

async function readInstructionSources(candidates) {
  const sources = []
  const seen = new Set()

  for (const candidate of candidates) {
    const file = path.resolve(candidate.file)
    if (seen.has(file)) continue
    seen.add(file)

    try {
      const content = await fs.readFile(file, 'utf8')
      const trimmed = content.trim()
      if (trimmed) sources.push({ source: candidate.source, content: trimmed })
    } catch {
      // optional compatibility source
    }
  }

  return sources
}

function combineInstructionSources(sources) {
  return sources.map((source) => source.content).join('\n\n') || null
}

function globalInstructionCandidates() {
  const home = os.homedir()
  return [
    { file: path.join(home, '.claude', 'CLAUDE.md'), source: '~/.claude/CLAUDE.md' },
    { file: path.join(home, '.opencode', 'AGENTS.md'), source: '~/.opencode/AGENTS.md' },
    { file: path.join(dataDir, 'AGENTS.md'), source: '~/.quickforge/AGENTS.md' },
    { file: path.join(dataDir, 'agents.md'), source: '~/.quickforge/agents.md' },
  ]
}

function projectInstructionCandidates(workspaceRoot) {
  return [
    { file: path.join(workspaceRoot, 'CLAUDE.md'), source: 'CLAUDE.md' },
    { file: path.join(workspaceRoot, 'AGENTS.md'), source: 'AGENTS.md' },
    { file: path.join(workspaceRoot, 'agents.md'), source: 'agents.md' },
    { file: path.join(workspaceRoot, '.opencode', 'AGENTS.md'), source: '.opencode/AGENTS.md' },
    { file: path.join(workspaceRoot, '.quickforge', 'AGENTS.md'), source: '.quickforge/AGENTS.md' },
  ]
}

export async function buildInstructionsPayload(projectId) {
  const config = await readProjectConfig()
  let projectInstructionSources = []
  let project = projectId ? config.projects.find((item) => item.id === projectId) ?? null : null

  if (projectId) {
    try {
      const context = await projectContextFromId(projectId)
      project = context.project
      projectInstructionSources = await readInstructionSources(projectInstructionCandidates(context.workspaceRoot))
    } catch {
      // project not found or inaccessible — leave projectInstructions null
    }
  }

  const globalInstructionSources = await readInstructionSources(globalInstructionCandidates())
  const globalInstructions = combineInstructionSources(globalInstructionSources)
  const projectInstructions = combineInstructionSources(projectInstructionSources)
  const globalSkills = await loadSelectedGlobalSkills(config.globalSkills)
  const projectSkills = project?.path
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
      : (defaultWorkspaceRoot ? { name: 'workspace', root: defaultWorkspaceRoot } : null),
    global: globalInstructions,
    project: projectInstructions,
    globalSources: globalInstructionSources,
    projectSources: projectInstructionSources,
    globalSkills: globalSkills.map(stripRuntimeFields),
    projectSkills: projectSkills.map(stripRuntimeFields),
    skills: activeSkills.map(stripRuntimeFields),
  }
}

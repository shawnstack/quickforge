import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dataDir } from './storage.mjs'
import { getEnabledPluginSkillSources } from './plugins/registry.mjs'

const userSkillsDir = path.join(dataDir, 'skills')
const sharedUserSkillsDir = path.join(os.homedir(), '.agents', 'skills')
const defaultEntry = 'SKILL.md'
const resourceDirs = ['scripts', 'references', 'assets']
const maxResourceFiles = 200

function isValidSkillName(value) {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 64 &&
    /^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
  )
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const item of value) {
    const text = normalizeString(item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

export function normalizeSkillNames(value) {
  return normalizeStringArray(value).filter(isValidSkillName)
}

function isPathInside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function readJsonFile(file, defaultValue = {}) {
  try {
    const text = await fs.readFile(file, 'utf8')
    const json = text.trimStart()
    return json ? JSON.parse(json) : defaultValue
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultValue
    throw error
  }
}

async function readOptionalText(file) {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function parseFrontmatter(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '')
  const match = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/)
  if (!match) return null
  return {
    frontmatter: match[1],
    body: match[2].trim(),
  }
}

function leadingIndent(line) {
  const match = line.match(/^\s*/)
  return match ? match[0].length : 0
}

function stripInlineComment(value) {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return trimmed
  const index = trimmed.indexOf(' #')
  return index >= 0 ? trimmed.slice(0, index).trimEnd() : trimmed
}

function parseYamlScalar(value) {
  const trimmed = stripInlineComment(String(value ?? ''))
  if (!trimmed) return ''

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
  }

  return trimmed
}

function collectIndentedBlock(lines, startIndex, parentIndent) {
  const block = []
  let index = startIndex
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      block.push(line)
      index++
      continue
    }
    if (leadingIndent(line) <= parentIndent) break
    block.push(line)
    index++
  }
  return { block, nextIndex: index }
}

function parseBlockScalar(lines, style) {
  const nonEmpty = lines.filter((line) => line.trim())
  const minIndent = nonEmpty.length
    ? Math.min(...nonEmpty.map((line) => leadingIndent(line)))
    : 0
  const unindented = lines.map((line) => line.slice(Math.min(minIndent, line.length)))
  return style === '>'
    ? unindented.join(' ').replace(/\s+/g, ' ').trim()
    : unindented.join('\n').trim()
}

function parseSimpleYamlMap(text) {
  const result = {}
  const lines = String(text || '').split(/\r?\n/)
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || leadingIndent(line) > 0) {
      index++
      continue
    }

    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/)
    if (!match) {
      index++
      continue
    }

    const [, key, rawValue = ''] = match
    const value = rawValue.trim()

    if (value === '|' || value === '>') {
      const { block, nextIndex } = collectIndentedBlock(lines, index + 1, 0)
      result[key] = parseBlockScalar(block, value)
      index = nextIndex
      continue
    }

    if (value) {
      result[key] = parseYamlScalar(value)
      index++
      continue
    }

    const nested = {}
    let nestedIndex = index + 1
    while (nestedIndex < lines.length) {
      const nestedLine = lines[nestedIndex]
      const nestedTrimmed = nestedLine.trim()
      if (!nestedTrimmed || nestedTrimmed.startsWith('#')) {
        nestedIndex++
        continue
      }

      const indent = leadingIndent(nestedLine)
      if (indent <= 0) break

      const nestedMatch = nestedLine.slice(indent).match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/)
      if (!nestedMatch) {
        nestedIndex++
        continue
      }

      const [, nestedKey, nestedRawValue = ''] = nestedMatch
      nested[nestedKey] = parseYamlScalar(nestedRawValue.trim())
      nestedIndex++
    }

    result[key] = Object.keys(nested).length ? nested : ''
    index = Object.keys(nested).length ? nestedIndex : index + 1
  }

  return result
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const metadata = {}
  for (const [key, item] of Object.entries(value)) {
    if (!key || item === undefined || item === null || typeof item === 'object') continue
    metadata[key] = String(item)
  }
  return metadata
}

async function listSkillDirectories(root) {
  if (!root || !existsSync(root)) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
}

function splitMetadataList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function metadataValue(metadata, key) {
  return normalizeString(metadata[key])
}

function skillFromStandardMarkdown(rootDir, source, text) {
  const parsed = parseFrontmatter(text)
  if (!parsed?.body) return null

  const rawManifest = parseSimpleYamlMap(parsed.frontmatter)
  const name = normalizeString(rawManifest.name)
  const description = normalizeString(rawManifest.description)
  if (!name || !isValidSkillName(name)) return null
  if (name !== path.basename(rootDir)) return null
  if (!description || description.length > 1024) return null

  const metadata = normalizeMetadata(rawManifest.metadata)
  const compatibility = normalizeString(rawManifest.compatibility)

  return {
    name,
    displayName: metadataValue(metadata, 'displayName') || metadataValue(metadata, 'title'),
    description,
    license: normalizeString(rawManifest.license),
    compatibility: compatibility && compatibility.length <= 500 ? compatibility : undefined,
    metadata,
    allowedTools: normalizeString(rawManifest['allowed-tools']),
    version: metadataValue(metadata, 'version'),
    tags: splitMetadataList(metadata.tags),
    triggers: splitMetadataList(metadata.triggers),
    entry: defaultEntry,
    source,
    rootDir,
    location: path.join(rootDir, defaultEntry),
    instructions: parsed.body,
  }
}

async function loadLegacySkillDirectory(rootDir, source) {
  const rawManifest = await readJsonFile(path.join(rootDir, 'skill.json'), null)
  if (!rawManifest || typeof rawManifest !== 'object') return null
  if (rawManifest.enabled === false) return null

  const name = normalizeString(rawManifest.name) || path.basename(rootDir)
  if (!isValidSkillName(name)) return null

  const entry = normalizeString(rawManifest.entry) || defaultEntry
  const entryPath = path.resolve(rootDir, entry)
  if (!isPathInside(rootDir, entryPath)) return null

  const instructions = (await readOptionalText(entryPath))?.trim()
  const description = normalizeString(rawManifest.description)
  if (!instructions || !description) return null

  return {
    name,
    displayName: normalizeString(rawManifest.displayName) || normalizeString(rawManifest.title),
    description,
    license: normalizeString(rawManifest.license),
    compatibility: normalizeString(rawManifest.compatibility),
    metadata: rawManifest.metadata && typeof rawManifest.metadata === 'object' ? rawManifest.metadata : {},
    allowedTools: normalizeString(rawManifest.allowedTools) || normalizeString(rawManifest['allowed-tools']),
    version: normalizeString(rawManifest.version),
    tags: normalizeStringArray(rawManifest.tags),
    triggers: normalizeStringArray(rawManifest.triggers),
    entry,
    source,
    rootDir,
    location: entryPath,
    instructions,
  }
}

async function loadSkillDirectory(rootDir, source) {
  const skillText = await readOptionalText(path.join(rootDir, defaultEntry))
  if (skillText) {
    const standardSkill = skillFromStandardMarkdown(rootDir, source, skillText)
    if (standardSkill) return standardSkill
  }

  return loadLegacySkillDirectory(rootDir, source)
}

function projectClientSkillsDir(workspaceRoot) {
  return workspaceRoot ? path.join(path.resolve(workspaceRoot), '.quickforge', 'skills') : ''
}

function projectSharedSkillsDir(workspaceRoot) {
  return workspaceRoot ? path.join(path.resolve(workspaceRoot), '.agents', 'skills') : ''
}

async function loadSkillsFromSources(sources) {
  const skillsByName = new Map()

  for (const source of sources) {
    for (const skillDir of await listSkillDirectories(source.dir)) {
      try {
        const skill = await loadSkillDirectory(skillDir, source.name)
        if (!skill) continue
        if (skillsByName.has(skill.name)) skillsByName.delete(skill.name)
        skillsByName.set(skill.name, skill)
      } catch (error) {
        console.warn(`Failed to load skill from ${skillDir}:`, error.message || error)
      }
    }
  }

  return [...skillsByName.values()].sort((a, b) => {
    const left = (a.displayName || a.name).toLowerCase()
    const right = (b.displayName || b.name).toLowerCase()
    return left.localeCompare(right)
  })
}

async function loadSkillsFromExplicitSources(sources) {
  const skillsByName = new Map()

  for (const source of sources) {
    const candidateDirs = [source.dir, ...(await listSkillDirectories(source.dir))]
    for (const skillDir of candidateDirs) {
      try {
        const skill = await loadSkillDirectory(skillDir, source.name)
        if (!skill) continue
        if (skillsByName.has(skill.name)) skillsByName.delete(skill.name)
        skillsByName.set(skill.name, skill)
      } catch (error) {
        console.warn(`Failed to load skill from ${skillDir}:`, error.message || error)
      }
    }
  }

  return [...skillsByName.values()].sort((a, b) => {
    const left = (a.displayName || a.name).toLowerCase()
    const right = (b.displayName || b.name).toLowerCase()
    return left.localeCompare(right)
  })
}

function searchDirsForList(value) {
  return value.length === 1 ? value[0] : value.slice()
}

function summarizeSkills(skills) {
  return skills.map(({ instructions: _instructions, rootDir: _rootDir, location: _location, ...summary }) => summary)
}

function filterKnownNames(skillNames, skills) {
  const selected = normalizeSkillNames(skillNames)
  if (selected.length === 0) return []

  const known = new Set(skills.map((skill) => skill.name))
  return selected.filter((name) => known.has(name))
}

function selectSkills(skillNames, skills) {
  const selected = normalizeSkillNames(skillNames)
  if (selected.length === 0) return []

  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  return selected.map((name) => byName.get(name)).filter(Boolean)
}

export function mergeSkills(...skillLists) {
  const skillsByName = new Map()
  for (const skillList of skillLists) {
    for (const skill of Array.isArray(skillList) ? skillList : []) {
      if (!skill?.name) continue
      if (skillsByName.has(skill.name)) skillsByName.delete(skill.name)
      skillsByName.set(skill.name, skill)
    }
  }
  return [...skillsByName.values()]
}

export const skillSearchPaths = {
  global: searchDirsForList([sharedUserSkillsDir, userSkillsDir]),
  project: ['<project>/.agents/skills', '<project>/.quickforge/skills'],
}

export function projectSkillSearchPaths(workspaceRoot) {
  if (!workspaceRoot) return skillSearchPaths.project.slice()
  return searchDirsForList([projectSharedSkillsDir(workspaceRoot), projectClientSkillsDir(workspaceRoot), '<enabled-plugin>/skills'])
}

async function loadPluginSkills(workspaceRoot) {
  if (!workspaceRoot) return []
  const sources = await getEnabledPluginSkillSources({ workspaceRoot })
  return loadSkillsFromExplicitSources(sources.map((source) => ({ dir: source.dir, name: source.source })))
}

export async function loadGlobalSkills() {
  return loadSkillsFromSources([
    { dir: sharedUserSkillsDir, name: 'user-shared' },
    { dir: userSkillsDir, name: 'user' },
  ])
}

export async function loadProjectSkills(workspaceRoot) {
  const pluginSkills = await loadPluginSkills(workspaceRoot)
  const projectSkills = await loadSkillsFromSources([
    { dir: projectSharedSkillsDir(workspaceRoot), name: 'project-shared' },
    { dir: projectClientSkillsDir(workspaceRoot), name: 'project' },
  ])
  return mergeSkills(pluginSkills, projectSkills).sort((a, b) => {
    const left = (a.displayName || a.name).toLowerCase()
    const right = (b.displayName || b.name).toLowerCase()
    return left.localeCompare(right)
  })
}

export async function loadSkills() {
  return loadGlobalSkills()
}

export async function listGlobalSkillSummaries() {
  return summarizeSkills(await loadGlobalSkills())
}

export async function listProjectSkillSummaries(workspaceRoot) {
  return summarizeSkills(await loadProjectSkills(workspaceRoot))
}

export async function listSkillSummaries() {
  return listGlobalSkillSummaries()
}

export async function findGlobalSkill(name) {
  const skills = await loadGlobalSkills()
  return skills.find((skill) => skill.name === name) || null
}

export async function findProjectSkill(name, workspaceRoot) {
  const skills = await loadProjectSkills(workspaceRoot)
  return skills.find((skill) => skill.name === name) || null
}

export async function findSkill(name) {
  return findGlobalSkill(name)
}

export async function filterKnownGlobalSkillNames(skillNames) {
  return filterKnownNames(skillNames, await loadGlobalSkills())
}

export async function filterKnownProjectSkillNames(skillNames, workspaceRoot) {
  return filterKnownNames(skillNames, await loadProjectSkills(workspaceRoot))
}

export async function filterKnownSkillNames(skillNames) {
  return filterKnownGlobalSkillNames(skillNames)
}

export async function loadSelectedGlobalSkills(skillNames) {
  return selectSkills(skillNames, await loadGlobalSkills())
}

export async function loadSelectedProjectSkills(skillNames, workspaceRoot) {
  const skills = await loadProjectSkills(workspaceRoot)
  const pluginSkills = skills.filter((skill) => String(skill.source || '').startsWith('plugin:'))
  return mergeSkills(pluginSkills, selectSkills(skillNames, skills))
}

export async function loadSelectedSkills(skillNames) {
  return loadSelectedGlobalSkills(skillNames)
}

async function walkResourceFiles(rootDir, currentDir, files, maxFiles) {
  if (files.length >= maxFiles) return
  let entries
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true })
  } catch {
    return
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (files.length >= maxFiles) return
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      await walkResourceFiles(rootDir, fullPath, files, maxFiles)
    } else if (entry.isFile()) {
      files.push(path.relative(rootDir, fullPath).replace(/\\/g, '/'))
    }
  }
}

export async function listSkillResourceFiles(skill, maxFiles = maxResourceFiles) {
  const rootDir = skill?.rootDir
  if (!rootDir) return []

  const files = []
  for (const dirName of resourceDirs) {
    await walkResourceFiles(rootDir, path.join(rootDir, dirName), files, maxFiles)
    if (files.length >= maxFiles) break
  }
  return files
}

function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export async function formatSkillActivation(skill) {
  const resources = await listSkillResourceFiles(skill)
  const resourceBlock = resources.length
    ? `\n\n<skill_resources>\n${resources.map((file) => `  <file>${file}</file>`).join('\n')}\n</skill_resources>`
    : ''

  return `<skill_content name="${escapeAttribute(skill.name)}">\n${skill.instructions}\n\nSkill directory: ${skill.rootDir}\nRelative paths in this skill are relative to the skill directory. Use read_skill_resource with the skill name and a relative path when you need a bundled reference, script, or asset.${resourceBlock}\n</skill_content>`
}

export async function readSkillResource(skill, resourcePath, options = {}) {
  const rootDir = skill?.rootDir
  const input = normalizeString(resourcePath)
  if (!rootDir || !input) {
    const error = new Error('skill name and resource path are required')
    error.statusCode = 400
    throw error
  }
  if (path.isAbsolute(input)) {
    const error = new Error('resource path must be relative to the skill directory')
    error.statusCode = 400
    throw error
  }

  const file = path.resolve(rootDir, input)
  if (!isPathInside(rootDir, file)) {
    const error = new Error(`resource path is outside the skill directory: ${input}`)
    error.statusCode = 403
    throw error
  }

  const stat = await fs.stat(file).catch(() => null)
  if (!stat || !stat.isFile()) {
    const error = new Error(`skill resource not found: ${input}`)
    error.statusCode = 404
    throw error
  }
  if (stat.size > 1024 * 1024) {
    const error = new Error(`skill resource is too large to read as text: ${input}`)
    error.statusCode = 413
    throw error
  }

  const text = await fs.readFile(file, 'utf8')
  const lines = text.split(/\r?\n/)
  const offset = Math.max(1, Number(options.offset || 1))
  const limit = Math.min(2000, Math.max(1, Number(options.limit || 200)))
  const selected = lines.slice(offset - 1, offset - 1 + limit)
  const content = selected.map((line, index) => `${offset + index}: ${line}`).join('\n')
  const suffix = offset - 1 + limit < lines.length ? `\n\n[showing ${selected.length} of ${lines.length} lines]` : ''

  return {
    content: `${content}${suffix}`,
    details: {
      skill: skill.name,
      path: path.relative(rootDir, file).replace(/\\/g, '/'),
      totalLines: lines.length,
      offset,
      limit,
    },
  }
}

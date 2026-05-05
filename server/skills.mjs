import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from './storage.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const bundledSkillsDir = path.resolve(__dirname, '..', 'skills')
const userSkillsDir = path.join(dataDir, 'skills')
const defaultEntry = 'SKILL.md'

function isValidSkillName(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,80}$/i.test(value)
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
    return text.trim() ? JSON.parse(text) : defaultValue
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

async function listSkillDirectories(root) {
  if (!existsSync(root)) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
}

async function loadSkillDirectory(rootDir, source) {
  const rawManifest = await readJsonFile(path.join(rootDir, 'skill.json'), {})
  const name = normalizeString(rawManifest.name) || path.basename(rootDir)
  if (!isValidSkillName(name)) return null
  if (rawManifest.enabled === false) return null

  const entry = normalizeString(rawManifest.entry) || defaultEntry
  const entryPath = path.resolve(rootDir, entry)
  if (!isPathInside(rootDir, entryPath)) return null

  const instructions = (await readOptionalText(entryPath))?.trim()
  if (!instructions) return null

  return {
    name,
    displayName: normalizeString(rawManifest.displayName) || normalizeString(rawManifest.title),
    description: normalizeString(rawManifest.description),
    version: normalizeString(rawManifest.version),
    tags: normalizeStringArray(rawManifest.tags),
    triggers: normalizeStringArray(rawManifest.triggers),
    entry,
    source,
    rootDir,
    instructions,
  }
}

export async function loadSkills() {
  const skillsByName = new Map()

  for (const source of [
    { dir: bundledSkillsDir, name: 'bundled' },
    { dir: userSkillsDir, name: 'user' },
  ]) {
    for (const skillDir of await listSkillDirectories(source.dir)) {
      try {
        const skill = await loadSkillDirectory(skillDir, source.name)
        if (skill) skillsByName.set(skill.name, skill)
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

export async function listSkillSummaries() {
  const skills = await loadSkills()
  return skills.map(({ instructions: _instructions, rootDir: _rootDir, ...summary }) => summary)
}

export async function filterKnownSkillNames(skillNames) {
  const selected = normalizeSkillNames(skillNames)
  if (selected.length === 0) return []

  const known = new Set((await loadSkills()).map((skill) => skill.name))
  return selected.filter((name) => known.has(name))
}

export async function loadSelectedSkills(skillNames) {
  const selected = normalizeSkillNames(skillNames)
  if (selected.length === 0) return []

  const skills = await loadSkills()
  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  return selected.map((name) => byName.get(name)).filter(Boolean)
}

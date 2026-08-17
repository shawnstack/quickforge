import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureStorage, storageDir } from './storage.mjs'
import { normalizeLanAccessConfig } from './sqlite/lan-access-repository.mjs'

// F11 mirror file: `security/lan-access.json` stays as the best-effort JSON
// mirror (and cutover source) once SQLite is authoritative. Writes use an
// atomic tmp+rename and always normalize through the repository so the file
// shape exactly matches what lan-access-store.mjs writes.
export function lanAccessJsonPath() {
  return path.join(storageDir, 'security', 'lan-access.json')
}

export function defaultLanAccessConfig() {
  return {
    enabled: false,
    passwordHash: undefined,
    passwordSalt: undefined,
    passwordVersion: undefined,
    authVersion: 1,
    sessionTtlHours: 12,
    updatedAt: new Date().toISOString(),
    tokens: [],
  }
}

export async function ensureLanAccessJsonFile() {
  await ensureStorage()
  await fs.mkdir(path.dirname(lanAccessJsonPath()), { recursive: true })
  try {
    await fs.access(lanAccessJsonPath())
  } catch {
    await fs.writeFile(lanAccessJsonPath(), `${JSON.stringify(normalizeLanAccessConfig(defaultLanAccessConfig()), null, 2)}\n`, 'utf8')
  }
}

export async function readLanAccessJsonFile() {
  await ensureLanAccessJsonFile()
  try {
    const raw = await fs.readFile(lanAccessJsonPath(), 'utf8')
    const text = raw.trimStart()
    const parsed = text ? JSON.parse(text) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultLanAccessConfig()
    throw error
  }
}

export async function writeLanAccessJsonFile(config) {
  await ensureLanAccessJsonFile()
  const finalPath = lanAccessJsonPath()
  const temporaryPath = `${finalPath}.${process.pid}.tmp`
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(normalizeLanAccessConfig(config), null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, finalPath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

// Materialize one mirror entry into the whole-file JSON store. `delete` resets
// the file to the default disabled config (the same fallback semantics the
// store applies to a missing file).
export async function materializeLanAccessJsonEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('LAN access mirror entry is invalid')
  if (entry.operation === 'delete') {
    await writeLanAccessJsonFile(defaultLanAccessConfig())
  } else if (entry.operation === 'upsert' && entry.config) {
    await writeLanAccessJsonFile(entry.config)
  } else {
    throw new Error('LAN access mirror entry is invalid')
  }
}

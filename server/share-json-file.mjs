import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureStorage, storageDir } from './storage.mjs'

// F10 mirror/backup file: `shares/conversation-shares.json` stays as the
// best-effort JSON mirror (and cutover source) once SQLite is authoritative.
export function sharesJsonPath() {
  return path.join(storageDir, 'shares', 'conversation-shares.json')
}

export async function ensureSharesJsonFile() {
  await ensureStorage()
  await fs.mkdir(path.dirname(sharesJsonPath()), { recursive: true })
  try {
    await fs.access(sharesJsonPath())
  } catch {
    await fs.writeFile(sharesJsonPath(), '{}\n', 'utf8')
  }
}

export async function readSharesJsonFile() {
  await ensureSharesJsonFile()
  try {
    const raw = await fs.readFile(sharesJsonPath(), 'utf8')
    const text = raw.trimStart()
    const parsed = text ? JSON.parse(text) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

export async function writeSharesJsonFile(data) {
  await ensureSharesJsonFile()
  const finalPath = sharesJsonPath()
  const temporaryPath = `${finalPath}.${process.pid}.tmp`
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(data || {}, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, finalPath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

// Materialize one mirror entry into the whole-file JSON store.
export async function materializeShareJsonEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Share mirror entry is invalid')
  const data = await readSharesJsonFile()
  if (entry.operation === 'delete') {
    if (!entry.shareId) throw new Error('Share mirror delete requires a shareId')
    delete data[entry.shareId]
  } else if (entry.operation === 'upsert' && entry.record?.id) {
    data[entry.record.id] = entry.record
  } else {
    throw new Error('Share mirror entry is invalid')
  }
  await writeSharesJsonFile(data)
}

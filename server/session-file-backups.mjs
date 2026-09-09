import path from 'node:path'
import fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { cacheDir, ensureStorage } from './storage.mjs'
import { createTextDiff } from './utils/text-diff.mjs'
import { assertSafeWorkspacePath, isInside } from './utils/workspace.mjs'
import { withSessionFileLock } from './session-file-lock.mjs'

export const sessionBackupsDir = path.join(cacheDir, 'global', 'session-backups')
const BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 60 * 1000
let lastSweepAt = 0
// A failed journal commit must never expose an older trustworthy after in-process.
const unavailableSessions = new Set()
const hash = (value) => createHash('sha256').update(value).digest('hex')
// Windows spelling aliases share a key, but a key collision alone is NOT proof
// of identity: Windows also supports case-sensitive directories.
const pathKey = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)

async function findTargetEntry(entries, absolutePath) {
  const entry = entries.find((candidate) => pathKey(candidate.path) === pathKey(absolutePath))
  if (!entry || entry.path === absolutePath) return entry
  // Do not merge distinct files (or missing/unverifiable aliases). Reject the
  // new write instead of introducing two rollback operations for one target.
  await validatePath(entry)
  const [savedReal, targetReal, savedStat, targetStat] = await Promise.all([
    fs.realpath(entry.path), fs.realpath(absolutePath), fs.lstat(entry.path), fs.lstat(absolutePath),
  ])
  if (savedReal !== targetReal || !savedStat.ino || savedStat.dev !== targetStat.dev || savedStat.ino !== targetStat.ino) {
    throw new Error('unsafe_path')
  }
  return entry
}

function safeSegment(value) {
  const normalized = String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120)
  return normalized === value ? normalized : `${normalized || 'session'}-${hash(String(value)).slice(0, 16)}`
}
function sessionDir(sessionId) {
  return path.join(sessionBackupsDir, safeSegment(sessionId))
}
function indexFilePath(sessionId) {
  return path.join(sessionDir(sessionId), 'index.json')
}
async function readIndex(sessionId) {
  try {
    const parsed = JSON.parse(await fs.readFile(indexFilePath(sessionId), 'utf8'))
    if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.some((entry) => !entry || typeof entry.path !== 'string')) {
      throw new Error('Invalid backup index')
    }
    // Includes legacy indexes with Windows spelling aliases. Fail the entire
    // batch before any mutation rather than risk partial rollback of one entity.
    if (new Set(parsed.entries.map((entry) => pathKey(entry.path))).size !== parsed.entries.length) throw new Error('Duplicate backup paths')
    // Independent durable intent also survives a failed first index commit or
    // final cleanup commit. Never treat a leftover marker as a retryable batch.
    try {
      await fs.lstat(path.join(sessionDir(sessionId), 'rollback-intent'))
      parsed.rollbackStarted = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    return parsed
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return { entries: [] }
  }
}
async function writeIndex(sessionId, index) {
  const temporary = `${indexFilePath(sessionId)}.${randomUUID()}.tmp`
  try {
    await fs.mkdir(sessionDir(sessionId), { recursive: true })
    index.generation = randomUUID()
    await fs.writeFile(temporary, JSON.stringify(index), { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporary, indexFilePath(sessionId))
  } catch (error) {
    unavailableSessions.add(sessionId)
    throw error
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}
// Only called inside the same lock as writes/rollback; never a detached sweep.
async function sweepExpiredBackups() {
  const now = Date.now()
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return
  lastSweepAt = now
  try {
    for (const child of await fs.readdir(sessionBackupsDir, { withFileTypes: true })) {
      if (!child.isDirectory()) continue
      const dir = path.join(sessionBackupsDir, child.name)
      const stat = await fs.stat(dir)
      if (now - stat.mtimeMs > BACKUP_TTL_MS) await fs.rm(dir, { recursive: true, force: true })
    }
  } catch { /* Cache maintenance must not prevent a new backup. */ }
}

// Reject links (including directory links), hard links, non-files and changed
// workspace roots. Existing workspace boundary/sensitive-path rules also apply.
async function validatePath(entry) {
  if (!path.isAbsolute(entry.path) || !entry.workspaceRoot || !entry.workspaceReal || !entry.realPath) throw new Error('unsafe_path')
  if (!isInside(entry.workspaceRoot, entry.path) || entry.path === entry.workspaceRoot) throw new Error('unsafe_path')
  const rootReal = await fs.realpath(entry.workspaceRoot)
  if (rootReal !== entry.workspaceReal) throw new Error('unsafe_path')
  await assertSafeWorkspacePath(entry.path, { workspaceRoot: entry.workspaceRoot }, { forWrite: true })
  const relative = path.relative(entry.workspaceRoot, entry.path)
  const expected = path.resolve(rootReal, relative)
  if (expected !== entry.realPath) throw new Error('unsafe_path')
  let current = entry.workspaceRoot
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink() || (current === entry.path && (!stat.isFile() || stat.nlink !== 1))) throw new Error('unsafe_path')
    } catch (error) {
      if (error?.code === 'ENOENT') break
      throw error
    }
  }
}
function isText(bytes) {
  return !bytes.includes(0) && Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)
}
async function readCurrent(entry) {
  await validatePath(entry)
  const stat = await fs.lstat(entry.path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('unsafe_path')
  const bytes = await fs.readFile(entry.path)
  if (!isText(bytes)) throw new Error('unsafe_path')
  return { text: bytes.toString('utf8'), hash: hash(bytes), identity: [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs] }
}
async function readBackupContent(sessionId, entry) {
  if (entry.created) return null
  if (!/^[a-f0-9-]+\.txt$/.test(entry.backupName || '') || typeof entry.beforeHash !== 'string') throw new Error('backup_unavailable')
  const file = path.join(sessionDir(sessionId), entry.backupName)
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('backup_unavailable')
  const bytes = await fs.readFile(file)
  if (!isText(bytes) || hash(bytes) !== entry.beforeHash) throw new Error('backup_unavailable')
  return bytes.toString('utf8')
}

/** Internal journal primitives: caller MUST hold withSessionFileLock across the
 * before read, these calls, and the actual write. Missing after stays unsafe.
 * afterHash describes the prepared write, never arbitrary subsequent disk data.
 */
export async function backupFileBeforeWrite(sessionId, absolutePath, oldContent, meta = {}) {
  if (!sessionId) return
  if (unavailableSessions.has(sessionId)) throw new Error('backup_unavailable')
  await ensureStorage()
  await sweepExpiredBackups()
  let index = await readIndex(sessionId)
  if (index.rollbackStarted) throw new Error('incomplete_write')
  if (index.completed) index = { entries: [] }
  let entry = await findTargetEntry(index.entries, absolutePath)
  if (entry?.rollbackState === 'completed') {
    // A successfully undone item starts a new history at this write's before.
    // Leave its old blob on disk for TTL recovery, not in the active index.
    index.entries = index.entries.filter((candidate) => candidate !== entry)
    entry = undefined
  }
  const isNew = !entry
  const workspaceRoot = meta.workspaceRoot ? path.resolve(meta.workspaceRoot) : null
  const workspaceReal = workspaceRoot ? await fs.realpath(workspaceRoot) : null
  const metadata = {
    workspaceRoot, workspaceReal,
    realPath: workspaceRoot ? path.resolve(workspaceReal, path.relative(workspaceRoot, absolutePath)) : null,
  }
  if (workspaceRoot) await validatePath({ path: absolutePath, ...metadata })
  if (entry) {
    if (entry.pending) entry.unsafeReason ||= 'incomplete_write'
    else if (!entry.afterHash || !entry.workspaceRoot) entry.unsafeReason ||= 'legacy_backup'
    else if (oldContent == null || hash(String(oldContent)) !== entry.afterHash) entry.unsafeReason ||= 'external_modified'
    if (entry.workspaceReal !== workspaceReal || !entry.realPath || !metadata.realPath || pathKey(entry.realPath) !== pathKey(metadata.realPath)) entry.unsafeReason ||= 'unsafe_path'
  } else {
    entry = {
      path: absolutePath, relativePath: meta.relativePath || absolutePath,
      created: oldContent == null, backupAt: new Date().toISOString(), ...metadata,
    }
    if (!entry.created) {
      entry.beforeHash = hash(String(oldContent))
      entry.backupName = `${randomUUID()}.txt`
    }
    index.entries.push(entry)
  }
  // Entry-local generation prevents ABA (including same-content tool writes),
  // without invalidating confirmations for unrelated entries.
  entry.generation = randomUUID()
  entry.pending = true
  entry.intendedHash = typeof meta.afterContent === 'string' ? hash(meta.afterContent) : null
  // Persist intent before the first blob write. A blob failure/crash now leaves
  // a durable pending entry, even after this process's unavailable set is gone.
  // writeIndex owns mkdir and its failure guard; never create the blob first.
  try {
    await writeIndex(sessionId, index)
    if (isNew && !entry.created) {
      await fs.writeFile(path.join(sessionDir(sessionId), entry.backupName), String(oldContent), { encoding: 'utf8', flag: 'wx' })
    }
  } catch (error) {
    unavailableSessions.add(sessionId)
    throw error
  }
}
export async function recordFileAfterWrite(sessionId, absolutePath) {
  if (!sessionId) return
  const index = await readIndex(sessionId)
  const entry = await findTargetEntry(index.entries, absolutePath)
  if (!entry?.pending || !entry.intendedHash) throw new Error('incomplete_write')
  entry.afterHash = entry.intendedHash
  entry.pending = false
  delete entry.intendedHash
  await writeIndex(sessionId, index)
}

function remainingEntries(index) {
  return index.completed ? [] : index.entries.filter((entry) => entry.rollbackState !== 'completed')
}
async function inspectEntry(sessionId, entry) {
  const inspected = await inspectEntryState(sessionId, entry)
  inspected.file.revision = hash(JSON.stringify({ entry, ...inspected }))
  return inspected
}
async function inspectEntryState(sessionId, entry) {
  const file = { path: entry.path, relativePath: entry.relativePath || entry.path, action: entry.created ? 'delete' : 'restore', safe: false, reason: '' }
  const result = { file }
  // Never follow paths from legacy/incomplete metadata, even to calculate a diff.
  if (!entry.workspaceRoot || !entry.workspaceReal || !entry.realPath || !entry.afterHash) {
    file.reason = entry.pending ? 'incomplete_write' : 'legacy_backup'
    return result
  }
  if (entry.unsafeReason || entry.pending || entry.rollbackState) {
    file.reason = entry.unsafeReason || 'incomplete_write'
    return result
  }
  try {
    await validatePath(entry)
  } catch {
    file.reason = 'unsafe_path'
    return result
  }
  try {
    result.backup = await readBackupContent(sessionId, entry)
  } catch {
    file.reason = 'backup_unavailable'
    return result
  }
  try {
    result.current = await readCurrent(entry)
  } catch (error) {
    file.reason = error?.code === 'ENOENT' ? 'missing_file' : error?.message === 'unsafe_path' ? 'unsafe_path' : 'unavailable'
    return result
  }
  file.safe = result.current.hash === entry.afterHash
  file.reason = file.safe ? '' : 'external_modified'
  return result
}
async function inspectBatch(sessionId, options = {}) {
  if (!sessionId) return { preview: { revision: hash('unavailable'), canRollback: false, files: [], reason: 'unavailable' } }
  let index
  try { index = await readIndex(sessionId) } catch {
    return { preview: { revision: hash('unavailable'), canRollback: false, files: [], reason: 'backup_unavailable' } }
  }
  const entries = remainingEntries(index)
  const inspected = []
  for (const entry of entries) inspected.push(await inspectEntry(sessionId, entry))
  const files = inspected.map(({ file }) => file)
  const revision = hash(JSON.stringify({ index, states: inspected.map(({ file, current }) => ({ file, current })) }))
  let reason
  if (options.isSessionBusy?.()) reason = 'session_busy'
  else if (unavailableSessions.has(sessionId)) reason = 'backup_unavailable'
  else if (index.rollbackStarted) reason = 'incomplete_write'
  else if (!files.length) reason = 'unavailable'
  const preview = { revision, canRollback: !reason && files.every((file) => file.safe), files, ...(reason ? { reason } : {}) }
  return { index, inspected, preview }
}
export async function getSessionFileRollbackPreview(sessionId, options = {}) {
  return withSessionFileLock(async () => (await inspectBatch(sessionId, options)).preview)
}

// Keep the legacy summary shape, but never read untrusted legacy target paths.
export async function getSessionFileChanges(sessionId) {
  if (!sessionId) return { files: [], totalAdded: 0, totalRemoved: 0 }
  return withSessionFileLock(async () => {
    const files = []
    let index
    try { index = await readIndex(sessionId) } catch { index = { entries: [] } }
    for (const entry of remainingEntries(index)) {
      // A conflict still belongs in the summary; it just cannot be rolled back.
      // Only records with validated workspace metadata may cause a target read.
      try {
        const current = await readCurrent(entry)
        const backup = await readBackupContent(sessionId, entry)
        const diff = createTextDiff(backup ?? '', current.text, entry.relativePath, { oldExists: !entry.created })
        files.push({ path: entry.path, relativePath: entry.relativePath, created: entry.created, added: diff.addedLines, removed: diff.removedLines })
      } catch { /* Unavailable, legacy and unsafe paths are not read for display. */ }
    }
    return { files, totalAdded: files.reduce((sum, file) => sum + file.added, 0), totalRemoved: files.reduce((sum, file) => sum + file.removed, 0) }
  })
}

export async function rollbackSessionFiles(sessionId, options = {}) {
  return withSessionFileLock(() => rollbackSelection(sessionId, options, false))
}
export async function rollbackSessionFile(sessionId, options = {}) {
  return withSessionFileLock(() => rollbackSelection(sessionId, options, true))
}

// Selection changes the preflight gate only; journals and target execution are
// shared so a single-file request can never fall back to a whole-batch write.
function selectRollback(batch, options, single) {
  if (!single) return { allowed: batch.preview.canRollback, revision: batch.preview.revision, entries: batch.index ? remainingEntries(batch.index) : [], inspected: batch.inspected }
  const entry = typeof options.path === 'string' && options.path && batch.index
    ? remainingEntries(batch.index).find((candidate) => candidate.path === options.path) : undefined
  const inspected = entry ? batch.inspected.find(({ file }) => file.path === entry.path) : undefined
  return { allowed: !batch.preview.reason && !!inspected?.file.safe, revision: inspected?.file.revision, entries: entry ? [entry] : [], inspected: inspected ? [inspected] : [] }
}
async function rollbackSelection(sessionId, options, single) {
  const batch = await inspectBatch(sessionId, options)
  let preview = batch.preview
  const result = { status: 'blocked', restored: 0, removedCreated: 0, errors: [], preview }
  const selection = selectRollback(batch, options, single)
  if (typeof options.revision !== 'string' || !options.revision || options.revision !== selection.revision) {
    preview = { ...preview, canRollback: false, reason: preview.reason === 'session_busy' ? 'session_busy' : 'batch_changed' }
    return { ...result, preview }
  }
  if (!selection.allowed) return result
  // A second selected-scope preflight before ANY target mutation. Internal
  // writers are serialized, but the filesystem is NOT atomic: external
  // editors can still race a check/write. Recheck each item, stop on first error,
  // keep journals and completed-item states, and never automatically compensate.
  const checked = await inspectBatch(sessionId, options)
  const confirmed = selectRollback(checked, options, single)
  if (!confirmed.allowed || confirmed.revision !== selection.revision) {
    return { ...result, preview: { ...checked.preview, canRollback: false, reason: checked.preview.reason || 'batch_changed' } }
  }
  const index = checked.index
  let activePath = ''
  const intentPath = path.join(sessionDir(sessionId), 'rollback-intent')
  let intentPersisted = false
  try {
    index.rollbackStarted = true
    await fs.writeFile(intentPath, 'pending', { encoding: 'utf8', flag: 'wx' })
    intentPersisted = true
    await writeIndex(sessionId, index)
    for (let i = 0; i < confirmed.entries.length; i++) {
      const entry = confirmed.entries[i]
      activePath = entry.relativePath || entry.path
      if (options.isSessionBusy?.()) throw new Error('session_busy')
      const fresh = await inspectEntry(sessionId, entry)
      if (!fresh.file.safe || fresh.file.revision !== confirmed.inspected[i].file.revision) throw new Error(fresh.file.reason || 'batch_changed')
      entry.rollbackState = 'pending'
      await writeIndex(sessionId, index)
      // Narrow the journal-I/O race window too; no automatic retry after failure.
      const current = await readCurrent(entry)
      if (JSON.stringify(current) !== JSON.stringify(fresh.current)) throw new Error('external_modified')
      if (options.isSessionBusy?.()) throw new Error('session_busy')
      if (entry.created) {
        await fs.unlink(entry.path)
        result.removedCreated++
      } else {
        await fs.writeFile(entry.path, fresh.backup, 'utf8')
        result.restored++
      }
      entry.rollbackState = 'completed'
      await writeIndex(sessionId, index)
    }
    // Keep blobs until TTL rather than risk losing recovery evidence. The
    // separate intent remains authoritative until final cleanup also succeeds.
    index.completed = index.entries.every((entry) => entry.rollbackState === 'completed')
    delete index.rollbackStarted
    await writeIndex(sessionId, index)
    await fs.unlink(intentPath)
    result.status = index.completed ? 'completed' : 'partial'
  } catch (error) {
    unavailableSessions.add(sessionId)
    // If even the marker could not be written, try to persist the index intent.
    // Never clear a successfully persisted intent on any failure path.
    if (!intentPersisted) {
      index.rollbackStarted = true
      await writeIndex(sessionId, index).catch(() => {})
    }
    result.status = 'failed'
    result.errors.push({ path: activePath, message: error?.message || String(error) })
  }
  result.preview = (await inspectBatch(sessionId, options)).preview
  return result
}

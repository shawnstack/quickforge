import path from 'node:path'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { cacheDir, ensureStorage } from './storage.mjs'
import { createTextDiff } from './utils/text-diff.mjs'

// 会话级影子备份：write_file / edit_file 写盘前把该会话首次修改前的旧文件内容
// 备份到 qf cache。回滚 = 恢复这些旧内容并删除会话新建的文件。备份不随会话
// 销毁删除（刷新后仍可回滚），由 TTL 兜底清理。
export const sessionBackupsDir = path.join(cacheDir, 'global', 'session-backups')

const BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

let lastSweepAt = 0

function safeSegment(value) {
  const normalized = String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120)
  return normalized || 'session'
}

function sessionDir(sessionId) {
  return path.join(sessionBackupsDir, safeSegment(sessionId))
}

function indexFilePath(sessionId) {
  return path.join(sessionDir(sessionId), 'index.json')
}

function backupFileName(absolutePath) {
  return `${createHash('sha1').update(path.resolve(absolutePath)).digest('hex')}.txt`
}

async function readIndex(sessionId) {
  try {
    const raw = await fs.readFile(indexFilePath(sessionId), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.entries) ? parsed : { entries: [] }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return { entries: [] }
  }
}

async function writeIndex(sessionId, index) {
  await fs.mkdir(sessionDir(sessionId), { recursive: true })
  await fs.writeFile(indexFilePath(sessionId), JSON.stringify(index), 'utf8')
}

async function sweepExpiredBackups(now = Date.now()) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return
  lastSweepAt = now
  try {
    const children = await fs.readdir(sessionBackupsDir, { withFileTypes: true })
    for (const child of children) {
      if (!child.isDirectory()) continue
      const dir = path.join(sessionBackupsDir, child.name)
      try {
        const stat = await fs.stat(dir)
        if (now - stat.mtimeMs > BACKUP_TTL_MS) await fs.rm(dir, { recursive: true, force: true })
      } catch {
        // 单个目录清理失败不影响其余目录
      }
    }
  } catch {
    // 备份根目录不存在等场景静默跳过
  }
}

/**
 * 在 write_file / edit_file 写盘前调用。同一会话同一文件只备份首次修改前的
 * 内容；新建文件（oldContent 为 null）只登记 created 标记。
 */
export async function backupFileBeforeWrite(sessionId, absolutePath, oldContent, meta = {}) {
  if (!sessionId || !absolutePath) return
  await ensureStorage()
  void sweepExpiredBackups()
  const index = await readIndex(sessionId)
  if (index.entries.some((entry) => entry.path === absolutePath)) return

  const entry = {
    path: absolutePath,
    relativePath: typeof meta.relativePath === 'string' ? meta.relativePath : absolutePath,
    created: oldContent == null,
    backupAt: new Date().toISOString(),
  }
  if (!entry.created) {
    await fs.mkdir(sessionDir(sessionId), { recursive: true })
    await fs.writeFile(path.join(sessionDir(sessionId), backupFileName(absolutePath)), String(oldContent), 'utf8')
  }
  index.entries.push(entry)
  await writeIndex(sessionId, index)
}

async function readBackupContent(sessionId, entry) {
  if (entry.created) return null
  return fs.readFile(path.join(sessionDir(sessionId), backupFileName(entry.path)), 'utf8')
}

/**
 * 对账真实 diff：每文件用「会话首次修改前备份内容 vs 当前文件内容」实时计算
 * 增删行数；新建文件按当前行数计 added；文件已不存在则跳过展示（回滚仍会恢复）。
 */
export async function getSessionFileChanges(sessionId) {
  if (!sessionId) return { files: [], totalAdded: 0, totalRemoved: 0 }
  const index = await readIndex(sessionId)
  const files = []
  for (const entry of index.entries) {
    let current = null
    try {
      current = await fs.readFile(entry.path, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      continue
    }
    let added = 0
    let removed = 0
    if (entry.created) {
      added = createTextDiff('', current, entry.relativePath, { oldExists: false }).addedLines
    } else {
      const backup = await readBackupContent(sessionId, entry)
      const diff = createTextDiff(backup ?? '', current, entry.relativePath)
      added = diff.addedLines
      removed = diff.removedLines
    }
    files.push({ path: entry.path, relativePath: entry.relativePath, created: entry.created, added, removed })
  }
  return {
    files,
    totalAdded: files.reduce((sum, file) => sum + file.added, 0),
    totalRemoved: files.reduce((sum, file) => sum + file.removed, 0),
  }
}

/**
 * 把本会话修改的文件恢复到首次修改前状态：恢复备份内容、删除会话新建且仍存在
 * 的文件，然后清空备份目录。逐文件尽力恢复，失败项通过 errors 返回。
 */
export async function rollbackSessionFiles(sessionId) {
  if (!sessionId) return { restored: 0, removedCreated: 0, errors: [] }
  const index = await readIndex(sessionId)
  let restored = 0
  let removedCreated = 0
  const errors = []
  for (const entry of index.entries) {
    try {
      if (entry.created) {
        await fs.rm(entry.path, { force: true })
        removedCreated += 1
      } else {
        const backup = await readBackupContent(sessionId, entry)
        await fs.mkdir(path.dirname(entry.path), { recursive: true })
        await fs.writeFile(entry.path, backup ?? '', 'utf8')
        restored += 1
      }
    } catch (error) {
      errors.push({ path: entry.relativePath, message: error?.message || String(error) })
    }
  }
  await fs.rm(sessionDir(sessionId), { recursive: true, force: true })
  return { restored, removedCreated, errors }
}

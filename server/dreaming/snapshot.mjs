import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dataDir, memoryDirOf } from '../storage.mjs'
import { copyNoteDir, replaceNoteDirFromSnapshot } from '../note-store.mjs'
import { experiencesDir } from '../experiences.mjs'
import { workingMemoryDir } from '../working-memory.mjs'
import { logger } from '../utils/logger.mjs'

/**
 * Filesystem snapshots for a Dreaming run.
 *
 * The curator is an agent with write access to two folders, so "it made a mess"
 * has to be a recoverable state. Every run copies both folders before the first
 * session is processed, and a run can be undone from Settings. The notes
 * themselves are not versioned anywhere else, which is exactly why this is a copy
 * and not a log of operations: a copy is the only thing that survives a partial
 * write, a crash, or a bug in the curator.
 */

export const SNAPSHOT_DIR_NAME = 'snapshots'
export const MAX_SNAPSHOTS = 10

export function snapshotsRoot(options = {}) {
  return path.join(memoryDirOf(options.dataDir || dataDir), SNAPSHOT_DIR_NAME)
}

export function snapshotDirOf(runId, options = {}) {
  return path.join(snapshotsRoot(options), String(runId))
}

/**
 * Copy both memory folders into `<dataDir>/memory/snapshots/<runId>/`.
 *
 * A missing folder is not an error: on a fresh install neither exists yet, and a
 * run that creates the first note must still be undoable back to "empty".
 */
export async function snapshotMemory({ runId, dataDir: baseDir } = {}) {
  if (!runId) throw new Error('A run id is required to snapshot memory.')
  const root = snapshotDirOf(runId, { dataDir: baseDir })
  const workingTarget = path.join(root, 'notes')
  const experiencesTarget = path.join(root, 'experiences')
  // Both targets are created even when the source folder is missing: restoring a
  // first-ever run has to be able to bring memory back to *empty*, and a snapshot
  // that only holds the folder that happened to exist cannot express that.
  await Promise.all([
    fs.mkdir(workingTarget, { recursive: true }),
    fs.mkdir(experiencesTarget, { recursive: true }),
  ])
  const [working, experiences] = await Promise.all([
    copyNoteDir(workingMemoryDir({ dataDir: baseDir }), workingTarget),
    copyNoteDir(experiencesDir({ dataDir: baseDir }), experiencesTarget),
  ])
  return {
    dir: root,
    workingMemoryFiles: working.copied,
    experienceFiles: experiences.copied,
  }
}

/**
 * Put both folders back the way they were before that run.
 *
 * Replace-in-place rather than "undo the diff": the diff is the agent's own
 * account of what it did, and trusting it to describe a failed run is how you end
 * up with a half-restored folder.
 */
export async function restoreMemorySnapshot(runId, options = {}) {
  const root = snapshotDirOf(runId, options)
  try {
    await fs.access(root)
  } catch {
    throw Object.assign(new Error('这次运行的文件快照已经不在了，无法回滚。'), { statusCode: 409 })
  }
  const [working, experiences] = await Promise.all([
    replaceNoteDirFromSnapshot(path.join(root, 'notes'), workingMemoryDir(options)),
    replaceNoteDirFromSnapshot(path.join(root, 'experiences'), experiencesDir(options)),
  ])
  return {
    workingMemoryFiles: working.copied,
    experienceFiles: experiences.copied,
  }
}

/** Keep the newest snapshots only; older ones are dead weight on disk. */
export async function pruneSnapshots(options = {}) {
  const root = snapshotsRoot(options)
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return { removed: 0 }
  }
  const dirs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = path.join(root, entry.name)
    try {
      const stat = await fs.stat(full)
      dirs.push({ full, mtime: stat.mtimeMs })
    } catch {
      // Ignore a directory that disappeared mid-scan.
    }
  }
  dirs.sort((left, right) => right.mtime - left.mtime)
  let removed = 0
  for (const dir of dirs.slice(MAX_SNAPSHOTS)) {
    try {
      await fs.rm(dir.full, { recursive: true, force: true })
      removed += 1
    } catch (error) {
      logger.warn('Dreaming could not prune a memory snapshot:', error instanceof Error ? error.message : String(error))
    }
  }
  return { removed }
}

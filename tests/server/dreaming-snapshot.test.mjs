import { promises as fsPromises } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_SNAPSHOTS,
  pruneSnapshots,
  restoreMemorySnapshot,
  snapshotDirOf,
  snapshotMemory,
} from '../../server/dreaming/snapshot.mjs'

/**
 * `replaceNoteDirFromSnapshot` copies through `fs.promises`, the same object this test
 * imports, so spying on `copyFile` / `rename` is how a real "the file is busy" failure
 * is produced: no seam is added to the production code for the test's benefit.
 */

/**
 * A Dreaming run edits memory with no human watching, so the copy taken before the
 * first write is the only thing standing between a bad run and lost notes. These
 * tests use a temp data directory and real files, because the failure mode being
 * guarded against is a filesystem one.
 */

let directory

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-dreaming-snapshot-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const options = () => ({ dataDir: directory })

async function seedMemory() {
  await mkdir(path.join(directory, 'memory', 'notes'), { recursive: true })
  await mkdir(path.join(directory, 'memory', 'experiences'), { recursive: true })
  await writeFile(path.join(directory, 'memory', 'notes', '一.md'), '# 一\n\n原文', 'utf8')
  await writeFile(path.join(directory, 'memory', 'experiences', '经验.md'), '# 经验\n\n- 何时用：某天', 'utf8')
}

const memoryRoot = () => path.join(directory, 'memory')
const notesDir = () => path.join(memoryRoot(), 'notes')
const snapshotNotesDir = (runId) => path.join(snapshotDirOf(runId, options()), 'notes')

async function listing(dir) {
  return (await readdir(dir)).sort()
}

/** Scratch folders a restore builds in and parks the old folder under, if any are left. */
async function scratchLeftovers() {
  return (await readdir(memoryRoot())).filter((name) => name.includes('.staging') || name.includes('.previous'))
}

/** Notes only: the experiences folder stays missing, so no copy of it can race the spy. */
async function seedNotes(files) {
  await mkdir(notesDir(), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(notesDir(), name), content, 'utf8')
  }
}

async function settle(promise) {
  return promise.then((value) => ({ value }), (error) => ({ error }))
}

describe('memory snapshots', () => {
  it('copies both folders and restores them afterwards', async () => {
    await seedMemory()
    const snapshot = await snapshotMemory({ runId: 'run-1', dataDir: directory })
    expect(snapshot.workingMemoryFiles).toBe(1)
    expect(snapshot.experienceFiles).toBe(1)
    expect(snapshot.dir).toBe(snapshotDirOf('run-1', options()))

    // Simulate a bad run: one file rewritten, one archived, one added.
    await writeFile(path.join(directory, 'memory', 'notes', '一.md'), '# 一\n\n被改坏了', 'utf8')
    await writeFile(path.join(directory, 'memory', 'notes', '二.md'), '# 二\n\n新写的', 'utf8')
    await mkdir(path.join(directory, 'memory', 'experiences', '_archive'), { recursive: true })
    await rm(path.join(directory, 'memory', 'experiences', '经验.md'))

    const restored = await restoreMemorySnapshot('run-1', options())
    expect(restored.workingMemoryFiles).toBe(1)
    expect(restored.experienceFiles).toBe(1)
    expect(await readFile(path.join(directory, 'memory', 'notes', '一.md'), 'utf8')).toContain('原文')
    expect((await readdir(path.join(directory, 'memory', 'notes'))).sort()).toEqual(['一.md'])
    expect(await readFile(path.join(directory, 'memory', 'experiences', '经验.md'), 'utf8')).toContain('何时用')
  })

  it('can roll a first-ever run back to empty, which is why a missing folder is not an error', async () => {
    const snapshot = await snapshotMemory({ runId: 'run-empty', dataDir: directory })
    expect(snapshot.workingMemoryFiles).toBe(0)
    expect(snapshot.experienceFiles).toBe(0)
    await mkdir(path.join(directory, 'memory', 'notes'), { recursive: true })
    await writeFile(path.join(directory, 'memory', 'notes', '一.md'), '# 一', 'utf8')
    await restoreMemorySnapshot('run-empty', options())
    expect(await readdir(path.join(directory, 'memory', 'notes'))).toEqual([])
  })

  it('refuses to restore a run whose snapshot is gone', async () => {
    await expect(restoreMemorySnapshot('missing-run', options())).rejects.toMatchObject({ statusCode: 409 })
  })

  it('keeps only the newest snapshots', async () => {
    for (let index = 0; index < MAX_SNAPSHOTS + 2; index += 1) {
      await snapshotMemory({ runId: `run-${String(index).padStart(2, '0')}`, dataDir: directory })
      // Snapshot pruning sorts by mtime; make the order explicit.
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const pruned = await pruneSnapshots(options())
    expect(pruned.removed).toBe(2)
    const remaining = await readdir(path.join(directory, 'memory', 'snapshots'))
    expect(remaining).toHaveLength(MAX_SNAPSHOTS)
    expect(remaining).not.toContain('run-00')
  })

  // The two cases below are the ones the old order (`rm` the folder, then copy into
  // it) could not survive: memory was deleted before the copy was known to work.
  it('leaves the current folder and the snapshot whole when the copy fails halfway', async () => {
    await seedNotes({ '一.md': '# 一\n\n回滚前的原文', '二.md': '# 二\n\n回滚前的原文' })
    await snapshotMemory({ runId: 'run-busy', dataDir: directory })
    // The bad run: both notes rewritten, one added.
    await seedNotes({ '一.md': '# 一\n\n被改坏了', '二.md': '# 二\n\n被改坏了', '三.md': '# 三\n\n新写的' })
    const before = await listing(notesDir())

    const realCopyFile = fsPromises.copyFile
    const copies = { count: 0 }
    // A real filesystem failure on the second file: the first one is already in the
    // staging folder by then, which is exactly the half-copied state to guard against.
    const spy = vi.spyOn(fsPromises, 'copyFile').mockImplementation(async (...args) => {
      copies.count += 1
      if (copies.count === 2) {
        throw Object.assign(
          new Error(`EBUSY: resource busy or locked, copyfile '${String(args[0])}' -> '${String(args[1])}'`),
          { code: 'EBUSY', path: args[0] },
        )
      }
      return realCopyFile(...args)
    })
    const { error } = await settle(restoreMemorySnapshot('run-busy', options())).finally(() => spy.mockRestore())

    expect(copies.count).toBe(2)
    // 1. The folder on disk is exactly what it was: no half-restored mix.
    expect(await listing(notesDir())).toEqual(before)
    expect(await readFile(path.join(notesDir(), '一.md'), 'utf8')).toContain('被改坏了')
    expect(await readFile(path.join(notesDir(), '二.md'), 'utf8')).toContain('被改坏了')
    // 2. The snapshot is untouched, which is what makes a retry possible.
    expect(await listing(snapshotNotesDir('run-busy'))).toEqual(['一.md', '二.md'])
    expect(await readFile(path.join(snapshotNotesDir('run-busy'), '一.md'), 'utf8')).toContain('回滚前的原文')
    // 3. The staging folder never survives as the leftovers of a later run.
    expect(await scratchLeftovers()).toEqual([])
    // 4. The failure is identifiable upwards and carries no path of its own — the
    // `fs` reason does, which is exactly why it is not passed through.
    expect(error).toMatchObject({ statusCode: 500, targetPreserved: true })
    expect(error.message).not.toContain(directory)
  })

  it('puts the old folder back when the swap itself fails', async () => {
    await seedNotes({ '一.md': '# 一\n\n回滚前的原文' })
    await snapshotMemory({ runId: 'run-rename', dataDir: directory })
    await writeFile(path.join(notesDir(), '一.md'), '# 一\n\n被改坏了', 'utf8')

    const realRename = fsPromises.rename
    const swapped = { count: 0 }
    // Only the swap fails (staging -> target); the move aside and the rollback are the
    // real ones, so this exercises "put the old folder back" rather than "give up".
    const spy = vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
      if (to === notesDir() && swapped.count === 0) {
        swapped.count += 1
        throw Object.assign(
          new Error(`EPERM: operation not permitted, rename '${String(from)}' -> '${String(to)}'`),
          { code: 'EPERM' },
        )
      }
      return realRename(from, to)
    })
    const { error } = await settle(restoreMemorySnapshot('run-rename', options())).finally(() => spy.mockRestore())

    expect(swapped.count).toBe(1)
    expect(error).toMatchObject({ statusCode: 500, targetPreserved: true })
    expect(error.message).not.toContain(directory)
    // The rollback is the whole point: the folder is back, not gone.
    expect(await listing(notesDir())).toEqual(['一.md'])
    expect(await readFile(path.join(notesDir(), '一.md'), 'utf8')).toContain('被改坏了')
    expect(await scratchLeftovers()).toEqual([])
  })
})

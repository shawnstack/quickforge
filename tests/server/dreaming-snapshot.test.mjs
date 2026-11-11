import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_SNAPSHOTS,
  pruneSnapshots,
  restoreMemorySnapshot,
  snapshotDirOf,
  snapshotMemory,
} from '../../server/dreaming/snapshot.mjs'

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
})

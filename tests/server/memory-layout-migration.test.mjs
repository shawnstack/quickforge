import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateMemoryLayout } from '../../server/storage.mjs'

let directory

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-memory-layout-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** The layout every install had before memory moved under `memory/`. */
async function seedLegacyLayout() {
  await writeFile(path.join(directory, 'MEMORY.md'), '# 偏好\n\n说人话', 'utf8')
  await mkdir(path.join(directory, 'working-memory'), { recursive: true })
  await writeFile(path.join(directory, 'working-memory', '一.md'), '# 一\n\n正文', 'utf8')
  await mkdir(path.join(directory, 'experiences'), { recursive: true })
  await writeFile(path.join(directory, 'experiences', '经验.md'), '# 经验\n\n- 怎么做：x', 'utf8')
  await mkdir(path.join(directory, 'dreaming-snapshots', 'dream_1', 'working-memory'), { recursive: true })
  await writeFile(path.join(directory, 'dreaming-snapshots', 'dream_1', 'working-memory', '一.md'), '# 一', 'utf8')
}

describe('memory layout migration', () => {
  it('moves every memory artefact under memory/ and keeps its content', async () => {
    await seedLegacyLayout()

    const result = await migrateMemoryLayout(directory)

    expect(result).toMatchObject({ moved: 4, conflicts: 0 })
    expect(await readFile(path.join(directory, 'memory', 'MEMORY.md'), 'utf8')).toContain('说人话')
    expect(await readFile(path.join(directory, 'memory', 'notes', '一.md'), 'utf8')).toContain('正文')
    expect(await readFile(path.join(directory, 'memory', 'experiences', '经验.md'), 'utf8')).toContain('怎么做')
    expect(await readdir(path.join(directory, 'memory', 'snapshots'))).toEqual(['dream_1'])
    // The old locations are gone, not duplicated.
    await expect(readFile(path.join(directory, 'MEMORY.md'), 'utf8')).rejects.toThrow()
    await expect(readdir(path.join(directory, 'working-memory'))).rejects.toThrow()
  })

  it('only creates memory/ on a fresh data dir', async () => {
    expect(await migrateMemoryLayout(directory)).toBeNull()
    expect(await readdir(directory)).toEqual(['memory'])
  })

  it('is idempotent', async () => {
    await seedLegacyLayout()
    await migrateMemoryLayout(directory)
    expect(await migrateMemoryLayout(directory)).toBeNull()
  })

  it('parks a conflicting old copy instead of overwriting the new one', async () => {
    await seedLegacyLayout()
    await mkdir(path.join(directory, 'memory', 'experiences'), { recursive: true })
    await writeFile(path.join(directory, 'memory', 'experiences', '新.md'), '# 新\n\n- 怎么做：y', 'utf8')

    const result = await migrateMemoryLayout(directory)

    expect(result).toMatchObject({ moved: 3, conflicts: 1 })
    expect(await readdir(path.join(directory, 'memory', 'experiences'))).toEqual(['新.md'])
    expect(await readFile(path.join(result.backupDir, 'conflict', 'experiences', '经验.md'), 'utf8')).toContain('怎么做')
  })

  it('keeps a full copy of the old layout before moving anything', async () => {
    await seedLegacyLayout()

    const result = await migrateMemoryLayout(directory)

    const [stampDir] = await readdir(path.join(directory, '_backups'))
    expect(stampDir).toMatch(/^memory-layout-/)
    expect(await readFile(path.join(result.backupDir, 'working-memory', '一.md'), 'utf8')).toContain('正文')
    expect(await readFile(path.join(result.backupDir, 'MEMORY.md'), 'utf8')).toContain('说人话')
  })
})

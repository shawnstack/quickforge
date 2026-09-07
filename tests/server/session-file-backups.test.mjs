import { describe, expect, it, beforeAll } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

process.env.QUICKFORGE_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-backups-test-'))

const {
  backupFileBeforeWrite,
  getSessionFileChanges,
  rollbackSessionFiles,
  sessionBackupsDir,
} = await import('../../server/session-file-backups.mjs')

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'qf-backups-ws-'))
}

describe('session file backups', () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(sessionBackupsDir), { recursive: true })
  })

  it('backs up only the first pre-session content for a path', async () => {
    const dir = await tempWorkspace()
    const file = path.join(dir, 'a.txt')
    await fs.writeFile(file, 'line1\nline2\n', 'utf8')

    await backupFileBeforeWrite('s-first', file, 'line1\nline2\n', { relativePath: 'a.txt' })
    await fs.writeFile(file, 'line1\nline2\nline3\n', 'utf8')
    await backupFileBeforeWrite('s-first', file, 'line1\nline2\nline3\n', { relativePath: 'a.txt' })

    const changes = await getSessionFileChanges('s-first')
    expect(changes.files).toHaveLength(1)
    expect(changes.files[0]).toMatchObject({ relativePath: 'a.txt', created: false, added: 1, removed: 0 })
    expect(changes.totalAdded).toBe(1)
    await fs.rm(dir, { recursive: true, force: true })
    await fs.rm(path.join(sessionBackupsDir, 's-first'), { recursive: true, force: true })
  })

  it('counts created files as additions and skips files deleted afterwards', async () => {
    const dir = await tempWorkspace()
    const created = path.join(dir, 'new.html')
    await backupFileBeforeWrite('s-created', created, null, { relativePath: 'new.html' })
    await fs.writeFile(created, '<p>a</p>\n<p>b</p>\n', 'utf8')

    const deleted = path.join(dir, 'gone.txt')
    await backupFileBeforeWrite('s-created', deleted, 'old\n', { relativePath: 'gone.txt' })
    // 文件随后被会话外删除：摘要跳过，但回滚仍会恢复

    const changes = await getSessionFileChanges('s-created')
    expect(changes.files).toHaveLength(1)
    expect(changes.files[0]).toMatchObject({ relativePath: 'new.html', created: true, added: 2, removed: 0 })
    expect(changes.totalAdded).toBe(2)

    const result = await rollbackSessionFiles('s-created')
    expect(result.restored).toBe(1)
    expect(result.removedCreated).toBe(1)
    expect(result.errors).toEqual([])
    await expect(fs.readFile(created, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(deleted, 'utf8')).resolves.toBe('old\n')

    const after = await getSessionFileChanges('s-created')
    expect(after.files).toEqual([])
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('rollback restores pre-session content across multiple edits', async () => {
    const dir = await tempWorkspace()
    const file = path.join(dir, 'src/app.ts')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, 'export const a = 1\n', 'utf8')

    await backupFileBeforeWrite('s-rollback', file, 'export const a = 1\n', { relativePath: 'src/app.ts' })
    await fs.writeFile(file, 'export const a = 2\nexport const b = 3\n', 'utf8')
    await backupFileBeforeWrite('s-rollback', file, 'export const a = 2\nexport const b = 3\n', { relativePath: 'src/app.ts' })
    await fs.writeFile(file, '// rewritten\n', 'utf8')

    const changes = await getSessionFileChanges('s-rollback')
    expect(changes.files[0]).toMatchObject({ created: false, removed: 1 })

    const result = await rollbackSessionFiles('s-rollback')
    expect(result).toMatchObject({ restored: 1, removedCreated: 0, errors: [] })
    await expect(fs.readFile(file, 'utf8')).resolves.toBe('export const a = 1\n')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('returns empty summary for sessions without backups', async () => {
    const changes = await getSessionFileChanges('s-none')
    expect(changes).toEqual({ files: [], totalAdded: 0, totalRemoved: 0 })
    const result = await rollbackSessionFiles('s-none')
    expect(result).toEqual({ restored: 0, removedCreated: 0, errors: [] })
  })

  it('sanitizes unsafe session ids into backup directory names', async () => {
    const dir = await tempWorkspace()
    const file = path.join(dir, 'x.txt')
    await fs.writeFile(file, 'x\n', 'utf8')
    await backupFileBeforeWrite('../escape/..', file, 'x\n', { relativePath: 'x.txt' })
    const changes = await getSessionFileChanges('../escape/..')
    expect(changes.files).toHaveLength(1)
    await fs.rm(path.join(sessionBackupsDir, '_escape'), { recursive: true, force: true })
    await fs.rm(path.join(sessionBackupsDir, 'escape_..'), { recursive: true, force: true })
    await fs.rm(dir, { recursive: true, force: true })
  })
})

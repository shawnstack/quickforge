import { describe, expect, it, afterEach, afterAll, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-safe-backups-'))
process.env.QUICKFORGE_DATA_DIR = dataDir
const { getSessionFileChanges, getSessionFileRollbackPreview, rollbackSessionFiles, rollbackSessionFile, getSessionTurnRollbackPreview, rollbackSessionTurn, sessionBackupsDir } = await import('../../server/session-file-backups.mjs')
const { toolWriteFile, toolEditFile } = await import('../../server/tools/index.mjs')
const { withSessionFileLock } = await import('../../server/session-file-lock.mjs')
const workspaces = []
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true })
  for (const dir of workspaces) await fs.rm(dir, { recursive: true, force: true })
})
async function fixture() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-safe-undo-ws-'))
  workspaces.push(workspaceRoot)
  const sessionId = randomUUID()
  const context = { workspaceRoot, sessionId }
  return {
    sessionId, context, dir: workspaceRoot,
    file: (name) => path.join(workspaceRoot, name),
    write: (name, content) => toolWriteFile({ path: name, content }, context),
    writeTurn: (name, content, turnId) => toolWriteFile({ path: name, content }, { ...context, turnId }),
    editTurn: (params, turnId) => toolEditFile(params, { ...context, turnId }),
    preview: () => getSessionFileRollbackPreview(sessionId),
    previewTurn: (turnIds, options) => getSessionTurnRollbackPreview(sessionId, { turnIds, ...options }),
    rollback: (revision) => rollbackSessionFiles(sessionId, { revision }),
    rollbackTurn: (turnIds, revision, options) => rollbackSessionTurn(sessionId, { turnIds, revision, ...options }),
    rollbackFile: (file, revision) => rollbackSessionFile(sessionId, { path: file, revision }),
    indexPath: path.join(sessionBackupsDir, sessionId, 'index.json'),
  }
}
async function indexFor(f) { return JSON.parse(await fs.readFile(f.indexPath, 'utf8')) }
async function rollbackCurrent(f) { return f.rollback((await f.preview()).revision) }

describe('safe single-file session rollback (real filesystem and session tools)', () => {
  it('restores only the selected safe item despite conflicts, legacy and missing siblings', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.write('a.txt', 'AI')
    for (const name of ['conflict.txt', 'legacy.txt', 'missing.txt']) await f.write(name, 'AI')
    await fs.writeFile(f.file('conflict.txt'), 'user bytes')
    await fs.unlink(f.file('missing.txt'))
    const index = await indexFor(f)
    delete index.entries[2].afterHash
    await fs.writeFile(f.indexPath, JSON.stringify(index))
    const preview = await f.preview()
    expect(preview.canRollback).toBe(false)
    expect(preview.files.every((file) => typeof file.revision === 'string')).toBe(true)
    expect(await f.rollbackFile(preview.files[0].path, preview.files[0].revision)).toMatchObject({ status: 'partial', restored: 1, removedCreated: 0, errors: [] })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('before')
    expect(await fs.readFile(f.file('conflict.txt'), 'utf8')).toBe('user bytes')
    expect(await fs.readFile(f.file('legacy.txt'), 'utf8')).toBe('AI')
    await expect(fs.stat(f.file('missing.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await f.preview()).files.map((file) => file.relativePath)).toEqual(['conflict.txt', 'legacy.txt', 'missing.txt'])
    expect((await getSessionFileChanges(f.sessionId)).files.some((file) => file.path === f.file('a.txt'))).toBe(false)
    expect(await indexFor(f)).toMatchObject({ completed: false, entries: [{ rollbackState: 'completed' }, {}, {}, {}] })
    expect((await indexFor(f)).rollbackStarted).toBeUndefined()
    expect((await rollbackCurrent(f)).status).toBe('blocked')
    await fs.writeFile(f.file('a.txt'), 'later external')
    expect((await f.rollbackFile(preview.files[0].path, preview.files[0].revision)).status).toBe('blocked')
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('later external')
  })

  it.each(['single', 'batch'])('continues with %s and completes only after all remaining items succeed', async (mode) => {
    const f = await fixture()
    for (const name of ['a.txt', 'b.txt']) await f.write(name, 'AI')
    const preview = await f.preview()
    expect((await f.rollbackFile(preview.files[0].path, preview.files[0].revision)).status).toBe('partial')
    const remaining = await f.preview()
    expect(remaining.files).toHaveLength(1)
    expect(remaining.canRollback).toBe(true)
    expect(remaining.files[0].revision).toBe(preview.files[1].revision)
    const result = mode === 'single' ? await f.rollbackFile(preview.files[1].path, preview.files[1].revision) : await f.rollback(remaining.revision)
    expect(result).toMatchObject({ status: 'completed', removedCreated: 1, preview: { files: [] } })
    expect((await indexFor(f)).completed).toBe(true)
    expect((await indexFor(f)).rollbackStarted).toBeUndefined()
  })

  it('unrelated disk and journal changes do not invalidate an item revision', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    await f.write('b.txt', 'AI')
    const preview = await f.preview()
    await fs.writeFile(f.file('b.txt'), 'external')
    await f.write('c.txt', 'new AI')
    expect((await f.preview()).files[0].revision).toBe(preview.files[0].revision)
    expect((await f.preview()).revision).not.toBe(preview.revision)
    expect((await f.rollbackFile(preview.files[0].path, preview.files[0].revision)).status).toBe('partial')
    expect(await fs.readFile(f.file('b.txt'), 'utf8')).toBe('external')
    expect(await fs.readFile(f.file('c.txt'), 'utf8')).toBe('new AI')
  })

  it.each(['missing path', 'empty path', 'relative path', 'unknown path', 'missing revision', 'wrong revision', 'external', 'missing after'])('blocks %s without target writes or arbitrary request-path reads', async (mode) => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    const file = (await f.preview()).files[0]
    let target = file.path
    let revision = file.revision
    if (mode === 'missing path') target = undefined
    if (mode === 'empty path') target = ''
    if (mode === 'relative path') target = 'a.txt'
    if (mode === 'unknown path') target = f.file('unregistered.txt')
    if (mode === 'missing revision') revision = undefined
    if (mode === 'wrong revision') revision = 'wrong'
    if (mode === 'external') await fs.writeFile(file.path, 'external')
    if (mode === 'missing after') {
      const index = await indexFor(f)
      delete index.entries[0].afterHash
      await fs.writeFile(f.indexPath, JSON.stringify(index))
      revision = (await f.preview()).files[0].revision
    }
    const read = vi.spyOn(fs, 'readFile')
    const write = vi.spyOn(fs, 'writeFile')
    expect(await f.rollbackFile(target, revision)).toMatchObject({ status: 'blocked', restored: 0, removedCreated: 0 })
    expect(write).not.toHaveBeenCalled()
    expect(read.mock.calls.some(([file]) => file === f.file('unregistered.txt'))).toBe(false)
    expect(await fs.readFile(file.path, 'utf8')).toBe(mode === 'external' ? 'external' : 'AI')
  })

  it.each(['external', 'legacy', 'missing', 'pending', 'backup', 'hardlink'])('blocks selected unsafe %s item even with its latest revision', async (mode) => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.write('a.txt', 'AI')
    await f.write('b.txt', 'AI')
    const index = await indexFor(f)
    if (mode === 'external') await fs.writeFile(f.file('a.txt'), 'external')
    if (mode === 'legacy') delete index.entries[0].afterHash
    if (mode === 'missing') await fs.unlink(f.file('a.txt'))
    if (mode === 'pending') index.entries[0].pending = true
    if (mode === 'backup') await fs.unlink(path.join(path.dirname(f.indexPath), index.entries[0].backupName))
    if (mode === 'hardlink') await fs.link(f.file('a.txt'), f.file('alias.txt'))
    await fs.writeFile(f.indexPath, JSON.stringify(index))
    const preview = await f.preview()
    expect(preview.files[0].safe).toBe(false)
    expect((await f.rollbackFile(preview.files[0].path, preview.files[0].revision)).status).toBe('blocked')
    expect((await f.rollbackFile(preview.files[1].path, preview.files[1].revision)).status).toBe('partial')
    expect((await indexFor(f)).entries[0]).toEqual(index.entries[0])
  })

  it('binds revision to the full current identity, not only its content hash', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    const file = (await f.preview()).files[0]
    await fs.utimes(file.path, new Date(1000), new Date(1000))
    const fresh = (await f.preview()).files[0]
    expect(fresh.safe).toBe(true)
    expect(fresh.revision).not.toBe(file.revision)
    expect((await f.rollbackFile(file.path, file.revision)).status).toBe('blocked')
    expect(await fs.readFile(file.path, 'utf8')).toBe('AI')
  })

  it('rebuilds a completed entry from the new before and rejects ABA confirmations while retaining blobs', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.write('a.txt', 'AI')
    await f.write('b.txt', 'AI')
    const oldIndex = await indexFor(f)
    const oldFile = (await f.preview()).files[0]
    await f.rollbackFile(oldFile.path, oldFile.revision)
    await fs.writeFile(oldFile.path, 'new user before')
    await f.write('a.txt', 'AI')
    const index = await indexFor(f)
    const rebuilt = index.entries.find((entry) => entry.path === oldFile.path)
    expect(rebuilt.generation).not.toBe(oldIndex.entries[0].generation)
    expect(rebuilt.backupName).not.toBe(oldIndex.entries[0].backupName)
    expect(rebuilt.rollbackState).toBeUndefined()
    expect(await fs.readFile(path.join(path.dirname(f.indexPath), oldIndex.entries[0].backupName), 'utf8')).toBe('before')
    expect((await f.rollbackFile(oldFile.path, oldFile.revision)).status).toBe('blocked')
    expect((await rollbackCurrent(f)).status).toBe('completed')
    expect(await fs.readFile(oldFile.path, 'utf8')).toBe('new user before')
  })

  it('re-registers a completed created file and serializes duplicate single-file requests', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    await f.write('b.txt', 'AI')
    const file = (await f.preview()).files[0]
    const results = await Promise.all([f.rollbackFile(file.path, file.revision), f.rollbackFile(file.path, file.revision)])
    expect(results.map((result) => result.status)).toEqual(['partial', 'blocked'])
    await f.write('a.txt', 'AI')
    const fresh = (await f.preview()).files.find((item) => item.path === file.path)
    expect(fresh).toMatchObject({ action: 'delete', safe: true })
    expect(fresh.revision).not.toBe(file.revision)
    expect((await f.rollbackFile(file.path, file.revision)).status).toBe('blocked')
    expect(await fs.readFile(file.path, 'utf8')).toBe('AI')
    expect((await rollbackCurrent(f)).status).toBe('completed')
    await expect(fs.stat(file.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects same-content entry generation ABA even when current identity is unchanged', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    const file = (await f.preview()).files[0]
    const index = await indexFor(f)
    index.entries[0].generation = randomUUID()
    await fs.writeFile(f.indexPath, JSON.stringify(index))
    expect((await f.rollbackFile(file.path, file.revision)).status).toBe('blocked')
    expect(await fs.readFile(file.path, 'utf8')).toBe('AI')
  })

  it.each(['intent', 'first index', 'pending', 'target', 'item complete', 'final commit', 'intent cleanup'])('persistently blocks after %s failure, including a fresh module reload', async (stage) => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.write('a.txt', 'AI')
    await f.write('b.txt', 'AI')
    const file = (await f.preview()).files[0]
    const originalWrite = fs.writeFile.bind(fs)
    const originalRename = fs.rename.bind(fs)
    const originalUnlink = fs.unlink.bind(fs)
    let renames = 0
    const failRename = { 'first index': 1, pending: 2, 'item complete': 3, 'final commit': 4 }[stage]
    vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      if (++renames === failRename) throw new Error(stage)
      return originalRename(...args)
    })
    vi.spyOn(fs, 'writeFile').mockImplementation(async (target, ...args) => {
      if ((stage === 'target' && target === file.path) || (stage === 'intent' && String(target).endsWith('rollback-intent'))) throw new Error(stage)
      return originalWrite(target, ...args)
    })
    vi.spyOn(fs, 'unlink').mockImplementation(async (target, ...args) => {
      if (stage === 'intent cleanup' && String(target).endsWith('rollback-intent')) throw new Error(stage)
      return originalUnlink(target, ...args)
    })
    expect(await f.rollbackFile(file.path, file.revision)).toMatchObject({ status: 'failed', errors: [{ message: stage }] })
    vi.restoreAllMocks()
    expect((await f.rollbackFile(file.path, file.revision)).status).toBe('blocked')
    vi.resetModules()
    const restarted = await import('../../server/session-file-backups.mjs')
    const preview = await restarted.getSessionFileRollbackPreview(f.sessionId)
    expect(preview).toMatchObject({ canRollback: false, reason: 'incomplete_write' })
    const sibling = preview.files.find((item) => item.path === f.file('b.txt'))
    expect(await restarted.rollbackSessionFile(f.sessionId, { path: sibling.path, revision: sibling.revision })).toMatchObject({ status: 'blocked' })
    expect(await restarted.rollbackSessionFiles(f.sessionId, { revision: preview.revision })).toMatchObject({ status: 'blocked' })
    await expect(restarted.backupFileBeforeWrite(f.sessionId, file.path, 'before', { workspaceRoot: f.dir, afterContent: 'retry' })).rejects.toThrow('incomplete_write')
    expect(await fs.readFile(f.file('b.txt'), 'utf8')).toBe('AI')
  })

  it('a final marker-cleanup failure keeps a logically completed index locked after reload', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.write('a.txt', 'AI')
    const file = (await f.preview()).files[0]
    vi.spyOn(fs, 'unlink').mockRejectedValue(new Error('cleanup denied'))
    expect((await f.rollbackFile(file.path, file.revision)).status).toBe('failed')
    vi.restoreAllMocks()
    expect((await indexFor(f)).completed).toBe(true)
    vi.resetModules()
    const restarted = await import('../../server/session-file-backups.mjs')
    expect(await restarted.getSessionFileRollbackPreview(f.sessionId)).toMatchObject({ canRollback: false, files: [], reason: 'incomplete_write' })
    await expect(restarted.backupFileBeforeWrite(f.sessionId, file.path, 'before', { workspaceRoot: f.dir, afterContent: 'retry' })).rejects.toThrow('incomplete_write')
    await fs.writeFile(file.path, 'external')
    expect((await restarted.rollbackSessionFile(f.sessionId, file)).status).toBe('blocked')
    expect(await fs.readFile(file.path, 'utf8')).toBe('external')
  })

  it('rechecks selected state and busy guard before committing intent', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    const file = (await f.preview()).files[0]
    expect(await rollbackSessionFile(f.sessionId, { ...file, isSessionBusy: () => true })).toMatchObject({ status: 'blocked', preview: { reason: 'session_busy' } })
    let guards = 0
    expect(await rollbackSessionFile(f.sessionId, { ...file, isSessionBusy: () => ++guards >= 2 })).toMatchObject({ status: 'blocked' })
    const originalRead = fs.readFile.bind(fs)
    let reads = 0
    vi.spyOn(fs, 'readFile').mockImplementation(async (target, ...args) => {
      const bytes = await originalRead(target, ...args)
      if (target === file.path && ++reads === 1) await fs.writeFile(target, 'external')
      return bytes
    })
    expect((await f.rollbackFile(file.path, file.revision)).status).toBe('blocked')
    expect((await indexFor(f)).rollbackStarted).toBeUndefined()
    expect(await fs.readFile(file.path, 'utf8')).toBe('external')
  })
})

describe('safe whole-batch session rollback (real filesystem and session tools)', () => {
  it('restores first contents across write/edit, deletes only unmodified created files, and keeps summary shape', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'first\n')
    await f.write('a.txt', 'second\n')
    await toolEditFile({ path: 'a.txt', oldText: 'second', newText: 'third' }, f.context)
    await f.write('new.txt', 'new\n')
    expect(await getSessionFileChanges(f.sessionId)).toMatchObject({ files: [
      { relativePath: 'a.txt', created: false, added: 1, removed: 1 },
      { relativePath: 'new.txt', created: true, added: 1, removed: 0 },
    ], totalAdded: 2, totalRemoved: 1 })
    const preview = await f.preview()
    expect(preview).toMatchObject({ canRollback: true, files: [{ action: 'restore', safe: true }, { action: 'delete', safe: true }] })
    expect(await f.rollback(preview.revision)).toMatchObject({ status: 'completed', restored: 1, removedCreated: 1, errors: [] })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('first\n')
    await expect(fs.stat(f.file('new.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await getSessionFileChanges(f.sessionId)).files).toEqual([])
    expect(await f.rollback(preview.revision)).toMatchObject({ status: 'blocked', restored: 0, removedCreated: 0 })
    await f.write('a.txt', 'new batch')
    expect((await f.preview()).canRollback).toBe(true)
    await rollbackCurrent(f)
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('first\n')
  })

  it.skipIf(process.platform !== 'win32')('deduplicates real Windows case aliases for before and after, restoring exactly once', async ({ skip }) => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    // The Windows fixture may itself live in a case-sensitive directory.
    const aliasStat = await fs.stat(f.file('A.txt')).catch(() => null)
    if (!aliasStat || aliasStat.ino !== (await fs.stat(f.file('a.txt'))).ino) skip()
    await f.write('a.txt', 'AI')
    await f.write('A.txt', 'AI')
    await toolEditFile({ path: 'A.txt', oldText: 'AI', newText: 'edited AI' }, f.context)
    expect((await indexFor(f)).entries).toHaveLength(1)
    expect(await f.preview()).toMatchObject({ canRollback: true, files: [{ safe: true }] })
    expect(await rollbackCurrent(f)).toMatchObject({ status: 'completed', restored: 1, errors: [] })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('before')
  })

  it.skipIf(process.platform !== 'win32')('rejects a case-key collision when canonical identity cannot be confirmed', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    const original = fs.realpath.bind(fs)
    // Emulate distinct canonical files in a Windows case-sensitive directory.
    vi.spyOn(fs, 'realpath').mockImplementation(async (file, ...args) => file === f.file('A.txt') ? f.file('A.txt') : original(file, ...args))
    await expect(f.write('A.txt', 'other file')).rejects.toThrow('unsafe_path')
    expect((await indexFor(f)).entries).toHaveLength(1)
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('AI')
    expect((await f.preview()).canRollback).toBe(true)
  })

  it.skipIf(process.platform !== 'win32')('blocks a legacy Windows alias batch before any target mutation', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.write('a.txt', 'AI')
    const index = await indexFor(f)
    index.entries.push({ ...index.entries[0], path: f.file('A.txt'), realPath: f.file('A.txt'), relativePath: 'A.txt' })
    await fs.writeFile(f.indexPath, JSON.stringify(index))
    const write = vi.spyOn(fs, 'writeFile')
    expect(await f.preview()).toMatchObject({ canRollback: false, reason: 'backup_unavailable' })
    expect(await rollbackCurrent(f)).toMatchObject({ status: 'blocked', restored: 0, removedCreated: 0 })
    expect(write).not.toHaveBeenCalled()
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('AI')
  })

  it('mixed batch starts zero target writes, including externally edited created file', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.write('a.txt', 'AI')
    await f.write('new.txt', 'AI created')
    await fs.writeFile(f.file('new.txt'), 'user work')
    const preview = await f.preview()
    expect(preview).toMatchObject({ canRollback: false, files: [{ safe: true }, { safe: false, reason: 'external_modified' }] })
    expect(await f.rollback(preview.revision)).toMatchObject({ status: 'blocked', restored: 0, removedCreated: 0 })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('AI')
    expect(await fs.readFile(f.file('new.txt'), 'utf8')).toBe('user work')
    expect((await indexFor(f)).rollbackStarted).toBeUndefined()
  })

  it('rejects conflict and even safe new AI writes after preview using the server batch revision', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    let preview = await f.preview()
    await f.write('b.txt', 'AI')
    expect(await f.rollback(preview.revision)).toMatchObject({ status: 'blocked', preview: { reason: 'batch_changed' } })
    preview = await f.preview()
    await fs.writeFile(f.file('a.txt'), 'external')
    expect(await f.rollback(preview.revision)).toMatchObject({ status: 'blocked', restored: 0, removedCreated: 0 })
    expect(await fs.readFile(f.file('b.txt'), 'utf8')).toBe('AI')
  })

  it('does not wash away AI → external → AI history, including later writes', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    await fs.writeFile(f.file('a.txt'), 'user')
    await f.write('a.txt', 'AI overwrites user')
    await f.write('a.txt', 'another AI write')
    expect(await f.preview()).toMatchObject({ canRollback: false, files: [{ reason: 'external_modified' }] })
    expect((await rollbackCurrent(f)).status).toBe('blocked')
  })

  it('fails closed on missing files and never recreates externally removed targets', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'old')
    await f.write('a.txt', 'AI')
    await fs.unlink(f.file('a.txt'))
    expect(await f.preview()).toMatchObject({ files: [{ safe: false, reason: 'missing_file' }] })
    expect((await rollbackCurrent(f)).status).toBe('blocked')
    await expect(fs.stat(f.file('a.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['missing', 'corrupt'])('fails closed on %s original backup', async (mode) => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'old')
    await f.write('a.txt', 'AI')
    const index = await indexFor(f)
    const backup = path.join(path.dirname(f.indexPath), index.entries[0].backupName)
    if (mode === 'missing') await fs.unlink(backup)
    else await fs.writeFile(backup, 'corrupt')
    expect(await f.preview()).toMatchObject({ canRollback: false, files: [{ reason: 'backup_unavailable' }] })
    expect((await rollbackCurrent(f)).status).toBe('blocked')
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('AI')
  })

  it('rejects corrupt index and legacy records without reading suspicious target paths', async () => {
    const f = await fixture()
    await fs.mkdir(path.dirname(f.indexPath), { recursive: true })
    await fs.writeFile(f.indexPath, JSON.stringify({ entries: [{ path: f.file('never-read.txt'), created: true }] }))
    const read = vi.spyOn(fs, 'readFile')
    expect(await f.preview()).toMatchObject({ canRollback: false, files: [{ reason: 'legacy_backup' }] })
    expect(read.mock.calls.some(([file]) => file === f.file('never-read.txt'))).toBe(false)
    await fs.writeFile(f.indexPath, '{invalid')
    expect(await f.preview()).toMatchObject({ canRollback: false, reason: 'backup_unavailable' })
    expect((await rollbackCurrent(f)).status).toBe('blocked')
  })

  it('old entry with no after remains unsafe after a new AI write', async () => {
    const f = await fixture()
    await f.write('a.txt', 'first')
    const index = await indexFor(f)
    delete index.entries[0].afterHash
    await fs.writeFile(f.indexPath, JSON.stringify(index))
    await f.write('a.txt', 'second')
    expect(await f.preview()).toMatchObject({ canRollback: false, files: [{ reason: 'legacy_backup' }] })
  })

  it('serializes concurrent tool edits and index updates, including across sessions', async () => {
    const f = await fixture()
    await Promise.all(Array.from({ length: 8 }, (_, i) => f.write(`${i}.txt`, `${i}`)))
    expect((await f.preview()).files).toHaveLength(8)
    await f.write('same.txt', 'x')
    await Promise.all([
      toolEditFile({ path: 'same.txt', oldText: 'x', newText: 'xy' }, f.context),
      toolEditFile({ path: 'same.txt', oldText: 'xy', newText: 'xyz' }, f.context),
    ])
    expect(await fs.readFile(f.file('same.txt'), 'utf8')).toBe('xyz')
    const other = { ...f.context, sessionId: randomUUID() }
    await toolWriteFile({ path: 'same.txt', content: 'other session' }, other)
    expect((await f.preview()).files.at(-1)).toMatchObject({ safe: false, reason: 'external_modified' })
  })

  it('rejects a queued rollback if a preceding tool adds a file', async () => {
    const f = await fixture()
    await f.write('a.txt', 'a')
    const { revision } = await f.preview()
    let release
    const hold = withSessionFileLock(() => new Promise((resolve) => { release = resolve }))
    await Promise.resolve()
    const write = f.write('b.txt', 'b')
    const rollback = f.rollback(revision)
    release()
    await hold
    await write
    expect(await rollback).toMatchObject({ status: 'blocked', preview: { reason: 'batch_changed' } })
  })

  it('backup, journal mkdir and atomic index rename failures prevent actual tool writes', async () => {
    for (const failure of ['backup', 'mkdir', 'index']) {
      const f = await fixture()
      await fs.writeFile(f.file('a.txt'), 'old')
      const originalWrite = fs.writeFile.bind(fs)
      const write = vi.spyOn(fs, 'writeFile').mockImplementation(async (file, ...args) => {
        if (failure === 'backup' && String(file).startsWith(path.dirname(f.indexPath)) && String(file).endsWith('.txt')) throw new Error('backup disk full')
        return originalWrite(file, ...args)
      })
      const rename = vi.spyOn(fs, 'rename')
      if (failure === 'index') rename.mockRejectedValue(new Error('rename denied'))
      const originalMkdir = fs.mkdir.bind(fs)
      vi.spyOn(fs, 'mkdir').mockImplementation(async (dir, ...args) => {
        if (failure === 'mkdir' && dir === path.dirname(f.indexPath)) throw new Error('mkdir denied')
        return originalMkdir(dir, ...args)
      })
      await expect(f.write('a.txt', 'AI')).rejects.toThrow()
      expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('old')
      expect(write.mock.calls.filter(([file]) => file === f.file('a.txt'))).toHaveLength(0)
      vi.restoreAllMocks()
      expect(await f.preview()).toMatchObject({ canRollback: false, reason: 'backup_unavailable' })
      if (failure === 'backup') {
        expect((await indexFor(f)).entries[0]).toMatchObject({ pending: true, created: false })
        // Fresh module has no in-memory unavailable flag: durable pending alone
        // must still prevent both rollback and washing away the failed backup.
        vi.resetModules()
        const restarted = await import('../../server/session-file-backups.mjs')
        const preview = await restarted.getSessionFileRollbackPreview(f.sessionId)
        expect(preview).toMatchObject({ canRollback: false, files: [{ reason: 'incomplete_write' }] })
        expect(await restarted.rollbackSessionFiles(f.sessionId, { revision: preview.revision })).toMatchObject({ status: 'blocked', restored: 0 })
      }
    }
  })

  it('metadata refusal before registration neither bans a safe batch nor discards existing pending', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    const { backupFileBeforeWrite } = await import('../../server/session-file-backups.mjs')
    for (const pending of [false, true]) {
      const index = await indexFor(f)
      index.entries[0].pending = pending
      await fs.writeFile(f.indexPath, JSON.stringify(index))
      const original = fs.realpath.bind(fs)
      vi.spyOn(fs, 'realpath').mockImplementation(async (file, ...args) => {
        if (file === f.dir) throw new Error('metadata unavailable')
        return original(file, ...args)
      })
      await expect(backupFileBeforeWrite(f.sessionId, f.file('a.txt'), 'AI', { workspaceRoot: f.dir, afterContent: 'new' })).rejects.toThrow('metadata unavailable')
      vi.restoreAllMocks()
      expect((await indexFor(f)).entries[0].pending).toBe(pending)
      expect((await f.preview()).canRollback).toBe(!pending)
      expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('AI')
    }
  })

  it('missing sessionId causes no backup access; non-session text tools remain supported', async () => {
    const f = await fixture()
    const read = vi.spyOn(fs, 'readFile')
    expect(await getSessionFileChanges()).toEqual({ files: [], totalAdded: 0, totalRemoved: 0 })
    const preview = await getSessionFileRollbackPreview()
    expect(preview).toMatchObject({ canRollback: false, files: [] })
    expect(await rollbackSessionFiles(undefined, { revision: preview.revision })).toMatchObject({ status: 'blocked', restored: 0, removedCreated: 0 })
    expect(read).not.toHaveBeenCalled()
    await toolWriteFile({ path: 'a.txt', content: 'no session' }, { workspaceRoot: f.dir })
    await toolEditFile({ path: 'a.txt', oldText: 'no', newText: 'without' }, { workspaceRoot: f.dir })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('without session')
  })

  it('summary still includes external conflicts but never follows legacy target paths', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    await fs.writeFile(f.file('a.txt'), 'external')
    expect(await getSessionFileChanges(f.sessionId)).toMatchObject({ files: [{ relativePath: 'a.txt', added: 1 }] })
    const index = await indexFor(f)
    delete index.entries[0].workspaceRoot
    await fs.writeFile(f.indexPath, JSON.stringify(index))
    const read = vi.spyOn(fs, 'readFile')
    expect((await getSessionFileChanges(f.sessionId)).files).toEqual([])
    expect(read.mock.calls.some(([file]) => file === f.file('a.txt'))).toBe(false)
  })

  it('target write failure persists pending and after commit failure never exposes old safe after', async () => {
    for (const failure of ['write', 'after']) {
      const f = await fixture()
      await f.write('a.txt', 'first')
      const originalWrite = fs.writeFile.bind(fs)
      const originalRename = fs.rename.bind(fs)
      let renamed = 0
      vi.spyOn(fs, 'writeFile').mockImplementation(async (file, ...args) => {
        if (failure === 'write' && file === f.file('a.txt')) throw new Error('target failure')
        return originalWrite(file, ...args)
      })
      vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
        if (failure === 'after' && ++renamed === 2) throw new Error('after failure')
        return originalRename(...args)
      })
      await expect(f.write('a.txt', 'second')).rejects.toThrow()
      expect((await indexFor(f)).entries[0].pending).toBe(true)
      expect((await f.preview()).canRollback).toBe(false)
      expect((await rollbackCurrent(f)).status).toBe('blocked')
      vi.restoreAllMocks()
    }
  })

  it('second whole-batch preflight catches a late conflict with zero target writes', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    await f.write('b.txt', 'AI')
    const { revision } = await f.preview()
    const originalRead = fs.readFile.bind(fs)
    let reads = 0
    vi.spyOn(fs, 'readFile').mockImplementation(async (file, ...args) => {
      // b is read last in the first preflight; mutate it after that snapshot.
      const bytes = await originalRead(file, ...args)
      if (file === f.file('b.txt') && ++reads === 1) await fs.writeFile(file, 'external')
      return bytes
    })
    const result = await f.rollback(revision)
    expect(result).toMatchObject({ status: 'blocked', restored: 0, removedCreated: 0 })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('AI')
    expect((await indexFor(f)).rollbackStarted).toBeUndefined()
  })

  it('a failed completion commit reports failed and retains the completed-item journal', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.write('a.txt', 'AI')
    const original = fs.rename.bind(fs)
    let renames = 0
    vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      if (++renames === 4) throw new Error('completion commit failed')
      return original(...args)
    })
    expect(await rollbackCurrent(f)).toMatchObject({ status: 'failed', restored: 1, errors: [{ message: 'completion commit failed' }] })
    const index = await indexFor(f)
    expect(index.entries[0].rollbackState).toBe('completed')
    expect(index.completed).not.toBe(true)
    expect((await rollbackCurrent(f)).status).toBe('blocked')
  })

  it('a failed deletion reports failure and preserves the created target and journal', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    vi.spyOn(fs, 'unlink').mockRejectedValue(new Error('delete denied'))
    expect(await rollbackCurrent(f)).toMatchObject({ status: 'failed', removedCreated: 0, errors: [{ message: 'delete denied' }] })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('AI')
    expect((await indexFor(f)).entries[0].rollbackState).toBe('pending')
  })

  it('after hash belongs to intended content, not an external write between tool write and after commit', async () => {
    const f = await fixture()
    const original = fs.writeFile.bind(fs)
    vi.spyOn(fs, 'writeFile').mockImplementation(async (file, ...args) => {
      await original(file, ...args)
      if (file === f.file('a.txt')) await original(file, 'external')
    })
    await f.write('a.txt', 'AI')
    expect(await f.preview()).toMatchObject({ canRollback: false, files: [{ reason: 'external_modified' }] })
  })

  it('execution failure retains all backups and completed item states; retry cannot overwrite', async () => {
    const f = await fixture()
    for (const name of ['a.txt', 'b.txt']) {
      await fs.writeFile(f.file(name), 'before')
      await f.write(name, 'AI')
    }
    const { revision } = await f.preview()
    const original = fs.writeFile.bind(fs)
    vi.spyOn(fs, 'writeFile').mockImplementation(async (file, ...args) => {
      if (file === f.file('b.txt')) throw new Error('write denied')
      return original(file, ...args)
    })
    expect(await f.rollback(revision)).toMatchObject({ status: 'failed', restored: 1, removedCreated: 0, errors: [{ path: 'b.txt', message: 'write denied' }] })
    const index = await indexFor(f)
    expect(index.entries.map((entry) => entry.rollbackState)).toEqual(['completed', 'pending'])
    for (const entry of index.entries) expect(await fs.readFile(path.join(path.dirname(f.indexPath), entry.backupName), 'utf8')).toBe('before')
    await fs.writeFile(f.file('a.txt'), 'later user work')
    expect((await rollbackCurrent(f)).status).toBe('blocked')
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('later user work')
  })

  it('late external conflict stops execution with truthful partial counts and preserves backup', async () => {
    const f = await fixture()
    for (const name of ['a.txt', 'b.txt']) {
      await fs.writeFile(f.file(name), 'before')
      await f.write(name, 'AI')
    }
    const original = fs.writeFile.bind(fs)
    vi.spyOn(fs, 'writeFile').mockImplementation(async (file, ...args) => {
      await original(file, ...args)
      if (file === f.file('a.txt')) await original(f.file('b.txt'), 'external')
    })
    const result = await rollbackCurrent(f)
    expect(result).toMatchObject({ status: 'failed', restored: 1, errors: [{ path: 'b.txt', message: 'external_modified' }] })
    expect(await fs.readFile(f.file('b.txt'), 'utf8')).toBe('external')
    expect((await indexFor(f)).completed).not.toBe(true)
  })

  it('checks busy state inside the lock and again before any target write', async () => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    const options = { isSessionBusy: () => true }
    expect(await getSessionFileRollbackPreview(f.sessionId, options)).toMatchObject({ reason: 'session_busy', canRollback: false })
    const { revision } = await f.preview()
    expect(await rollbackSessionFiles(f.sessionId, { revision, ...options })).toMatchObject({ status: 'blocked', preview: { reason: 'session_busy' } })
    let guards = 0
    expect(await rollbackSessionFiles(f.sessionId, { revision, isSessionBusy: () => ++guards >= 2 })).toMatchObject({ status: 'blocked', restored: 0, removedCreated: 0 })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('AI')
  })

  it('requires revision and blocks empty/repeated batches', async () => {
    const f = await fixture()
    expect(await getSessionFileChanges(f.sessionId)).toEqual({ files: [], totalAdded: 0, totalRemoved: 0 })
    expect((await rollbackCurrent(f)).status).toBe('blocked')
    await f.write('a.txt', 'AI')
    expect(await rollbackSessionFiles(f.sessionId)).toMatchObject({ status: 'blocked', preview: { reason: 'batch_changed' } })
    expect(await rollbackSessionFiles(f.sessionId, { revision: 12 })).toMatchObject({ status: 'blocked' })
  })

  it.each(['outside', 'sensitive', 'directory', 'hardlink'])('blocks %s target substitution without touching it', async (mode) => {
    const f = await fixture()
    await f.write('a.txt', 'AI')
    const index = await indexFor(f)
    if (mode === 'outside') index.entries[0].path = path.resolve(f.dir, '..', 'outside.txt')
    if (mode === 'sensitive') {
      index.entries[0].path = f.file('.env')
      index.entries[0].realPath = f.file('.env')
    }
    if (mode === 'directory') {
      await fs.unlink(f.file('a.txt'))
      await fs.mkdir(f.file('a.txt'))
    }
    if (mode === 'hardlink') await fs.link(f.file('a.txt'), f.file('alias.txt'))
    await fs.writeFile(f.indexPath, JSON.stringify(index))
    expect(await f.preview()).toMatchObject({ canRollback: false, files: [{ reason: 'unsafe_path' }] })
    expect((await rollbackCurrent(f)).status).toBe('blocked')
  })

  it('blocks a replaced parent directory junction/symlink', async () => {
    const f = await fixture()
    await f.write('sub/a.txt', 'AI')
    await fs.rename(f.file('sub'), f.file('renamed'))
    await fs.symlink(f.file('renamed'), f.file('sub'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await f.preview()).toMatchObject({ canRollback: false, files: [{ reason: 'unsafe_path' }] })
    expect((await rollbackCurrent(f)).status).toBe('blocked')
    expect(await fs.readFile(f.file('renamed/a.txt'), 'utf8')).toBe('AI')
  })

  it('refuses binary source rather than backing up lossy decoded text', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), Buffer.from([0xff, 0x00, 0x01]))
    await expect(f.write('a.txt', 'replacement')).rejects.toThrow('UTF-8 text')
    expect(await fs.readFile(f.file('a.txt'))).toEqual(Buffer.from([0xff, 0x00, 0x01]))
  })
})

describe('per-turn rollback (versioned backup entries)', () => {
  it('records an independent version snapshot per write while entry fields stay anchored to the first version', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'first')
    await f.writeTurn('a.txt', 'turn1-a', 'turn-1')
    await f.editTurn({ path: 'a.txt', oldText: 'turn1-a', newText: 'turn1-b' }, 'turn-1')
    await f.writeTurn('a.txt', 'turn2', 'turn-2')
    const entry = (await indexFor(f)).entries[0]
    expect(entry.versions).toHaveLength(3)
    const [v1, v2, v3] = entry.versions
    expect(v1).toMatchObject({ turnId: 'turn-1', created: false, blobName: entry.backupName, beforeBytes: 5, afterBytes: 7 })
    expect(v2).toMatchObject({ turnId: 'turn-1', created: false, beforeBytes: 7, afterBytes: 7 })
    expect(v2.blobName).not.toBe(entry.backupName)
    expect(v3).toMatchObject({ turnId: 'turn-2', created: false, beforeBytes: 7, afterBytes: 5 })
    expect(entry.beforeHash).toBe(v1.beforeHash)
    expect(entry.afterHash).toBe(v3.afterHash)
    for (const [version, content] of [[v1, 'first'], [v2, 'turn1-a'], [v3, 'turn1-b']]) {
      expect(await fs.readFile(path.join(path.dirname(f.indexPath), version.blobName), 'utf8')).toBe(content)
    }
  })

  it('groups the turn preview by safety with the three conflict reasons', async () => {
    const f = await fixture()
    for (const name of ['a.txt', 'b.txt', 'c.txt']) await fs.writeFile(f.file(name), `${name}-before`)
    await f.writeTurn('a.txt', 'a-t1', 'turn-1')
    await f.writeTurn('b.txt', 'b-t1', 'turn-1')
    await f.writeTurn('c.txt', 'c-t1', 'turn-1')
    await f.writeTurn('d.txt', 'd-t1', 'turn-1')
    await f.writeTurn('a.txt', 'a-t2', 'turn-2')
    await fs.writeFile(f.file('b.txt'), 'external')
    const index = await indexFor(f)
    delete index.entries.find((entry) => entry.relativePath === 'c.txt').versions[0].afterHash
    await fs.writeFile(f.indexPath, JSON.stringify(index))
    const preview = await f.previewTurn(['turn-1'])
    expect(preview).toMatchObject({ turnIds: ['turn-1'], canRollback: true })
    expect(preview.files.map(({ relativePath, safe, reason, action, created }) => ({ relativePath, safe, reason, action, created }))).toEqual([
      { relativePath: 'a.txt', safe: false, reason: 'modified-after-turn', action: 'restore', created: false },
      { relativePath: 'b.txt', safe: false, reason: 'external-change', action: 'restore', created: false },
      { relativePath: 'c.txt', safe: false, reason: 'stale-backup', action: 'restore', created: false },
      { relativePath: 'd.txt', safe: true, reason: null, action: 'delete', created: true },
    ])
    expect(preview.files.every((file) => typeof file.revision === 'string')).toBe(true)
    expect(preview.files.find((file) => file.relativePath === 'd.txt')).toMatchObject({ beforeBytes: 0, afterBytes: 4 })
    expect((await f.previewTurn(['turn-1'])).revision).toBe(preview.revision)
    // The later turn only lists its own write, restorable to the turn-1 result.
    expect(await f.previewTurn(['turn-2'])).toMatchObject({ files: [{ relativePath: 'a.txt', safe: true, action: 'restore', created: false }] })
    // Unknown turns have no journaled writes: an empty list is a valid answer.
    expect(await f.previewTurn(['unknown-turn'])).toMatchObject({ turnIds: ['unknown-turn'], canRollback: true, files: [] })
    const empty = await f.previewTurn(['unknown-turn'])
    expect(await f.rollbackTurn(['unknown-turn'], empty.revision)).toMatchObject({ status: 'completed', rolledBack: [], conflicts: [] })
  })

  it('treats a turn group (original run + retry run) as one rollback unit', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.writeTurn('a.txt', 'original-run', 'turn-1')
    await f.writeTurn('a.txt', 'retry-run', 'turn-1r')
    await f.writeTurn('new.txt', 'created-by-retry', 'turn-1r')
    // A single id only sees part of the group: the retry superseded the
    // original run's write on a.txt.
    expect(await f.previewTurn(['turn-1'])).toMatchObject({ turnIds: ['turn-1'], files: [{ relativePath: 'a.txt', safe: false, reason: 'modified-after-turn' }] })
    expect(await f.previewTurn(['turn-1r'])).toMatchObject({ turnIds: ['turn-1r'], canRollback: true })
    // The whole group hits every version of the turn and restores each file
    // to its state before the group's first matching version.
    const preview = await f.previewTurn(['turn-1', 'turn-1r'])
    expect(preview).toMatchObject({ turnIds: ['turn-1', 'turn-1r'], canRollback: true })
    expect(preview.files.map(({ relativePath, safe }) => ({ relativePath, safe }))).toEqual([
      { relativePath: 'a.txt', safe: true },
      { relativePath: 'new.txt', safe: true },
    ])
    expect(await f.rollbackTurn(['turn-1', 'turn-1r'], preview.revision)).toMatchObject({
      status: 'completed',
      rolledBack: [{ path: f.file('a.txt'), action: 'restore' }, { path: f.file('new.txt'), action: 'delete' }],
      conflicts: [],
    })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('before')
    await expect(fs.stat(f.file('new.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('flags a turn group when a later run outside the group or an unattributed write follows', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await fs.writeFile(f.file('b.txt'), 'before')
    await f.writeTurn('a.txt', 'original-run', 'turn-1')
    await f.writeTurn('a.txt', 'retry-run', 'turn-1r')
    await f.writeTurn('b.txt', 'original-run', 'turn-1')
    await f.writeTurn('b.txt', 'retry-run', 'turn-1r')
    await f.writeTurn('a.txt', 'next-turn', 'turn-2')
    await f.write('b.txt', 'unattributed')
    const preview = await f.previewTurn(['turn-1', 'turn-1r'])
    expect(preview.files.map(({ relativePath, safe, reason }) => ({ relativePath, safe, reason }))).toEqual([
      { relativePath: 'a.txt', safe: false, reason: 'modified-after-turn' },
      { relativePath: 'b.txt', safe: false, reason: 'modified-after-turn' },
    ])
  })

  it('returns an empty but valid preview for an empty turn id set', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.writeTurn('a.txt', 'run', 'turn-1')
    const preview = await f.previewTurn([])
    expect(preview).toMatchObject({ turnIds: [], canRollback: true, files: [] })
    expect(await f.rollbackTurn([], preview.revision)).toMatchObject({ status: 'completed', rolledBack: [], conflicts: [] })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('run')
  })

  it('restores a turn to its start state, deleting files it created', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.writeTurn('a.txt', 't1-v1', 'turn-1')
    await f.editTurn({ path: 'a.txt', oldText: 't1-v1', newText: 't1-v2' }, 'turn-1')
    await f.writeTurn('new.txt', 'created', 'turn-1')
    const preview = await f.previewTurn(['turn-1'])
    const result = await f.rollbackTurn(['turn-1'], preview.revision)
    expect(result).toMatchObject({
      status: 'completed',
      rolledBack: [{ path: f.file('a.txt'), action: 'restore' }, { path: f.file('new.txt'), action: 'delete' }],
      conflicts: [],
      errors: [],
    })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('before')
    await expect(fs.stat(f.file('new.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    // Rolled-back entries leave the turn preview; the old revision is stale.
    expect((await f.previewTurn(['turn-1'])).files).toEqual([])
    expect(await f.rollbackTurn(['turn-1'], preview.revision)).toMatchObject({ status: 'blocked', rolledBack: [] })
    expect((await indexFor(f)).entries.every((entry) => entry.rollbackState === 'completed')).toBe(true)
  })

  it('rolls back only safe files and reports modified-after-turn conflicts as partial', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'a-before')
    await fs.writeFile(f.file('b.txt'), 'b-before')
    await f.writeTurn('a.txt', 'a-t1', 'turn-1')
    await f.writeTurn('b.txt', 'b-t1', 'turn-1')
    await f.writeTurn('a.txt', 'a-t2', 'turn-2')
    const result = await f.rollbackTurn(['turn-1'], (await f.previewTurn(['turn-1'])).revision)
    expect(result).toMatchObject({
      status: 'partial',
      rolledBack: [{ path: f.file('b.txt'), action: 'restore' }],
      conflicts: [{ path: f.file('a.txt'), reason: 'modified-after-turn' }],
    })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('a-t2')
    expect(await fs.readFile(f.file('b.txt'), 'utf8')).toBe('b-before')
    // The later turn is unaffected and still rolls back onto the turn-1 result.
    expect(await f.rollbackTurn(['turn-2'], (await f.previewTurn(['turn-2'])).revision)).toMatchObject({ status: 'completed' })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('a-t1')
  })

  it('treats legacy versionless entries as an implicit version and keeps whole-session rollback working', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.writeTurn('a.txt', 'AI', 'turn-1')
    const index = await indexFor(f)
    delete index.entries[0].versions
    await fs.writeFile(f.indexPath, JSON.stringify(index))
    // Legacy entries carry no turn attribution: invisible to turn lookups...
    expect((await f.previewTurn(['turn-1'])).files).toEqual([])
    // ...but the whole-session rollback keeps its exact legacy behavior.
    expect(await rollbackCurrent(f)).toMatchObject({ status: 'completed', restored: 1 })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('before')

    // An active legacy entry (simulate by stripping versions) is materialized
    // as an implicit null-turn version on the next write.
    await f.writeTurn('a.txt', 'user + AI', 'turn-2')
    const stripped = await indexFor(f)
    delete stripped.entries[0].versions
    await fs.writeFile(f.indexPath, JSON.stringify(stripped))
    await f.writeTurn('a.txt', 'turn-9', 'turn-9')
    const entry = (await indexFor(f)).entries[0]
    expect(entry.versions).toHaveLength(2)
    expect(entry.versions[0]).toMatchObject({ turnId: null, created: false, blobName: entry.backupName })
    expect(entry.versions[1]).toMatchObject({ turnId: 'turn-9', created: false })
    expect((await f.previewTurn(['turn-1'])).files).toEqual([])
    expect(await f.rollbackTurn(['turn-9'], (await f.previewTurn(['turn-9'])).revision)).toMatchObject({ status: 'completed', rolledBack: [{ path: f.file('a.txt'), action: 'restore' }] })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('user + AI')
  })

  it('blocks turn rollback on a stale revision or a fresh external change without target writes', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.writeTurn('a.txt', 't1', 'turn-1')
    const preview = await f.previewTurn(['turn-1'])
    expect(await f.rollbackTurn(['turn-1'])).toMatchObject({ status: 'blocked', preview: { reason: 'batch_changed' } })
    await f.writeTurn('b.txt', 'other file', 'turn-2')
    expect(await f.rollbackTurn(['turn-1'], preview.revision)).toMatchObject({ status: 'blocked', rolledBack: [], preview: { reason: 'batch_changed' } })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('t1')
    const fresh = await f.previewTurn(['turn-1'])
    await fs.writeFile(f.file('a.txt'), 'external')
    expect(await f.rollbackTurn(['turn-1'], fresh.revision)).toMatchObject({ status: 'blocked', rolledBack: [] })
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('external')
    expect(await f.rollbackTurn(['turn-1'], 'wrong')).toMatchObject({ status: 'blocked' })
    expect(await f.previewTurn(['turn-1'], { isSessionBusy: () => true })).toMatchObject({ canRollback: false, reason: 'session_busy' })
    expect(await f.rollbackTurn(['turn-1'], (await f.previewTurn(['turn-1'])).revision, { isSessionBusy: () => true })).toMatchObject({ status: 'blocked', preview: { reason: 'session_busy' } })
    expect(await getSessionTurnRollbackPreview(undefined, { turnIds: ['turn-1'] })).toMatchObject({ canRollback: false, files: [], reason: 'unavailable' })
    expect(await f.rollbackTurn(undefined, 'any')).toMatchObject({ status: 'blocked' })
  })
})

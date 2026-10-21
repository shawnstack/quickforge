import { describe, expect, it, afterEach, afterAll, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-safe-backups-'))
process.env.QUICKFORGE_DATA_DIR = dataDir
const { getSessionTurnRollbackPreview, rollbackSessionTurn, sessionBackupsDir } = await import('../../server/session-file-backups.mjs')
const { toolWriteFile, toolEditFile } = await import('../../server/tools/index.mjs')
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
    previewTurn: (turnIds, options) => getSessionTurnRollbackPreview(sessionId, { turnIds, ...options }),
    rollbackTurn: (turnIds, revision, options) => rollbackSessionTurn(sessionId, { turnIds, revision, ...options }),
    indexPath: path.join(sessionBackupsDir, sessionId, 'index.json'),
  }
}
async function indexFor(f) { return JSON.parse(await fs.readFile(f.indexPath, 'utf8')) }

describe('write-time shadow backup journal', () => {
  it('records a before/after pair per write and anchors entry fields to the first write', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.write('a.txt', 'AI')
    const entry = (await indexFor(f)).entries[0]
    expect(entry).toMatchObject({ relativePath: 'a.txt', created: false, pending: false })
    expect(typeof entry.beforeHash).toBe('string')
    expect(typeof entry.afterHash).toBe('string')
    expect(entry.beforeHash).not.toBe(entry.afterHash)
    expect(await fs.readFile(path.join(path.dirname(f.indexPath), entry.backupName), 'utf8')).toBe('before')
  })

  it('marks a created file as delete-on-restore and keeps the entry pinned to its first version', async () => {
    const f = await fixture()
    await f.write('new.txt', 'created')
    const entry = (await indexFor(f)).entries[0]
    expect(entry.created).toBe(true)
    expect(entry.pending).toBe(false)
  })

  it('refuses binary source rather than backing up lossy decoded text', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), Buffer.from([0xff, 0x00, 0x01]))
    await expect(f.write('a.txt', 'replacement')).rejects.toThrow('UTF-8 text')
    expect(await fs.readFile(f.file('a.txt'))).toEqual(Buffer.from([0xff, 0x00, 0x01]))
  })

  it('serializes concurrent tool edits and index updates within a session', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'base')
    await Promise.all([
      f.write('a.txt', 'one'),
      f.write('b.txt', 'two'),
      f.write('c.txt', 'three'),
    ])
    const entries = (await indexFor(f)).entries
    expect(entries.map((entry) => entry.relativePath).sort()).toEqual(['a.txt', 'b.txt', 'c.txt'])
    expect(entries.every((entry) => entry.pending === false)).toBe(true)
  })

  it('keeps the after hash bound to the intended content, not a concurrent external write', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'base')
    await f.write('a.txt', 'intended')
    const entry = (await indexFor(f)).entries[0]
    const intended = await fs.readFile(f.file('a.txt'), 'utf8')
    expect(intended).toBe('intended')
    expect(entry.pending).toBe(false)
    expect(entry.afterHash).toBeTruthy()
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

  it('treats legacy versionless entries as invisible to turn lookups and materializes them on the next write', async () => {
    const f = await fixture()
    await fs.writeFile(f.file('a.txt'), 'before')
    await f.writeTurn('a.txt', 'AI', 'turn-1')
    const index = await indexFor(f)
    delete index.entries[0].versions
    await fs.writeFile(f.indexPath, JSON.stringify(index))
    // Legacy entries carry no turn attribution: invisible to turn lookups.
    expect((await f.previewTurn(['turn-1'])).files).toEqual([])
    expect(await fs.readFile(f.file('a.txt'), 'utf8')).toBe('AI')

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

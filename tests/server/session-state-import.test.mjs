import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Schema v11 JSON importer tests: a real QUICKFORGE_DATA_DIR temp layout (env
// set before every dynamic import — the vi.resetModules cache-bust pattern),
// the real physical fs adapter, and a real temp SQLite database initialized
// through initializeSqliteStorage (so the auto_vacuum pragma path runs too).
let tmpDir
let previousDataDir
let modules
let databaseSerial = 0

async function loadModules() {
  vi.resetModules()
  modules = {
    database: await import('../../server/sqlite/database.mjs'),
    repository: await import('../../server/sqlite/session-state-repository.mjs'),
    storage: await import('../../server/storage.mjs'),
    importer: await import('../../server/session-state-import.mjs'),
  }
  return modules
}

function body(sessionId, overrides = {}) {
  const scope = overrides.scope || 'global'
  return {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId: overrides.projectId || 'demo' } : {}),
    title: `Title ${sessionId}`,
    stateVersion: 1,
    createdAt: overrides.createdAt || '2026-01-02T00:00:00.000Z',
    lastModified: overrides.lastModified || '2026-01-02T00:00:01.000Z',
    messages: overrides.messages ?? [{ role: 'user', content: `hello ${sessionId}` }],
    ...overrides.body,
  }
}

function metadataFor(sessionId, overrides = {}) {
  const scope = overrides.scope || 'global'
  return {
    id: sessionId,
    scope,
    ...(scope === 'project' ? { projectId: overrides.projectId || 'demo' } : {}),
    title: `Title ${sessionId}`,
    createdAt: overrides.createdAt || '2026-01-02T00:00:00.000Z',
    lastModified: overrides.lastModified || '2026-01-02T00:00:01.000Z',
    messageCount: overrides.messageCount ?? 1,
    stateVersion: 1,
    ...overrides.metadata,
  }
}

function bucketDir(bucket) {
  const base = path.join(tmpDir, 'data', 'storage', 'conversations')
  return bucket.scope === 'project' ? path.join(base, 'projects', bucket.projectId) : path.join(base, 'global')
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

describe('session state JSON import (schema v11)', () => {
  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-session-import-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await loadModules()
  })

  afterEach(async () => {
    await modules.database.closeSqliteStorage().catch(() => {})
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  async function setup() {
    await modules.storage.ensureStorage()
    const databasePath = path.join(tmpDir, `state-${++databaseSerial}.sqlite3`)
    const storage = await modules.database.initializeSqliteStorage({ databasePath })
    const repository = modules.repository.createSessionStateRepository(storage)
    return { storage, repository }
  }

  async function seedJsonTree() {
    const globalSessions = path.join(bucketDir({ scope: 'global' }), 'sessions')
    const demoSessions = path.join(bucketDir({ scope: 'project', projectId: 'demo' }), 'sessions')
    // g1: plain inline body + metadata.
    await writeJson(path.join(globalSessions, 'g1.json'), body('g1', { messages: [
      { role: 'user', content: 'm0' }, { role: 'assistant', content: 'm1' },
    ] }))
    // g2: legacy split-marked body that still carries its inline messages copy.
    await writeJson(path.join(globalSessions, 'g2.json'), {
      ...body('g2', { messages: [{ role: 'user', content: 'gm0' }, { role: 'user', content: 'gm1' }] }),
      messageStorage: 'split',
    })
    // g3: body-only file (no metadata entry) — metadata is derived.
    await writeJson(path.join(globalSessions, 'g3.json'), { ...body('g3', { messages: [] }) })
    // g4: body whose id mismatches its filename — invalid, skipped.
    await writeJson(path.join(globalSessions, 'g4.json'), body('wrong-id'))
    // ghost: metadata-only orphan — dropped and diagnosed.
    await writeJson(path.join(bucketDir({ scope: 'global' }), 'sessions-metadata.json'), {
      g1: metadataFor('g1', { messageCount: 2 }),
      g2: metadataFor('g2'),
      g4: metadataFor('g4'),
      ghost: metadataFor('ghost'),
    })
    // Project bucket: one session with two messages.
    await writeJson(path.join(demoSessions, 'p1.json'), body('p1', {
      scope: 'project', projectId: 'demo',
      messages: [{ role: 'user', content: 'pm0' }, { role: 'user', content: 'pm1' }],
    }))
    await writeJson(path.join(bucketDir({ scope: 'project', projectId: 'demo' }), 'sessions-metadata.json'), {
      p1: metadataFor('p1', { scope: 'project', projectId: 'demo', messageCount: 2 }),
    })
  }

  it('imports both buckets, extracts every message representation, and reports diagnostics', async () => {
    await seedJsonTree()
    const { storage, repository } = await setup()
    // Fresh database initialized through initializeSqliteStorage: the
    // auto_vacuum = INCREMENTAL pragma took effect (0 none / 1 full / 2 incr).
    expect(Number(storage.prepare('PRAGMA auto_vacuum').get().auto_vacuum)).toBe(2)

    const result = await modules.importer.importSessionStateFromJson({ storage: modules.storage })
    expect(result.imported).toBe(4)
    expect(result.skipped).toBe(2)
    expect(result.diagnostics).toHaveLength(3)
    const byKind = Object.fromEntries(result.diagnostics.map((entry) => [entry.kind, entry]))
    expect(byKind['metadata-only-orphan']).toMatchObject({ scope: 'global', projectId: null, sessionId: 'ghost' })
    expect(byKind['invalid-entry']).toMatchObject({ scope: 'global', projectId: null, sessionId: 'g4', message: expect.stringContaining('id mismatch') })
    expect(byKind['body-only']).toMatchObject({ scope: 'global', projectId: null, sessionId: 'g3' })

    expect(repository.count()).toBe(4)
    expect(repository.findBySessionId('ghost')).toBeNull()
    expect(repository.messageCount({ scope: 'global', sessionId: 'g1' })).toBe(2)
    expect(repository.messageCount({ scope: 'global', sessionId: 'g2' })).toBe(2)
    expect(repository.messageCount({ scope: 'global', sessionId: 'g3' })).toBe(0)
    expect(repository.messageCount({ scope: 'project', projectId: 'demo', sessionId: 'p1' })).toBe(2)

    // Bodies never store messages; the marker keeps the service-side readers
    // working, and message_count follows the stored rows.
    const g1 = repository.findBySessionId('g1')
    expect(g1.state).not.toHaveProperty('messages')
    expect(g1.state.messageStorage).toBe('split')
    expect(g1.metadata.title).toBe('Title g1')
    const row = storage.prepare('SELECT title, message_count, created_at FROM sessions WHERE session_id = ?').get('g1')
    expect(row.title).toBe('Title g1')
    expect(row.message_count).toBe(2)
    // Original creation timestamps survive the import.
    expect(row.created_at).toBe('2026-01-02T00:00:00.000Z')
    const g3 = repository.findBySessionId('g3')
    expect(g3.metadata.messageCount).toBe(0)

    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 4 })
  })

  it('is idempotent on re-run and never modifies the JSON tree', async () => {
    await seedJsonTree()
    const { repository } = await setup()
    const before = await modules.importer.importSessionStateFromJson({ storage: modules.storage })
    expect(before.imported).toBe(4)
    const digestAfterFirst = repository.digest()

    const g1File = path.join(bucketDir({ scope: 'global' }), 'sessions', 'g1.json')
    const g1Before = await readFile(g1File, 'utf8')
    const second = await modules.importer.importSessionStateFromJson({ storage: modules.storage })
    expect(second.imported).toBe(4)
    expect(second.diagnostics.map((entry) => entry.kind).sort()).toEqual(before.diagnostics.map((entry) => entry.kind).sort())
    // Same rows, same digests: saves are CAS upserts that replace the message
    // rows with identical content instead of duplicating them.
    expect(repository.count()).toBe(4)
    expect(repository.messageCount({ scope: 'global', sessionId: 'g1' })).toBe(2)
    expect(repository.digest()).toBe(digestAfterFirst)
    expect(repository.findBySessionId('g1').revision).toBe(2)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 4 })
    expect(await readFile(g1File, 'utf8')).toBe(g1Before)
  })

  it('imports into an empty store when the JSON tree only has the global bucket', async () => {
    await modules.storage.ensureStorage()
    const { repository } = await setup()
    const result = await modules.importer.importSessionStateFromJson({ storage: modules.storage })
    expect(result).toMatchObject({ imported: 0, skipped: 0, diagnostics: [] })
    expect(repository.count()).toBe(0)
    expect(repository.verifyIntegrity()).toMatchObject({ ok: true, count: 0 })
  })
})

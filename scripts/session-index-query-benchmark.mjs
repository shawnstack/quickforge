import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { applySqliteMigrations } from '../server/sqlite/migrations.mjs'
import { createSessionIndexRepository } from '../server/sqlite/session-index-repository.mjs'
import { canonicalSessionMetadata, sessionMetadataDigest } from '../server/session-index-service.mjs'

const counts = process.argv.slice(2).map(Number).filter((value) => Number.isSafeInteger(value) && value > 0)
if (counts.length === 0) counts.push(1_000, 10_000)

function handle(database) {
  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => database.prepare(sql),
    transaction(callback, { mode = 'immediate' } = {}) {
      database.exec(`BEGIN ${mode.toUpperCase()}`)
      try {
        const result = callback(this)
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
}

function elapsedMs(start) {
  return Number(process.hrtime.bigint() - start) / 1_000_000
}

function jsonPage(values, limit, offset) {
  const copy = values.filter((value) => value.messageCount !== 0 && !value.archivedAt)
  copy.sort((left, right) => {
    if (left.pinnedAt !== right.pinnedAt) {
      if (left.pinnedAt == null) return 1
      if (right.pinnedAt == null) return -1
      return -String(left.pinnedAt).localeCompare(String(right.pinnedAt))
    }
    return -String(left.lastModified).localeCompare(String(right.lastModified))
  })
  return { total: copy.length, values: copy.slice(offset, offset + limit) }
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-query-benchmark-'))
try {
  for (const count of counts) {
    const database = new DatabaseSync(path.join(directory, `${count}.sqlite3`))
    try {
      applySqliteMigrations(database)
      const repository = createSessionIndexRepository(handle(database))
      const values = []
      const rows = []
      const indexedAt = new Date().toISOString()
      for (let index = 0; index < count; index += 1) {
        const scope = index % 3 === 0 ? 'global' : 'project'
        const projectId = scope === 'project' ? `project-${index % 20}` : null
        const sessionId = `session-${String(index).padStart(7, '0')}`
        const metadata = canonicalSessionMetadata({
          id: sessionId,
          scope,
          ...(projectId ? { projectId } : {}),
          title: `Session ${index}`,
          messageCount: index % 17 === 0 ? 0 : 1,
          createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1_000).toISOString(),
          lastModified: new Date(Date.UTC(2026, 0, 1) + index * 2_000).toISOString(),
          ...(index % 97 === 0 ? { pinnedAt: new Date(Date.UTC(2026, 6, 1) + index * 1_000).toISOString() } : {}),
          ...(index % 101 === 0 ? { archivedAt: new Date(Date.UTC(2026, 7, 1) + index * 1_000).toISOString() } : {}),
        }, { scope, projectId, sessionId })
        values.push(metadata)
        rows.push({
          scope, projectId, sessionId,
          createdAt: metadata.createdAt,
          lastModified: metadata.lastModified,
          messageCount: metadata.messageCount,
          pinnedAt: metadata.pinnedAt ?? null,
          archivedAt: metadata.archivedAt ?? null,
          stateVersion: null,
          metadata,
          metadataDigest: sessionMetadataDigest(metadata),
          indexedAt,
        })
      }
      repository.replaceAll(rows)
      const options = { scopeMode: 'all', archive: 'exclude', pinnedOnly: false, sort: 'lastModified', direction: 'desc', limit: 20, offset: 200 }
      repository.listPage(options)
      const jsonStart = process.hrtime.bigint()
      const jsonResult = jsonPage(values, options.limit, options.offset)
      const jsonMs = elapsedMs(jsonStart)
      const sqlStart = process.hrtime.bigint()
      const sqlResult = repository.listPage(options)
      const sqlMs = elapsedMs(sqlStart)
      process.stdout.write(`${JSON.stringify({
        benchmark: 'session-index-query',
        count,
        query: options,
        jsonMs,
        warmSqlMs: sqlMs,
        equivalent: jsonResult.total === sqlResult.total && JSON.stringify(jsonResult.values) === JSON.stringify(sqlResult.values),
        explain: repository.explainQueryPlan(options).map((row) => row.detail),
      })}\n`)
    } finally {
      database.close()
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}

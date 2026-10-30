import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import { createScheduledTaskRunsRepository } from '../../server/sqlite/scheduled-task-runs-repository.mjs'
import { createShareRepository } from '../../server/sqlite/share-repository.mjs'
import { importSessionStateFromJson } from '../../server/session-state-import.mjs'
import {
  configureSessionStateService,
  deleteSessionState,
  readSessionStateValue,
  saveSessionBody,
} from '../../server/session-state-service.mjs'
import {
  exportSessionStateForBackup,
  restoreSessionStateSnapshot,
} from '../../server/session-state-backup.mjs'
import { initializeShareService, configureShareService, stopShareService } from '../../server/share-service.mjs'
import {
  exportShareStateForBackup,
  restoreShareStateSnapshot,
} from '../../server/share-backup.mjs'
import {
  createConversationShare,
  issueConversationShareToken,
  readConversationShare,
  revokeConversationShare,
  verifyShareToken,
} from '../../server/share-store.mjs'
import {
  initializeLanAccessService,
  configureLanAccessService,
  stopLanAccessService,
} from '../../server/lan-access-service.mjs'
import { createLanAccessRepository } from '../../server/sqlite/lan-access-repository.mjs'
import {
  exportLanAccessStateForBackup,
  restoreLanAccessStateSnapshot,
} from '../../server/lan-access-backup.mjs'
// Full-chain smoke: requires QUICKFORGE_DATA_DIR to be set by the runner so
// storage.mjs resolves into an isolated temp dir.
const directory = process.env.QUICKFORGE_DATA_DIR
if (!directory) throw new Error('QUICKFORGE_DATA_DIR is required')

const projectRoot = path.resolve(import.meta.dirname, '../..')

const globalDir = path.join(directory, 'storage', 'conversations', 'global')
const sessionsDir = path.join(globalDir, 'sessions')

function bigMessages(count, start = 0) {
  const result = []
  for (let index = start; index < start + count; index += 1) {
    result.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: `message ${index}`, timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z` })
  }
  return result
}

function spawnTool(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: projectRoot,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        QUICKFORGE_DATA_DIR: directory,
        QUICKFORGE_LOG_LEVEL: 'ERROR',
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`maintenance tool timed out: ${stderr}`))
    }, 30_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

try {
  await mkdir(sessionsDir, { recursive: true })
  const seedState = { id: 'seed', scope: 'global', stateVersion: 1, title: 'Seed', messages: [{ role: 'user', content: 'hello' }] }
  const seedMetadata = { id: 'seed', scope: 'global', stateVersion: 1, title: 'Seed', createdAt: '2026-01-01T00:00:00.000Z', lastModified: '2026-01-01T00:00:00.000Z', messageCount: 1 }
  await writeFile(path.join(sessionsDir, 'seed.json'), `${JSON.stringify(seedState)}\n`, 'utf8')
  await writeFile(path.join(globalDir, 'sessions-metadata.json'), `${JSON.stringify({ seed: seedMetadata })}\n`, 'utf8')

  const storage = await initializeSqliteStorage({ dataDir: directory })
  // Guard on structural consistency (the migration rows line up with the
  // stamped user_version) rather than on a literal latest version, so appending
  // a migration does not require editing this fixture.
  const initialHealth = storage.health()
  if (!initialHealth.ok || initialHealth.schemaVersion !== initialHealth.latestSchemaVersion) {
    throw new Error(`inconsistent sqlite migration state: ${JSON.stringify(initialHealth)}`)
  }
  const repository = createSessionStateRepository(storage)
  // Storage v2: SQLite is authoritative by construction; only the repository
  // override remains testable (mirror/phase are ignored).
  configureSessionStateService({ repository })

  // Startup import: JSON tree → authoritative SQLite store (idempotent,
  // read-only over the JSON files, WAL checkpoint at the end).
  const imported = await importSessionStateFromJson()
  if (imported.imported !== 1 || imported.skipped !== 0) {
    throw new Error(`unexpected import result: ${JSON.stringify(imported)}`)
  }

  // Session save / read / delete.
  await saveSessionBody('smoke', { messages: [{ role: 'user', content: 'hello' }], title: 'Smoke' })
  const readBack = await readSessionStateValue('smoke')
  if (!readBack || readBack.messages.length !== 1 || readBack.title !== 'Smoke') throw new Error('session save/read failed')

  // CAS 409 on a stale expectedRevision.
  let conflicted = false
  try {
    await saveSessionBody('smoke', { messages: [] }, { expectedRevision: 0 })
  } catch (error) {
    if (error?.errorCode === 'SESSION_STATE_CONFLICT') conflicted = true
  }
  if (!conflicted) throw new Error('CAS conflict was not raised as SESSION_STATE_CONFLICT')

  // F9 split path: a message-heavy session is stored incrementally in
  // session_messages; reads reassemble body + messages. The state frame the
  // routes would ship is asserted to be lightweight (summary instead of the
  // full message list).
  await saveSessionBody('big', { messages: bigMessages(210), title: 'Big' })
  const readBig = await readSessionStateValue('big')
  if (!readBig || readBig.messages.length !== 210 || readBig.title !== 'Big') throw new Error('split session read/assembly failed')
  if (repository.messageCount({ scope: 'global', sessionId: 'big' }) !== 210) throw new Error('split session message count mismatch')
  await saveSessionBody('big', { messages: [...bigMessages(210), { role: 'user', content: 'appended', timestamp: '2026-01-01T00:00:03.000Z' }] })
  if (repository.messageCount({ scope: 'global', sessionId: 'big' }) !== 211) throw new Error('incremental append failed')
  const splitStateFrame = JSON.stringify({ ...readBig, messages: undefined, messagesSummary: { count: readBig.messages.length } })
  if (Buffer.byteLength(splitStateFrame, 'utf8') > 2048) throw new Error(`split state frame unexpectedly large: ${Buffer.byteLength(splitStateFrame, 'utf8')} bytes`)
  if (!(await deleteSessionState('big'))) throw new Error('split session delete failed')

  const deleted = await deleteSessionState('smoke')
  if (!deleted || (await readSessionStateValue('smoke')) !== null) throw new Error('session delete failed')

  // Authoritative backup/restore with a split session present: the exported
  // snapshot must reassemble messages; restoring the exported values must
  // reproduce the exact stored digest (representation roundtrip).
  await saveSessionBody('big2', { messages: bigMessages(210), title: 'Big 2' })
  const exported = await exportSessionStateForBackup()
  if (exported.count !== 2 || exported.phase !== 'authoritative' || !exported.digest) throw new Error('authoritative export failed')
  if (exported.sessions.big2?.messages?.length !== 210) throw new Error('split session export did not reassemble messages')
  const restored = await restoreSessionStateSnapshot({
    sessions: exported.sessions,
    sessionsMetadata: exported.sessionsMetadata,
  }, { mode: 'replace' })
  if (restored.sessions !== 2) throw new Error('authoritative restore failed')
  const afterRestore = repository.exportSnapshot()
  if (afterRestore.count !== 2 || afterRestore.digest !== exported.digest) throw new Error('split-session restore digest roundtrip failed')
  const readBig2 = await readSessionStateValue('big2')
  if (!readBig2 || readBig2.messages.length !== 210) throw new Error('split session restore reassembly failed')

  // Scheduled runs must not regress while session state is authoritative.
  const runsRepository = createScheduledTaskRunsRepository(storage)
  runsRepository.create('smoke-task', { id: 'run-1', status: 'success', startedAt: '2026-01-01T00:00:00.000Z' })
  const listed = runsRepository.list({ taskIds: ['smoke-task'], page: 1, pageSize: 10 })
  if (listed.total !== 1 || listed.runs[0].id !== 'run-1') throw new Error('scheduled runs regression detected')

  // === share storage full chain (SQLite is the only store) ===
  // Drive create/read/token/revoke through the real share-store → repository
  // path, prove backup/restore reproduces the exact digest, and prove runtime
  // writes never materialize a JSON store any more.
  const sharesFile = path.join(directory, 'storage', 'shares', 'conversation-shares.json')
  const shareRepository = createShareRepository(storage)
  configureShareService({ repository: shareRepository })
  await initializeShareService()

  const createdShare = await createConversationShare({
    sessionId: 'smoke', permission: 'read', titleSnapshot: 'Smoke', scope: 'global',
  })
  const createdShareId = createdShare.id
  const readShareBack = await readConversationShare(createdShareId)
  if (!readShareBack || readShareBack.sessionId !== 'smoke' || readShareBack.permission !== 'read') throw new Error('share create/read failed')
  const issuedShare = await issueConversationShareToken(createdShareId)
  if (!issuedShare?.token) throw new Error('share token issue failed')
  const readShareAfterIssue = await readConversationShare(createdShareId)
  if (!verifyShareToken(readShareAfterIssue, issuedShare.token)) throw new Error('share token verify failed')
  const revokedShare = await revokeConversationShare(createdShareId)
  if (!revokedShare?.revokedAt) throw new Error('share revoke failed')

  const shareExport = await exportShareStateForBackup()
  if (shareExport.count !== 1 || !shareExport.digest) throw new Error('share authoritative export failed')
  const shareRestored = await restoreShareStateSnapshot({ shares: shareExport.shares }, { mode: 'replace' })
  if (shareRestored.shares !== 1) throw new Error('share authoritative restore failed')
  const shareAfterRestore = shareRepository.exportSnapshot()
  if (shareAfterRestore.count !== 1 || shareAfterRestore.digest !== shareExport.digest) throw new Error('share restore digest roundtrip failed')

  let shareJsonWritten = true
  try { await readFile(sharesFile, 'utf8') } catch { shareJsonWritten = false }
  if (shareJsonWritten) throw new Error('runtime share writes materialized a JSON store')

  // === lan-access storage full chain (SQLite is the only store) ===
  // Settings/token lifecycle through the real store, then a repository
  // exportSnapshot → backup/restore digest roundtrip. Runtime writes never
  // materialize security/lan-access.json any more.
  const lanAccessFile = path.join(directory, 'storage', 'security', 'lan-access.json')
  const lanAccessRepository = createLanAccessRepository(storage)
  configureLanAccessService({ repository: lanAccessRepository })
  await initializeLanAccessService()

  const lanAccessStore = await import('../../server/lan-access-store.mjs')
  const lanSettings = await lanAccessStore.updateLanAccessSettings({ enabled: true, password: 'smoke-password-123', sessionTtlHours: 12 })
  if (lanSettings.enabled !== true) throw new Error('lan-access settings update failed')
  const lanStoreIssued = await lanAccessStore.issueLanAccessToken('smoke-password-123', { remoteAddress: '192.168.1.78', userAgent: 'Store Smoke' })
  if (!(await lanAccessStore.verifyLanAccessToken(lanStoreIssued.token))) throw new Error('lan-access store issue/verify failed')
  if (await lanAccessStore.verifyLanAccessToken(`999.${lanStoreIssued.token.split('.')[1]}`)) throw new Error('lan-access store verify failed open on version mismatch')

  // Authoritative backup/restore roundtrip: the exported snapshot must not leak
  // the token secret and restoring it must reproduce the exact digest.
  const lanBackup = await exportLanAccessStateForBackup()
  if (lanBackup.count !== 1 || !lanBackup.digest) throw new Error('lan-access authoritative export failed')
  if (lanBackup.lanAccess.tokens[0].tokenHash.includes(lanStoreIssued.token.split('.')[1])) throw new Error('lan-access backup leaked the token secret')
  const lanRestored = await restoreLanAccessStateSnapshot(
    { lanAccess: lanBackup.lanAccess },
    { mode: 'replace', planFile: path.join(directory, 'lan-access-restore-plan.json') },
  )
  if (lanRestored.lanAccess !== 1) throw new Error('lan-access authoritative restore failed')
  if (lanAccessRepository.digest() !== lanBackup.digest) throw new Error('lan-access restore digest roundtrip failed')
  if (!(await lanAccessStore.verifyLanAccessToken(lanStoreIssued.token))) throw new Error('lan-access token lost after restore')

  if (!(await lanAccessStore.revokeLanAccessToken(lanStoreIssued.token))) throw new Error('lan-access store logout failed')
  if (await lanAccessStore.verifyLanAccessToken(lanStoreIssued.token)) throw new Error('lan-access store logout did not invalidate the token')

  let lanJsonWritten = true
  try { await readFile(lanAccessFile, 'utf8') } catch { lanJsonWritten = false }
  if (lanJsonWritten) throw new Error('runtime lan-access writes materialized a JSON store')
  stopLanAccessService()

  // Runtime saves never touch the JSON tree; the offline export tools are the
  // escape hatch (they open the database in their own process after the fixture
  // closes it).
  await saveSessionBody('big3', { messages: bigMessages(210), title: 'Big 3' })
  const big3Json = path.join(sessionsDir, 'big3.json')
  let big3Written = true
  try { await readFile(big3Json, 'utf8') } catch { big3Written = false }
  if (big3Written) throw new Error('runtime save leaked a session body to JSON')
  stopShareService()
  await closeSqliteStorage()

  // Offline lan-access export: authoritative export from a closed DB.
  const lanAccessExportScript = path.join(projectRoot, 'server', 'maintenance', 'export-lan-access-v1.mjs')
  const lanOfflineExport = await spawnTool(lanAccessExportScript, [path.join(directory, 'lan-access-export.json')])
  if (lanOfflineExport.code !== 0) throw new Error(`lan-access offline export failed: ${lanOfflineExport.stderr}`)
  const lanOfflineBackup = JSON.parse(await readFile(path.join(directory, 'lan-access-export.json'), 'utf8'))
  if (typeof lanOfflineBackup.lanAccessState?.count !== 'number' || !lanOfflineBackup.lanAccessState?.digest) {
    throw new Error('lan-access offline export envelope mismatch')
  }

  // Offline share export: same escape hatch for the share domain.
  const shareExportScript = path.join(projectRoot, 'server', 'maintenance', 'export-share-v1.mjs')
  const shareOfflineExport = await spawnTool(shareExportScript, [path.join(directory, 'share-export.json')])
  if (shareOfflineExport.code !== 0) throw new Error(`share offline export failed: ${shareOfflineExport.stderr}`)
  const shareOfflineBackup = JSON.parse(await readFile(path.join(directory, 'share-export.json'), 'utf8'))
  if (shareOfflineBackup.shareState?.count !== 1 || !shareOfflineBackup.shareState?.digest) {
    throw new Error('share offline export envelope mismatch')
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    schemaVersion: initialHealth.schemaVersion,
    count: exported.count,
    share: {
      count: shareExport.count,
      restoreDigestOk: true,
      jsonUntouched: true,
      offlineExportOk: true,
    },
    lanAccess: {
      count: lanBackup.count,
      roundtripDigestOk: true,
      jsonUntouched: true,
      offlineExportOk: true,
    },
    runtime: { electron: process.versions.electron ?? null, node: process.versions.node, sqlite: process.versions.sqlite },
  })}\n`)
} finally {
  await closeSqliteStorage().catch(() => {})
  await rm(directory, { recursive: true, force: true })
}

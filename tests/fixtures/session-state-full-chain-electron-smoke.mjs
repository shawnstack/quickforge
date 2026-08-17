import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import { createScheduledTaskRunsRepository } from '../../server/sqlite/scheduled-task-runs-repository.mjs'
import { createShareRepository } from '../../server/sqlite/share-repository.mjs'
import { initializeSessionStateCutover } from '../../server/session-state-cutover.mjs'
import {
  configureSessionStateService,
  deleteSessionState,
  drainSessionJsonMirror,
  readSessionStateValue,
  readSessionStorageState,
  saveSessionBody,
} from '../../server/session-state-service.mjs'
import {
  exportSessionStateForBackup,
  restoreSessionStateSnapshot,
} from '../../server/session-state-backup.mjs'
import { initializeShareCutover } from '../../server/share-cutover.mjs'
import {
  configureShareService,
  drainShareJsonMirror,
  readShareStorageState,
  stopShareService,
} from '../../server/share-service.mjs'
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
import { initializeLanAccessCutover } from '../../server/lan-access-cutover.mjs'
import {
  configureLanAccessService,
  drainLanAccessJsonMirror,
  readLanAccessStorageState,
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
const downgradeScript = path.join(projectRoot, 'server', 'maintenance', 'downgrade-session-state-v1.mjs')

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
      reject(new Error(`downgrade tool timed out: ${stderr}`))
    }, 30_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

function spawnDowngrade(args) {
  return spawnTool(downgradeScript, args)
}

try {
  await mkdir(sessionsDir, { recursive: true })
  const seedState = { id: 'seed', scope: 'global', stateVersion: 1, title: 'Seed', messages: [{ role: 'user', content: 'hello' }] }
  const seedMetadata = { id: 'seed', scope: 'global', stateVersion: 1, title: 'Seed', createdAt: '2026-01-01T00:00:00.000Z', lastModified: '2026-01-01T00:00:00.000Z', messageCount: 1 }
  await writeFile(path.join(sessionsDir, 'seed.json'), `${JSON.stringify(seedState)}\n`, 'utf8')
  await writeFile(path.join(globalDir, 'sessions-metadata.json'), `${JSON.stringify({ seed: seedMetadata })}\n`, 'utf8')

  const storage = await initializeSqliteStorage({ dataDir: directory })
  if (storage.health().schemaVersion !== 9) throw new Error(`unexpected schema version ${storage.health().schemaVersion}`)
  const repository = createSessionStateRepository(storage)
  configureSessionStateService({ repository, mirror: null, phase: 'json_authoritative' })

  // Startup cutover: JSON → authoritative.
  const state = await initializeSessionStateCutover({
    storage,
    repository,
    backupDirectory: path.join(directory, 'storage', 'backups'),
  })
  if (state.phase !== 'authoritative') throw new Error(`expected authoritative after cutover, got ${state.phase}`)

  // Session save / read / delete.
  saveSessionBody('smoke', { messages: [{ role: 'user', content: 'hello' }], title: 'Smoke' })
  const readBack = readSessionStateValue('smoke')
  if (!readBack || readBack.messages.length !== 1 || readBack.title !== 'Smoke') throw new Error('session save/read failed')

  // CAS 409 on a stale expectedRevision.
  let conflicted = false
  try {
    saveSessionBody('smoke', { messages: [] }, { expectedRevision: 0 })
  } catch (error) {
    if (error?.errorCode === 'SESSION_STATE_CONFLICT') conflicted = true
  }
  if (!conflicted) throw new Error('CAS conflict was not raised as SESSION_STATE_CONFLICT')

  // F9 split path: a message-heavy session is stored incrementally in
  // session_messages; reads reassemble body + messages and the mirror
  // materializes the full body. The state frame the routes would ship is
  // asserted to be lightweight (summary instead of the full message list).
  saveSessionBody('big', { messages: bigMessages(210), title: 'Big' })
  const readBig = readSessionStateValue('big')
  if (!readBig || readBig.messages.length !== 210 || readBig.title !== 'Big') throw new Error('split session read/assembly failed')
  if (repository.messageCount({ scope: 'global', sessionId: 'big' }) !== 210) throw new Error('split session message count mismatch')
  saveSessionBody('big', { messages: [...bigMessages(210), { role: 'user', content: 'appended', timestamp: '2026-01-01T00:00:03.000Z' }] })
  if (repository.messageCount({ scope: 'global', sessionId: 'big' }) !== 211) throw new Error('incremental append failed')
  await drainSessionJsonMirror()
  const mirroredBig = JSON.parse(await readFile(path.join(sessionsDir, 'big.json'), 'utf8'))
  if (!Array.isArray(mirroredBig.messages) || mirroredBig.messages.length !== 211) throw new Error('mirror did not reassemble split messages')
  if (mirroredBig.messageStorage !== 'split') throw new Error('mirror lost the split marker')
  const splitStateFrame = JSON.stringify({ ...readBig, messages: undefined, messagesSummary: { count: readBig.messages.length } })
  if (Buffer.byteLength(splitStateFrame, 'utf8') > 2048) throw new Error(`split state frame unexpectedly large: ${Buffer.byteLength(splitStateFrame, 'utf8')} bytes`)
  if (!deleteSessionState('big')) throw new Error('split session delete failed')

  const deleted = deleteSessionState('smoke')
  if (!deleted || readSessionStateValue('smoke') !== null) throw new Error('session delete failed')
  // Drain the deletes before the restore below: replaceAll wipes the mirror
  // queue, so any pending delete entries would otherwise leave stale JSON files
  // that break the downgrade mirror/digest verification.
  await drainSessionJsonMirror()

  // Authoritative backup/restore with a split session present: the exported
  // snapshot must reassemble messages; restoring the exported values must
  // reproduce the exact stored digest (representation roundtrip).
  saveSessionBody('big2', { messages: bigMessages(210), title: 'Big 2' })
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
  const readBig2 = readSessionStateValue('big2')
  if (!readBig2 || readBig2.messages.length !== 210) throw new Error('split session restore reassembly failed')

  // Mirror drain: JSON mirror files are materialized and readable.
  await drainSessionJsonMirror()
  const mirrored = JSON.parse(await readFile(path.join(sessionsDir, 'big2.json'), 'utf8'))
  if (!Array.isArray(mirrored.messages) || mirrored.messages.length !== 210) throw new Error('mirror did not materialize the restored split body')
  const restoredFile = path.join(sessionsDir, 'restored.json')
  let restoredWritten = true
  try { await readFile(restoredFile, 'utf8') } catch { restoredWritten = false }
  if (restoredWritten) throw new Error('restore created an unexpected session file')

  // Scheduled runs must not regress while session state is authoritative.
  const runsRepository = createScheduledTaskRunsRepository(storage)
  runsRepository.create('smoke-task', { id: 'run-1', status: 'success', startedAt: '2026-01-01T00:00:00.000Z' })
  const listed = runsRepository.list({ taskIds: ['smoke-task'], page: 1, pageSize: 10 })
  if (listed.total !== 1 || listed.runs[0].id !== 'run-1') throw new Error('scheduled runs regression detected')

  // === F10 Phase 3: share storage full chain ===
  // Seed the v1 JSON store, run the share cutover to authoritative, then drive
  // create/read/token/revoke through the real share-store → repository path.
  // backup/restore must reproduce the exact digest, the mirror must materialize
  // a readable JSON store, and the offline downgrade tool must dry-run without
  // writes, materialize, then --commit back to json_authoritative.
  const sharesFile = path.join(directory, 'storage', 'shares', 'conversation-shares.json')
  await mkdir(path.dirname(sharesFile), { recursive: true })
  await writeFile(sharesFile, `${JSON.stringify({
    qfs_seedshare000000000001: {
      id: 'qfs_seedshare000000000001', sessionId: 'seed', permission: 'read', titleSnapshot: 'Seed',
      scope: 'global', authVersion: 1, allowCloudUsage: false,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', accessCount: 0,
    },
  })}\n`, 'utf8')

  const shareRepository = createShareRepository(storage)
  configureShareService({ repository: shareRepository, mirror: null, phase: 'json_authoritative' })
  const shareCutoverState = await initializeShareCutover({
    storage,
    repository: shareRepository,
    backupDirectory: path.join(directory, 'storage', 'backups'),
  })
  if (shareCutoverState.phase !== 'authoritative') throw new Error(`expected share authoritative after cutover, got ${shareCutoverState.phase}`)

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
  if (shareExport.count !== 2 || shareExport.phase !== 'authoritative' || !shareExport.digest) throw new Error('share authoritative export failed')
  const shareRestored = await restoreShareStateSnapshot({ shares: shareExport.shares }, { mode: 'replace' })
  if (shareRestored.shares !== 2) throw new Error('share authoritative restore failed')
  const shareAfterRestore = shareRepository.exportSnapshot()
  if (shareAfterRestore.count !== 2 || shareAfterRestore.digest !== shareExport.digest) throw new Error('share restore digest roundtrip failed')

  await drainShareJsonMirror()
  const materializedShares = JSON.parse(await readFile(sharesFile, 'utf8'))
  if (Object.keys(materializedShares).length !== 2) throw new Error('share mirror did not materialize the full store')
  if (!materializedShares[createdShareId] || materializedShares[createdShareId].sessionId !== 'smoke') throw new Error('share mirror record is not readable')

  // === F11 Phase 1: lan-access storage full chain (core layer) ===
  // Seed security/lan-access.json, run the lan-access cutover to authoritative,
  // then drive settings/issue/verify/revoke and exportSnapshot→replaceAll
  // roundtrip through the repository, and materialize the JSON mirror.
  const lanAccessFile = path.join(directory, 'storage', 'security', 'lan-access.json')
  await mkdir(path.dirname(lanAccessFile), { recursive: true })
  await writeFile(lanAccessFile, `${JSON.stringify({
    enabled: true,
    passwordHash: 'bGFuLWFjY2Vzcy1oYXNo',
    passwordSalt: 'bGFuLWFjY2Vzcy1zYWx0',
    passwordVersion: 1,
    authVersion: 1,
    sessionTtlHours: 12,
    updatedAt: '2026-01-01T00:00:00.000Z',
    tokens: [],
  })}\n`, 'utf8')

  const lanAccessRepository = createLanAccessRepository(storage)
  configureLanAccessService({ repository: lanAccessRepository, mirror: null, phase: 'json_authoritative' })
  const lanAccessCutoverState = await initializeLanAccessCutover({
    storage,
    repository: lanAccessRepository,
    backupDirectory: path.join(directory, 'storage', 'backups'),
  })
  if (lanAccessCutoverState.phase !== 'authoritative') throw new Error(`expected lan-access authoritative after cutover, got ${lanAccessCutoverState.phase}`)
  if (lanAccessCutoverState.lanTokenCount !== 0 || !lanAccessCutoverState.digest) throw new Error('lan-access cutover state is malformed')

  const lanIssued = lanAccessRepository.issueToken({ remoteAddress: '192.168.1.77', userAgent: 'Electron Smoke' })
  if (!lanAccessRepository.verifyToken(lanIssued.token)) throw new Error('lan-access token verify failed')
  if (lanAccessRepository.verifyToken(`999.${lanIssued.token.split('.')[1]}`)) throw new Error('lan-access token version gate failed')
  const lanSnapshot = lanAccessRepository.exportSnapshot()
  if (lanSnapshot.tokenCount !== 1) throw new Error('lan-access export count failed')
  if (lanSnapshot.config.tokens[0].tokenHash.includes(lanIssued.token.split('.')[1])) throw new Error('lan-access token hash leaked the secret')
  lanAccessRepository.replaceAll(lanSnapshot.config, { expectedCount: lanSnapshot.tokenCount, expectedDigest: lanSnapshot.digest })
  if (lanAccessRepository.exportSnapshot().digest !== lanSnapshot.digest) throw new Error('lan-access exportSnapshot roundtrip digest failed')
  if (!lanAccessRepository.verifyToken(lanIssued.token)) throw new Error('lan-access token lost after roundtrip')

  await drainLanAccessJsonMirror()
  const materializedLan = JSON.parse(await readFile(lanAccessFile, 'utf8'))
  if (materializedLan.enabled !== true || materializedLan.tokens.length !== 1) throw new Error('lan-access mirror did not materialize the config')
  if (materializedLan.tokens[0].remoteAddress !== '192.168.1.77') throw new Error('lan-access mirror lost token metadata')

  // === F11 Phase 2: store paths route to the repository while authoritative ===
  const lanAccessStore = await import('../../server/lan-access-store.mjs')
  const lanStatus = await lanAccessStore.readLanAccessStatus()
  if (lanStatus.enabled !== true || lanStatus.activeTokenCount !== 1) throw new Error('lan-access store did not route reads to the repository')
  const lanSettings = await lanAccessStore.updateLanAccessSettings({ enabled: true, password: 'smoke-password-123', sessionTtlHours: 12 })
  if (lanSettings.authVersion !== lanStatus.authVersion + 1 || lanSettings.activeTokenCount !== 0) throw new Error('lan-access store settings did not bump authVersion and clear tokens')
  if (lanAccessRepository.verifyToken(lanIssued.token)) throw new Error('lan-access store password change did not invalidate prior tokens')

  const lanStoreIssued = await lanAccessStore.issueLanAccessToken('smoke-password-123', { remoteAddress: '192.168.1.78', userAgent: 'Store Smoke' })
  if (!(await lanAccessStore.verifyLanAccessToken(lanStoreIssued.token))) throw new Error('lan-access store issue/verify failed')
  if (await lanAccessStore.verifyLanAccessToken(`999.${lanStoreIssued.token.split('.')[1]}`)) throw new Error('lan-access store verify failed open on version mismatch')
  if (!(await lanAccessStore.revokeLanAccessToken(lanStoreIssued.token))) throw new Error('lan-access store logout failed')
  if (await lanAccessStore.verifyLanAccessToken(lanStoreIssued.token)) throw new Error('lan-access store logout did not invalidate the token')
  await lanAccessStore.revokeLanAccessTokens()

  await drainLanAccessJsonMirror()
  const materializedLanAfterStore = JSON.parse(await readFile(lanAccessFile, 'utf8'))
  if (materializedLanAfterStore.enabled !== true || materializedLanAfterStore.tokens.length !== 0) throw new Error('lan-access mirror did not materialize the store state')
  if (materializedLanAfterStore.authVersion !== lanSettings.authVersion + 1) throw new Error('lan-access mirror authVersion mismatch after store revokes')
  const lanAccessCountAfterRevoke = lanAccessRepository.count()
  stopLanAccessService()

  // === F11 Phase 3: authoritative lan-access backup/restore roundtrip ===
  // Issue a fresh token, export under the lan-access maintenance lock, restore
  // with plan-file compensation, and prove the digest round-trips exactly.
  const lanIssued2 = lanAccessRepository.issueToken({ remoteAddress: '192.168.1.79', userAgent: 'Phase3 Backup' })
  const lanBackup = await exportLanAccessStateForBackup()
  if (lanBackup.count !== 1 || lanBackup.phase !== 'authoritative' || !lanBackup.digest) throw new Error('lan-access authoritative export failed')
  if (lanBackup.lanAccess.tokens[0].tokenHash.includes(lanIssued2.token.split('.')[1])) throw new Error('lan-access backup leaked the token secret')
  const lanRestored = await restoreLanAccessStateSnapshot(
    { lanAccess: lanBackup.lanAccess },
    { mode: 'replace', planFile: path.join(directory, 'lan-access-restore-plan.json') },
  )
  if (lanRestored.lanAccess !== 1) throw new Error('lan-access authoritative restore failed')
  if (lanAccessRepository.digest() !== lanBackup.digest) throw new Error('lan-access restore digest roundtrip failed')
  if (!lanAccessRepository.verifyToken(lanIssued2.token)) throw new Error('lan-access token lost after restore')
  const phaseBeforeLanDowngrade = readLanAccessStorageState().phase
  const lanAccessExportScript = path.join(projectRoot, 'server', 'maintenance', 'export-lan-access-v1.mjs')
  const lanAccessDowngradeScript = path.join(projectRoot, 'server', 'maintenance', 'downgrade-lan-access-v1.mjs')

  // Pending mirror entry: create another share without draining so the offline
  // downgrade tool has something to materialize in its own process.
  const createdShare2 = await createConversationShare({
    sessionId: 'smoke2', permission: 'read', titleSnapshot: 'Smoke 2', scope: 'global',
  })
  const smoke2Id = createdShare2.id
  const sharesBeforeDowngrade = JSON.parse(await readFile(sharesFile, 'utf8'))
  if (sharesBeforeDowngrade[smoke2Id]) throw new Error('pending share mirror entry leaked to JSON before downgrade')
  const phaseBeforeShareDowngrade = readShareStorageState().phase
  stopShareService()

  const phaseBeforeDowngrade = readSessionStorageState().phase

  // F9 Phase 3 offline downgrade: split sessions must materialize a complete
  // v1 JSON body (marker + messages), dry-run must write nothing, and --commit
  // must flip authority back to JSON with a fully readable mirror. big3 is
  // saved with a PENDING mirror entry so the dry-run probe can verify the
  // child tool does not drain/write anything until the materialize run.
  saveSessionBody('big3', { messages: bigMessages(210), title: 'Big 3' })
  const big3Json = path.join(sessionsDir, 'big3.json')
  let big3Written = true
  try { await readFile(big3Json, 'utf8') } catch { big3Written = false }
  if (big3Written) throw new Error('pending mirror entry leaked to JSON before downgrade')
  await closeSqliteStorage()

  const dryRun = await spawnDowngrade(['--dry-run'])
  if (dryRun.code !== 0) throw new Error(`downgrade --dry-run failed: ${dryRun.stderr}`)
  const dryReport = JSON.parse(dryRun.stdout.trim())
  if (dryReport.phase !== 'authoritative' || dryReport.dryRun !== true) throw new Error('downgrade dry-run changed the phase')
  big3Written = true
  try { await readFile(big3Json, 'utf8') } catch { big3Written = false }
  if (big3Written) throw new Error('downgrade dry-run wrote JSON')

  const materialized = await spawnDowngrade([])
  if (materialized.code !== 0) throw new Error(`downgrade materialization failed: ${materialized.stderr}`)
  const materializedBig = JSON.parse(await readFile(big3Json, 'utf8'))
  if (!Array.isArray(materializedBig.messages) || materializedBig.messages.length !== 210) throw new Error('downgrade did not materialize the full split body')

  const committed = await spawnDowngrade(['--commit'])
  if (committed.code !== 0) throw new Error(`downgrade --commit failed: ${committed.stderr}`)
  const commitReport = JSON.parse(committed.stdout.trim())
  if (commitReport.phase !== 'json_authoritative' || commitReport.phaseChanged !== true) throw new Error('downgrade --commit did not flip authority')

  // Offline share downgrade (share storage is still authoritative; the fixture
  // closed SQLite before the session downgrade section, so the tools can open
  // the database in their own process).
  const shareDowngradeScript = path.join(projectRoot, 'server', 'maintenance', 'downgrade-share-v1.mjs')
  const shareDryRun = await spawnTool(shareDowngradeScript, ['--dry-run'])
  if (shareDryRun.code !== 0) throw new Error(`share downgrade --dry-run failed: ${shareDryRun.stderr}`)
  const shareDryReport = JSON.parse(shareDryRun.stdout.trim())
  if (shareDryReport.phase !== 'authoritative' || shareDryReport.dryRun !== true) throw new Error('share downgrade dry-run changed the phase')
  const sharesAfterDryRun = JSON.parse(await readFile(sharesFile, 'utf8'))
  if (sharesAfterDryRun[smoke2Id]) throw new Error('share downgrade dry-run wrote JSON')

  const shareMaterialized = await spawnTool(shareDowngradeScript, [])
  if (shareMaterialized.code !== 0) throw new Error(`share downgrade materialization failed: ${shareMaterialized.stderr}`)
  const sharesAfterMaterialize = JSON.parse(await readFile(sharesFile, 'utf8'))
  if (Object.keys(sharesAfterMaterialize).length !== 3) throw new Error('share downgrade did not materialize the pending record')

  const shareCommitted = await spawnTool(shareDowngradeScript, ['--commit'])
  if (shareCommitted.code !== 0) throw new Error(`share downgrade --commit failed: ${shareCommitted.stderr}`)
  const shareCommitReport = JSON.parse(shareCommitted.stdout.trim())
  if (shareCommitReport.phase !== 'json_authoritative' || shareCommitReport.phaseChanged !== true) throw new Error('share downgrade --commit did not flip authority')

  // Offline lan-access export tool: authoritative export from a closed DB.
  const lanOfflineExport = await spawnTool(lanAccessExportScript, [path.join(directory, 'lan-access-export.json')])
  if (lanOfflineExport.code !== 0) throw new Error(`lan-access offline export failed: ${lanOfflineExport.stderr}`)
  const lanOfflineBackup = JSON.parse(await readFile(path.join(directory, 'lan-access-export.json'), 'utf8'))
  if (lanOfflineBackup.lanAccessState?.count !== 1 || lanOfflineBackup.lanAccessState?.digest !== lanBackup.digest) {
    throw new Error('lan-access offline export envelope mismatch')
  }

  // Offline lan-access downgrade: --dry-run zero writes → materialize the full
  // JSON mirror → --commit flips authority back to JSON.
  const lanDryRun = await spawnTool(lanAccessDowngradeScript, ['--dry-run'])
  if (lanDryRun.code !== 0) throw new Error(`lan-access downgrade --dry-run failed: ${lanDryRun.stderr}`)
  const lanDryReport = JSON.parse(lanDryRun.stdout.trim())
  if (lanDryReport.phase !== 'authoritative' || lanDryReport.dryRun !== true) throw new Error('lan-access downgrade dry-run changed the phase')

  const lanMaterialized = await spawnTool(lanAccessDowngradeScript, [])
  if (lanMaterialized.code !== 0) throw new Error(`lan-access downgrade materialization failed: ${lanMaterialized.stderr}`)
  const lanJsonAfterDowngrade = JSON.parse(await readFile(lanAccessFile, 'utf8'))
  if (lanJsonAfterDowngrade.enabled !== true || lanJsonAfterDowngrade.tokens.length !== 1) throw new Error('lan-access downgrade did not materialize the config')

  const lanCommitted = await spawnTool(lanAccessDowngradeScript, ['--commit'])
  if (lanCommitted.code !== 0) throw new Error(`lan-access downgrade --commit failed: ${lanCommitted.stderr}`)
  const lanCommitReport = JSON.parse(lanCommitted.stdout.trim())
  if (lanCommitReport.phase !== 'json_authoritative' || lanCommitReport.phaseChanged !== true) throw new Error('lan-access downgrade --commit did not flip authority')

  process.stdout.write(`${JSON.stringify({
    ok: true,
    schemaVersion: 9,
    phase: phaseBeforeDowngrade,
    count: exported.count,
    mirrorPending: 0,
    downgrade: { dryRunOk: true, materialized: 210, committed: true, phaseAfterCommit: commitReport.phase },
    share: {
      phase: phaseBeforeShareDowngrade,
      count: shareExport.count,
      restoreDigestOk: true,
      mirrorOk: true,
      downgrade: { dryRunOk: true, materialized: 1, committed: true, phaseAfterCommit: shareCommitReport.phase },
    },
    lanAccess: {
      phase: phaseBeforeLanDowngrade,
      count: lanBackup.count,
      roundtripDigestOk: true,
      mirrorOk: true,
      revokeAllOk: true,
      backupRestoreOk: true,
      downgrade: { dryRunOk: true, materialized: 1, committed: true, phaseAfterCommit: lanCommitReport.phase },
    },
    runtime: { electron: process.versions.electron ?? null, node: process.versions.node, sqlite: process.versions.sqlite },
  })}\n`)
} finally {
  await closeSqliteStorage().catch(() => {})
  await rm(directory, { recursive: true, force: true })
}

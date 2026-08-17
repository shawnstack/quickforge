import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const script = path.join(projectRoot, 'tests', 'fixtures', 'session-state-full-chain-electron-smoke.mjs')

// Runs under the current runtime: plain Node in CI, or Electron when the suite
// itself runs inside Electron (ELECTRON_RUN_AS_NODE=1 keeps the fixture a Node
// script powered by Electron's bundled Node).
function spawnSmoke(directory) {
  const child = spawn(process.execPath, [script], {
    cwd: projectRoot,
    windowsHide: true,
    shell: false,
    env: { ...process.env, QUICKFORGE_DATA_DIR: directory, QUICKFORGE_LOG_LEVEL: 'ERROR', ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  return new Promise((resolve) => child.once('close', (code) => resolve({ code, stdout, stderr })))
}

describe('session state full chain smoke', () => {
  const directories = []
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('runs cutover→authoritative, save/read/delete, CAS 409, split save→read→append→SSE frame, backup/restore, mirror drain, scheduled runs and offline downgrade without regression', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'qf-full-chain-smoke-'))
    directories.push(directory)
    const result = await spawnSmoke(directory)
    expect(result.code).toBe(0)
    const output = JSON.parse(result.stdout.trim())
    expect(output.ok).toBe(true)
    expect(output.schemaVersion).toBe(9)
    expect(output.phase).toBe('authoritative')
    expect(output.count).toBe(2)
    expect(output.mirrorPending).toBe(0)
    expect(output.downgrade).toMatchObject({ dryRunOk: true, materialized: 210, committed: true, phaseAfterCommit: 'json_authoritative' })
    expect(output.share).toMatchObject({
      phase: 'authoritative',
      count: 2,
      restoreDigestOk: true,
      mirrorOk: true,
      downgrade: { dryRunOk: true, materialized: 1, committed: true, phaseAfterCommit: 'json_authoritative' },
    })
    expect(output.lanAccess).toMatchObject({
      phase: 'authoritative',
      count: 1,
      roundtripDigestOk: true,
      mirrorOk: true,
      revokeAllOk: true,
      backupRestoreOk: true,
      downgrade: { dryRunOk: true, materialized: 1, committed: true, phaseAfterCommit: 'json_authoritative' },
    })
    expect(output.runtime).toBeDefined()
  })
})

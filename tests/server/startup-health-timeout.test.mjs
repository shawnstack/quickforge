import { readFileSync } from 'node:fs'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startQuickForge } from '../../server/public-api.mjs'

const binSource = readFileSync(new URL('../../bin/quickforge.mjs', import.meta.url), 'utf8')
const publicApiSource = readFileSync(new URL('../../server/public-api.mjs', import.meta.url), 'utf8')

let dataDir = ''
let blockerPort = 0
let blocker = null

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'quickforge-startup-timeout-test-'))

  // Occupy the target port with a non-QuickForge HTTP server so that
  // checkQuickForgeHealth does not reuse it and the spawned real server
  // fails to bind (EADDRINUSE) and exits with code 1.
  blocker = http.createServer((req, res) => {
    res.statusCode = 404
    res.end()
  })
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve))
  blockerPort = blocker.address().port
})

afterAll(async () => {
  if (blocker) await new Promise((resolve) => blocker.close(resolve))
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

describe('startup health timeout defaults', () => {
  it('waits up to 5 minutes for startup health by default in the CLI', () => {
    expect(binSource).toMatch(/const STARTUP_HEALTH_TIMEOUT_MS = 300000/)
    expect(binSource).toMatch(/timeoutMs = STARTUP_HEALTH_TIMEOUT_MS/)
    expect(binSource).toMatch(
      /waitForHealth\(\{ expectedPid: child\.pid, previousBootId, requireChanged: Boolean\(previousBootId\) \}\)/,
    )
  })

  it('stops waiting as soon as the CLI-spawned server process dies', () => {
    expect(binSource).toMatch(
      /if \(expectedPid && !isProcessRunning\(expectedPid\)\) \{[\s\S]*?await sleep\(300\)[\s\S]*?return null/,
    )
  })

  it('waits up to 5 minutes for startup health by default in the public API', () => {
    expect(publicApiSource).toMatch(/const STARTUP_HEALTH_TIMEOUT_MS = 300000/)
    expect(publicApiSource).toMatch(/timeoutMs = options\.timeoutMs \|\| STARTUP_HEALTH_TIMEOUT_MS/)
  })

  it('checks the spawned child liveness only in spawn mode, not inline mode', () => {
    expect(publicApiSource).toMatch(/waitForQuickForge\(\{ \.\.\.options, expectedPid: child\.pid \}\)/)
    expect(publicApiSource).toMatch(/const health = await waitForQuickForge\(options\)/)
  })

  it('rejects promptly with the exit reason when the spawned server dies before becoming healthy', async () => {
    const startedAt = Date.now()

    await expect(startQuickForge({
      host: '127.0.0.1',
      port: blockerPort,
      dataDir,
      openBrowser: false,
    })).rejects.toThrow(/process exited early \(code/)

    // With a blind full-timeout wait this would hang for the whole startup
    // window; the early-exit path must return within seconds.
    expect(Date.now() - startedAt).toBeLessThan(45_000)
  }, 90_000)
})

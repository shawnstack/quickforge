import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const benchmarkScript = path.join(projectRoot, 'scripts', 'session-message-benchmark.mjs')

function runBenchmark(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [benchmarkScript, ...args], {
      cwd: projectRoot,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, QUICKFORGE_LOG_LEVEL: 'ERROR', ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function parseJsonLines(stdout) {
  return stdout.trim().split('\n').map((line) => JSON.parse(line))
}

describe('session message benchmark script', () => {
  it('runs an isolated smoke pass with valid output format and zero residue', async () => {
    // Guard dir is a belt-and-braces isolation check: the script must create
    // and clean its own mkdtemp scratch dir and never write anywhere else.
    const guard = await mkdtemp(path.join(os.tmpdir(), 'qf-bench-guard-'))
    try {
      const result = await runBenchmark(['100'], { QUICKFORGE_DATA_DIR: guard })
      expect(result.code, result.stderr).toBe(0)

      const rows = parseJsonLines(result.stdout)
      const meta = rows.find((row) => row.kind === 'meta')
      const scale = rows.find((row) => row.kind === 'scale')
      const decision = rows.find((row) => row.kind === 'decision')
      expect(meta).toBeDefined()
      expect(scale).toBeDefined()
      expect(decision).toBeDefined()

      expect(meta.benchmark).toBe('session-message-storage')
      expect(meta.scratchDir).toBeTruthy()
      expect(Number.isSafeInteger(meta.schemaVersion)).toBe(true)

      expect(scale.benchmark).toBe('session-message-storage')
      expect(scale.messageCount).toBe(100)
      expect(Number.isSafeInteger(scale.estimatedTokens) && scale.estimatedTokens > 0).toBe(true)
      expect(scale.stateBytes).toBeGreaterThan(0)
      expect(scale.sseStateBytes).toBeGreaterThan(scale.stateBytes)
      expect(scale.messagesBytes).toBeGreaterThan(0)
      expect(scale.messagesShare).toBeGreaterThan(0)
      expect(scale.messagesShare).toBeLessThanOrEqual(1)
      for (const field of ['saveMs', 'encodeMs', 'sqliteCommitMs', 'readMs', 'jsonWriteMs']) {
        expect(typeof scale[field]).toBe('number')
        expect(Number.isFinite(scale[field]) && scale[field] >= 0).toBe(true)
      }
      expect(scale.thresholds).toEqual({ saveMs: 100, readMs: 100, transportBytes: 1024 * 1024 })
      expect(scale.exceeded).toMatchObject({ saveMs: expect.any(Boolean), readMs: expect.any(Boolean), transport: expect.any(Boolean) })
      expect(scale.splitElimination.serializationShare).toBeGreaterThan(0)
      expect(scale.splitElimination.serializationShare).toBeLessThanOrEqual(1)
      // F9 Phase 3 split-frame metrics: the lightweight state frame must be
      // dramatically smaller than the whole-body frame and the incremental
      // append frame must exist.
      expect(Number.isSafeInteger(scale.splitStateBytes) && scale.splitStateBytes > 0).toBe(true)
      expect(Number.isSafeInteger(scale.splitAppendBytes) && scale.splitAppendBytes > 0).toBe(true)
      expect(scale.splitStateBytes).toBeLessThan(scale.sseStateBytes)
      expect(scale.stateFrameReduction).toBeGreaterThan(0.5)

      expect(['split-messages-justified', 'no-evidence-keep-whole-body']).toContain(decision.recommendation)
      expect(decision.userPerceptible).toMatchObject({ saveMs: expect.any(Boolean), readMs: expect.any(Boolean), transport: expect.any(Boolean) })

      // Zero residue: the benchmark's own scratch dir must be fully removed.
      await expect(stat(meta.scratchDir)).rejects.toMatchObject({ code: 'ENOENT' })
      // And the externally provided data dir must never have been touched.
      expect(await readdir(guard)).toEqual([])
    } finally {
      await rm(guard, { recursive: true, force: true })
    }
  }, 120_000)
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The audit log is the only record of "what did this plugin do", so its two
// contract numbers (newest-first, capped at 300) are worth pinning: a regression
// here silently loses history rather than failing loudly.

const tempDirs = []
let previousDataDir
let testRoot

async function importAudit() {
  return import('../../../server/plugins/audit.mjs')
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-plugin-audit-'))
  tempDirs.push(testRoot)
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = path.join(testRoot, 'data')
  vi.resetModules()
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  vi.resetModules()
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('plugin audit log', () => {
  it('keeps newest first and caps the log at 300 entries', async () => {
    const audit = await importAudit()
    for (let index = 0; index < 305; index += 1) {
      await audit.recordPluginAudit({ plugin: 'demo', slot: 'composer.actions', action: `a${index}`, outcome: 'ok' })
    }

    const entries = await audit.listPluginAudit({ limit: 400 })
    expect(entries).toHaveLength(300)
    expect(entries[0].action).toBe('a304')
    expect(entries[299].action).toBe('a5')
  })

  it('filters by plugin and honours the requested limit', async () => {
    const audit = await importAudit()
    await audit.recordPluginAudit({ plugin: 'alpha', action: 'one' })
    await audit.recordPluginAudit({ plugin: 'beta', action: 'two' })
    await audit.recordPluginAudit({ plugin: 'alpha', action: 'three' })

    const alpha = await audit.listPluginAudit({ plugin: 'alpha' })
    expect(alpha.map((entry) => entry.action)).toEqual(['three', 'one'])

    const limited = await audit.listPluginAudit({ limit: 1 })
    expect(limited).toHaveLength(1)
    expect(limited[0].action).toBe('three')

    // Junk limits fall back to the default instead of throwing.
    expect(await audit.listPluginAudit({ limit: Number.NaN })).toHaveLength(3)
  })

  it('normalises the fields it records', async () => {
    const audit = await importAudit()
    await audit.recordPluginAudit({
      plugin: 'demo',
      slot: 'session.header',
      action: 'greet',
      outcome: 'denied',
      reason: 'x'.repeat(400),
      durationMs: 12.6,
    })

    const [entry] = await audit.listPluginAudit()
    expect(entry).toMatchObject({
      plugin: 'demo',
      kind: 'ui',
      slot: 'session.header',
      action: 'greet',
      outcome: 'denied',
      durationMs: 13,
    })
    expect(entry.reason).toHaveLength(300)
    expect(typeof entry.at).toBe('string')
  })

  it('ignores malformed entries without throwing', async () => {
    const audit = await importAudit()
    await expect(audit.recordPluginAudit(null)).resolves.toBeUndefined()
    await expect(audit.recordPluginAudit({})).resolves.toBeUndefined()
    await expect(audit.recordPluginAudit({ plugin: 42 })).resolves.toBeUndefined()

    expect(await audit.listPluginAudit()).toEqual([])
  })
})

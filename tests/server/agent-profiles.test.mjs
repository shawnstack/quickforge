import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let tmpDir
let previousDataDir

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-agent-profiles-store-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
  vi.resetModules()
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('managed custom agent markdown profiles', () => {
  it('creates custom agents as markdown files under the user agents directory', async () => {
    const { createCustomAgentProfile, getAgentProfile } = await import('../../server/agent-profiles.mjs')
    const { userAgentsDir } = await import('../../server/storage.mjs')

    const created = await createCustomAgentProfile({
      name: 'reviewer',
      label: 'Reviewer',
      description: 'Review changes',
      systemPrompt: 'Review the change.',
      allowedTools: ['read_file', 'grep_files'],
      capabilityPolicy: 'review-only',
      enabledAsSubagent: true,
    })

    expect(created.source).toBe('user')
    expect(created.readonly).toBe(false)
    const file = path.join(userAgentsDir, 'reviewer.md')
    const markdown = await readFile(file, 'utf8')
    expect(markdown).toContain('name: reviewer')
    expect(markdown).toContain('managedBy: quickforge')
    expect(markdown).toContain('readonly: false')

    const loaded = await getAgentProfile(created.id)
    expect(loaded).toMatchObject({ name: 'reviewer', source: 'user', readonly: false })
  })

  it('updates, renames, and deletes managed markdown agents', async () => {
    const { createCustomAgentProfile, deleteCustomAgentProfile, getAgentProfile, updateCustomAgentProfile } = await import('../../server/agent-profiles.mjs')
    const { userAgentsDir } = await import('../../server/storage.mjs')

    const created = await createCustomAgentProfile({
      name: 'writer',
      label: 'Writer',
      systemPrompt: 'Write docs.',
      allowedTools: ['read_file', 'grep_files'],
      capabilityPolicy: 'review-only',
    })

    const updated = await updateCustomAgentProfile(created.id, {
      name: 'doc-writer',
      label: 'Docs Writer',
      systemPrompt: 'Write better docs.',
      allowedTools: ['read_file', 'grep_files'],
      capabilityPolicy: 'review-only',
    })

    expect(updated.id).toBe(created.id)
    await expect(readFile(path.join(userAgentsDir, 'writer.md'), 'utf8')).rejects.toThrow()
    expect(await readFile(path.join(userAgentsDir, 'doc-writer.md'), 'utf8')).toContain('Write better docs.')
    expect((await getAgentProfile(created.id)).name).toBe('doc-writer')

    await deleteCustomAgentProfile(created.id)
    await expect(readFile(path.join(userAgentsDir, 'doc-writer.md'), 'utf8')).rejects.toThrow()
  })

  it('migrates legacy custom-agents store to managed markdown once and preserves ids', async () => {
    const { writeStore } = await import('../../server/storage.mjs')
    const legacy = {
      'agent-legacy': {
        id: 'agent-legacy',
        name: 'legacy-reviewer',
        label: 'Legacy Reviewer',
        description: 'Legacy store profile',
        systemPrompt: 'Legacy prompt.',
        allowedTools: ['read_file', 'grep_files'],
        capabilityPolicy: 'review-only',
        maxRuntimeMs: 1800000,
        maxToolCalls: 300,
        enabledAsSubagent: true,
        source: 'store',
        readonly: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }
    await writeStore('custom-agents', legacy)

    const { getAgentProfile, listAgentProfiles } = await import('../../server/agent-profiles.mjs')
    const { userAgentsDir } = await import('../../server/storage.mjs')
    await listAgentProfiles({ includeDisabled: true })

    const file = path.join(userAgentsDir, 'legacy-reviewer.md')
    const markdown = await readFile(file, 'utf8')
    expect(markdown).toContain('id: "agent-legacy"')
    expect(markdown).toContain('name: legacy-reviewer')
    expect(await readFile(path.join(userAgentsDir, '.custom-agents-migrated.json'), 'utf8')).toContain('agent-legacy')
    const loaded = await getAgentProfile('agent-legacy')
    expect(loaded).toMatchObject({ id: 'agent-legacy', name: 'legacy-reviewer', readonly: false })
  })

  it('does not load builtin subdirectory files as user profiles', async () => {
    const { userAgentsDir } = await import('../../server/storage.mjs')
    await mkdir(path.join(userAgentsDir, 'builtin'), { recursive: true })
    await writeFile(path.join(userAgentsDir, 'builtin', 'fake.md'), `---\nname: fake\n---\nFake.\n`)
    const { listAgentProfiles } = await import('../../server/agent-profiles.mjs')
    const profiles = await listAgentProfiles({ includeDisabled: true })
    expect(profiles.some((profile) => profile.name === 'fake')).toBe(false)
  })
})

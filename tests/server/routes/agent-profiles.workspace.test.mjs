import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

function mockResponse() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    },
  }
}

async function listAgents(url) {
  const { handleAgentProfilesApi } = await import('../../../server/routes/agent-profiles.mjs')
  const res = mockResponse()
  await handleAgentProfilesApi({ method: 'GET' }, res, new URL(url), {})
  return res
}

describe('GET /api/agent-profiles projectId awareness', () => {
  let tmpDir
  let workspaceRoot
  let previousDataDir
  let previousHome
  let previousUserProfile

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-agent-profiles-route-'))
    workspaceRoot = path.join(tmpDir, 'workspace')
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    previousHome = process.env.HOME
    previousUserProfile = process.env.USERPROFILE
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    process.env.HOME = tmpDir
    process.env.USERPROFILE = tmpDir
    vi.resetModules()

    await mkdir(path.join(workspaceRoot, '.claude', 'agents'), { recursive: true })
    await writeFile(
      path.join(workspaceRoot, '.claude', 'agents', 'qf-route-tester.md'),
      [
        '---',
        'name: qf-route-tester',
        'description: Route test agent',
        'enabled-as-subagent: true',
        'tools: read_file, grep_files',
        '---',
        'You test routes.',
        '',
      ].join('\n'),
      'utf8',
    )

    const { atomicProjectConfigUpdate } = await import('../../../server/storage.mjs')
    await atomicProjectConfigUpdate((config) => {
      config.projects = [{
        id: 'proj-1',
        name: 'workspace',
        path: workspaceRoot,
        lastOpenedAt: '',
        sortOrder: 0,
        skills: [],
        commandDir: '',
      }]
      config.activeProjectId = 'proj-1'
      return config
    })
  })

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
    vi.resetModules()
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  })

  it('includes project-level agent profiles when projectId resolves', async () => {
    const res = await listAgents('http://localhost/api/agent-profiles?projectId=proj-1')

    expect(res.status).toBe(200)
    const names = res.body.agents.map((agent) => agent.name)
    expect(names).toContain('qf-route-tester')
    expect(names).toEqual(expect.arrayContaining(['general', 'explore']))
    expect(res.body.agents.find((agent) => agent.name === 'qf-route-tester')).toMatchObject({
      enabledAsSubagent: true,
      source: 'project-claude',
    })
  })

  it('keeps the default behavior without a projectId', async () => {
    const res = await listAgents('http://localhost/api/agent-profiles')

    expect(res.status).toBe(200)
    const names = res.body.agents.map((agent) => agent.name)
    expect(names).not.toContain('qf-route-tester')
    expect(names).toEqual(expect.arrayContaining(['general', 'explore']))
  })

  it('falls back to the default behavior for an unknown projectId', async () => {
    const res = await listAgents('http://localhost/api/agent-profiles?projectId=missing')

    expect(res.status).toBe(200)
    const names = res.body.agents.map((agent) => agent.name)
    expect(names).not.toContain('qf-route-tester')
    expect(names).toEqual(expect.arrayContaining(['general', 'explore']))
  })
})

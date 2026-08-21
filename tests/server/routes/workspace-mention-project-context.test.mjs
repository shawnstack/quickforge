import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let tempDir
let previousDataDir
let workspaceRoute
let projectConfig

function mockRes() {
  return {
    headersSent: false,
    status: undefined,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
      this.headersSent = true
    },
    end(body = '') {
      this.body = body
    },
  }
}

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tempDir = await mkdtemp(path.join(tmpdir(), 'quickforge-mention-project-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tempDir, 'data')
  vi.resetModules()

  const workspaceRoot = path.join(tempDir, 'registered-workspace')
  const defaultWorkspaceRoot = path.join(tempDir, 'default-workspace')
  await mkdir(workspaceRoot, { recursive: true })
  await mkdir(defaultWorkspaceRoot, { recursive: true })
  await writeFile(path.join(workspaceRoot, 'registered-match.txt'), 'registered')
  await writeFile(path.join(defaultWorkspaceRoot, 'default-match.txt'), 'default')

  const storage = await import('../../../server/storage.mjs')
  await storage.writeProjectConfigData({
    activeProjectId: 'project-1',
    globalSkills: [],
    projects: [{ id: 'project-1', name: 'Registered', path: workspaceRoot, skills: [] }],
  })

  projectConfig = await import('../../../server/project-config.mjs')
  projectConfig.setDefaultWorkspaceRoot(defaultWorkspaceRoot)
  workspaceRoute = await import('../../../server/routes/workspace.mjs')
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  await rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('workspace mention project context', () => {
  it('searches a registered project normally', async () => {
    const res = mockRes()
    await workspaceRoute.handleWorkspaceApi(
      { method: 'GET' },
      res,
      new URL('http://localhost/api/workspace/mention-search?projectId=project-1&query=registered'),
    )

    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(res.body)).toMatchObject({
      root: 'Registered',
      query: 'registered',
      entries: [{ name: 'registered-match.txt', path: 'registered-match.txt', type: 'file' }],
      truncated: false,
    })
  })

  it('rejects an unknown project without searching the default workspace', async () => {
    await expect(workspaceRoute.handleWorkspaceApi(
      { method: 'GET' },
      mockRes(),
      new URL('http://localhost/api/workspace/mention-search?projectId=deleted-project&query=default'),
    )).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'PROJECT_NOT_FOUND',
      message: 'Unknown project',
    })
  })

  it('keeps the legacy projectContextFromId fallback for other callers', async () => {
    await expect(projectConfig.projectContextFromId('deleted-project')).resolves.toMatchObject({
      project: { id: 'default' },
      workspaceRoot: path.join(tempDir, 'default-workspace'),
    })
  })
})

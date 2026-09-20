import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

let tempDir
let previousDataDir
let workspaceRoute
let workspaceRoot

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

function postReq(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  req.headers = {}
  return req
}

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tempDir = await mkdtemp(path.join(tmpdir(), 'quickforge-resolve-path-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tempDir, 'data')
  vi.resetModules()

  workspaceRoot = path.join(tempDir, 'workspace')
  const defaultWorkspaceRoot = path.join(tempDir, 'default-workspace')
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await mkdir(defaultWorkspaceRoot, { recursive: true })
  await writeFile(path.join(workspaceRoot, 'src', 'App.tsx'), 'export default function App() {}\n')

  const storage = await import('../../../server/storage.mjs')
  await storage.writeProjectConfigData({
    activeProjectId: 'project-1',
    globalSkills: [],
    projects: [{ id: 'project-1', name: 'Registered', path: workspaceRoot, skills: [] }],
  })

  const projectConfig = await import('../../../server/project-config.mjs')
  projectConfig.setDefaultWorkspaceRoot(defaultWorkspaceRoot)
  workspaceRoute = await import('../../../server/routes/workspace.mjs')
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  await rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('workspace resolve-path route', () => {
  it('resolves a relative workspace path to its relativePath', async () => {
    const res = mockRes()
    await workspaceRoute.handleWorkspaceApi(
      postReq({ projectId: 'project-1', path: 'src/App.tsx' }),
      res,
      new URL('http://localhost/api/workspace/resolve-path'),
    )

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      relativePath: 'src/App.tsx',
      exists: true,
      isDirectory: false,
    })
  })

  it('rejects a relative path escaping the workspace with 403', async () => {
    await expect(workspaceRoute.handleWorkspaceApi(
      postReq({ projectId: 'project-1', path: '../outside' }),
      mockRes(),
      new URL('http://localhost/api/workspace/resolve-path'),
    )).rejects.toMatchObject({ statusCode: 403 })
  })

  it('still resolves an absolute path inside the workspace', async () => {
    const res = mockRes()
    await workspaceRoute.handleWorkspaceApi(
      postReq({ projectId: 'project-1', path: path.join(workspaceRoot, 'src', 'App.tsx') }),
      res,
      new URL('http://localhost/api/workspace/resolve-path'),
    )

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ relativePath: 'src/App.tsx', exists: true })
  })
})

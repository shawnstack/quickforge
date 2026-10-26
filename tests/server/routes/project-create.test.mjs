import { Readable } from 'node:stream'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir
let previousDataDir
let defaultWorkspaceRoot
let projectRoute
let projectConfig

function request(body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  req.headers = body === undefined ? {} : { 'content-type': 'application/json' }
  return req
}

function mockRes() {
  return {
    headersSent: false,
    status: undefined,
    body: '',
    writeHead(status) {
      this.status = status
      this.headersSent = true
    },
    end(body = '') {
      this.body = body
    },
  }
}

function createUrl() {
  return new URL('http://localhost/api/project/create')
}

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tempDir = await mkdtemp(path.join(tmpdir(), 'quickforge-project-create-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tempDir, 'data')
  vi.resetModules()

  defaultWorkspaceRoot = path.join(tempDir, 'workspace')
  await mkdir(defaultWorkspaceRoot, { recursive: true })

  projectConfig = await import('../../../server/project-config.mjs')
  projectConfig.setDefaultWorkspaceRoot(defaultWorkspaceRoot)
  projectRoute = await import('../../../server/routes/project.mjs')
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  await rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('POST /api/project/create', () => {
  it('creates the folder in the default workspace and activates it', async () => {
    const res = mockRes()
    await projectRoute.handleProjectApi(request({ name: 'landing-page' }), res, createUrl(), { isLocalRequest: true })

    expect(res.status).toBe(200)
    const payload = JSON.parse(res.body)
    expect(payload.createdPath).toBe(path.join(defaultWorkspaceRoot, 'landing-page'))
    expect(payload.project).toMatchObject({
      name: 'landing-page',
      path: path.join(defaultWorkspaceRoot, 'landing-page'),
    })
    expect(payload.projects).toHaveLength(1)
    expect(payload.workspaceRoot).toBe(path.join(defaultWorkspaceRoot, 'landing-page'))

    const config = await projectConfig.readProjectConfig()
    expect(config.activeProjectId).toBe(payload.project.id)
  })

  it('trims surrounding whitespace in the submitted name', async () => {
    const res = mockRes()
    await projectRoute.handleProjectApi(request({ name: '  spaced  ' }), res, createUrl(), { isLocalRequest: true })
    expect(JSON.parse(res.body).project.name).toBe('spaced')
  })

  it('rejects a duplicate folder with 409 and a machine-readable code', async () => {
    await projectRoute.handleProjectApi(request({ name: 'dup' }), mockRes(), createUrl(), { isLocalRequest: true })
    await expect(
      projectRoute.handleProjectApi(request({ name: 'dup' }), mockRes(), createUrl(), { isLocalRequest: true }),
    ).rejects.toMatchObject({ statusCode: 409, errorCode: 'PROJECT_FOLDER_EXISTS' })
  })

  for (const name of ['', '   ', '.', '..', 'a/b', 'a\\b', 'bad:name', 'wild*card', 'quo"te']) {
    it(`rejects invalid name ${JSON.stringify(name)} with 400`, async () => {
      await expect(
        projectRoute.handleProjectApi(request({ name }), mockRes(), createUrl(), { isLocalRequest: true }),
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'INVALID_PROJECT_NAME' })
    })
  }

  it('rejects a name longer than 64 characters', async () => {
    await expect(
      projectRoute.handleProjectApi(request({ name: 'a'.repeat(65) }), mockRes(), createUrl(), { isLocalRequest: true }),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'INVALID_PROJECT_NAME' })
  })

  it('is not treated as a local-only application action', async () => {
    const res = mockRes()
    await projectRoute.handleProjectApi(request({ name: 'remote-ok' }), res, createUrl(), { isLocalRequest: false })
    expect(res.status).toBe(200)
  })

  it('keeps the existing select-directory route untouched', async () => {
    // The remote policy list must not have grown a /api/project/create entry.
    await expect(
      projectRoute.handleProjectApi(request(), mockRes(), new URL('http://localhost/api/project/select-directory'), {
        isLocalRequest: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

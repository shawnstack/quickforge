import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { handleWorkspaceApi } from '../../../server/routes/workspace.mjs'
import { getDefaultWorkspaceRoot, setDefaultWorkspaceRoot } from '../../../server/project-config.mjs'

const tempDirs = []
const originalDefaultWorkspaceRoot = getDefaultWorkspaceRoot()

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

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-workspace-file-'))
  tempDirs.push(workspaceRoot)
  return workspaceRoot
}

afterEach(async () => {
  setDefaultWorkspaceRoot(originalDefaultWorkspaceRoot)
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('workspace file route', () => {
  it('returns content, size, and mtimeMs for a normal file request', async () => {
    const workspaceRoot = await createWorkspace()
    setDefaultWorkspaceRoot(workspaceRoot)
    const filePath = path.join(workspaceRoot, 'hello.ts')
    await writeFile(filePath, 'export const x = 1\n')

    const res = mockRes()
    await handleWorkspaceApi(
      { method: 'GET' },
      res,
      new URL('http://localhost/api/workspace/file?projectId=unknown&path=hello.ts'),
    )
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const fileStat = await stat(filePath)
    expect(JSON.parse(res.body)).toEqual({
      path: 'hello.ts',
      content: 'export const x = 1\n',
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      language: 'typescript',
      readonly: true,
    })
  })

  it('returns metadata without content when meta=1', async () => {
    const workspaceRoot = await createWorkspace()
    setDefaultWorkspaceRoot(workspaceRoot)
    const filePath = path.join(workspaceRoot, 'notes.md')
    await writeFile(filePath, '# notes')

    const res = mockRes()
    await handleWorkspaceApi(
      { method: 'GET' },
      res,
      new URL('http://localhost/api/workspace/file?projectId=unknown&path=notes.md&meta=1'),
    )
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const fileStat = await stat(filePath)
    const payload = JSON.parse(res.body)
    expect(payload.content).toBeUndefined()
    expect(payload).toEqual({
      path: 'notes.md',
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      language: 'markdown',
      readonly: true,
    })
  })

  it('keeps missing-file and oversized-file errors unchanged for both modes', async () => {
    const workspaceRoot = await createWorkspace()
    setDefaultWorkspaceRoot(workspaceRoot)

    await expect(handleWorkspaceApi(
      { method: 'GET' },
      mockRes(),
      new URL('http://localhost/api/workspace/file?projectId=unknown&path=missing.txt'),
    )).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(handleWorkspaceApi(
      { method: 'GET' },
      mockRes(),
      new URL('http://localhost/api/workspace/file?projectId=unknown&path=missing.txt&meta=1'),
    )).rejects.toMatchObject({ code: 'ENOENT' })

    const bigPath = path.join(workspaceRoot, 'big.bin')
    await writeFile(bigPath, Buffer.alloc(50 * 1024 * 1024 + 1))
    await expect(handleWorkspaceApi(
      { method: 'GET' },
      mockRes(),
      new URL('http://localhost/api/workspace/file?projectId=unknown&path=big.bin'),
    )).rejects.toMatchObject({ statusCode: 413 })
    await expect(handleWorkspaceApi(
      { method: 'GET' },
      mockRes(),
      new URL('http://localhost/api/workspace/file?projectId=unknown&path=big.bin&meta=1'),
    )).rejects.toMatchObject({ statusCode: 413 })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
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

  // 缺文件/不可读的失败语义：曾有 17 次 500——读已删掉的临时 .cjs 时，
  // `ENOENT ... realpath 'C:\Users\...'` 被原样回给前端，状态码 500 且泄露绝对路径。
  // 下面四条钉住 404/403 + 脱敏，且不许把未知故障吞成 404。
  async function failureOf(req, url) {
    const res = mockRes()
    try {
      await handleWorkspaceApi(req, res, url)
    } catch (error) {
      return error
    }
    throw new Error(`Expected the request to fail, but it answered ${res.status}`)
  }

  it('maps a missing file to a 404 issue without leaking the absolute path', async () => {
    const workspaceRoot = await createWorkspace()
    setDefaultWorkspaceRoot(workspaceRoot)

    const error = await failureOf(
      { method: 'GET' },
      new URL('http://localhost/api/workspace/file?projectId=unknown&path=missing.txt'),
    )

    expect(error).toMatchObject({
      statusCode: 404,
      errorCode: 'WORKSPACE_FILE_NOT_FOUND',
      message: 'File not found',
    })
    expect(error.message).not.toContain('C:\\')
    expect(error.message).not.toContain('realpath')
  })

  it('maps a missing file to the same 404 issue when only metadata is requested', async () => {
    const workspaceRoot = await createWorkspace()
    setDefaultWorkspaceRoot(workspaceRoot)

    const error = await failureOf(
      { method: 'GET' },
      new URL('http://localhost/api/workspace/file?projectId=unknown&path=missing.txt&meta=1'),
    )

    expect(error).toMatchObject({
      statusCode: 404,
      errorCode: 'WORKSPACE_FILE_NOT_FOUND',
      message: 'File not found',
    })
    expect(error.message).not.toContain('C:\\')
  })

  it('maps a path whose parent is a plain file to the same 404 issue', async () => {
    const workspaceRoot = await createWorkspace()
    setDefaultWorkspaceRoot(workspaceRoot)
    await writeFile(path.join(workspaceRoot, 'plain.txt'), 'plain')

    const error = await failureOf(
      { method: 'GET' },
      new URL('http://localhost/api/workspace/file?projectId=unknown&path=plain.txt/nested.txt'),
    )

    expect(error).toMatchObject({ statusCode: 404, errorCode: 'WORKSPACE_FILE_NOT_FOUND' })
    expect(error.message).not.toContain('C:\\')
  })

  it('maps a permission failure to a 403 issue without leaking the absolute path', async () => {
    const workspaceRoot = await createWorkspace()
    setDefaultWorkspaceRoot(workspaceRoot)
    await writeFile(path.join(workspaceRoot, 'locked.txt'), 'secret')

    // Windows 上造不出稳定的 EACCES（chmod 对属主基本无效），
    // 这里只把 fs.stat 对目标文件的那一次调用换成真实的 EACCES 形状，
    // 走的是与线上完全相同的映射代码路径。
    const realStat = fs.stat
    const spy = vi.spyOn(fs, 'stat').mockImplementation(async (target, ...rest) => {
      if (String(target).endsWith('locked.txt')) {
        throw Object.assign(new Error(`EACCES: permission denied, stat '${target}'`), { code: 'EACCES' })
      }
      return realStat.call(fs, target, ...rest)
    })

    try {
      const error = await failureOf(
        { method: 'GET' },
        new URL('http://localhost/api/workspace/file?projectId=unknown&path=locked.txt'),
      )
      expect(error).toMatchObject({
        statusCode: 403,
        errorCode: 'WORKSPACE_FILE_PERMISSION_DENIED',
        message: 'Permission denied',
      })
      expect(error.message).not.toContain('C:\\')
    } finally {
      spy.mockRestore()
    }
  })
})

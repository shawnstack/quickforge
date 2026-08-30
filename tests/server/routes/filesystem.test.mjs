import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { handleFilesystemApi } from '../../../server/routes/filesystem.mjs'

const cleanupPaths = []

function request(method, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.headers = body === undefined ? {} : { 'content-type': 'application/json' }
  return req
}

function createResponse() {
  const captured = { status: 0, body: '' }
  const res = {
    writeHead(status) {
      captured.status = status
    },
    end(chunk) {
      captured.body = String(chunk || '')
    },
  }
  return { res, captured }
}

function getJson(captured) {
  return JSON.parse(captured.body)
}

function mkdirUrl() {
  return new URL('http://localhost/api/filesystem/mkdir')
}

async function makeBaseDir() {
  const baseDir = path.join(
    os.homedir(),
    `.quickforge-mkdir-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  await fs.mkdir(baseDir, { recursive: true })
  cleanupPaths.push(baseDir)
  return baseDir
}

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop()
    await fs.rm(target, { recursive: true, force: true }).catch(() => {})
  }
})

describe('filesystem routes', () => {
  it('lists roots without the QuickForge install directory', async () => {
    const { res, captured } = createResponse()
    await handleFilesystemApi(request('GET'), res, new URL('http://localhost/api/filesystem/roots'))
    expect(captured.status).toBe(200)
    const payload = getJson(captured)
    expect(payload.roots.some((root) => root.name === 'QuickForge')).toBe(false)
    const home = payload.roots.find((root) => root.name === 'Home')
    expect(home).toMatchObject({ path: path.resolve(os.homedir()) })
  })

  it('reports the parent path when browsing the home directory', async () => {
    const { res, captured } = createResponse()
    const home = path.resolve(os.homedir())
    const url = new URL(`http://localhost/api/filesystem/directories?path=${encodeURIComponent(home)}`)
    await handleFilesystemApi(request('GET'), res, url)
    expect(captured.status).toBe(200)
    const payload = getJson(captured)
    expect(payload.path).toBe(home)
    expect(payload.parent).toBe(path.dirname(home))
  })

  it('creates a directory under an allowed parent', async () => {
    const baseDir = await makeBaseDir()
    const { res, captured } = createResponse()
    await handleFilesystemApi(request('POST', { parentPath: baseDir, name: 'child' }), res, mkdirUrl())
    expect(captured.status).toBe(200)
    const payload = getJson(captured)
    expect(payload.ok).toBe(true)
    expect(payload.path).toBe(path.join(baseDir, 'child'))
    const stat = await fs.stat(payload.path)
    expect(stat.isDirectory()).toBe(true)
  })

  it('rejects duplicate directory names with 409', async () => {
    const baseDir = await makeBaseDir()
    await handleFilesystemApi(request('POST', { parentPath: baseDir, name: 'dup' }), createResponse().res, mkdirUrl())
    await expect(
      handleFilesystemApi(request('POST', { parentPath: baseDir, name: 'dup' }), createResponse().res, mkdirUrl()),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  for (const name of ['a/b', 'a\\b', '..', '.', '   ']) {
    it(`rejects invalid directory name ${JSON.stringify(name)} with 400`, async () => {
      const baseDir = await makeBaseDir()
      await expect(
        handleFilesystemApi(request('POST', { parentPath: baseDir, name }), createResponse().res, mkdirUrl()),
      ).rejects.toMatchObject({ statusCode: 400 })
    })
  }

  it('rejects a missing parentPath with 400', async () => {
    await expect(
      handleFilesystemApi(request('POST', { name: 'child' }), createResponse().res, mkdirUrl()),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a non-existent parentPath with 404', async () => {
    const missingParent = path.join(os.homedir(), `.quickforge-mkdir-test-missing-${Date.now()}`)
    await expect(
      handleFilesystemApi(request('POST', { parentPath: missingParent, name: 'child' }), createResponse().res, mkdirUrl()),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects a parentPath outside allowed roots with 403 when constructible', async () => {
    // POSIX 下 '/' 恒为 root，Windows 下所有已挂载盘符也在 roots 内，均无法稳定构造越界绝对路径；
    // 仅在 Windows 存在未挂载盘符时构造越界路径断言 403，其余环境跳过（400/404 拒绝面已由上方用例覆盖）。
    let outsideRoot = null
    if (process.platform === 'win32') {
      for (const letter of ['Q', 'X', 'Y', 'Z', 'I', 'J']) {
        const drive = `${letter}:\\`
        const exists = await fs.stat(drive).then(
          () => true,
          () => false,
        )
        if (!exists) {
          outsideRoot = path.join(drive, '__nope')
          break
        }
      }
    }
    if (!outsideRoot) return
    await expect(
      handleFilesystemApi(request('POST', { parentPath: outsideRoot, name: 'child' }), createResponse().res, mkdirUrl()),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

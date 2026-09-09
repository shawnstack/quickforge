import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { handleWorkspaceApi, searchWorkspace } from '../../../server/routes/workspace.mjs'
import { getDefaultWorkspaceRoot, setDefaultWorkspaceRoot } from '../../../server/project-config.mjs'

// 路由级 abort 用例用可控假子进程替换 spawn；默认透传真实 spawn，其余用例不受影响
const spawnControl = vi.hoisted(() => ({ impl: null }))
// 覆盖 ripgrep 解析结果（null → 强制 BFS fallback；undefined → 透传真实解析）
const ripgrepControl = vi.hoisted(() => ({ resolve: undefined }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    spawn: (command, args, options) => (spawnControl.impl
      ? spawnControl.impl(command, args, options)
      : actual.spawn(command, args, options)),
  }
})

vi.mock('../../../server/utils/ripgrep.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    resolveRipgrepExecutable: () => (ripgrepControl.resolve === undefined
      ? actual.resolveRipgrepExecutable()
      : ripgrepControl.resolve),
  }
})

const tempDirs = []
const originalDefaultWorkspaceRoot = getDefaultWorkspaceRoot()

function mockRes() {
  const res = {
    headersSent: false,
    writableEnded: false,
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
      this.writableEnded = true
    },
  }
  Object.setPrototypeOf(res, EventEmitter.prototype)
  return res
}

function mockReq(method = 'GET') {
  const req = new EventEmitter()
  req.method = method
  return req
}

// 假 rg 子进程：stdout/stderr 用 PassThrough（支持 setEncoding），永不自行退出
function fakeChild(pid = 1234) {
  const child = new EventEmitter()
  child.pid = pid
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  return child
}

async function createWorkspace(prefix = 'quickforge-workspace-search-') {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(workspaceRoot)
  return { workspaceRoot, project: { id: 'project-1', name: 'Workspace' } }
}

afterEach(async () => {
  spawnControl.impl = null
  ripgrepControl.resolve = undefined
  setDefaultWorkspaceRoot(originalDefaultWorkspaceRoot)
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('workspace search ripgrep fallback', () => {
  it('falls back to the BFS traversal and keeps the same result shape when ripgrep is unavailable', async () => {
    ripgrepControl.resolve = null
    const context = await createWorkspace()
    await mkdir(path.join(context.workspaceRoot, 'target-dir'))
    await writeFile(path.join(context.workspaceRoot, 'target-dir', 'inside.ts'), 'inside')
    await writeFile(path.join(context.workspaceRoot, 'target-file.txt'), 'target')
    await writeFile(path.join(context.workspaceRoot, 'other.txt'), 'other')
    await writeFile(path.join(context.workspaceRoot, '.dot-target'), 'visible')

    const result = await searchWorkspace(context, 'target')

    expect(result.root).toBe('Workspace')
    expect(result.query).toBe('target')
    expect(result.entries.map((entry) => `${entry.type}:${entry.path}`)).toEqual([
      'directory:target-dir',
      'file:.dot-target',
      'file:target-dir/inside.ts',
      'file:target-file.txt',
    ])
    expect(result.truncated).toBe(false)
  })
})

describe('workspace search route abort', () => {
  it('silently settles, leaves the response unwritten, and kills the ripgrep child when the client disconnects mid-search', async () => {
    const context = await createWorkspace()
    setDefaultWorkspaceRoot(context.workspaceRoot)
    await writeFile(path.join(context.workspaceRoot, 'search-match.txt'), 'match')
    // 直接给出可用 rg，跳过 --version 验证；假 rg 子进程永不自行退出，保证时序确定不 flaky
    ripgrepControl.resolve = { command: path.join(tmpdir(), 'rg.exe'), source: 'bundled' }

    const rgChild = fakeChild(4321)
    const killer = fakeChild(8765)
    const spawned = []
    spawnControl.impl = (command) => {
      spawned.push(command)
      return /rg/i.test(command) && !/taskkill/i.test(command) ? rgChild : killer
    }

    const req = mockReq()
    const res = mockRes()
    const running = handleWorkspaceApi(
      req,
      res,
      new URL('http://localhost/api/workspace/search?projectId=unknown&query=search'),
    )
    await vi.waitFor(() => expect(spawned.some((command) => /rg/i.test(command) && !/taskkill/i.test(command))).toBe(true), { timeout: 5000 })

    req.emit('aborted')
    await expect(running).resolves.toBeUndefined()

    expect(res.headersSent).toBe(false)
    expect(res.status).toBeUndefined()
    expect(res.body).toBe('')
    expect(req.listenerCount('aborted')).toBe(0)
    expect(res.listenerCount('close')).toBe(0)
    // rg 子进程被清理：win32 走 taskkill，其他平台走进程组/直接 kill
    expect(
      spawned.some((command) => /taskkill/i.test(command)) || rgChild.kill.mock.calls.length > 0,
    ).toBe(true)
  })

  it('rejects with a standard AbortError when the signal is already aborted before spawning ripgrep', async () => {
    const context = await createWorkspace()
    await writeFile(path.join(context.workspaceRoot, 'search-match.txt'), 'match')
    const controller = new AbortController()
    controller.abort()

    await expect(searchWorkspace(context, 'search', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' })
  })
})

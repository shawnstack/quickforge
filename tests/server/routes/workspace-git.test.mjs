import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { commitAndPushGitChanges, handleGitApi, listGitStatus } from '../../../server/routes/workspace.mjs'
import { getDefaultWorkspaceRoot, setDefaultWorkspaceRoot } from '../../../server/project-config.mjs'

const execFileAsync = promisify(execFile)
const tempDirs = []
const originalDefaultWorkspaceRoot = getDefaultWorkspaceRoot()
const originalGitCeiling = process.env.GIT_CEILING_DIRECTORIES

async function git(cwd, ...args) {
  return execFileAsync('git', args, { cwd, windowsHide: true })
}

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

async function initRepoWithCommit(workspaceRoot) {
  await git(workspaceRoot, 'init')
  await git(workspaceRoot, 'config', 'user.name', 'QuickForge Test')
  await git(workspaceRoot, 'config', 'user.email', 'quickforge@example.test')
  await writeFile(path.join(workspaceRoot, 'tracked.txt'), 'one\n')
  await git(workspaceRoot, 'add', '-A')
  await git(workspaceRoot, 'commit', '-m', 'init')
}

afterEach(async () => {
  if (originalGitCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES
  else process.env.GIT_CEILING_DIRECTORIES = originalGitCeiling
  setDefaultWorkspaceRoot(originalDefaultWorkspaceRoot)
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('workspace git status', () => {
  it('expands untracked directories into individual files', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-'))
    tempDirs.push(workspaceRoot)
    await git(workspaceRoot, 'init')
    await mkdir(path.join(workspaceRoot, 'untracked-dir', 'nested'), { recursive: true })
    await writeFile(path.join(workspaceRoot, 'untracked-dir', 'a.txt'), 'first\n')
    await writeFile(path.join(workspaceRoot, 'untracked-dir', 'nested', 'b.txt'), 'second\n')

    const result = await listGitStatus({ workspaceRoot })

    expect(result.files.map((file) => file.path)).toEqual([
      'untracked-dir/a.txt',
      'untracked-dir/nested/b.txt',
    ])
    expect(result.files).toMatchObject([
      { path: 'untracked-dir/a.txt', additions: 1, deletions: 0 },
      { path: 'untracked-dir/nested/b.txt', additions: 1, deletions: 0 },
    ])
    expect(result.files.every((file) => !file.path.endsWith('/'))).toBe(true)
    expect(result.counts?.untracked).toBe(2)
    expect(result.counts?.total).toBe(2)
  })

  it('keeps oversized untracked files while omitting line counts', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-'))
    tempDirs.push(workspaceRoot)
    await git(workspaceRoot, 'init')
    await writeFile(path.join(workspaceRoot, 'small.txt'), 'first\nsecond\n')
    await writeFile(path.join(workspaceRoot, 'large.txt'), 'x'.repeat(1024 * 1024 + 1))

    const result = await listGitStatus({ workspaceRoot })
    const small = result.files.find((file) => file.path === 'small.txt')
    const large = result.files.find((file) => file.path === 'large.txt')

    expect(small).toMatchObject({ additions: 2, deletions: 0 })
    expect(large).toBeTruthy()
    expect(large).not.toHaveProperty('additions')
    expect(large).not.toHaveProperty('deletions')
    expect(result.counts?.total).toBe(2)
  })

  it('counts at most 100 untracked files without truncating the status list', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-'))
    tempDirs.push(workspaceRoot)
    await git(workspaceRoot, 'init')
    await Promise.all(Array.from({ length: 101 }, (_, index) => {
      return writeFile(path.join(workspaceRoot, `file-${String(index).padStart(3, '0')}.txt`), `${index}\n`)
    }))

    const result = await listGitStatus({ workspaceRoot })
    const counted = result.files.filter((file) => typeof file.additions === 'number')
    const last = result.files.find((file) => file.path === 'file-100.txt')

    expect(result.files).toHaveLength(101)
    expect(result.counts?.total).toBe(101)
    expect(counted).toHaveLength(100)
    expect(last).toBeTruthy()
    expect(last).not.toHaveProperty('additions')
  })

  it('limits total untracked line-count reads to 10MB', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-'))
    tempDirs.push(workspaceRoot)
    await git(workspaceRoot, 'init')
    const oneMegabyteText = `${'x'.repeat(1024 * 1024 - 1)}\n`
    await Promise.all(Array.from({ length: 11 }, (_, index) => {
      return writeFile(path.join(workspaceRoot, `large-${String(index).padStart(2, '0')}.txt`), oneMegabyteText)
    }))

    const result = await listGitStatus({ workspaceRoot })
    const counted = result.files.filter((file) => typeof file.additions === 'number')
    const last = result.files.find((file) => file.path === 'large-10.txt')

    expect(result.files).toHaveLength(11)
    expect(counted).toHaveLength(10)
    expect(last).toBeTruthy()
    expect(last).not.toHaveProperty('additions')
  })
})

describe('workspace git status branch header and light mode', () => {
  it('reads the branch from the --branch header without treating it as a file', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-'))
    const remoteRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-remote-'))
    tempDirs.push(workspaceRoot, remoteRoot)
    await git(remoteRoot, 'init', '--bare')
    await initRepoWithCommit(workspaceRoot)
    await git(workspaceRoot, 'branch', '-M', 'dev')
    await git(workspaceRoot, 'remote', 'add', 'origin', remoteRoot.replace(/\\/g, '/'))
    await git(workspaceRoot, 'push', '-u', 'origin', 'dev')
    await writeFile(path.join(workspaceRoot, 'tracked.txt'), 'one\ntwo\n')

    const result = await listGitStatus({ workspaceRoot })

    expect(result.branch).toBe('dev')
    expect(result.detached).toBe(false)
    expect(result.files.map((file) => file.path)).toEqual(['tracked.txt'])
    expect(result.files.some((file) => file.path.startsWith('## '))).toBe(false)
  })

  it('reads an unborn branch from the --branch header', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-'))
    tempDirs.push(workspaceRoot)
    await git(workspaceRoot, 'init')
    await writeFile(path.join(workspaceRoot, 'new.txt'), 'one\n')

    const result = await listGitStatus({ workspaceRoot })

    expect(result.branch).toMatch(/^\S+$/)
    expect(result.detached).toBe(false)
    expect(result.files.map((file) => file.path)).toEqual(['new.txt'])
  })

  it('reports a detached HEAD from the --branch header without treating it as a file', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-'))
    tempDirs.push(workspaceRoot)
    await initRepoWithCommit(workspaceRoot)
    await git(workspaceRoot, 'checkout', '--detach')
    await writeFile(path.join(workspaceRoot, 'tracked.txt'), 'one\ntwo\n')

    const result = await listGitStatus({ workspaceRoot })

    expect(result.detached).toBe(true)
    expect(result.branch).toMatch(/^HEAD [0-9a-f]+$/)
    expect(result.files.map((file) => file.path)).toEqual(['tracked.txt'])
    expect(result.files.some((file) => file.path.startsWith('## '))).toBe(false)
  })

  it('returns branch and counts in light mode without per-file additions/deletions', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-'))
    tempDirs.push(workspaceRoot)
    await initRepoWithCommit(workspaceRoot)
    await writeFile(path.join(workspaceRoot, 'tracked.txt'), 'one\ntwo\n')

    const light = await listGitStatus({ workspaceRoot }, { includeFileStats: false })
    const full = await listGitStatus({ workspaceRoot })

    expect(light.branch).toBeTruthy()
    expect(light.branch).toBe(full.branch)
    expect(light.counts).toEqual({ staged: 0, unstaged: 1, untracked: 0, conflicts: 0, total: 1 })
    expect(light.files).toEqual([expect.objectContaining({ path: 'tracked.txt', status: 'modified' })])
    expect(light.files[0]).not.toHaveProperty('additions')
    expect(light.files[0]).not.toHaveProperty('deletions')
    expect(full.files[0]).toMatchObject({ additions: 1, deletions: 0 })
  })

  it('keeps the non-repository response shape', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-'))
    tempDirs.push(workspaceRoot)
    // 用户主目录可能本身是 Git 仓库（C:\Users\<user>\.git），tmpdir 下的空目录会被当成它的
    // 工作区并扫描整棵树；用 ceiling 阻止向上发现，让「非仓库」用例快速且确定。
    process.env.GIT_CEILING_DIRECTORIES = tmpdir()

    await expect(listGitStatus({ workspaceRoot })).resolves.toEqual({ isGitRepository: false, files: [] })
  })

  it('maps the light=1 query parameter to stat-free status in the route handler', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-'))
    tempDirs.push(workspaceRoot)
    await initRepoWithCommit(workspaceRoot)
    await writeFile(path.join(workspaceRoot, 'tracked.txt'), 'one\ntwo\n')
    setDefaultWorkspaceRoot(workspaceRoot)

    const lightRes = mockRes()
    await handleGitApi({ method: 'GET' }, lightRes, new URL('http://localhost/api/git/status?projectId=unknown&light=1'))
    const light = JSON.parse(lightRes.body)
    expect(lightRes.status).toBe(200)
    expect(light.isGitRepository).toBe(true)
    expect(light.branch).toBeTruthy()
    expect(light.counts.total).toBe(1)
    expect(light.files[0]).not.toHaveProperty('additions')

    const fullRes = mockRes()
    await handleGitApi({ method: 'GET' }, fullRes, new URL('http://localhost/api/git/status?projectId=unknown'))
    const full = JSON.parse(fullRes.body)
    expect(full.files[0]).toMatchObject({ additions: 1, deletions: 0 })
  })
})

describe('workspace git commit and push', () => {
  it('reports a committed local change when push fails', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-git-'))
    tempDirs.push(workspaceRoot)
    await git(workspaceRoot, 'init')
    await git(workspaceRoot, 'config', 'user.name', 'QuickForge Test')
    await git(workspaceRoot, 'config', 'user.email', 'quickforge@example.test')
    await writeFile(path.join(workspaceRoot, 'example.txt'), 'safe commit\n')

    const result = await commitAndPushGitChanges({ workspaceRoot }, 'test: safe commit', true)
    const { stdout } = await git(workspaceRoot, 'rev-list', '--count', 'HEAD')

    expect(result.committed).toBe(true)
    expect(result.pushed).toBe(false)
    expect(result.pushError).toBeTruthy()
    expect(stdout.trim()).toBe('1')
    expect(result.counts?.total).toBe(0)
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { commitAndPushGitChanges, listGitStatus } from '../../../server/routes/workspace.mjs'

const execFileAsync = promisify(execFile)
const tempDirs = []

async function git(cwd, ...args) {
  return execFileAsync('git', args, { cwd, windowsHide: true })
}

afterEach(async () => {
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

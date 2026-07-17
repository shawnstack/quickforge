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
    expect(result.files.every((file) => !file.path.endsWith('/'))).toBe(true)
    expect(result.counts?.untracked).toBe(2)
    expect(result.counts?.total).toBe(2)
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

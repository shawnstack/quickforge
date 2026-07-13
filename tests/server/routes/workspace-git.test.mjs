import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { commitAndPushGitChanges } from '../../../server/routes/workspace.mjs'

const execFileAsync = promisify(execFile)
const tempDirs = []

async function git(cwd, ...args) {
  return execFileAsync('git', args, { cwd, windowsHide: true })
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
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

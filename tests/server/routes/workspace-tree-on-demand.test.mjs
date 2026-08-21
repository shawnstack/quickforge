import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { compareWorkspaceEntries, listWorkspaceChildren, readValidatedWorkspaceSearchDirectory, searchWorkspace, searchWorkspaceMentions, handleWorkspaceApi } from '../../../server/routes/workspace.mjs'
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
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-workspace-tree-'))
  tempDirs.push(workspaceRoot)
  return { workspaceRoot, project: { id: 'project-1', name: 'Workspace' } }
}

async function createExternalDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'quickforge-workspace-outside-'))
  tempDirs.push(directory)
  return directory
}

afterEach(async () => {
  setDefaultWorkspaceRoot(originalDefaultWorkspaceRoot)
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('workspace children', () => {
  it('lists only direct children with directories first and case-insensitive sorting', async () => {
    const context = await createWorkspace()
    await mkdir(path.join(context.workspaceRoot, 'zDir'))
    await mkdir(path.join(context.workspaceRoot, 'adir'))
    await mkdir(path.join(context.workspaceRoot, 'adir', 'nested'))
    await writeFile(path.join(context.workspaceRoot, 'B.txt'), 'b')
    await writeFile(path.join(context.workspaceRoot, 'a.txt'), 'a')
    await writeFile(path.join(context.workspaceRoot, '.visible'), 'dot')

    const result = await listWorkspaceChildren(context)

    expect(result.path).toBe('.')
    expect(result.entries.map((entry) => `${entry.type}:${entry.path}`)).toEqual([
      'directory:adir',
      'directory:zDir',
      'file:.visible',
      'file:a.txt',
      'file:B.txt',
    ])
    expect(result.entries.some((entry) => entry.path.includes('nested'))).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it('returns empty directories and paginates with a stable cursor', async () => {
    const context = await createWorkspace()
    await mkdir(path.join(context.workspaceRoot, 'empty'))
    for (const name of ['c.txt', 'a.txt', 'b.txt']) await writeFile(path.join(context.workspaceRoot, name), name)

    expect((await listWorkspaceChildren(context, 'empty')).entries).toEqual([])
    const first = await listWorkspaceChildren(context, '.', { limit: 2 })
    const second = await listWorkspaceChildren(context, '.', { limit: 2, cursor: first.nextCursor })

    expect(first.entries.map((entry) => entry.path)).toEqual(['empty', 'a.txt'])
    expect(first.truncated).toBe(true)
    expect(second.entries.map((entry) => entry.path)).toEqual(['b.txt', 'c.txt'])
    expect(second.nextCursor).toBeNull()
  })

  it('uses deterministic secondary ordering for case-only names across pages', async () => {
    const lower = { name: 'a.txt', path: 'lower/a.txt', type: 'file' }
    const upper = { name: 'A.txt', path: 'upper/A.txt', type: 'file' }
    const expected = [lower, upper].sort(compareWorkspaceEntries).map((entry) => entry.path)

    expect(compareWorkspaceEntries(lower, upper)).not.toBe(0)
    expect([lower, upper].sort(compareWorkspaceEntries).map((entry) => entry.path)).toEqual(expected)
    expect([upper, lower].sort(compareWorkspaceEntries).map((entry) => entry.path)).toEqual(expected)

    const context = await createWorkspace()
    for (const name of ['c.txt', 'a.txt', 'b.txt']) await writeFile(path.join(context.workspaceRoot, name), name)
    const all = await listWorkspaceChildren(context, '.', { limit: 10 })
    const first = await listWorkspaceChildren(context, '.', { limit: 1 })
    const second = await listWorkspaceChildren(context, '.', { limit: 1, cursor: first.nextCursor })
    const third = await listWorkspaceChildren(context, '.', { limit: 1, cursor: second.nextCursor })
    expect([first, second, third].flatMap((page) => page.entries.map((entry) => entry.path)))
      .toEqual(all.entries.map((entry) => entry.path))
  })

  it('keeps offset cursor semantics explicit when a directory changes between pages', async () => {
    const context = await createWorkspace()
    for (const name of ['b.txt', 'c.txt', 'd.txt']) await writeFile(path.join(context.workspaceRoot, name), name)

    const first = await listWorkspaceChildren(context, '.', { limit: 2 })
    await writeFile(path.join(context.workspaceRoot, 'a.txt'), 'a')
    const second = await listWorkspaceChildren(context, '.', { limit: 2, cursor: first.nextCursor })

    expect(first.entries.map((entry) => entry.path)).toEqual(['b.txt', 'c.txt'])
    expect(second.entries.map((entry) => entry.path)).toEqual(['c.txt', 'd.txt'])
  })

  it('keeps dot files visible while skipping .git and node_modules', async () => {
    const context = await createWorkspace()
    await mkdir(path.join(context.workspaceRoot, '.git'))
    await mkdir(path.join(context.workspaceRoot, 'node_modules'))
    await mkdir(path.join(context.workspaceRoot, '.config'))
    await writeFile(path.join(context.workspaceRoot, '.env'), 'visible in tree')

    const result = await listWorkspaceChildren(context)
    expect(result.entries.map((entry) => entry.path)).toEqual(['.config', '.env'])
  })

  it('rejects traversal, file-as-directory, invalid limits, and invalid cursors', async () => {
    const context = await createWorkspace()
    await writeFile(path.join(context.workspaceRoot, 'file.txt'), 'file')

    await expect(listWorkspaceChildren(context, '../outside')).rejects.toMatchObject({ statusCode: 403 })
    await expect(listWorkspaceChildren(context, 'file.txt')).rejects.toMatchObject({ statusCode: 400 })
    await expect(listWorkspaceChildren(context, '.', { limit: 0 })).rejects.toMatchObject({ statusCode: 400 })
    await expect(listWorkspaceChildren(context, '.', { cursor: 'invalid' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('omits external symbolic links and accepts safe internal symbolic links when supported', async () => {
    const context = await createWorkspace()
    const outside = await createExternalDirectory()
    await writeFile(path.join(outside, 'secret.txt'), 'outside')
    await mkdir(path.join(context.workspaceRoot, 'inside'))
    await writeFile(path.join(context.workspaceRoot, 'inside', 'ok.txt'), 'inside')
    try {
      await symlink(outside, path.join(context.workspaceRoot, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir')
      await symlink(path.join(context.workspaceRoot, 'inside'), path.join(context.workspaceRoot, 'inside-link'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') return
      throw error
    }

    const result = await listWorkspaceChildren(context)
    expect(result.entries.map((entry) => entry.path)).toContain('inside-link')
    expect(result.entries.map((entry) => entry.path)).not.toContain('outside-link')
  })
})

describe('workspace search', () => {
  it('revalidates every queued directory before reading it', async () => {
    const calls = []
    const validateWorkspacePath = async (directory, options) => {
      calls.push(['validate', directory, options])
    }
    const realpath = async (directory) => {
      calls.push(['realpath', directory])
      return `${directory}-real`
    }
    const readdir = async (directory, options) => {
      calls.push(['readdir', directory, options])
      return []
    }

    const visitedDirectories = new Set()
    await expect(readValidatedWorkspaceSearchDirectory('queued-directory', validateWorkspacePath, visitedDirectories, { realpath, readdir }))
      .resolves.toEqual({ directoryReal: 'queued-directory-real', dirents: [] })
    expect(calls).toEqual([
      ['validate', 'queued-directory', { allowSensitive: true }],
      ['realpath', 'queued-directory'],
      ['readdir', 'queued-directory', { withFileTypes: true }],
    ])

    calls.length = 0
    await expect(readValidatedWorkspaceSearchDirectory('queued-directory', validateWorkspacePath, visitedDirectories, { realpath, readdir }))
      .resolves.toBeNull()
    expect(calls).toEqual([
      ['validate', 'queued-directory', { allowSensitive: true }],
      ['realpath', 'queued-directory'],
    ])

    calls.length = 0
    await expect(readValidatedWorkspaceSearchDirectory('replaced-directory', async () => {
      calls.push(['validate', 'replaced-directory'])
      throw new Error('outside workspace')
    }, new Set(), { realpath, readdir })).rejects.toThrow('outside workspace')
    expect(calls).toEqual([['validate', 'replaced-directory']])
  })

  it('searches the full project without requiring loaded tree state', async () => {
    const context = await createWorkspace()
    await mkdir(path.join(context.workspaceRoot, 'src', 'deep'), { recursive: true })
    await writeFile(path.join(context.workspaceRoot, 'src', 'deep', 'TargetFile.ts'), 'target')

    const result = await searchWorkspace(context, 'target')
    expect(result.entries.map((entry) => entry.path)).toEqual(['src/deep/TargetFile.ts'])
    expect(result.truncated).toBe(false)
  })

  it('reports search truncation only when an additional match exists', async () => {
    const context = await createWorkspace()
    await writeFile(path.join(context.workspaceRoot, 'only-match.txt'), 'only')

    const exact = await searchWorkspace(context, 'match', { limit: 1 })
    await writeFile(path.join(context.workspaceRoot, 'second-match.txt'), 'second')
    const truncated = await searchWorkspace(context, 'match', { limit: 1 })

    expect(exact.entries).toHaveLength(1)
    expect(exact.truncated).toBe(false)
    expect(truncated.entries).toHaveLength(1)
    expect(truncated.truncated).toBe(true)
  })

  it('enforces the query minimum and reports truncation at the result limit', async () => {
    const context = await createWorkspace()
    await writeFile(path.join(context.workspaceRoot, 'match-a.txt'), 'a')
    await writeFile(path.join(context.workspaceRoot, 'match-b.txt'), 'b')

    await expect(searchWorkspace(context, 'm')).rejects.toMatchObject({ statusCode: 400 })
    const result = await searchWorkspace(context, 'match', { limit: 1 })
    expect(result.entries).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('skips ignored directories and external symbolic-link targets', async () => {
    const context = await createWorkspace()
    await mkdir(path.join(context.workspaceRoot, '.git'))
    await mkdir(path.join(context.workspaceRoot, 'node_modules'))
    await writeFile(path.join(context.workspaceRoot, '.git', 'hidden-match.txt'), 'hidden')
    await writeFile(path.join(context.workspaceRoot, 'node_modules', 'dependency-match.txt'), 'hidden')
    await writeFile(path.join(context.workspaceRoot, '.dot-match'), 'visible')
    const outside = await createExternalDirectory()
    await writeFile(path.join(outside, 'outside-match.txt'), 'outside')
    try {
      await symlink(outside, path.join(context.workspaceRoot, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
    }

    const result = await searchWorkspace(context, 'match')
    expect(result.entries.map((entry) => entry.path)).toEqual(['.dot-match'])
  })
  it('filters mention search to safe files, ranks basename matches, caps limits, and keeps existing search behavior', async () => {
    const context = await createWorkspace()
    await mkdir(path.join(context.workspaceRoot, 'nested'))
    await mkdir(path.join(context.workspaceRoot, 'target-dir'))
    await writeFile(path.join(context.workspaceRoot, 'target'), 'exact')
    await writeFile(path.join(context.workspaceRoot, 'target-prefix.ts'), 'prefix')
    await writeFile(path.join(context.workspaceRoot, 'my-target.ts'), 'contains')
    await writeFile(path.join(context.workspaceRoot, 'nested', 'target-path.ts'), 'path')
    await writeFile(path.join(context.workspaceRoot, '.ENV.TARGET'), 'secret')
    await writeFile(path.join(context.workspaceRoot, 'target-dir', 'inside.ts'), 'inside')

    const mentions = await searchWorkspaceMentions(context, 'target', { limit: 50 })
    expect(mentions.entries).toEqual([
      { name: 'target', path: 'target', type: 'file' },
      { name: 'target-path.ts', path: 'nested/target-path.ts', type: 'file' },
      { name: 'target-prefix.ts', path: 'target-prefix.ts', type: 'file' },
      { name: 'my-target.ts', path: 'my-target.ts', type: 'file' },
      { name: 'inside.ts', path: 'target-dir/inside.ts', type: 'file' },
    ])
    expect(mentions.entries.every((entry) => entry.type === 'file')).toBe(true)
    expect(mentions.entries.some((entry) => entry.path === '.ENV.TARGET')).toBe(false)
    expect((await searchWorkspaceMentions(context, 'target', { limit: 1 })).entries).toHaveLength(1)

    const existingSearch = await searchWorkspace(context, 'target')
    expect(existingSearch.entries.map((entry) => entry.path)).toContain('.ENV.TARGET')
    expect(existingSearch.entries.map((entry) => entry.path)).toContain('target-dir')
  })

  it('omits safe-looking links to sensitive real targets from mention search', async () => {
    const context = await createWorkspace()
    await writeFile(path.join(context.workspaceRoot, '.ENV.MATCH'), 'secret')
    try {
      await symlink(path.join(context.workspaceRoot, '.ENV.MATCH'), path.join(context.workspaceRoot, 'safe-match.txt'), 'file')
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') return
      throw error
    }

    const mentions = await searchWorkspaceMentions(context, 'match')
    expect(mentions.entries).toEqual([])
  })

  it('enforces mention query minimum and clamps the maximum limit to 50', async () => {
    const context = await createWorkspace()
    for (let index = 0; index < 55; index += 1) await writeFile(path.join(context.workspaceRoot, `match-${index}.txt`), 'x')
    await expect(searchWorkspaceMentions(context, 'm')).rejects.toMatchObject({ statusCode: 400 })
    expect((await searchWorkspaceMentions(context, 'match', { limit: 999 })).entries).toHaveLength(50)
  })
})

describe('workspace on-demand route wiring', () => {
  it('keeps children and search fallback behavior but rejects unknown projects for mention-search', async () => {
    const context = await createWorkspace()
    setDefaultWorkspaceRoot(context.workspaceRoot)
    await writeFile(path.join(context.workspaceRoot, 'route-match.txt'), 'route')

    const childrenRes = mockRes()
    await handleWorkspaceApi(
      { method: 'GET' },
      childrenRes,
      new URL('http://localhost/api/workspace/children?projectId=unknown&path=.&limit=1'),
    )
    expect(childrenRes.status).toBe(200)
    expect(childrenRes.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(childrenRes.body)).toMatchObject({
      path: '.',
      entries: [{ path: 'route-match.txt', type: 'file' }],
      nextCursor: null,
      truncated: false,
    })

    const searchRes = mockRes()
    await handleWorkspaceApi(
      { method: 'GET' },
      searchRes,
      new URL('http://localhost/api/workspace/search?projectId=unknown&query=route&limit=1'),
    )
    expect(searchRes.status).toBe(200)
    expect(JSON.parse(searchRes.body)).toMatchObject({
      query: 'route',
      entries: [{ path: 'route-match.txt', type: 'file' }],
      truncated: false,
    })

    await expect(handleWorkspaceApi(
      { method: 'GET' },
      mockRes(),
      new URL('http://localhost/api/workspace/mention-search?projectId=unknown&query=route&limit=1'),
    )).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'PROJECT_NOT_FOUND',
      message: 'Unknown project',
    })
  })

  it('surfaces real route validation errors to the shared error boundary', async () => {
    const context = await createWorkspace()
    setDefaultWorkspaceRoot(context.workspaceRoot)

    await expect(handleWorkspaceApi(
      { method: 'GET' },
      mockRes(),
      new URL('http://localhost/api/workspace/search?projectId=unknown&query=x'),
    )).rejects.toMatchObject({ statusCode: 400, message: 'query must contain at least 2 characters' })
  })
})

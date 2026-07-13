import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openWorkspaceExternalPath } from '../../../server/routes/workspace.mjs'

const tempDirs = []

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-open-external-'))
  tempDirs.push(workspaceRoot)
  return { workspaceRoot }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('workspace external open', () => {
  it('opens an existing file in VS Code', async () => {
    const context = await createWorkspace()
    await mkdir(path.join(context.workspaceRoot, 'src'))
    const file = path.join(context.workspaceRoot, 'src', 'example.ts')
    await writeFile(file, 'export const value = 1\n')
    const vscode = vi.fn().mockResolvedValue(undefined)

    const result = await openWorkspaceExternalPath(context, 'src/example.ts', 'vscode', { vscode })

    expect(vscode).toHaveBeenCalledWith(file)
    expect(result).toEqual({ ok: true, opened: 'file', target: 'vscode' })
  })

  it('opens the parent directory for a missing deleted file', async () => {
    const context = await createWorkspace()
    const directory = path.join(context.workspaceRoot, 'src')
    await mkdir(directory)
    const explorer = vi.fn().mockResolvedValue(undefined)

    const result = await openWorkspaceExternalPath(context, 'src/deleted.ts', 'explorer', { explorer })

    expect(explorer).toHaveBeenCalledWith(directory)
    expect(result).toEqual({ ok: true, opened: 'directory', target: 'explorer' })
  })

  it('rejects a missing file for an editor target', async () => {
    const context = await createWorkspace()
    await mkdir(path.join(context.workspaceRoot, 'src'))

    await expect(openWorkspaceExternalPath(context, 'src/deleted.ts', 'idea', { idea: vi.fn() }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects paths outside the workspace', async () => {
    const context = await createWorkspace()

    await expect(openWorkspaceExternalPath(context, '../outside.ts', 'explorer', { explorer: vi.fn() }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects an unsupported target', async () => {
    const context = await createWorkspace()

    await expect(openWorkspaceExternalPath(context, 'src/example.ts', 'terminal'))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

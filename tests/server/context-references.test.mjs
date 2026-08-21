import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  contextReferencesPrompt,
  validateContextReferences,
  validatePromptContextReferences,
  withCanonicalContextReferences,
} from '../../server/context-references.mjs'

const tempDirs = []

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'qf-context-references-'))
  tempDirs.push(workspaceRoot)
  return workspaceRoot
}

function projectSession(workspaceRoot, overrides = {}) {
  return {
    scope: 'project',
    projectId: 'project-1',
    harness: 'quickforge',
    projectContext: { workspaceRoot, project: { id: 'project-1', name: 'Project' } },
    ...overrides,
  }
}

async function createSymlink(target, linkPath, type = 'file') {
  try {
    await symlink(target, linkPath, process.platform === 'win32' && type === 'directory' ? 'junction' : type)
    return true
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') return false
    throw error
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('context references validation', () => {
  it('canonicalizes, deduplicates, preserves shape, and does not read file contents', async () => {
    const workspaceRoot = await createWorkspace()
    await mkdir(path.join(workspaceRoot, 'src'))
    const secretMarker = 'BODY-MUST-NOT-BE-READ'
    await writeFile(path.join(workspaceRoot, 'src', 'app.ts'), secretMarker)

    const canonical = await validateContextReferences([
      { type: 'file', projectId: 'project-1', path: 'src/app.ts', name: 'forged', extra: secretMarker },
      { type: 'file', projectId: 'project-1', path: 'src/app.ts' },
      { type: 'file', projectId: 'project-1', path: 'src/app.ts' },
    ], projectSession(workspaceRoot))

    expect(canonical).toEqual([{ type: 'file', projectId: 'project-1', path: 'src/app.ts', name: 'app.ts' }])
    expect(JSON.stringify(canonical)).not.toContain(secretMarker)
    expect(await readFile(path.join(workspaceRoot, 'src', 'app.ts'), 'utf8')).toBe(secretMarker)
  })

  it.each([
    ['invalid', 'CONTEXT_REFERENCES_INVALID'],
    [{}, 'CONTEXT_REFERENCES_INVALID'],
    [[{ type: 'directory', projectId: 'project-1', path: 'src' }], 'CONTEXT_REFERENCES_INVALID'],
    [[{ type: 'file', projectId: 'other', path: 'src/app.ts' }], 'CONTEXT_REFERENCE_PROJECT_MISMATCH'],
    [[{ type: 'file', projectId: 'project-1', path: '/etc/passwd' }], 'CONTEXT_REFERENCES_INVALID'],
    [[{ type: 'file', projectId: 'project-1', path: '../outside.txt' }], 'CONTEXT_REFERENCES_INVALID'],
    [[{ type: 'file', projectId: 'project-1', path: './src/app.ts' }], 'CONTEXT_REFERENCES_INVALID'],
    [[{ type: 'file', projectId: 'project-1', path: 'src/../app.ts' }], 'CONTEXT_REFERENCES_INVALID'],
    [[{ type: 'file', projectId: 'project-1', path: 'src//app.ts' }], 'CONTEXT_REFERENCES_INVALID'],
    [[{ type: 'file', projectId: 'project-1', path: 'src\napp.ts' }], 'CONTEXT_REFERENCES_INVALID'],
    [[{ type: 'file', projectId: 'project-1', path: 'src\\app.ts' }], 'CONTEXT_REFERENCES_INVALID'],
  ])('rejects invalid request shape %#', async (value, errorCode) => {
    const workspaceRoot = await createWorkspace()
    await expect(validateContextReferences(value, projectSession(workspaceRoot))).rejects.toMatchObject({ errorCode })
  })

  it('accepts missing or empty references and enforces the item limit', async () => {
    const workspaceRoot = await createWorkspace()
    expect(await validateContextReferences(undefined, projectSession(workspaceRoot))).toEqual([])
    expect(await validateContextReferences([], projectSession(workspaceRoot))).toEqual([])
    await expect(validateContextReferences(Array.from({ length: 9 }, () => ({ type: 'file', projectId: 'project-1', path: 'a.txt' })), projectSession(workspaceRoot)))
      .rejects.toMatchObject({ errorCode: 'CONTEXT_REFERENCES_LIMIT' })
  })

  it('requires a matching project conversation and a regular non-sensitive file', async () => {
    const workspaceRoot = await createWorkspace()
    await mkdir(path.join(workspaceRoot, 'folder'))
    await writeFile(path.join(workspaceRoot, '.ENV'), 'secret')

    await expect(validateContextReferences([{ type: 'file', projectId: 'project-1', path: 'folder' }], projectSession(workspaceRoot)))
      .rejects.toMatchObject({ errorCode: 'CONTEXT_REFERENCE_NOT_FILE' })
    await expect(validateContextReferences([{ type: 'file', projectId: 'project-1', path: '.ENV' }], projectSession(workspaceRoot)))
      .rejects.toMatchObject({ errorCode: 'CONTEXT_REFERENCE_SENSITIVE' })
    await expect(validateContextReferences([{ type: 'file', projectId: 'project-1', path: 'missing.ts' }], projectSession(workspaceRoot)))
      .rejects.toMatchObject({ errorCode: 'CONTEXT_REFERENCE_NOT_FOUND' })
    await expect(validateContextReferences([{ type: 'file', projectId: 'project-1', path: 'folder' }], projectSession(workspaceRoot, { scope: 'global', projectId: null })))
      .rejects.toMatchObject({ errorCode: 'CONTEXT_REFERENCES_PROJECT_REQUIRED' })
  })

  it('rejects external symlinks and internal symlinks whose real target is sensitive', async () => {
    const workspaceRoot = await createWorkspace()
    const outside = await createWorkspace()
    await writeFile(path.join(outside, 'outside.txt'), 'outside')
    await writeFile(path.join(workspaceRoot, '.env.secret'), 'secret')
    const externalSupported = await createSymlink(path.join(outside, 'outside.txt'), path.join(workspaceRoot, 'outside-link.txt'))
    const sensitiveSupported = await createSymlink(path.join(workspaceRoot, '.env.secret'), path.join(workspaceRoot, 'safe-name.txt'))

    if (externalSupported) {
      const validation = validateContextReferences([{ type: 'file', projectId: 'project-1', path: 'outside-link.txt' }], projectSession(workspaceRoot))
      await expect(validation).rejects.toMatchObject({ errorCode: 'CONTEXT_REFERENCE_OUTSIDE_PROJECT' })
      await expect(validation).rejects.not.toThrow(outside)
    }
    if (sensitiveSupported) {
      await expect(validateContextReferences([{ type: 'file', projectId: 'project-1', path: 'safe-name.txt' }], projectSession(workspaceRoot)))
        .rejects.toMatchObject({ errorCode: 'CONTEXT_REFERENCE_SENSITIVE' })
    }
  })

  it('rejects non-empty OpenCode references before filesystem validation', async () => {
    const workspaceRoot = await createWorkspace()
    await expect(validatePromptContextReferences([
      { type: 'file', projectId: 'project-1', path: 'missing.ts' },
    ], projectSession(workspaceRoot, { harness: 'opencode' }))).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'CONTEXT_REFERENCES_UNSUPPORTED_HARNESS',
    })
  })

  it('overwrites forged details and creates a path-only transient prompt', () => {
    const canonical = [{ type: 'file', projectId: 'project-1', path: 'src/app.ts', name: 'app.ts' }]
    const message = withCanonicalContextReferences({
      role: 'user',
      content: 'inspect',
      details: { contextReferences: [{ path: 'forged' }], keep: true },
    }, canonical)

    expect(message.details).toEqual({ contextReferences: canonical, keep: true })
    const prompt = contextReferencesPrompt(canonical)
    expect(prompt).toContain('- "src/app.ts"')
    expect(prompt).toContain('paths only')
    expect(prompt).toContain('read_file with the exact project-relative path')
    expect(prompt).not.toContain(path.resolve('src/app.ts'))
  })
})

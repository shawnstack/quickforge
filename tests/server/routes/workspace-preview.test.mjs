import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inspectWorkspacePreviewFile, workspacePreviewIssueFromError } from '../../../server/routes/workspace.mjs'

const tempDirs = []

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-preview-'))
  tempDirs.push(workspaceRoot)
  return { workspaceRoot }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('workspace preview inspection', () => {
  it('returns metadata for supported files', async () => {
    const context = await createWorkspace()
    const file = path.join(context.workspaceRoot, 'index.html')
    await writeFile(file, '<h1>QuickForge</h1>')

    const result = await inspectWorkspacePreviewFile(context, 'index.html')

    expect(result.file).toBe(file)
    expect(result.stat.size).toBeGreaterThan(0)
    expect(result.contentType).toBe('text/html; charset=utf-8')
  })

  it('keeps HTML subresources previewable', async () => {
    const context = await createWorkspace()
    await mkdir(path.join(context.workspaceRoot, 'assets'))
    await writeFile(path.join(context.workspaceRoot, 'assets', 'app.js'), 'console.log("ok")')

    await expect(inspectWorkspacePreviewFile(context, 'assets/app.js'))
      .resolves.toMatchObject({ contentType: 'application/javascript; charset=utf-8' })
  })

  it('rejects unsupported file types with a stable code', async () => {
    const context = await createWorkspace()
    await writeFile(path.join(context.workspaceRoot, 'document.pdf'), 'pdf')

    await expect(inspectWorkspacePreviewFile(context, 'document.pdf'))
      .rejects.toMatchObject({ statusCode: 415, previewCode: 'PREVIEW_UNSUPPORTED_TYPE' })
  })

  it('rejects oversized files with a stable code', async () => {
    const context = await createWorkspace()
    const file = path.join(context.workspaceRoot, 'large.html')
    await writeFile(file, '')
    await truncate(file, 50 * 1024 * 1024 + 1)

    await expect(inspectWorkspacePreviewFile(context, 'large.html'))
      .rejects.toMatchObject({ statusCode: 413, previewCode: 'PREVIEW_FILE_TOO_LARGE' })
  })

  it('maps missing files to a 404 issue while preserving the raw error', async () => {
    const context = await createWorkspace()

    try {
      await inspectWorkspacePreviewFile(context, 'missing.html')
      throw new Error('Expected preview inspection to fail')
    } catch (error) {
      const issue = workspacePreviewIssueFromError(error, 'missing.html')
      expect(issue).toMatchObject({
        status: 404,
        payload: {
          code: 'PREVIEW_FILE_NOT_FOUND',
          path: 'missing.html',
        },
      })
      expect(issue.payload.error).toContain('ENOENT')
    }
  })

  it('maps restricted paths to a permission issue', async () => {
    const context = await createWorkspace()
    await writeFile(path.join(context.workspaceRoot, '.env'), 'SECRET=hidden')

    try {
      await inspectWorkspacePreviewFile(context, '.env')
      throw new Error('Expected preview inspection to fail')
    } catch (error) {
      expect(workspacePreviewIssueFromError(error, '.env')).toMatchObject({
        status: 403,
        payload: { code: 'PREVIEW_PERMISSION_DENIED', path: '.env' },
      })
    }
  })

  it('maps malformed encoded paths to an invalid path issue', () => {
    const error = new URIError('URI malformed')

    expect(workspacePreviewIssueFromError(error)).toMatchObject({
      status: 400,
      payload: { code: 'PREVIEW_INVALID_PATH', error: 'URI malformed' },
    })
  })
})

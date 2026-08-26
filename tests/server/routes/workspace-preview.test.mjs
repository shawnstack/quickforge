import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildPreviewEtag, handleWorkspaceApi, inspectWorkspacePreviewFile, workspacePreviewIssueFromError } from '../../../server/routes/workspace.mjs'
import { getDefaultWorkspaceRoot, setDefaultWorkspaceRoot } from '../../../server/project-config.mjs'

const tempDirs = []
const originalDefaultWorkspaceRoot = getDefaultWorkspaceRoot()

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-preview-'))
  tempDirs.push(workspaceRoot)
  return { workspaceRoot }
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

async function requestPreview(relativePath, headers = {}, search = '') {
  const res = mockRes()
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/')
  await handleWorkspaceApi(
    { method: 'GET', headers },
    res,
    new URL(`http://localhost/api/workspace/preview/unknown/${encoded}${search}`),
  )
  return res
}

afterEach(async () => {
  setDefaultWorkspaceRoot(originalDefaultWorkspaceRoot)
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

  it('returns metadata and MIME types for supported document files', async () => {
    const context = await createWorkspace()
    const cases = [
      ['document.pdf', 'application/pdf'],
      ['document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['legacy.xls', 'application/vnd.ms-excel'],
      ['workbook.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ]
    for (const [name, contentType] of cases) {
      await writeFile(path.join(context.workspaceRoot, name), 'document')
      await expect(inspectWorkspacePreviewFile(context, name)).resolves.toMatchObject({ contentType })
    }
  })

  it('rejects unsupported file types with a stable code', async () => {
    const context = await createWorkspace()
    for (const name of ['document.doc', 'slides.ppt', 'slides.pptx', 'macro.xlsm']) {
      await writeFile(path.join(context.workspaceRoot, name), 'unsupported')
      await expect(inspectWorkspacePreviewFile(context, name))
        .rejects.toMatchObject({ statusCode: 415, previewCode: 'PREVIEW_UNSUPPORTED_TYPE' })
    }
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

describe('buildPreviewEtag', () => {
  it('builds a strong etag from stat mtimeMs and size', () => {
    expect(buildPreviewEtag({ mtimeMs: 1717171717171.123, size: 42 })).toBe('"1717171717171.123-42"')
    expect(buildPreviewEtag({ mtimeMs: 0, size: 0 })).toBe('"0-0"')
  })
})

describe('workspace preview HTTP caching', () => {
  it('serves a fresh 200 with an etag derived from the real stat', async () => {
    const context = await createWorkspace()
    setDefaultWorkspaceRoot(context.workspaceRoot)
    const content = '<h1>QuickForge</h1>'
    await writeFile(path.join(context.workspaceRoot, 'index.html'), content)
    const stats = await stat(path.join(context.workspaceRoot, 'index.html'))

    const res = await requestPreview('index.html')

    expect(res.status).toBe(200)
    expect(res.headers.etag).toBe(`"${stats.mtimeMs}-${stats.size}"`)
    expect(res.headers.etag).toBe(buildPreviewEtag(stats))
    expect(res.headers['content-length']).toBe(String(stats.size))
    expect(res.headers['cache-control']).toBe('private, no-cache')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(String(res.body)).toBe(content)
  })

  it('answers 304 with the same etag and an empty body on an exact match', async () => {
    const context = await createWorkspace()
    setDefaultWorkspaceRoot(context.workspaceRoot)
    await writeFile(path.join(context.workspaceRoot, 'index.html'), '<h1>v1</h1>')

    const first = await requestPreview('index.html')
    const second = await requestPreview('index.html', { 'if-none-match': first.headers.etag })

    expect(first.status).toBe(200)
    expect(second.status).toBe(304)
    expect(second.headers.etag).toBe(first.headers.etag)
    expect(second.headers['cache-control']).toBe('private, no-cache')
    expect(second.headers['x-content-type-options']).toBe('nosniff')
    expect(second.body).toBe('')
  })

  it('answers 304 for `*` and for a comma-separated etag list containing the current value', async () => {
    const context = await createWorkspace()
    setDefaultWorkspaceRoot(context.workspaceRoot)
    await writeFile(path.join(context.workspaceRoot, 'index.html'), '<h1>v1</h1>')

    const star = await requestPreview('index.html', { 'if-none-match': '*' })
    expect(star.status).toBe(304)
    expect(star.body).toBe('')

    const first = await requestPreview('index.html')
    const listed = await requestPreview('index.html', {
      'if-none-match': `"stale-etag", ${first.headers.etag}`,
    })
    expect(listed.status).toBe(304)
  })

  it('serves a new 200 with a new etag and body when the etag is stale', async () => {
    const context = await createWorkspace()
    setDefaultWorkspaceRoot(context.workspaceRoot)
    const filePath = path.join(context.workspaceRoot, 'index.html')
    await writeFile(filePath, 'v1')

    const first = await requestPreview('index.html')
    await writeFile(filePath, 'version-two-content')

    const second = await requestPreview('index.html', { 'if-none-match': first.headers.etag })
    const stats = await stat(filePath)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.headers.etag).toBe(`"${stats.mtimeMs}-${stats.size}"`)
    expect(second.headers.etag).not.toBe(first.headers.etag)
    expect(String(second.body)).toBe('version-two-content')
  })

  it('reports mtimeMs from the real stat in the preflight check payload', async () => {
    const context = await createWorkspace()
    setDefaultWorkspaceRoot(context.workspaceRoot)
    const filePath = path.join(context.workspaceRoot, 'index.html')
    await writeFile(filePath, 'preflight')

    const res = await requestPreview('index.html', {}, '?__quickforge_check=1')
    const stats = await stat(filePath)

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      path: 'index.html',
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      contentType: 'text/html; charset=utf-8',
    })
  })

  it('keeps error responses on no-store with stable statuses', async () => {
    const context = await createWorkspace()
    setDefaultWorkspaceRoot(context.workspaceRoot)
    await writeFile(path.join(context.workspaceRoot, '.env'), 'SECRET=hidden')
    await writeFile(path.join(context.workspaceRoot, 'slides.pptx'), 'pptx')

    const forbidden = await requestPreview('.env')
    expect(forbidden.status).toBe(403)
    expect(forbidden.headers['cache-control']).toBe('no-store')

    const missing = await requestPreview('missing.html')
    expect(missing.status).toBe(404)
    expect(missing.headers['cache-control']).toBe('no-store')

    const unsupported = await requestPreview('slides.pptx')
    expect(unsupported.status).toBe(415)
    expect(unsupported.headers['cache-control']).toBe('no-store')
  })
})

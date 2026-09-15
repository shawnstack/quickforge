import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { serveStatic } from '../../../server/routes/static.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..', '..', '..')
const androidApkPath = path.join(projectRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')

function mockResponse() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers = {}) {
      this.status = status
      this.headers = headers
    },
    end(body = null) {
      this.body = body
    },
  }
}

async function serve(pathname) {
  const response = mockResponse()
  await serveStatic({ method: 'GET' }, response, { pathname })
  return response
}

const encodedDotDotTraversal = ['..', '..', 'definitely-missing-qf-static-9f3a.json']
  .map((part, index) => (index < 2 ? encodeURIComponent(part) : part))
  .reduce((acc, part) => `${acc}/${part}`, '')
const winDriveTraversal = `/${['C:', 'Windows', 'win.ini'].join(path.win32.sep)}`
const posixBackslashTraversal = `/${encodeURIComponent(['..', '..', 'secret.txt'].join('\\'))}`
const mixedTraversal = `/${encodeURIComponent(['..', '..', 'C:\\Windows\\win.ini'].join('\\'))}`

describe('static route', () => {
  it('hints at the android build command when the debug apk is missing', { skip: existsSync(androidApkPath) }, async () => {
    const response = await serve('/downloads/quickforge-android.apk')
    expect(response.status).toBe(404)
    expect(response.body).toBe('Android APK not found. Run npm run android:build first.')
    expect(response.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('never serves files for encoded dot-dot traversal outside dist', async () => {
    const response = await serve(encodedDotDotTraversal)
    expect(response.status).not.toBe(200)
    expect([403, 404]).toContain(response.status)
    if (response.status === 404) expect(response.body).toBe('Static asset not found')
  })

  it('rejects windows drive-absolute traversal with 403', { skip: process.platform !== 'win32' }, async () => {
    const response = await serve(winDriveTraversal)
    expect(response.status).toBe(403)
    expect(response.body).toBe('Forbidden')
  })

  it('rejects backslash traversal samples with 403 on posix', { skip: process.platform === 'win32' }, async () => {
    const response = await serve(posixBackslashTraversal)
    expect(response.status).toBe(403)
    expect(response.body).toBe('Forbidden')
  })

  it('rejects traversal that targets a windows absolute path on every platform', async () => {
    const response = await serve(mixedTraversal)
    expect(response.status).toBe(403)
    expect(response.body).toBe('Forbidden')
  })

  it('returns 404 for missing assets without falling back to index.html', async () => {
    const response = await serve('/assets/definitely-missing-qf-static-9f3a.js')
    expect(response.status).toBe(404)
    expect(response.body).toBe('Static asset not found')
    expect(response.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('maps share asset paths onto the missing-assets 404 branch', async () => {
    const response = await serve('/share/demo-qf/assets/definitely-missing-qf-static-9f3a.png')
    expect(response.status).toBe(404)
    expect(response.body).toBe('Static asset not found')
  })
})

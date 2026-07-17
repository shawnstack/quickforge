import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDirs = []

function mockResponse() {
  return {
    status: null,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers || {}
    },
    end(body) {
      this.body = body
    },
  }
}

async function withTempModules(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-image-route-test-'))
  tempDirs.push(tmpDir)
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  vi.resetModules()
  try {
    const storage = await import('../../../server/storage.mjs')
    const assets = await import('../../../server/session-assets.mjs')
    const routes = await import('../../../server/routes/session-assets.mjs')
    await storage.ensureStorage()
    await testFn({ storage, assets, routes })
  } finally {
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    vi.resetModules()
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('session image asset route', () => {
  it('serves a stored image with safe response headers', async () => {
    await withTempModules(async ({ storage, assets, routes }) => {
      await storage.writeSessionValue('session-route', { id: 'session-route', scope: 'global' })
      const image = await assets.writeSessionAsset(
        { scope: 'global' },
        'session-route',
        { mimeType: 'image/png', data: Buffer.from('png bytes') },
      )
      const response = mockResponse()

      await routes.handleSessionAssetsApi(
        { method: 'GET' },
        response,
        new URL(`http://localhost/api/session-assets/session-route/${image.assetId}`),
      )

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('image/png')
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.body).toEqual(Buffer.from('png bytes'))
    })
  })

  it('deletes image assets when the session is permanently deleted', async () => {
    await withTempModules(async ({ storage, assets }) => {
      await storage.writeSessionValue('session-delete', { id: 'session-delete', scope: 'global' })
      const image = await assets.writeSessionAsset(
        { scope: 'global' },
        'session-delete',
        { mimeType: 'image/png', data: Buffer.from('png bytes') },
      )

      await storage.deleteSessionValue('session-delete')
      await expect(assets.readSessionAsset({ scope: 'global' }, 'session-delete', image.assetId))
        .rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})

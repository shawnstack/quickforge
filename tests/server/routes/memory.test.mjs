import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { handleMemoryApi } from '../../../server/routes/memory.mjs'

function mockRequest(method, body) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  request.method = method
  return request
}

function mockResponse() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    },
  }
}

describe('memory routes', () => {
  it('loads a document while memory is disabled', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-memory-route-'))
    try {
      await fs.writeFile(path.join(dataDir, 'MEMORY.md'), '# User memory\n\nUser is a developer.\n')
      const response = mockResponse()
      await handleMemoryApi(mockRequest('GET'), response, { dataDir, enabled: false })
      expect(response.status).toBe(200)
      expect(response.body.enabled).toBe(false)
      expect(response.body.markdown).toContain('User is a developer.')
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true })
    }
  })

  it('saves free-form Markdown without normalization', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-memory-route-'))
    try {
      const markdown = '# Preferences\n\nUse Chinese by default.\n\n> Keep this formatting.\n'
      const response = mockResponse()
      await handleMemoryApi(mockRequest('PUT', {
        markdown,
      }), response, { dataDir, enabled: true })
      expect(response.status).toBe(200)
      expect(response.body.chars).toBe(markdown.length)
      expect(response.body.markdown).toBe(markdown)
      await expect(fs.readFile(path.join(dataDir, 'MEMORY.md'), 'utf8')).resolves.toBe(markdown)
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true })
    }
  })

  it('rejects saving while memory is disabled', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-memory-route-'))
    try {
      await expect(handleMemoryApi(mockRequest('PUT', {
        markdown: '## Profile\n\n- User is a developer.\n',
      }), mockResponse(), { dataDir, enabled: false })).rejects.toMatchObject({ statusCode: 403 })
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true })
    }
  })
})

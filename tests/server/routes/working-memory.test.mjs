import { afterEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { handleWorkingMemoryApi } from '../../../server/routes/working-memory.mjs'
import { WORKING_MEMORY_DISPLAY_PATH, workingMemoryDir } from '../../../server/working-memory.mjs'

const tempDirs = []

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-working-memory-route-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

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

describe('working memory routes', () => {
  it('returns only the switch and the folder path', async () => {
    const response = mockResponse()
    await handleWorkingMemoryApi(mockRequest('GET'), response, {
      settings: { enabled: true, prompt: '内部提示词' },
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ enabled: true, path: WORKING_MEMORY_DISPLAY_PATH })
    expect(response.body.prompt).toBeUndefined()
    expect(response.body.defaultPrompt).toBeUndefined()
  })

  it('refuses to edit the note prompt from Settings', async () => {
    let writes = 0
    const response = mockResponse()
    await expect(handleWorkingMemoryApi(mockRequest('PUT', { prompt: '我自己改' }), response, {
      settings: { enabled: false, prompt: '内部提示词' },
      writeSettings: async () => { writes += 1 },
    })).rejects.toThrow('Working memory prompt is not editable from Settings.')
    expect(writes).toBe(0)
  })

  it('rejects a non-boolean switch', async () => {
    const response = mockResponse()
    await expect(handleWorkingMemoryApi(mockRequest('PUT', { enabled: 'yes' }), response, {
      settings: { enabled: false, prompt: '内部提示词' },
      writeSettings: async () => undefined,
    })).rejects.toThrow('enabled must be a boolean.')
  })

  it('saves the switch and creates the notes folder', async () => {
    const dataDir = await createTempDir()
    let written = null
    const response = mockResponse()
    await handleWorkingMemoryApi(mockRequest('PUT', { enabled: true }), response, {
      dataDir,
      settings: { enabled: false, prompt: '内部提示词' },
      writeSettings: async (next) => { written = next },
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ enabled: true, path: WORKING_MEMORY_DISPLAY_PATH })
    expect(written).toEqual({ enabled: true, prompt: '内部提示词' })
    await expect(fs.stat(workingMemoryDir({ dataDir }))).resolves.toBeDefined()
  })
})

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

  it('pages note titles newest-first without leaking note bodies', async () => {
    const dataDir = await createTempDir()
    await writeNote(dataDir, 'oldest.md', '# 最早的那篇\n', new Date('2024-01-01T00:00:00Z'))
    await writeNote(dataDir, 'middle.md', '# 中间那篇\n', new Date('2024-02-01T00:00:00Z'))
    await writeNote(dataDir, 'newest.md', '# 最新那篇\n', new Date('2024-03-01T00:00:00Z'))

    const first = mockResponse()
    await handleWorkingMemoryApi(mockRequest('GET'), first, {
      dataDir,
      url: new URL('http://localhost/api/working-memory/notes?page=1&pageSize=2'),
    })
    expect(first.status).toBe(200)
    expect(first.body.page).toBe(1)
    expect(first.body.pageSize).toBe(2)
    expect(first.body.total).toBe(3)
    expect(first.body.notes.map((note) => note.name)).toEqual(['newest.md', 'middle.md'])
    expect(first.body.notes[0].title).toBe('newest')
    expect(first.body.notes[0].content).toBeUndefined()

    const second = mockResponse()
    await handleWorkingMemoryApi(mockRequest('GET'), second, {
      dataDir,
      url: new URL('http://localhost/api/working-memory/notes?page=2&pageSize=2'),
    })
    expect(second.body.notes.map((note) => note.name)).toEqual(['oldest.md'])
  })

  it('clamps a bad page and page size instead of failing', async () => {
    const dataDir = await createTempDir()
    const response = mockResponse()
    await handleWorkingMemoryApi(mockRequest('GET'), response, {
      dataDir,
      url: new URL('http://localhost/api/working-memory/notes?page=-3&pageSize=1000'),
    })

    expect(response.status).toBe(200)
    expect(response.body.page).toBe(1)
    expect(response.body.pageSize).toBe(100)
    expect(response.body.notes).toEqual([])
    expect(response.body.total).toBe(0)
  })

  it('reveals a note in the file manager', async () => {
    const dataDir = await createTempDir()
    const file = await writeNote(dataDir, '构建要 9 秒.md', '# 构建要 9 秒\n')
    const opened = []
    const response = mockResponse()
    await handleWorkingMemoryApi(mockRequest('POST', { name: '构建要 9 秒.md' }), response, {
      dataDir,
      url: new URL('http://localhost/api/working-memory/notes/open'),
      openPath: async (target) => { opened.push(target) },
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, name: '构建要 9 秒.md' })
    expect(opened).toEqual([file])
  })

  it('refuses to open a note that does not exist', async () => {
    const dataDir = await createTempDir()
    let opened = 0
    const response = mockResponse()
    await expect(handleWorkingMemoryApi(mockRequest('POST', { name: '不存在的笔记' }), response, {
      dataDir,
      url: new URL('http://localhost/api/working-memory/notes/open'),
      openPath: async () => { opened += 1 },
    })).rejects.toThrow('does not exist')
    expect(opened).toBe(0)
  })

  it('rejects a note name that escapes the folder', async () => {
    const dataDir = await createTempDir()
    const response = mockResponse()
    await expect(handleWorkingMemoryApi(mockRequest('POST', { name: '../MEMORY.md' }), response, {
      dataDir,
      url: new URL('http://localhost/api/working-memory/notes/open'),
      openPath: async () => undefined,
    })).rejects.toThrow('cannot contain')
  })

  it('404s on an unknown working memory sub-path', async () => {
    const response = mockResponse()
    await expect(handleWorkingMemoryApi(mockRequest('GET'), response, {
      url: new URL('http://localhost/api/working-memory/unknown'),
    })).rejects.toThrow('Not found')
  })
})

async function writeNote(dataDir, name, content, modifiedAt) {
  const dir = workingMemoryDir({ dataDir })
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await fs.writeFile(file, content, 'utf8')
  if (modifiedAt) await fs.utimes(file, modifiedAt, modifiedAt)
  return file
}

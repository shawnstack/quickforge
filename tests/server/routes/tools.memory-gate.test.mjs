import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let tmpDir
let previousDataDir

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-tools-memory-gate-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
  vi.resetModules()
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
})

function request(body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  req.headers = {}
  return req
}

function response() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status },
    end(body = '') { this.body = body },
  }
}

describe('tools route working memory gate', () => {
  it('rejects direct note-tool calls while working memory is disabled', async () => {
    const { handleToolApi } = await import('../../../server/routes/tools.mjs')
    const { saveWorkingMemorySettings } = await import('../../../server/working-memory.mjs')
    await saveWorkingMemorySettings({ enabled: false })

    for (const toolName of ['list_memory_notes', 'read_memory_note', 'write_memory_note', 'move_memory_note']) {
      await expect(handleToolApi(
        request(),
        response(),
        new URL(`http://quickforge.local/api/tools/${toolName}`),
      )).rejects.toMatchObject({
        message: `Working memory is disabled: ${toolName} is unavailable`,
        statusCode: 403,
      })
    }
  })

  it('still serves read-only note tools when working memory is enabled', async () => {
    const { handleToolApi } = await import('../../../server/routes/tools.mjs')
    const { saveWorkingMemorySettings } = await import('../../../server/working-memory.mjs')
    await saveWorkingMemorySettings({ enabled: true })

    const res = response()
    await handleToolApi(request({ scope: 'working' }), res, new URL('http://quickforge.local/api/tools/list_memory_notes'))

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).details).toMatchObject({ scope: 'working', count: 0, notes: [] })
  })
})

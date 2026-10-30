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

/**
 * 只读会话视图端点（`GET /api/sessions/:id/view`）的契约。
 *
 * 这个端点的存在理由就是「不重建 agent 运行时」，所以每个用例都显式断言
 * `restoreAgent` / `createAgent` **没有被调用**——如果哪天有人给它加了一条
 * fallback，这里必须先红。
 */
async function withTempModules(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-session-view-test-'))
  tempDirs.push(tmpDir)
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  vi.resetModules()
  const database = await import('../../../server/sqlite/database.mjs')
  try {
    await database.closeSqliteStorage().catch(() => {})
    await database.initializeSqliteStorage()
    const storage = await import('../../../server/storage.mjs')
    await storage.ensureStorage()
    // The route reads the in-memory session first; with no restore it must miss.
    const agentManager = await import('../../../server/agent-manager.mjs')
    const routes = await import('../../../server/routes/session-view.mjs')
    await testFn({ storage, agentManager, routes })
  } finally {
    await database.closeSqliteStorage().catch(() => {})
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    vi.resetModules()
  }
}

async function writeSession(storage, sessionId, state) {
  await storage.writeSessionValue(sessionId, {
    scope: 'global',
    projectId: null,
    title: 'View contract',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-01T00:00:01.000Z',
    model: { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o' },
    thinkingLevel: 'off',
    accessMode: 'default',
    ...state,
  })
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('GET /api/sessions/:sessionId/view', () => {
  it('returns persisted messages without restoring an agent runtime', async () => {
    await withTempModules(async ({ storage, agentManager, routes }) => {
      const restore = vi.spyOn(agentManager, 'restoreAgent')
      const messages = [
        { role: 'user', content: 'hello', timestamp: 1 },
        { role: 'assistant', content: 'hi', timestamp: 2 },
      ]
      await writeSession(storage, 'view-session', { messages })

      const res = mockResponse()
      await routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        res,
        new URL('http://localhost/api/sessions/view-session/view'),
      )

      expect(res.status).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.sessionId).toBe('view-session')
      expect(body.title).toBe('View contract')
      expect(body.messages).toHaveLength(2)
      expect(body.messages[0].content).toBe('hello')
      expect(body.readonly).toBe(true)
      // 关键断言：读路径没有触碰运行时。
      expect(restore).not.toHaveBeenCalled()
    })
  })

  it('keeps the response shape aligned with the live session state', async () => {
    await withTempModules(async ({ storage, routes }) => {
      await writeSession(storage, 'shape-session', {
        messages: [{ role: 'user', content: 'x', timestamp: 1 }],
      })

      const res = mockResponse()
      await routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        res,
        new URL('http://localhost/api/sessions/shape-session/view'),
      )

      const body = JSON.parse(res.body)
      // 渲染层直接消费这些字段；缺任何一个都会让历史消息渲染退化。
      for (const field of [
        'sessionId', 'scope', 'projectId', 'accessMode', 'yoloMode', 'model',
        'thinkingLevel', 'title', 'createdAt', 'lastModified', 'stateVersion',
        'messages', 'tools', 'pendingToolCalls', 'contextCompaction', 'goal',
      ]) {
        expect(body).toHaveProperty(field)
      }
      expect(Array.isArray(body.messages)).toBe(true)
      expect(Array.isArray(body.tools)).toBe(true)
      expect(Array.isArray(body.pendingToolCalls)).toBe(true)
      // 系统提示词不参与历史渲染，只读视图不回传（避免大字段空转）。
      expect(body.systemPrompt).toBe('')
    })
  })

  it('returns a tail window instead of the whole transcript', async () => {
    await withTempModules(async ({ storage, routes }) => {
      const messages = Array.from({ length: 30 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `m${index}`,
        timestamp: index,
      }))
      await writeSession(storage, 'tail-session', { messages })

      const res = mockResponse()
      await routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        res,
        new URL('http://localhost/api/sessions/tail-session/view?tail=10'),
      )

      const body = JSON.parse(res.body)
      expect(body.messages).toHaveLength(10)
      // The window is the TAIL, not the head: the surface opens at the bottom.
      expect(body.messages[0].content).toBe('m20')
      expect(body.messages[9].content).toBe('m29')
      // The total count tells the client how much history exists behind it.
      expect(body.messagesSummary).toEqual({ count: 30, logVersion: 0 })
      // 窗口起点是绝对 seq：客户端据此对齐下标，不需要用本地长度反推。
      expect(body.messagesAfter).toBe(20)
    })
  })

  it('omits messagesSummary when the whole conversation fits the window', async () => {
    await withTempModules(async ({ storage, routes }) => {
      await writeSession(storage, 'short-session', {
        messages: [
          { role: 'user', content: 'only q', timestamp: 1 },
          { role: 'assistant', content: 'only a', timestamp: 2 },
        ],
      })

      const res = mockResponse()
      await routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        res,
        new URL('http://localhost/api/sessions/short-session/view'),
      )

      const body = JSON.parse(res.body)
      expect(body.messages).toHaveLength(2)
      // No truncation happened, so the client must not think older history exists.
      expect(body.messagesSummary).toBeUndefined()
    })
  })

  it('serves an ACTIVE session through the same tail window', async () => {
    // The memory-hit branch used to return `getSessionState` wholesale, which
    // carries the full message list. On a 1200-message live session that meant a
    // ~9MB response and every row rendered before the first paint — the read-only
    // endpoint then provided no benefit exactly where it mattered most.
    await withTempModules(async ({ agentManager, routes }) => {
      const messages = Array.from({ length: 300 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `live-${index}`,
        timestamp: index,
      }))
      vi.spyOn(agentManager, 'getSessionState').mockReturnValue({
        sessionId: 'live-session',
        title: 'Live',
        stateVersion: 9,
        messages,
        tools: [{ name: 'read_file' }],
        isStreaming: false,
        pendingToolApprovals: [],
      })

      const res = mockResponse()
      await routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        res,
        new URL('http://localhost/api/sessions/live-session/view?tail=50'),
      )

      const body = JSON.parse(res.body)
      expect(body.messages).toHaveLength(50)
      // The window is the TAIL, not the head.
      expect(body.messages[49].content).toBe('live-299')
      expect(body.messagesSummary).toEqual({ count: 300, logVersion: 0 })
      expect(body.messagesAfter).toBe(250)
      // Runtime-only fields survive: a live session knows things storage does not.
      expect(body.tools).toEqual([{ name: 'read_file' }])
    })
  })

  it('returns an active session unchanged when it fits the window', async () => {
    await withTempModules(async ({ agentManager, routes }) => {
      vi.spyOn(agentManager, 'getSessionState').mockReturnValue({
        sessionId: 'small-live',
        title: 'Small',
        stateVersion: 1,
        messages: [{ role: 'user', content: 'only', timestamp: 1 }],
        tools: [],
        isStreaming: false,
      })

      const res = mockResponse()
      await routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        res,
        new URL('http://localhost/api/sessions/small-live/view'),
      )

      const body = JSON.parse(res.body)
      expect(body.messages).toHaveLength(1)
      expect(body.messagesSummary).toBeUndefined()
    })
  })

  it('reports 404 for an unknown session instead of create-on-read', async () => {
    await withTempModules(async ({ agentManager, routes }) => {
      const restore = vi.spyOn(agentManager, 'restoreAgent')
      const res = mockResponse()

      await expect(routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        res,
        new URL('http://localhost/api/sessions/missing-session/view'),
      )).rejects.toMatchObject({ statusCode: 404 })

      expect(restore).not.toHaveBeenCalled()
    })
  })

  it('rejects non-GET methods', async () => {
    await withTempModules(async ({ routes }) => {
      await expect(routes.handleSessionViewApi(
        { method: 'POST', headers: {} },
        mockResponse(),
        new URL('http://localhost/api/sessions/any/view'),
      )).rejects.toMatchObject({ statusCode: 405 })
    })
  })

  it('rejects an unknown action suffix', async () => {
    await withTempModules(async ({ routes }) => {
      await expect(routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        mockResponse(),
        new URL('http://localhost/api/sessions/any/other'),
      )).rejects.toMatchObject({ statusCode: 404 })

      // No action segment at all.
      await expect(routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        mockResponse(),
        new URL('http://localhost/api/sessions/any'),
      )).rejects.toMatchObject({ statusCode: 404 })
    })
  })
})

describe('GET /api/sessions/:sessionId/attachments/:attachmentId', () => {
  const attachment = {
    id: 'image.png_1_0.5',
    type: 'image',
    fileName: 'pixel.png',
    mimeType: 'image/png',
    size: 3,
    content: Buffer.from([1, 2, 3]).toString('base64'),
    preview: 'AQID',
  }

  async function writeAttachmentSession(storage, sessionId) {
    await writeSession(storage, sessionId, {
      messages: [
        { role: 'user-with-attachments', content: 'see image', attachments: [attachment] },
      ],
    })
  }

  it('projects the view to an asset URL and serves the stored bytes', async () => {
    await withTempModules(async ({ storage, routes }) => {
      await writeAttachmentSession(storage, 'attachment-session')

      const viewRes = mockResponse()
      await routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        viewRes,
        new URL('http://localhost/api/sessions/attachment-session/view'),
      )
      const view = JSON.parse(viewRes.body)
      expect(view.messages[0].attachments[0]).toMatchObject({
        id: attachment.id,
        assetUrl: `/api/sessions/attachment-session/attachments/${attachment.id}`,
      })
      expect(view.messages[0].attachments[0]).not.toHaveProperty('content')

      const rawRes = mockResponse()
      const rawUrl = new URL(`http://localhost/api/sessions/attachment-session/attachments/${attachment.id}?raw=1`)
      await routes.handleSessionViewApi(
        { method: 'GET', headers: {}, url: rawUrl.pathname + rawUrl.search },
        rawRes,
        rawUrl,
      )
      expect(rawRes.status).toBe(200)
      expect(rawRes.headers['content-type']).toBe('image/png')
      expect(Buffer.from(rawRes.body).toString('base64')).toBe(attachment.content)

      const jsonRes = mockResponse()
      await routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        jsonRes,
        new URL(`http://localhost/api/sessions/attachment-session/attachments/${attachment.id}`),
      )
      expect(JSON.parse(jsonRes.body).content).toBe(attachment.content)
    })
  })

  it('returns 404 for unknown attachments', async () => {
    await withTempModules(async ({ storage, routes }) => {
      await writeAttachmentSession(storage, 'attachment-session')
      await expect(routes.handleSessionViewApi(
        { method: 'GET', headers: {} },
        mockResponse(),
        new URL('http://localhost/api/sessions/attachment-session/attachments/missing-id'),
      )).rejects.toMatchObject({ statusCode: 404 })
    })
  })
})

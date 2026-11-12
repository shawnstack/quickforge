import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// open-in-explorer 会真的弹出系统窗口：这里把平台动作换成 spy，只验路由与本机边界。
vi.mock('../../../server/utils/platform.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    openPathInFileManager: vi.fn(),
    openPathInVSCode: vi.fn(),
    openPathInIDEA: vi.fn(),
  }
})

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

function mockRequest(method, body) {
  if (body === undefined) return { method }
  return {
    method,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body))
    },
  }
}

async function callBots(method, url, body) {
  const { handleBotsApi } = await import('../../../server/routes/bots.mjs')
  const res = mockResponse()
  await handleBotsApi(mockRequest(method, body), res, new URL(url))
  return res
}

async function callBotsWithContext(method, url, body, context) {
  const { handleBotsApi } = await import('../../../server/routes/bots.mjs')
  const res = mockResponse()
  await handleBotsApi(mockRequest(method, body), res, new URL(url), context)
  return res
}

async function expectRejection(promise, statusCode) {
  await expect(promise).rejects.toMatchObject({ statusCode })
}

describe('bots API', () => {
  let tmpDir
  let previousDataDir
  let previousHome
  let previousUserProfile

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-bots-route-'))
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    previousHome = process.env.HOME
    previousUserProfile = process.env.USERPROFILE
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    process.env.HOME = tmpDir
    process.env.USERPROFILE = tmpDir
    vi.resetModules()
  })

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
    vi.resetModules()
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates a bot with its own folder, memory file and project registration', async () => {
    const res = await callBots('POST', 'http://localhost/api/bots', { name: '小助手' })

    expect(res.status).toBe(201)
    const bot = res.body.bot
    expect(bot.name).toBe('小助手')
    expect(bot.heartbeat.enabled).toBe(true)
    expect(bot.heartbeat.intervalMinutes).toBe(15)
    expect(bot.heartbeat.nextRunAt).toEqual(expect.any(String))
    expect(bot).not.toHaveProperty('skills')
    // 目录名由 id 派生，与显示名无关：名字可以是中文，路径里不会出现它
    expect(bot.workspacePath.endsWith(path.join('bots', `bot-${bot.id.replace(/-/g, '').slice(0, 8)}`))).toBe(true)
    expect(bot.workspacePath).not.toContain('小助手')

    // 目录和记忆文件都真实存在
    await expect(access(bot.workspacePath)).resolves.toBeUndefined()
    const memory = await readFile(path.join(bot.workspacePath, 'MEMORY.md'), 'utf8')
    expect(memory).toContain('小助手')

    // 目录被注册成一个 kind: 'bot' 的项目，工具才能落在它里面
    const { readProjectConfig } = await import('../../../server/project-config.mjs')
    const config = await readProjectConfig()
    const project = config.projects.find((item) => item.id === bot.projectId)
    expect(project).toMatchObject({ kind: 'bot', name: '小助手' })
    expect(path.resolve(project.path)).toBe(path.resolve(bot.workspacePath))
  })

  it('lists bots and reports heartbeat state', async () => {
    await callBots('POST', 'http://localhost/api/bots', { name: 'one' })
    const res = await callBots('GET', 'http://localhost/api/bots')
    expect(res.status).toBe(200)
    expect(res.body.bots).toHaveLength(1)
    expect(res.body.bots[0].name).toBe('one')
    expect(res.body.bots[0]).toHaveProperty('busy')
  })

  it('rejects a duplicate name and an unusable name', async () => {
    await callBots('POST', 'http://localhost/api/bots', { name: 'twin' })
    await expectRejection(callBots('POST', 'http://localhost/api/bots', { name: 'twin' }), 409)
    await expectRejection(callBots('POST', 'http://localhost/api/bots', { name: 'a/b' }), 400)
  })

  it('reads and writes the bot memory file', async () => {
    const created = await callBots('POST', 'http://localhost/api/bots', { name: 'writer' })
    const botId = created.body.bot.id

    const before = await callBots('GET', `http://localhost/api/bots/${encodeURIComponent(botId)}/memory`)
    expect(before.status).toBe(200)
    expect(before.body.content).toContain('writer')

    const saved = await callBots(
      'PUT',
      `http://localhost/api/bots/${encodeURIComponent(botId)}/memory`,
      { content: '# rewritten\n' },
    )
    expect(saved.status).toBe(200)

    const after = await callBots('GET', `http://localhost/api/bots/${encodeURIComponent(botId)}/memory`)
    expect(after.body.content).toBe('# rewritten\n')
  })

  it('recomputes the next heartbeat when the interval changes, and clears it when disabled', async () => {
    const created = await callBots('POST', 'http://localhost/api/bots', { name: 'pacer' })
    const botId = created.body.bot.id

    const faster = await callBots(
      'PATCH',
      `http://localhost/api/bots/${encodeURIComponent(botId)}`,
      { heartbeat: { intervalMinutes: 15 } },
    )
    expect(faster.body.bot.heartbeat.intervalMinutes).toBe(15)
    expect(faster.body.bot.heartbeat.nextRunAt).toEqual(expect.any(String))

    const paused = await callBots(
      'PATCH',
      `http://localhost/api/bots/${encodeURIComponent(botId)}`,
      { heartbeat: { enabled: false } },
    )
    expect(paused.body.bot.heartbeat.enabled).toBe(false)
    expect(paused.body.bot.heartbeat.nextRunAt).toBeNull()
  })

  it('reorders bots: persists sortOrder, keeps it across patches, rejects bad bodies', async () => {
    const a = (await callBots('POST', 'http://localhost/api/bots', { name: 'alpha' })).body.bot
    const b = (await callBots('POST', 'http://localhost/api/bots', { name: 'bravo' })).body.bot
    const c = (await callBots('POST', 'http://localhost/api/bots', { name: 'charlie' })).body.bot

    // 初始顺序 = 创建顺序
    const initial = await callBots('GET', 'http://localhost/api/bots')
    expect(initial.body.bots.map((bot) => bot.name)).toEqual(['alpha', 'bravo', 'charlie'])

    const reordered = await callBots('PUT', 'http://localhost/api/bots/reorder', {
      orderedIds: [c.id, a.id, b.id],
    })
    expect(reordered.status).toBe(200)
    expect(reordered.body.bots.map((bot) => bot.name)).toEqual(['charlie', 'alpha', 'bravo'])
    expect(reordered.body.bots.map((bot) => bot.sortOrder)).toEqual([0, 1, 2])

    // 顺序落在服务端，重新拉列表不再依赖创建时间
    const again = await callBots('GET', 'http://localhost/api/bots')
    expect(again.body.bots.map((bot) => bot.name)).toEqual(['charlie', 'alpha', 'bravo'])

    // 后续 PATCH（心跳等）不能把排序位弄丢
    await callBots('PATCH', `http://localhost/api/bots/${encodeURIComponent(c.id)}`, {
      heartbeat: { enabled: false },
    })
    const afterPatch = await callBots('GET', 'http://localhost/api/bots')
    expect(afterPatch.body.bots.map((bot) => bot.name)).toEqual(['charlie', 'alpha', 'bravo'])

    // 只给一部分 id：没提到的按原相对顺序追在后面；不认识的 id 忽略；非法 body 400
    const partial = await callBots('PUT', 'http://localhost/api/bots/reorder', {
      orderedIds: ['not-a-bot', b.id],
    })
    expect(partial.body.bots.map((bot) => bot.name)).toEqual(['bravo', 'alpha', 'charlie'])
    await expectRejection(callBots('PUT', 'http://localhost/api/bots/reorder', {}), 400)
    await expectRejection(
      callBots('PUT', 'http://localhost/api/bots/reorder', { orderedIds: 'nope' }),
      400,
    )
  })

  it('renames a bot, syncs the project registration, and still rejects duplicates', async () => {
    const created = await callBots('POST', 'http://localhost/api/bots', { name: 'before' })
    const botId = created.body.bot.id

    const renamed = await callBots(
      'PATCH',
      `http://localhost/api/bots/${encodeURIComponent(botId)}`,
      { name: 'after' },
    )
    expect(renamed.status).toBe(200)
    expect(renamed.body.bot.name).toBe('after')

    // projects.json 里 kind:'bot' 项目的显示名跟着改（改名不能只改 bots 存储）
    const { readProjectConfig } = await import('../../../server/project-config.mjs')
    const config = await readProjectConfig()
    const project = config.projects.find((item) => item.id === renamed.body.bot.projectId)
    expect(project?.name).toBe('after')

    // 重名依旧拒绝（409 BOT_NAME_TAKEN）
    await callBots('POST', 'http://localhost/api/bots', { name: 'other' })
    await expectRejection(
      callBots(
        'PATCH',
        `http://localhost/api/bots/${encodeURIComponent(botId)}`,
        { name: 'other' },
      ),
      409,
    )
  })

  it('deletes the bot and its project registration but keeps the folder', async () => {
    const created = await callBots('POST', 'http://localhost/api/bots', { name: 'gone' })
    const bot = created.body.bot

    const deleted = await callBots('DELETE', `http://localhost/api/bots/${encodeURIComponent(bot.id)}`)
    expect(deleted.status).toBe(200)

    const list = await callBots('GET', 'http://localhost/api/bots')
    expect(list.body.bots).toHaveLength(0)

    const { readProjectConfig } = await import('../../../server/project-config.mjs')
    const config = await readProjectConfig()
    expect(config.projects.some((item) => item.id === bot.projectId)).toBe(false)

    // 目录留下来，不删用户的文件
    await expect(access(bot.workspacePath)).resolves.toBeUndefined()
  })

  it('feeds the inbox: appends text, pulls nextRunAt forward only when enabled', async () => {
    const created = await callBots('POST', 'http://localhost/api/bots', { name: 'feeder' })
    const bot = created.body.bot

    // 先把节拍推远，投喂后应被拉回到当前时间附近（下一轮扫描即醒）。
    await callBots(
      'PATCH',
      `http://localhost/api/bots/${encodeURIComponent(bot.id)}`,
      { heartbeat: { intervalMinutes: 60 } },
    )
    const fed = await callBots(
      'POST',
      `http://localhost/api/bots/${encodeURIComponent(bot.id)}/inbox`,
      { text: '帮我看一下 demo 分支为什么挂了' },
    )
    expect(fed.status).toBe(200)
    expect(fed.body.ok).toBe(true)
    const inbox = await readFile(`${bot.workspacePath}/.bot/inbox.md`, 'utf8')
    expect(inbox).toContain('帮我看一下 demo 分支为什么挂了')

    const after = await callBots('GET', `http://localhost/api/bots/${encodeURIComponent(bot.id)}`)
    const nextRunAt = Date.parse(after.body.bot.heartbeat.nextRunAt)
    expect(Number.isFinite(nextRunAt)).toBe(true)
    expect(nextRunAt - Date.now()).toBeLessThan(5 * 60 * 1000)

    // 空文本拒绝；心跳关着时只落盘、不动节拍。
    await expectRejection(
      callBots('POST', `http://localhost/api/bots/${encodeURIComponent(bot.id)}/inbox`, { text: '   ' }),
      400,
    )
    await callBots(
      'PATCH',
      `http://localhost/api/bots/${encodeURIComponent(bot.id)}`,
      { heartbeat: { enabled: false } },
    )
    const stillFed = await callBots(
      'POST',
      `http://localhost/api/bots/${encodeURIComponent(bot.id)}/inbox`,
      { text: '第二条投喂' },
    )
    expect(stillFed.status).toBe(200)
    const paused = await callBots('GET', `http://localhost/api/bots/${encodeURIComponent(bot.id)}`)
    expect(paused.body.bot.heartbeat.nextRunAt).toBeNull()
    const inboxAgain = await readFile(`${bot.workspacePath}/.bot/inbox.md`, 'utf8')
    expect(inboxAgain).toContain('第二条投喂')
  })

  it('ensures the bot session before opening it', async () => {
    const created = await callBots('POST', 'http://localhost/api/bots', { name: 'opener' })
    const bot = created.body.bot

    const first = await callBots('POST', `http://localhost/api/bots/${encodeURIComponent(bot.id)}/session`, {})
    expect(first.status).toBe(200)
    expect(first.body.sessionId).toBe(bot.sessionId)

    // 再要一次必须还是同一条 —— 「一个 bot 只有一条会话」靠的就是这个不变性。
    const second = await callBots('POST', `http://localhost/api/bots/${encodeURIComponent(bot.id)}/session`, {})
    expect(second.body.sessionId).toBe(bot.sessionId)
  })

  it('404s an unknown bot', async () => {
    await expectRejection(callBots('GET', 'http://localhost/api/bots/nope'), 404)
  })

  it('opens the bot folder in the file manager for local callers only', async () => {
    const created = await callBots('POST', 'http://localhost/api/bots', { name: 'open-dir' })
    const bot = created.body.bot
    const { openPathInFileManager } = await import('../../../server/utils/platform.mjs')

    const local = await callBotsWithContext(
      'POST',
      `http://localhost/api/bots/${encodeURIComponent(bot.id)}/open-in-explorer`,
      undefined,
      { isLocalRequest: true },
    )
    expect(local.status).toBe(200)
    expect(local.body).toEqual({ ok: true, path: bot.workspacePath })
    expect(openPathInFileManager).toHaveBeenCalledWith(bot.workspacePath)

    // 远端（局域网客户端）不能把窗口开到主人桌面上：403，且平台动作不被触发。
    openPathInFileManager.mockClear()
    await expectRejection(
      callBotsWithContext(
        'POST',
        `http://localhost/api/bots/${encodeURIComponent(bot.id)}/open-in-explorer`,
        undefined,
        { isLocalRequest: false },
      ),
      403,
    )
    expect(openPathInFileManager).not.toHaveBeenCalled()
  })
})

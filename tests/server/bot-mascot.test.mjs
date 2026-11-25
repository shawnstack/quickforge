import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { DEFAULT_MASCOT, normalizeBotRecord, normalizeMascot } from '../../server/bots.mjs'

/**
 * 吉祥物外观是 bot 记录里唯一一个「嵌套 + 颜色」字段，
 * 最容易踩的坑是：只在一处白名单加了字段，保存成功但前端读不到。
 * 这里分别盯「归一化」和「接口返回」两头。
 */

describe('normalizeMascot', () => {
  it('defaults to ink colours with motion and composer display on', () => {
    expect(normalizeMascot(undefined)).toEqual(DEFAULT_MASCOT)
    expect(normalizeMascot({})).toEqual({ body: '#0B0B0C', eye: '#FFFFFF', animated: true, showOnComposer: true })
  })

  it('uppercases hex colours so the UI and the record agree', () => {
    expect(normalizeMascot({ body: '#ef8a3c', eye: '#ffffff' })).toMatchObject({
      body: '#EF8A3C',
      eye: '#FFFFFF',
    })
  })

  it('merges a partial patch with the previous value', () => {
    const previous = { body: '#EF8A3C', eye: '#FFFFFF', animated: true, showOnComposer: true }
    expect(normalizeMascot({ eye: '#101010' }, previous)).toEqual({
      body: '#EF8A3C',
      eye: '#101010',
      animated: true,
      showOnComposer: true,
    })
  })

  it('falls back to the previous colour instead of accepting junk', () => {
    const previous = { body: '#57C2A6', eye: '#FFFFFF', animated: true, showOnComposer: true }
    expect(normalizeMascot({ body: 'red' }, previous).body).toBe('#57C2A6')
    expect(normalizeMascot({ body: '#GGGGGG' }, previous).body).toBe('#57C2A6')
    expect(normalizeMascot({ eye: '#fff' }, previous).eye).toBe('#FFFFFF')
  })

  it('treats only an explicit true as animated', () => {
    expect(normalizeMascot({ animated: false }).animated).toBe(false)
    expect(normalizeMascot({ animated: 'yes' }).animated).toBe(false)
    expect(normalizeMascot({ animated: false }, { ...DEFAULT_MASCOT, animated: false }).animated).toBe(false)
    expect(normalizeMascot({}, { ...DEFAULT_MASCOT, animated: false }).animated).toBe(false)
  })

  it('treats the composer switch like the animation switch', () => {
    expect(normalizeMascot({ showOnComposer: false }).showOnComposer).toBe(false)
    expect(normalizeMascot({ showOnComposer: 'yes' }).showOnComposer).toBe(false)
    // 只改颜色/动画时不得把显示开关重置回默认。
    expect(normalizeMascot({ body: '#EF8A3C' }, { ...DEFAULT_MASCOT, showOnComposer: false }).showOnComposer).toBe(false)
    // 存量记录没有这个字段（老进程写出来的），回落到默认显示。
    expect(normalizeMascot({}, { body: '#101010', eye: '#F5F5F5', animated: true }).showOnComposer).toBe(true)
  })
})

describe('normalizeBotRecord keeps the mascot on the record', () => {
  it('adds the default mascot to a new bot', () => {
    const record = normalizeBotRecord({ name: 'helper' })
    expect(record.mascot).toEqual(DEFAULT_MASCOT)
  })

  it('keeps existing colours when a patch only touches the heartbeat', () => {
    const created = normalizeBotRecord({ name: 'helper', mascot: { body: '#6C4AB6' } })
    const patched = normalizeBotRecord({ ...created, heartbeat: { enabled: false } }, created)
    expect(patched.mascot.body).toBe('#6C4AB6')
    expect(patched.mascot.eye).toBe('#FFFFFF')
  })
})

describe('bots API exposes the mascot', () => {
  let tmpDir
  let previousDataDir
  let previousHome
  let previousUserProfile
  let databaseModule

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-bot-mascot-'))
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    previousHome = process.env.HOME
    previousUserProfile = process.env.USERPROFILE
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    process.env.HOME = tmpDir
    process.env.USERPROFILE = tmpDir
    vi.resetModules()
    // 列表接口会为未加载的会话回退读 SQLite 元数据；正式启动由 server/index.mjs 初始化。
    databaseModule = await import('../../server/sqlite/database.mjs')
    await databaseModule.initializeSqliteStorage()
  })

  afterEach(async () => {
    await databaseModule?.closeSqliteStorage().catch(() => {})
    // 先把日志写流关掉。logger 每 5s 把缓冲刷到 <data>/logs/（刷之前还会 mkdir
    // 兜底），那个定时器属于本次模块图、路径也指向本次的临时目录：rm 走到一半它
    // 一触发，刚删掉的 data 目录就被重新建出来，Windows 上就是
    // ENOTEMPTY: rmdir '...\data'。刷完 close 掉流，剩下的句柄释放交给 rm 的
    // 重试窗口（杀软扫描也会短暂占住新文件）。
    const { flushLogger } = await import('../../server/utils/logger.mjs')
    flushLogger()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
    vi.resetModules()
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
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

  async function call(method, url, body) {
    const { handleBotsApi } = await import('../../../server/routes/bots.mjs')
    const res = mockResponse()
    await handleBotsApi(mockRequest(method, body), res, new URL(url))
    return res
  }

  it('returns the default mascot from POST, GET and the list', async () => {
    const created = await call('POST', 'http://localhost/api/bots', { name: 'painted' })
    expect(created.status).toBe(201)
    expect(created.body.bot.mascot).toEqual(DEFAULT_MASCOT)

    const botId = created.body.bot.id
    const single = await call('GET', `http://localhost/api/bots/${encodeURIComponent(botId)}`)
    expect(single.body.bot.mascot).toEqual(DEFAULT_MASCOT)

    const list = await call('GET', 'http://localhost/api/bots')
    expect(list.body.bots[0].mascot).toEqual(DEFAULT_MASCOT)
  })

  it('patches colours and the animation switch, and keeps the rest', async () => {
    const created = await call('POST', 'http://localhost/api/bots', { name: 'painted' })
    const botId = created.body.bot.id
    const url = `http://localhost/api/bots/${encodeURIComponent(botId)}`

    const coloured = await call('PATCH', url, { mascot: { body: '#EF8A3C' } })
    expect(coloured.status).toBe(200)
    expect(coloured.body.bot.mascot).toEqual({ body: '#EF8A3C', eye: '#FFFFFF', animated: true, showOnComposer: true })

    const switched = await call('PATCH', url, { mascot: { animated: false } })
    expect(switched.body.bot.mascot).toEqual({ body: '#EF8A3C', eye: '#FFFFFF', animated: false, showOnComposer: true })

    const hidden = await call('PATCH', url, { mascot: { showOnComposer: false } })
    expect(hidden.body.bot.mascot).toEqual({ body: '#EF8A3C', eye: '#FFFFFF', animated: false, showOnComposer: false })

    // 回读一次：路径不同但数据要一致（防止只改了内存里的那份）
    const reread = await call('GET', url)
    expect(reread.body.bot.mascot).toEqual({ body: '#EF8A3C', eye: '#FFFFFF', animated: false, showOnComposer: false })
  })

  it('rejects junk colours without breaking the record', async () => {
    const created = await call('POST', 'http://localhost/api/bots', { name: 'painted' })
    const url = `http://localhost/api/bots/${encodeURIComponent(created.body.bot.id)}`
    const patched = await call('PATCH', url, { mascot: { body: 'not-a-colour' } })
    expect(patched.status).toBe(200)
    expect(patched.body.bot.mascot.body).toBe(DEFAULT_MASCOT.body)
  })

  it('clears the stale heartbeat error when the switch is toggled off', async () => {
    const created = await call('POST', 'http://localhost/api/bots', { name: 'sleeper' })
    const url = `http://localhost/api/bots/${encodeURIComponent(created.body.bot.id)}`
    // 先让记录带上一次历史失败。
    const tainted = await call('PATCH', url, { heartbeat: { lastError: 'boom' } })
    expect(tainted.status).toBe(200)
    expect(tainted.body.bot.heartbeat.lastError).toBe('boom')

    const switched = await call('PATCH', url, { heartbeat: { enabled: false } })
    expect(switched.status).toBe(200)
    expect(switched.body.bot.heartbeat.lastError).toBeNull()
    expect(switched.body.bot.heartbeat.lastIdleReason).toBeNull()

    // 回读一次：防止只改了内存里的那份。
    const reread = await call('GET', url)
    expect(reread.body.bot.heartbeat.lastError).toBeNull()
    expect(reread.body.bot.heartbeat.lastIdleReason).toBeNull()
  })

  it('clears the stale heartbeat error when the switch is toggled back on', async () => {
    const created = await call('POST', 'http://localhost/api/bots', { name: 'sleeper' })
    const url = `http://localhost/api/bots/${encodeURIComponent(created.body.bot.id)}`
    // 先关掉（这一次切换本身也会清，但此时还没有错误），再在关着的状态下带上错误，
    // 然后重新打开 —— 旧错误不得跟着回来。
    const sleeping = await call('PATCH', url, { heartbeat: { enabled: false } })
    expect(sleeping.body.bot.heartbeat.enabled).toBe(false)
    const tainted = await call('PATCH', url, { heartbeat: { lastError: 'boom' } })
    expect(tainted.body.bot.heartbeat.lastError).toBe('boom')

    const switched = await call('PATCH', url, { heartbeat: { enabled: true } })
    expect(switched.status).toBe(200)
    expect(switched.body.bot.heartbeat.enabled).toBe(true)
    expect(switched.body.bot.heartbeat.lastError).toBeNull()
    expect(switched.body.bot.heartbeat.lastIdleReason).toBeNull()
  })

  it('keeps the heartbeat error when the patch does not touch the switch', async () => {
    const created = await call('POST', 'http://localhost/api/bots', { name: 'sleeper' })
    const url = `http://localhost/api/bots/${encodeURIComponent(created.body.bot.id)}`
    const tainted = await call('PATCH', url, { heartbeat: { lastError: 'boom' } })
    expect(tainted.body.bot.heartbeat.lastError).toBe('boom')

    const retimed = await call('PATCH', url, { heartbeat: { intervalMinutes: 45 } })
    expect(retimed.status).toBe(200)
    expect(retimed.body.bot.heartbeat.intervalMinutes).toBe(45)
    expect(retimed.body.bot.heartbeat.lastError).toBe('boom')
  })
})

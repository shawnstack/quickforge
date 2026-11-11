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
  it('defaults to ink colours with motion on', () => {
    expect(normalizeMascot(undefined)).toEqual(DEFAULT_MASCOT)
    expect(normalizeMascot({})).toEqual({ body: '#0B0B0C', eye: '#FFFFFF', animated: true })
  })

  it('uppercases hex colours so the UI and the record agree', () => {
    expect(normalizeMascot({ body: '#ef8a3c', eye: '#ffffff' })).toMatchObject({
      body: '#EF8A3C',
      eye: '#FFFFFF',
    })
  })

  it('merges a partial patch with the previous value', () => {
    const previous = { body: '#EF8A3C', eye: '#FFFFFF', animated: true }
    expect(normalizeMascot({ eye: '#101010' }, previous)).toEqual({
      body: '#EF8A3C',
      eye: '#101010',
      animated: true,
    })
  })

  it('falls back to the previous colour instead of accepting junk', () => {
    const previous = { body: '#57C2A6', eye: '#FFFFFF', animated: true }
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

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-bot-mascot-'))
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
    expect(coloured.body.bot.mascot).toEqual({ body: '#EF8A3C', eye: '#FFFFFF', animated: true })

    const switched = await call('PATCH', url, { mascot: { animated: false } })
    expect(switched.body.bot.mascot).toEqual({ body: '#EF8A3C', eye: '#FFFFFF', animated: false })

    // 回读一次：路径不同但数据要一致（防止只改了内存里的那份）
    const reread = await call('GET', url)
    expect(reread.body.bot.mascot).toEqual({ body: '#EF8A3C', eye: '#FFFFFF', animated: false })
  })

  it('rejects junk colours without breaking the record', async () => {
    const created = await call('POST', 'http://localhost/api/bots', { name: 'painted' })
    const url = `http://localhost/api/bots/${encodeURIComponent(created.body.bot.id)}`
    const patched = await call('PATCH', url, { mascot: { body: 'not-a-colour' } })
    expect(patched.status).toBe(200)
    expect(patched.body.bot.mascot.body).toBe(DEFAULT_MASCOT.body)
  })
})

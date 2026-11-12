import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 命令日志体系的两道闸（2026-11-12 用户拍板重设计）：
//   ①单文件 8MB 上限——历史上一条跑飞的命令写出过 1.8GB（2026-10-30）；
//   ②目录「14 天保留 + 512MB 总量」双闸——目录曾积累 7.46GB。
// 上限按 JS 字符数计（String.length），对多字节输出天然偏保守（UTF-8 会更长），
// 这里锁定的是行为而不是精确字节语义。

// cleanOldCommandLogs 读模块级 logsDir（数据目录在 import 时定型），测试用
// QUICKFORGE_DATA_DIR 指向临时目录，必须先设环境再动态 import。
const prevDataDir = process.env.QUICKFORGE_DATA_DIR
const prevHome = process.env.HOME
const prevUserProfile = process.env.USERPROFILE

function makeMemoryStream() {
  const chunks = []
  return {
    chunks,
    write(chunk) {
      chunks.push(String(chunk))
    },
    end(afterEnd) {
      setTimeout(() => afterEnd?.(), 0)
    },
  }
}

describe('createBoundedCommandLog', () => {
  beforeEach(async () => {
    vi.resetModules()
    process.env.QUICKFORGE_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-logcap-'))
    process.env.HOME = process.env.QUICKFORGE_DATA_DIR
    process.env.USERPROFILE = process.env.QUICKFORGE_DATA_DIR
  })

  afterEach(async () => {
    if (prevDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = prevDataDir
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    vi.resetModules()
    await fs.rm(process.env.QUICKFORGE_DATA_DIR, { recursive: true, force: true }).catch(() => {})
  })

  it('passes through writes while inside the budget', async () => {
    const { createBoundedCommandLog } = await import('../../server/tools/run-command.mjs')
    const stream = makeMemoryStream()
    const log = createBoundedCommandLog(stream, 100)

    log.write('a'.repeat(60))
    log.write('b'.repeat(40))

    expect(log.truncated).toBe(false)
    expect(stream.chunks).toEqual(['a'.repeat(60), 'b'.repeat(40)])

    await new Promise((resolve) => log.close(resolve))
    expect(stream.chunks).toHaveLength(2)
  })

  it('accepts a write that exactly fills the budget', async () => {
    const { createBoundedCommandLog } = await import('../../server/tools/run-command.mjs')
    const stream = makeMemoryStream()
    const log = createBoundedCommandLog(stream, 50)

    log.write('x'.repeat(50))
    expect(log.truncated).toBe(false)

    // 第 51 个字符才触发丢弃，而不是第 50 个。
    await new Promise((resolve) => log.close(resolve))
    expect(stream.chunks).toEqual(['x'.repeat(50)])
  })

  it('discards the overflowing chunk and everything after it', async () => {
    const { createBoundedCommandLog } = await import('../../server/tools/run-command.mjs')
    const stream = makeMemoryStream()
    const log = createBoundedCommandLog(stream, 10)

    log.write('12345')
    log.write('6789012345678')
    log.write('more')

    // 超限的那一整块被丢弃：宁可少写半块，也不写一个超限文件。
    expect(stream.chunks).toEqual(['12345'])
    expect(log.truncated).toBe(true)
  })

  it('writes a truncation marker on close and only then ends the stream', async () => {
    const { createBoundedCommandLog } = await import('../../server/tools/run-command.mjs')
    const stream = makeMemoryStream()
    const log = createBoundedCommandLog(stream, 5)

    log.write('abcdefgh')
    const closed = new Promise((resolve) => log.close(resolve))

    expect(stream.chunks.join('')).toContain('Log truncated')
    expect(stream.chunks.join('')).toContain('5 bytes')
    await closed
  })

  it('ends without a marker when nothing was dropped', async () => {
    const { createBoundedCommandLog } = await import('../../server/tools/run-command.mjs')
    const stream = makeMemoryStream()
    const log = createBoundedCommandLog(stream, 100)

    log.write('fine')
    await new Promise((resolve) => log.close(resolve))

    expect(stream.chunks.join('')).not.toContain('Log truncated')
  })

  it('is wired into a real command: a small run still logs fully', async () => {
    const { toolRunCommand } = await import('../../server/tools/run-command.mjs')
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-logcap-run-'))

    const result = await toolRunCommand(
      { command: 'node -e "process.stdout.write(\'log-cap-probe\')"', description: 'log cap probe' },
      { workspaceRoot: cwd },
      { toolCallId: 'tool-log-cap-probe' },
    )

    expect(result.details.outputFile).toMatch(/commands[\\/].+\.log$/)
    const text = await fs.readFile(result.details.outputFile, 'utf8')
    expect(text).toContain('log-cap-probe')
    expect(text).toContain('Command finished.')
    expect(text).not.toContain('Log truncated')
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => {})
    await fs.rm(result.details.outputFile, { force: true }).catch(() => {})
  })

  it('is wired into a real command: a huge output stops at the cap with a marker', async () => {
    const { toolRunCommand } = await import('../../server/tools/run-command.mjs')
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-logcap-big-'))
    // 8MB 上限 + 每块 64KB × 300 块 ≈ 19MB：足够翻越上限。
    const script = "process.stdout.write('x'.repeat(65536).repeat(300))"

    const result = await toolRunCommand(
      { command: `node -e ${JSON.stringify(script)}`, description: 'log cap flood' },
      { workspaceRoot: cwd },
      { toolCallId: 'tool-log-cap-flood' },
    )

    const text = await fs.readFile(result.details.outputFile, 'utf8')
    // 预览不受影响（尾窗 10k 字），文件被封顶且带标记（含字节数）。
    expect(result.details.stdout).toContain('x')
    expect(text).toContain('Log truncated: output capped at 8388608 bytes')
    expect(text.length).toBeLessThan(9 * 1024 * 1024)
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => {})
    await fs.rm(result.details.outputFile, { force: true }).catch(() => {})
  }, 30_000)
})

describe('cleanOldCommandLogs', () => {
  beforeEach(async () => {
    vi.resetModules()
    process.env.QUICKFORGE_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-logprune-'))
    process.env.HOME = process.env.QUICKFORGE_DATA_DIR
    process.env.USERPROFILE = process.env.QUICKFORGE_DATA_DIR
  })

  afterEach(async () => {
    if (prevDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = prevDataDir
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    vi.resetModules()
    await fs.rm(process.env.QUICKFORGE_DATA_DIR, { recursive: true, force: true }).catch(() => {})
  })

  const DAY = 24 * 60 * 60 * 1000

  async function seedLog(name, ageDays, size = 16) {
    const dir = path.join(process.env.QUICKFORGE_DATA_DIR, 'logs', 'commands')
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, name)
    await fs.writeFile(file, 'z'.repeat(size))
    const at = new Date(Date.now() - ageDays * DAY)
    await fs.utimes(file, at, at)
    return file
  }

  it('removes command logs older than the retention window and keeps fresh ones', async () => {
    const { cleanOldCommandLogs } = await import('../../server/storage.mjs')
    const stale = await seedLog('stale.log', 15)
    const fresh = await seedLog('fresh.log', 2)

    await cleanOldCommandLogs()

    await expect(fs.stat(stale)).rejects.toThrow()
    await expect(fs.stat(fresh)).resolves.toBeTruthy()
  })

  it('tolerates a missing commands directory', async () => {
    const { cleanOldCommandLogs } = await import('../../server/storage.mjs')
    await expect(cleanOldCommandLogs()).resolves.toBeUndefined()
  })

  it('never touches the server log files next to the commands directory', async () => {
    const { cleanOldCommandLogs } = await import('../../server/storage.mjs')
    const serverLog = path.join(process.env.QUICKFORGE_DATA_DIR, 'logs', 'server-2026-01-01.log')
    await fs.mkdir(path.dirname(serverLog), { recursive: true })
    await fs.writeFile(serverLog, 'server log')
    const at = new Date(Date.now() - 30 * DAY)
    await fs.utimes(serverLog, at, at)
    await seedLog('stale-command.log', 20)

    await cleanOldCommandLogs()

    // server 日志有自己的闸（cleanOldLogs），commands 清理不得越界。
    await expect(fs.stat(serverLog)).resolves.toBeTruthy()
  })
})

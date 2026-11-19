import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// logs 顶层的清理闸（cleanOldLogs）。顶层有三类写入方，全在同一目录：
//   server-*.log   —— utils/logger.mjs
//   ai-http-*.jsonl —— ai-http-logger.mjs
//   update-*.log   —— index.mjs 的自动更新
// 旧实现只筛 `server-` + `.log`，另外两类永不回收（潜伏的容量缺陷）。
// logs/commands/ 有自己的闸（cleanOldCommandLogs，14 天 / 512MB），不得越界：
// 不递归、不删目录。
//
// cleanOldLogs 读模块级 logsDir（数据目录在 import 时定型），所以必须先设
// QUICKFORGE_DATA_DIR 再动态 import。

const prevDataDir = process.env.QUICKFORGE_DATA_DIR
const prevHome = process.env.HOME
const prevUserProfile = process.env.USERPROFILE

describe('cleanOldLogs（logs 顶层）', () => {
  const DAY = 24 * 60 * 60 * 1000
  let tempDataDir

  beforeEach(async () => {
    vi.resetModules()
    // 存下这次建的目录：afterEach 里 env 已经恢复，按 process.env 去删会删错/删空。
    tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-logretention-'))
    process.env.QUICKFORGE_DATA_DIR = tempDataDir
    process.env.HOME = tempDataDir
    process.env.USERPROFILE = tempDataDir
  })

  afterEach(async () => {
    // logger 的 5s 刷盘定时器还挂在这个临时数据目录上：留着它会在 rm 之后把
    // data/logs 重新 mkdir 出来（Windows 上表现为 ENOTEMPTY 或 %TEMP% 空壳目录）。
    const { flushLogger } = await import('../../server/utils/logger.mjs')
    flushLogger()
    if (prevDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = prevDataDir
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    vi.resetModules()
    await fs.rm(tempDataDir, { recursive: true, force: true }).catch(() => {})
  })

  async function seedLog(name, ageDays, subdir = 'logs') {
    const dir = path.join(tempDataDir, subdir)
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, name)
    await fs.writeFile(file, 'x'.repeat(16))
    const at = new Date(Date.now() - ageDays * DAY)
    await fs.utimes(file, at, at)
    return file
  }

  it('回收过期的 ai-http / update 顶层日志，当天的新文件留着', async () => {
    const { cleanOldLogs } = await import('../../server/storage.mjs')
    const staleAiHttp = await seedLog('ai-http-2026-01-01.jsonl', 10)
    const freshAiHttp = await seedLog('ai-http-2026-01-11.jsonl', 0)
    const staleUpdate = await seedLog('update-2026-01-01T00-00-00.log', 10)
    const freshUpdate = await seedLog('update-2026-01-11T00-00-00.log', 0)

    await cleanOldLogs()

    await expect(fs.stat(staleAiHttp)).rejects.toThrow()
    await expect(fs.stat(staleUpdate)).rejects.toThrow()
    await expect(fs.stat(freshAiHttp)).resolves.toBeTruthy()
    await expect(fs.stat(freshUpdate)).resolves.toBeTruthy()
  })

  it('保留原有 server 日志语义：超过 7 天的删、当天的留', async () => {
    const { cleanOldLogs } = await import('../../server/storage.mjs')
    const stale = await seedLog('server-2026-01-01.log', 8)
    const fresh = await seedLog('server-2026-01-11.log', 0)

    await cleanOldLogs()

    await expect(fs.stat(stale)).rejects.toThrow()
    await expect(fs.stat(fresh)).resolves.toBeTruthy()
  })

  it('不递归进 logs/commands/：旧命令日志留着，目录也没被删', async () => {
    const { cleanOldLogs } = await import('../../server/storage.mjs')
    // 10 天：过了顶层 7 天闸、还没到 commands 自己的 14 天闸。顶层闸要是递归进去，
    // 这个文件就会被删；所以它是「不递归」的判别样本。
    const staleCommand = await seedLog('stale-command.log', 10, path.join('logs', 'commands'))
    const staleTop = await seedLog('ai-http-2026-01-01.jsonl', 10)

    await cleanOldLogs()

    // 顶层照常回收，子目录一律不碰（那是 cleanOldCommandLogs 的地盘）。
    await expect(fs.stat(staleTop)).rejects.toThrow()
    await expect(fs.stat(staleCommand)).resolves.toBeTruthy()
    const commandsDir = await fs.stat(path.join(tempDataDir, 'logs', 'commands'))
    expect(commandsDir.isDirectory()).toBe(true)
  })

  it('顶层以后新增的日志文件同样受闸：不靠文件名前缀白名单', async () => {
    const { cleanOldLogs } = await import('../../server/storage.mjs')
    const staleOther = await seedLog('future-channel.jsonl', 10)

    await cleanOldLogs()

    // 闸按「顶层常规文件」判，而不是「server- 开头的 .log」——否则下一个新增的
    // 顶层日志会重演这次「永不回收」的债。
    await expect(fs.stat(staleOther)).rejects.toThrow()
  })
})

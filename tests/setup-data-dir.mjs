/**
 * 每个测试文件一个临时数据目录。
 *
 * 为什么必须在 setup 里设、而不是各测试自己设：`server/storage.mjs` 在 import
 * 时就把 `dataDir` / `logsDir` 定成模块级常量（storage.mjs:236-245），
 * `server/utils/logger.mjs` 又从它取 `logsDir`（logger.mjs:3、:29-30、:53-55）。
 * 于是「先 import、后设 env」的测试即使跑在临时目录上，logger 的文件写入仍然
 * 指向真实的 `~/.quickforge/logs`。
 *
 * 实测（2026-11-17）：当天 server-2026-11-17.log 里 332 对
 * `SQLite storage initialized/closed`（INFO），只分布在 13 个分钟里，且这些
 * 分钟全部落在我跑全量测试的时间窗内。真实日志是我每跳的第一眼健康指标，
 * 被自己的验证跑污染等于把指标读错——级别再往上一档（ERROR）就会被误判成
 * 线上缺陷。
 *
 * 每个测试文件一个目录：vitest 的 setup 对每个测试文件都会执行一遍，互不干扰；
 * 文件跑完整目录删掉（Windows 上偶有 sqlite 句柄没释放，删不掉就留着，
 * 不影响测试结论）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll } from 'vitest'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickforge-vitest-'))
process.env.QUICKFORGE_DATA_DIR = dataDir

afterAll(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch {
    /* 句柄未释放就留着，不影响测试结论。 */
  }
})

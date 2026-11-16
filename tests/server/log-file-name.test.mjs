import { describe, expect, it } from 'vitest'
import { localDateKey, serverLogFileName, serverLogFilePath } from '../../server/log-file-name.mjs'

// 日志文件名与日志行时间戳必须同口径（都是**本地**时间）。
// 选「本地 00:30」当用例，是因为该时刻在 UTC+8 下 UTC 日期还停在前一天：
// 拿 `toISOString().slice(0,10)` 拼名字会得到昨天的文件名，而服务端正往今天的文件里写。
// 注意这类用例在 UTC 时区跑不会红（本地＝UTC），它守的是「本机口径」这条契约。
describe('serverLogFileName', () => {
  it('本地 00:30 的文件名是本地当天，不跟着 UTC 回退一天', () => {
    const justAfterLocalMidnight = new Date(2026, 10, 17, 0, 30, 0)
    expect(localDateKey(justAfterLocalMidnight)).toBe('2026-11-17')
    expect(serverLogFileName(justAfterLocalMidnight)).toBe('server-2026-11-17.log')
  })

  it('本地 23:59 仍归当天（不因为 UTC 已跨日而提前翻页）', () => {
    const beforeLocalMidnight = new Date(2026, 10, 17, 23, 59, 0)
    expect(serverLogFileName(beforeLocalMidnight)).toBe('server-2026-11-17.log')
  })

  it('月日补零，路径 = logsDir 下的该文件名', () => {
    const firstOfMonth = new Date(2026, 0, 5, 9, 0, 0)
    expect(serverLogFileName(firstOfMonth)).toBe('server-2026-01-05.log')
    // 用 basename 比对：路径分隔符随平台变，断言不该被 `\\` 与 `/` 的差异绊倒。
    expect(serverLogFilePath('C:/logs', firstOfMonth).replace(/\\/g, '/')).toBe('C:/logs/server-2026-01-05.log')
  })
})

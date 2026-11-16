import path from 'node:path'

// 服务端日志文件名的日期口径 = **本地日期**。
//
// 为什么要单独一个模块：这个口径原本写了两遍，而且两遍不一样——
// `server/utils/logger.mjs` 从 2026-08-20（5e49c915）起按**本地**日期轮转、日志行也是本地
// 时间戳，而 `bin/quickforge.mjs` 的 `getLogFile()` 用 `toISOString().slice(0, 10)`（**UTC**）
// 拼给用户看的路径。本地 00:00–08:00 这段（UTC 还在前一天）两者分叉：CLI 打印
// `Current log: …/server-<昨天>.log`，而服务端正往 `server-<今天>.log` 里写；
// 启动失败时那句 `Check log: …` 也会把人引到一个空文件（`quickforge logs` 还会先
// `appendFile` 把它造出来，看着像「服务器启动后一行都没写」）。
//
// 判据：文件名与行时间戳必须同口径，且跨零点按本地零点翻页——实测
// `logs/server-2026-11-16.log` 的首行是 `2026-11-15 23:59:56`，翻页点就在本地零点。
export function localDateKey(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function serverLogFileName(now = new Date()) {
  return `server-${localDateKey(now)}.log`
}

export function serverLogFilePath(logsDir, now = new Date()) {
  return path.join(logsDir, serverLogFileName(now))
}

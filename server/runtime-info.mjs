// 本机服务自身的运行时信息（监听端口 / 本地 API 基址）。
//
// 为什么需要它：只有 server/index.mjs 在 listen 回调里才知道真实端口（可能是
// 0 让系统分配，也可能被 QUICKFORGE_PORT 覆盖）。而 run_command 拉起的子进程
// 需要知道「本地 API 在哪个地址」才能调用 QuickForge 自己，之前只能靠猜端口。
//
// 为什么不落盘：dev 实例（32176）和正式实例（5176）会同时运行，自定义端口更
// 是不可预期；写同一个文件就是互相覆盖。进程内变量天然是「谁 listen 谁写」，
// 不会串。落盘的唯一好处是外部程序能读，那不是本次要解决的问题。

let runtimeInfo = null

function loopbackHostFor(host) {
  // 绑定 0.0.0.0 / :: 时，本机访问应该走回环地址而不是通配地址。
  if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') return '127.0.0.1'
  return host
}

export function setRuntimeInfo(info) {
  const port = Number(info?.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  const host = loopbackHostFor(typeof info?.host === 'string' ? info.host.trim() : '')
  runtimeInfo = { host, port, baseUrl: `http://${host.includes(':') ? `[${host}]` : host}:${port}` }
  return runtimeInfo
}

export function getRuntimeInfo() {
  return runtimeInfo
}

export function clearRuntimeInfo() {
  runtimeInfo = null
}

/**
 * 给 run_command 子进程准备的环境变量：把「本地 API 在哪、我这次是谁」变成
 * 普通环境变量，脚本和 curl 都能直接读，不需要额外工具或参数。
 */
export function buildChildProcessEnv(context = {}, baseEnv = process.env) {
  const env = { ...baseEnv }
  if (runtimeInfo?.baseUrl) env.QUICKFORGE_API_BASE = runtimeInfo.baseUrl
  const sessionId = typeof context?.sessionId === 'string' ? context.sessionId.trim() : ''
  if (sessionId) env.QUICKFORGE_SESSION_ID = sessionId
  const projectId = typeof context?.projectId === 'string' ? context.projectId.trim() : ''
  if (projectId) env.QUICKFORGE_PROJECT_ID = projectId
  const projectRoot = typeof context?.workspaceRoot === 'string' ? context.workspaceRoot.trim() : ''
  if (projectRoot) env.QUICKFORGE_WORKSPACE_ROOT = projectRoot
  return env
}

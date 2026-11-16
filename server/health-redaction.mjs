// `/api/health` 是局域网**免密**可读的引导路径（`server/index.mjs` 的 `isLanAccessBootstrapPath`），
// 但它拼出来的状态里带了一批**本机绝对路径**：数据 / 配置 / 存储 / 缓存 / 日志目录，以及
// 当前项目的 `path`。也就是说，同一网段里任何人（不需要密码）都能读到这台机器的用户名、
// 盘符和工作区位置——这不是凭证，但确实是「不该出门」的信息。
//
// 判据（2026-11-16 20:16，答疑bot 报、我自己用 LAN 地址复核过）：从
// `http://192.168.0.108:5176/api/health` 拿到 `isLocalRequest:false` 的同时，
// `dataDir` 仍是 `C:\\Users\\<用户名>\\.quickforge`、`workspaceRoot` 与 `project.path` 仍是 `D:\\quickforge`。
// 判成「漏收口」而不是设计如此的依据：同一份返回里的 `capabilities.restart /
// openLocalApps / terminal` 早就按 `isLocalRequest` 收口了，只有路径这一批没跟。
//
// 消费面我静态核过（`src/**`、`bin/**`、`server/**` 全量搜这六个字段）：
// 前端没有任何代码读 health 的路径字段（`AboutSettingsTab` 只读 `isLocalRequest`，
// 其余调用方只认 `ok` / `pid` / `version` / `bootId`），CLI 是自己算路径而不是从 health 拿。
// 所以远程一律置 `null` 不影响界面与 CLI；字段保留（不删键）是为了让 payload 形状稳定。
const HOST_PATH_FIELDS = ['dataDir', 'configDir', 'storageDir', 'cacheDir', 'logsDir', 'workspaceRoot']

export function redactHostPathsForRemote(status) {
  if (!status || typeof status !== 'object') return status
  // 只在**确认是本地请求**时保留路径；`isLocalRequest` 缺失或为假一律按远程处理
  // （缺字段要往安全那边倒，别指望调用方一定传了它）。
  if (status.isLocalRequest === true) return status
  const redacted = { ...status }
  for (const key of HOST_PATH_FIELDS) {
    if (key in redacted) redacted[key] = null
  }
  if (redacted.project && typeof redacted.project === 'object') {
    redacted.project = { ...redacted.project, path: null }
  }
  return redacted
}

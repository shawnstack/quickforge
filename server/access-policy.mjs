export function isAuthenticatedAppClient(context = {}) {
  if (context.isLocalRequest === true) return true
  // 云远程访问隧道（X-QuickForge-Tunnel: 1，仅 agent 与 qf 同机回环注入）：视为已认证远程客户端。
  // 认证等级提升，但本地能力裁剪不变——终端/系统代理/目录选择器/Explorer 等仍由 isLocalRequest 禁止。
  if (context.tunnelClient === true) return true
  return context.isLocalRequest === false && context.remoteAuthorized === true
}

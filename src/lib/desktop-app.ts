/**
 * 「当前是否运行在 QuickForge 桌面端」的唯一判定入口。
 *
 * 判定依据由主进程在 dom-ready 时注入（`window.__quickforgeDesktopApp` 与
 * `body.quickforge-desktop-app`），历史上这段表达式在多个组件里各写了一份，
 * 这里收成一处，避免新增能力时再复制第四份。
 */
export function isDesktopApp(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  const flagged = (window as Window & { __quickforgeDesktopApp?: boolean }).__quickforgeDesktopApp === true
  if (flagged) return true
  return document.body?.classList.contains('quickforge-desktop-app') === true
}

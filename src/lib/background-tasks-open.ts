/**
 * 「打开后台任务面板」的窗口事件。
 *
 * 后台任务面板挂在右侧 Inspector 上，但发起打开的位置分散在 Inspector 子树之外
 * （置顶摘要的后台命令区块、Composer 左下角的命令图标），那些位置既拿不到
 * `requestWorkspaceInspector`，也不该反向依赖面板状态。因此统一用窗口事件把
 * 「打开」意图交给 App.tsx，由它决定往哪个 project / runtime scope 打开。
 *
 * 与 `quickforge:view-command-log` 同一模式：payload 只放纯数据，监听端逐字段
 * 校验，无效即静默 return（跨会话/跨项目的残留事件不应把面板切走）。
 */
export const OPEN_BACKGROUND_TASKS_EVENT = 'quickforge:open-background-tasks'

export type OpenBackgroundTasksRequest = {
  /** 发起打开的会话；缺省时由 App 用当前会话。 */
  sessionId?: string
}

export function dispatchOpenBackgroundTasks(request: OpenBackgroundTasksRequest = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_BACKGROUND_TASKS_EVENT, {
    detail: { sessionId: request.sessionId },
  }))
}

/** 把事件 detail 收窄成可信请求；结构不符时返回 `{}`（等价于「用当前会话打开」）。 */
export function normalizeOpenBackgroundTasksRequest(detail: unknown): OpenBackgroundTasksRequest {
  if (!detail || typeof detail !== 'object') return {}
  const raw = detail as { sessionId?: unknown }
  return {
    sessionId: typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : undefined,
  }
}

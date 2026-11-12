import type { BackgroundTask } from './types'

// 同会话重复点击的加载短路判定：session-open-fast-path §2.2「同会话重复点击：
// 不显示遮罩、不重复加载」的加载半边。过渡遮罩半边由 beginSessionTransition
// 对相同 sessionId 短路，但 scheduleSessionLoad 的无遮罩分支仍会执行 load()——
// performLoadSession 借本函数对「纯重复」的加载直接早退。
//
// 三个条件缺一不可：
// - runningTask 缺失：agent 已被空闲回收，必须重载（走只读视图快路径）；
// - currentSessionId 不同：这是真正的会话切换；
// - viewAgent 引用不同：视图处于中间态（attach 尚未完成），不能跳过收尾。
//
// 不早退的代价（bot 会话尤为明显）：setLoadingSessionId 的中间态跨过渲染
// 周期会触发兜底「正在加载对话」遮罩，而撤除遮罩所需的就绪信号因 agent
// 引用未变不会重发（ChatPanelHost 主 effect 仅在 agent 变化时重跑），遮罩
// 只能等 10s watchdog 强撤；bot 会话每次还多一次恒为无效的
// switchActiveProject 网络往返（bot 项目永远写不进 activeProject）。
export function shouldSkipSessionReload(params: {
  sessionId: string
  runningTask: BackgroundTask | undefined
  currentSessionId: string | undefined
  viewAgent: unknown
}): boolean {
  const { sessionId, runningTask, currentSessionId, viewAgent } = params
  return runningTask !== undefined
    && currentSessionId === sessionId
    && viewAgent === runningTask.agent
}

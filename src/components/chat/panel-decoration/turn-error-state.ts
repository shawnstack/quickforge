/**
 * 回合终态错误的「重试循环」状态机（每个聊天面板一个实例，随 agent 重建）。
 *
 * 错误本身是消息数据（assistant `stopReason='error'` + `errorMessage`），但
 * 「重试了几次仍未恢复」是跨重渲染的 UI 状态：`retryFromMessage` 会把旧错误
 * 消息从历史里裁剪掉（消息数组无法体现连续失败），因此计数只能由 UI 层持有：
 *
 * - `noteRetryClicked(errorKey)`：用户点击错误行「重试」→ 计数 +1、挂起本次错误键。
 * - `observe(...)`（每次 decorate 周期调用一次，参数取消息尾部状态）：
 *   - 尾部仍是同一错误且已点击重试 → 呈现「正在重试…」过渡态；
 *   - 尾部是（新）错误 → 呈现错误行；计数 >0 时附升级提示「已重试 n 次仍失败」；
 *   - 尾部不再是错误且正在流式 → 已恢复，清零；
 *   - 尾部不再是错误且无挂起重试 → 用户放弃（发送新消息等），清零；
 *   - 挂起重试期间错误被裁剪（等待结果）→ 保留计数。
 */
export type TurnErrorView = {
  /** 同一错误已被点击重试、结果未出：呈现「正在重试…」过渡 */
  retrying: boolean
  /** 附升级提示（重试后仍失败 ≥1 次） */
  escalated: boolean
  /** 连续重试失败次数（升级提示文案用） */
  retryCount: number
}

export type TurnErrorTracker = {
  noteRetryClicked(errorKey: string): void
  observe(hasTerminalError: boolean, streaming: boolean, errorKey: string): TurnErrorView
}

/** 错误消息的稳定键：新合成的错误消息有新 timestamp，可与被重试的旧错误区分。 */
export function turnErrorKeyOf(message: { errorMessage?: unknown; timestamp?: unknown }): string {
  const timestamp = typeof message.timestamp === 'number' ? message.timestamp : 0
  const text = typeof message.errorMessage === 'string' ? message.errorMessage : ''
  return `${timestamp}:${text}`
}

export function createTurnErrorTracker(): TurnErrorTracker {
  let retryCount = 0
  let pendingKey: string | null = null

  return {
    noteRetryClicked(errorKey) {
      retryCount += 1
      pendingKey = errorKey
    },
    observe(hasTerminalError, streaming, errorKey) {
      if (hasTerminalError) {
        if (pendingKey !== null && errorKey === pendingKey) {
          return { retrying: true, escalated: false, retryCount }
        }
        pendingKey = null
        return { retrying: false, escalated: retryCount > 0, retryCount }
      }
      if (streaming || pendingKey === null) {
        retryCount = 0
        pendingKey = null
      }
      return { retrying: false, escalated: false, retryCount }
    },
  }
}

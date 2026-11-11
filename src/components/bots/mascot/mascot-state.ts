import type { MascotStateId } from './mascot-geometry'

/**
 * 决定吉祥物演哪个动作的输入信号。
 * 全部来自现有状态，不新造一套「bot 状态机」：
 * 流式/工具/审批来自 `agent.state`，完成与暂停来自运行时状态和心跳。
 */
export type MascotSignals = {
  /** 最近一次错误：本轮报错，或心跳里记录的失败。 */
  error?: string | null
  /** 在等用户：工具待审批、或者在等一个回答。 */
  waitingForUser?: boolean
  /** 有工具正在执行。 */
  toolRunning?: boolean
  /** 模型正在输出。 */
  streaming?: boolean
  /** 刚跑完一轮，短暂开心一下。 */
  justCompleted?: boolean
  /** 心跳关掉了 —— 这个 bot 在睡觉。 */
  paused?: boolean
}

/**
 * 纯函数：状态信号 → 动作。优先级从上到下，
 * 越靠上越「需要人知道」，所以出错和等审批压过正在干活。
 */
export function resolveMascotState(signals: MascotSignals): MascotStateId {
  if (signals.error) return 'alert'
  if (signals.waitingForUser) return 'alert'
  if (signals.toolRunning) return 'working'
  if (signals.streaming) return 'thinking'
  if (signals.justCompleted) return 'happy'
  if (signals.paused) return 'sleepy'
  return 'idle'
}

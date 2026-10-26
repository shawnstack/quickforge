/**
 * 思考等级词表与标签。
 *
 * 控件本体已并入模型选择弹层底部的滑杆（`lib/thinking-slider.ts` 负责交互与
 * 粒子渲染，`lib/custom-model-selector.ts` 负责挂载）。这里只保留词表与标签，
 * 因为档位词表是跨模块契约（服务端同步、持久化、子代理运行详情共用同一套
 * off / low / medium / high / xhigh），不应跟着某个控件实现一起消失。
 */
import { t } from '@/lib/i18n'
import type { AppTextKey } from '@/lib/i18n'

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh'

export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh']

const THINKING_LABEL_KEY: Record<ThinkingLevel, AppTextKey> = {
  off: 'thinkingOff',
  low: 'thinkingLow',
  medium: 'thinkingMedium',
  high: 'thinkingHigh',
  xhigh: 'thinkingXHigh',
}

export function thinkingLevelLabel(level: ThinkingLevel): string {
  return t(THINKING_LABEL_KEY[level] ?? 'thinkingOff')
}

/**
 * 把外部传入的档位收敛到本模块的 5 档词表。
 *
 * 上游 `pi-agent-core` 的 `ThinkingLevel` 还包含 `minimal`（Provider 侧有效，
 * 但 UI 没有对应档位）。这类值映射到相邻的 `low`，非法值兜底到 `off`。
 *
 * 必须收敛后再用：`thinkingLevelLabel()` 的映射表没有 `minimal` 键，
 * `indexOf()` 也会返回 -1，两者都会把等级显示/几何算成「关」。
 */
export function toThinkingLevel(level: string | null | undefined): ThinkingLevel {
  if (level === 'minimal') return 'low'
  return THINKING_LEVELS.includes(level as ThinkingLevel)
    ? (level as ThinkingLevel)
    : 'off'
}

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

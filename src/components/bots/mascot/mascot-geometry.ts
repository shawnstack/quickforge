/** 由 docs/design/bot-mascot/generate-bot-gif.py --emit-web 生成，勿手改。
 *  改造型请改生成脚本后重新导出。 */

export const MASCOT_VIEW_BOX = 512

export const MASCOT_BODY_SHAPE = { cx: 256, cy: 258, r: 150 }

export const MASCOT_EYE_SHAPE = {
  dx: 46,
  cy: 267,
  rx: 20,
  ry: 26,
}

export const MASCOT_ARC = { d: 'M -18 6 Q 0 -17 18 6', width: 11 }

/** 每个状态的循环时长（秒），与 GIF 一致。 */
export const MASCOT_DURATIONS = {
  idle: 1.60,
  thinking: 1.80,
  working: 0.72,
  happy: 0.88,
  sleepy: 3.20,
  alert: 1.12,
  walk: 0.80,
} as const

export type MascotStateId = keyof typeof MASCOT_DURATIONS

/** 状态的中文名，界面上的 aria-label 用它。 */
export const MASCOT_STATE_LABELS_ZH: Record<MascotStateId, string> = {
  idle: '待机',
  thinking: '思考',
  working: '干活中',
  happy: '开心',
  sleepy: '犯困',
  alert: '提醒',
  walk: '走路',
}

export type MascotPalette = { id: string; body: string; eye: string }

export const MASCOT_PALETTES: MascotPalette[] = [
  { id: 'ink', body: '#0B0B0C', eye: '#FFFFFF' },
  { id: 'inverse', body: '#FFFFFF', eye: '#0B0B0C' },
  { id: 'indigo', body: '#2C3E70', eye: '#FFFFFF' },
  { id: 'tangerine', body: '#EF8A3C', eye: '#FFFFFF' },
  { id: 'mint', body: '#57C2A6', eye: '#FFFFFF' },
  { id: 'grape', body: '#6C4AB6', eye: '#FFFFFF' },
  { id: 'butter', body: '#F2C94C', eye: '#242424' },
  { id: 'slate', body: '#4A5568', eye: '#F7FAFC' },
]

export const MASCOT_DEFAULT = { body: '#0B0B0C', eye: '#FFFFFF', animated: true }

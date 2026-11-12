/** 由 docs/design/bot-mascot/generate-bot-gif.py --emit-web 生成，勿手改。
 *  改造型请改生成脚本后重新导出。 */

export const MASCOT_VIEW_BOX = 512

export const MASCOT_BODY_SHAPE = { cx: 256, cy: 258, r: 150 }

export const MASCOT_EYE_SHAPE = {
  dx: 46,
  cy: 262,
  rx: 18,
  ry: 32,
}

export const MASCOT_ARC = { d: 'M -18 6 Q 0 -17 18 6', width: 11 }

/** 状态与动作的循环时长（秒）；动作（peek/wave/…）由 use-mascot-actions 触发，详见生成脚本。 */
export const MASCOT_DURATIONS = {
  idle: 1.60,
  thinking: 1.80,
  working: 0.70,
  happy: 0.90,
  sleepy: 3.20,
  alert: 1.10,
  walk: 0.80,
  peek: 2.40,
  wave: 3.40,
  stretch: 3.00,
  yawn: 3.40,
  pleased: 1.80,
  surprise: 1.20,
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
  peek: '偷看打字',
  wave: '打招呼',
  stretch: '伸懒腰',
  yawn: '打哈欠',
  pleased: '被夸',
  surprise: '惊讶',
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

/** 质感层几何（quality-proposal.html 拍板 2026-11-13）；图层由 BotMascot.tsx 渲染。 */
export const MASCOT_QUALITY = {
  sheen: { cx: 210, cy: 170, r: 172 },
  shade: { cy: 150, r: 390 },
  rim: { cy: 512, r: 330 },
} as const

export const MASCOT_DEFAULT = { body: '#0B0B0C', eye: '#FFFFFF', animated: true }

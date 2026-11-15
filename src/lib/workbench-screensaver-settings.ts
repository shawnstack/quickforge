import { getAppStorage } from '@/storage'

/** 屏保配置沿用原开关的存储键：旧值是 boolean，normalize 会把它读成 enabled。 */
export const WORKBENCH_SCREENSAVER_KEY = 'workbenchScreensaver'

export const SCREENSAVER_IDLE_RANGE = { min: 1, max: 120 } as const
export const SCREENSAVER_PERCENT_RANGE = { min: 0, max: 100 } as const
export const SCREENSAVER_CLOCK_RANGE = { min: 70, max: 150 } as const
export const SCREENSAVER_IDLE_PRESETS = [5, 10, 15, 30, 60] as const

/** 夜间仪表盘的主色候选：默认沿用工作台看板的苔绿。 */
export const SCREENSAVER_ACCENTS = ['#3aa981', '#6cb6ff', '#e8a020', '#e879b9', '#7ee787', '#ff6b57'] as const

export type WorkbenchScreensaverSettings = {
  enabled: boolean
  idleMinutes: number
  accent: string
  motion: number
  glow: number
  density: number
  clockScale: number
  drift: boolean
  showSchedule: boolean
  showRunning: boolean
  showToday: boolean
}

export const DEFAULT_WORKBENCH_SCREENSAVER: WorkbenchScreensaverSettings = {
  enabled: true,
  idleMinutes: 10,
  accent: SCREENSAVER_ACCENTS[0],
  motion: 55,
  glow: 62,
  density: 55,
  clockScale: 100,
  drift: true,
  showSchedule: true,
  showRunning: true,
  showToday: true,
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeWorkbenchScreensaver(value: unknown): WorkbenchScreensaverSettings {
  const defaults = DEFAULT_WORKBENCH_SCREENSAVER
  if (typeof value === 'boolean') return { ...defaults, enabled: value }
  if (!value || typeof value !== 'object') return { ...defaults }
  const raw = value as Partial<Record<keyof WorkbenchScreensaverSettings, unknown>>
  const accent = typeof raw.accent === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accent)
    ? raw.accent.toLowerCase()
    : defaults.accent
  return {
    enabled: pickBoolean(raw.enabled, defaults.enabled),
    idleMinutes: clampNumber(raw.idleMinutes, defaults.idleMinutes, SCREENSAVER_IDLE_RANGE.min, SCREENSAVER_IDLE_RANGE.max),
    accent,
    motion: clampNumber(raw.motion, defaults.motion, SCREENSAVER_PERCENT_RANGE.min, SCREENSAVER_PERCENT_RANGE.max),
    glow: clampNumber(raw.glow, defaults.glow, SCREENSAVER_PERCENT_RANGE.min, SCREENSAVER_PERCENT_RANGE.max),
    density: clampNumber(raw.density, defaults.density, SCREENSAVER_PERCENT_RANGE.min, SCREENSAVER_PERCENT_RANGE.max),
    clockScale: clampNumber(raw.clockScale, defaults.clockScale, SCREENSAVER_CLOCK_RANGE.min, SCREENSAVER_CLOCK_RANGE.max),
    drift: pickBoolean(raw.drift, defaults.drift),
    showSchedule: pickBoolean(raw.showSchedule, defaults.showSchedule),
    showRunning: pickBoolean(raw.showRunning, defaults.showRunning),
    showToday: pickBoolean(raw.showToday, defaults.showToday),
  }
}

export function screensaverIdleMs(idleMinutes: number): number {
  return clampNumber(idleMinutes, DEFAULT_WORKBENCH_SCREENSAVER.idleMinutes, SCREENSAVER_IDLE_RANGE.min, SCREENSAVER_IDLE_RANGE.max) * 60_000
}

/** 纯判定：启用、工作台未开、且 idle 达到配置阈值时才触发屏保。 */
export function screensaverDue(
  lastActivity: number,
  now: number,
  enabled: boolean,
  workbenchOpen: boolean,
  idleMinutes: number,
): boolean {
  return enabled && !workbenchOpen && now - lastActivity >= screensaverIdleMs(idleMinutes)
}

export async function loadWorkbenchScreensaverSettings(): Promise<WorkbenchScreensaverSettings> {
  return normalizeWorkbenchScreensaver(await getAppStorage().settings.get<unknown>(WORKBENCH_SCREENSAVER_KEY))
}

export async function saveWorkbenchScreensaverSettings(settings: WorkbenchScreensaverSettings): Promise<void> {
  await getAppStorage().settings.set(WORKBENCH_SCREENSAVER_KEY, normalizeWorkbenchScreensaver(settings))
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** 随机只动外观，不碰开关与 idle 时长——用户刚设好的等待时间不该被骰子改掉。 */
export function randomizeScreensaverAppearance(settings: WorkbenchScreensaverSettings): WorkbenchScreensaverSettings {
  const others = SCREENSAVER_ACCENTS.filter((accent) => accent !== settings.accent)
  return normalizeWorkbenchScreensaver({
    ...settings,
    accent: others[randomInt(0, others.length - 1)],
    motion: randomInt(25, 90),
    glow: randomInt(30, 95),
    density: randomInt(20, 90),
    clockScale: randomInt(SCREENSAVER_CLOCK_RANGE.min, SCREENSAVER_CLOCK_RANGE.max),
    drift: Math.random() < 0.75,
  })
}
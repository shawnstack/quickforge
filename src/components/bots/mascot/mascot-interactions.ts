import type { MascotStateId } from './mascot-geometry'

/**
 * 互动动作与待机小剧场的纯逻辑（不含 React）：
 * 悬停 / 戳 / 连戳转晕 / 待机东张西望。
 *
 * 时机规则：互动只在「待机 / 犯困」时响应——思考、干活、提醒、开心是
 * 要让用户看清的状态，走路（溜达）时目标还在横向移动，都不理人。
 * 张望只在「待机」来：犯困时在打瞌睡，东张西望会自相矛盾。
 * 由调用方算好两个开关传入；CSS 见 mascot-anim.css 的 data-interact / data-ambient 段。
 */

/** 允许互动的状态。 */
export const MASCOT_INTERACTIVE_STATES: readonly MascotStateId[] = ['idle', 'sleepy']

/** 会来一段「东张西望」的状态。 */
export const MASCOT_LOOK_STATES: readonly MascotStateId[] = ['idle']

export type MascotInteract = 'hover' | 'hover-exit' | 'poke' | 'dizzy'
export type MascotAmbient = 'look' | null

export const MASCOT_POKE_MS = 600
export const MASCOT_DIZZY_MS = 1500
export const MASCOT_HOVER_EXIT_MS = 320
/** 连点窗口：在这个窗口内点满 MASCOT_DIZZY_CLICKS 下就转晕。 */
export const MASCOT_DIZZY_WINDOW_MS = 1600
export const MASCOT_DIZZY_CLICKS = 5

/** 一段张望的时长，与 mascot-anim.css 的 qf-mascot-gaze-look 3.30s 一致。 */
export const MASCOT_LOOK_MS = 3300
/** 两段张望之间的间隔：随机取 [min, max]。准点张望会显得像坏了。 */
export const MASCOT_LOOK_GAP_MIN_MS = 5000
export const MASCOT_LOOK_GAP_MAX_MS = 9000

export type MascotInteractHandlers = {
  onPointerEnter: () => void
  onPointerLeave: () => void
  onPointerDown: () => void
}

export type MascotInteractController = MascotInteractHandlers & {
  /** 互动响应开关。关掉后指针事件全部无效。 */
  setEnabled: (enabled: boolean) => void
  /** 张望开关（独立于互动：犯困时互动还在、张望停了）。 */
  setAmbientEnabled: (enabled: boolean) => void
  /** 立即清空互动与张望（置 null、停一次性动画、取消定时器）。 */
  reset: () => void
  /** 卸载时清定时器。 */
  dispose: () => void
}

/**
 * schedule / cancel / now / random 都可注入，测试里用假时钟驱动；
 * 默认走 window.setTimeout、performance.now 与 Math.random。
 */
export function createMascotInteractController(
  setInteract: (value: MascotInteract | null) => void,
  opts: {
    setAmbient?: (value: MascotAmbient) => void
    schedule?: (handler: () => void, ms: number) => number
    cancel?: (handle: number) => void
    now?: () => number
    random?: () => number
    enabled?: boolean
    ambientEnabled?: boolean
  } = {},
): MascotInteractController {
  const schedule = opts.schedule ?? ((handler: () => void, ms: number) => window.setTimeout(handler, ms))
  const cancel = opts.cancel ?? ((handle: number) => window.clearTimeout(handle))
  const now = opts.now ?? (() => performance.now())
  const random = opts.random ?? Math.random
  const setAmbient = opts.setAmbient ?? (() => {})

  let enabled = opts.enabled ?? false
  let ambientEnabled = opts.ambientEnabled ?? false
  let acting: 'poke' | 'dizzy' | null = null
  let hovering = false
  let clicks: number[] = []
  let endTimer: number | undefined
  let current: MascotInteract | null = null
  let looking = false
  let ambientTimer: number | undefined

  const apply = (value: MascotInteract | null) => {
    current = value
    setInteract(value)
  }
  const clearEndTimer = () => {
    if (endTimer !== undefined) {
      cancel(endTimer)
      endTimer = undefined
    }
  }
  const finishOneShot = () => {
    acting = null
    // 播完时指针还停在球上就回到 hover 姿态，否则归位
    apply(hovering ? 'hover' : null)
  }

  // ---- 东张西望：随机间隔来一段，任何互动立即打断 ----
  const clearAmbientTimer = () => {
    if (ambientTimer !== undefined) {
      cancel(ambientTimer)
      ambientTimer = undefined
    }
  }
  const lookGap = () =>
    MASCOT_LOOK_GAP_MIN_MS + random() * (MASCOT_LOOK_GAP_MAX_MS - MASCOT_LOOK_GAP_MIN_MS)

  const scheduleLook = () => {
    if (ambientTimer !== undefined || looking) return
    ambientTimer = schedule(() => {
      ambientTimer = undefined
      // 正忙着（互动中 / 悬停中）就等下一轮
      if (!ambientEnabled || !enabled || acting || hovering || current !== null) {
        scheduleLook()
        return
      }
      looking = true
      setAmbient('look')
      ambientTimer = schedule(() => {
        looking = false
        ambientTimer = undefined
        setAmbient(null)
        scheduleLook()
      }, MASCOT_LOOK_MS)
    }, lookGap())
  }
  /** 打断张望并从新的间隔重新起算（悬停 / 点击 / 转晕都会调它）。 */
  const stopLook = () => {
    looking = false
    clearAmbientTimer()
    setAmbient(null)
    scheduleLook()
  }

  return {
    setEnabled(next: boolean) {
      enabled = next
    },

    setAmbientEnabled(next: boolean) {
      if (ambientEnabled === next) return
      ambientEnabled = next
      if (next) {
        scheduleLook()
        return
      }
      looking = false
      clearAmbientTimer()
      setAmbient(null)
    },

    reset() {
      hovering = false
      clicks = []
      acting = null
      looking = false
      clearEndTimer()
      clearAmbientTimer()
      apply(null)
      setAmbient(null)
      // reset 不动两个开关：还开着张望就从新的间隔继续
      if (ambientEnabled) scheduleLook()
    },

    dispose() {
      clearEndTimer()
      clearAmbientTimer()
    },

    onPointerEnter() {
      if (!enabled) return
      if (looking) stopLook()
      hovering = true
      if (acting) return // 一次性动画播完会自己落到 hover
      // 悬停退出还没走完就又回来了：取消收尾，直接回 hover
      clearEndTimer()
      apply('hover')
    },

    onPointerLeave() {
      if (!enabled) return
      hovering = false
      if (acting) return // 播完时 finishOneShot 会按 hovering 归位
      if (current === 'hover') {
        apply('hover-exit')
        clearEndTimer()
        endTimer = schedule(() => apply(null), MASCOT_HOVER_EXIT_MS)
      } else {
        apply(null)
      }
    },

    onPointerDown() {
      if (!enabled || acting === 'dizzy') return
      if (looking) stopLook()
      const t = now()
      clicks = clicks.filter((c) => t - c < MASCOT_DIZZY_WINDOW_MS)
      clicks.push(t)
      if (clicks.length >= MASCOT_DIZZY_CLICKS) {
        clicks = []
        clearEndTimer() // 转晕可以直接打断还没播完的 poke
        acting = 'dizzy'
        apply('dizzy')
        endTimer = schedule(finishOneShot, MASCOT_DIZZY_MS)
        return
      }
      if (acting === 'poke') return // poke 播放中的点击只计数，攒够 5 下就转晕
      clearEndTimer()
      acting = 'poke'
      apply('poke')
      endTimer = schedule(finishOneShot, MASCOT_POKE_MS)
    },
  }
}

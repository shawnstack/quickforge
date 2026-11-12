import { useEffect, useRef, useState } from 'react'
import { MASCOT_DURATIONS, type MascotStateId } from './mascot-geometry'

/**
 * 事件触发的小动作组（actions-preview.html 验收）：打招呼 / 伸懒腰 / 打哈欠 /
 * 偷看打字 / 被夸（惊讶在 mascot-interactions 里走连点 3 下的彩蛋，不在这）。
 *
 * 返回一个「叠加动作状态」，调用方在业务状态之上优先用它
 * （`state={strolling ? 'walk' : action ?? mascotState}`）。
 * 两层保险保证小动作永远不盖业务信息：
 *   ① 触发都要求 idle（思考 / 干活 / 提醒 / 开心是信息，不让卖萌盖掉）；
 *   ② 渲染层统一 gate——内部状态即使没来得及清，非对应窗口就返回 null。
 */

/** 夸奖词表：包含匹配，但每个词都够长，避免「不好」误中「好」这类单字误报。 */
export const MASCOT_PRAISE_WORDS = [
  '谢谢', '感谢', '太棒', '棒极了', '厉害', '好样的', '干得漂亮', '真不错', '靠谱', '点赞',
  'thank', 'thanks', 'nice', 'great', 'good job', 'well done', 'awesome', 'perfect',
] as const

/** 判断一条消息是否在夸 bot（不区分大小写）。 */
export function containsPraise(text: string): boolean {
  const lower = text.toLowerCase()
  return MASCOT_PRAISE_WORDS.some((word) => lower.includes(word))
}

/** 伸懒腰的节奏：idle 持续一段时间后偶尔来一次（比散步稀，比哈欠密）。 */
export const MASCOT_STRETCH_FIRST_MS = 35_000
export const MASCOT_STRETCH_GAP_MIN_MS = 35_000
export const MASCOT_STRETCH_GAP_MAX_MS = 55_000
/** 打哈欠的节奏：idle 很久才来一次，像个真困了的样子。 */
export const MASCOT_YAWN_AFTER_MS = 180_000
/** 偷看打字：停止输入这么多毫秒后就不好意思再盯着了。 */
export const MASCOT_PEEK_LINGER_MS = 2_500

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * @param enabled       bot 模式且输入框上方那只显示且开了动画
 * @param businessState useMascotState 的业务状态（不含动作）
 * @param strolling     正在溜达（walk 占住 data-state，小动作不抢）
 * @param activeBotId   当前 bot；切换（含进入）时打招呼
 * @param praiseCounter 发送的消息里带夸奖词时 +1；在下一个 happy 窗口（回答完成）换成 pleased
 */
export function useMascotActions(
  enabled: boolean,
  businessState: MascotStateId,
  strolling: boolean,
  activeBotId: string | null | undefined,
  praiseCounter: number,
): MascotStateId | null {
  const botId = activeBotId ?? null
  const idle = enabled && businessState === 'idle' && !strolling
  const [wave, setWave] = useState(false)
  const [ambient, setAmbient] = useState<'stretch' | 'yawn' | null>(null)
  const [peeking, setPeeking] = useState(false)
  const [pendingPraise, setPendingPraise] = useState(false)

  // ---- 打招呼：切换 bot（含进入 bot 模式）；挂载后的首次不算，免得刷新就挥手 ----
  const seenBotRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!enabled) {
      seenBotRef.current = undefined
      return
    }
    if (seenBotRef.current === undefined) {
      seenBotRef.current = botId
      return
    }
    if (seenBotRef.current === botId) return
    seenBotRef.current = botId
    setWave(true)
    const stop = window.setTimeout(() => setWave(false), MASCOT_DURATIONS.wave * 1000)
    return () => window.clearTimeout(stop)
    // idle 不在依赖里：挥手是否可见由渲染层 gate 决定，计时不受状态切换打断
  }, [enabled, botId])

  // ---- 伸懒腰 / 打哈欠：idle 小剧场（散步由 useMascotStroll 管，两边互不认识也不冲突：
  //      真撞上时 strolling 让 data-state=walk，渲染层 gate 会把小动作让位）----
  useEffect(() => {
    if (!idle || prefersReducedMotion()) return
    let gapTimer: number | undefined
    let actTimer: number | undefined
    let yawned = false

    const schedule = (delayMs: number) => {
      gapTimer = window.setTimeout(() => {
        const act = (!yawned && Date.now() - startedAt >= MASCOT_YAWN_AFTER_MS) ? 'yawn' : 'stretch'
        if (act === 'yawn') yawned = true
        setAmbient(act)
        actTimer = window.setTimeout(() => {
          setAmbient(null)
          schedule(MASCOT_STRETCH_GAP_MIN_MS
            + Math.random() * (MASCOT_STRETCH_GAP_MAX_MS - MASCOT_STRETCH_GAP_MIN_MS))
        }, MASCOT_DURATIONS[act] * 1000)
      }, delayMs)
    }

    const startedAt = Date.now()
    schedule(MASCOT_STRETCH_FIRST_MS)
    return () => {
      if (gapTimer !== undefined) window.clearTimeout(gapTimer)
      if (actTimer !== undefined) window.clearTimeout(actTimer)
    }
  }, [idle])

  // ---- 偷看打字：输入框里有输入就看向下方（document 级 input 监听，
  //      同 panel-decoration 的 DOM 桥模式；配 MASCOT_PEEK_LINGER_MS 的保活窗口）----
  useEffect(() => {
    if (!enabled) return
    let lingerTimer: number | undefined
    const inComposer = (target: EventTarget | null) => {
      const el = target instanceof HTMLElement ? target : null
      if (!el) return false
      const composer = el.closest('.quickforge-composer')
      return Boolean(composer && (el instanceof HTMLTextAreaElement || el.isContentEditable))
    }
    const onInput = (e: Event) => {
      if (!inComposer(e.target)) return
      const value = e.target instanceof HTMLTextAreaElement ? e.target.value
        : (e.target instanceof HTMLElement ? e.target.textContent : '') ?? ''
      if (!value.trim()) return
      setPeeking(true)
      if (lingerTimer !== undefined) window.clearTimeout(lingerTimer)
      lingerTimer = window.setTimeout(() => setPeeking(false), MASCOT_PEEK_LINGER_MS)
    }
    document.addEventListener('input', onInput)
    return () => {
      document.removeEventListener('input', onInput)
      if (lingerTimer !== undefined) window.clearTimeout(lingerTimer)
    }
  }, [enabled])

  // ---- 被夸：夸奖消息发出后记一笔，下一个 happy 窗口（回答完成，1.8s）换成 pleased ----
  useEffect(() => {
    if (praiseCounter <= 0) return
    const mark = window.setTimeout(() => setPendingPraise(true), 0)
    return () => window.clearTimeout(mark)
  }, [praiseCounter])
  useEffect(() => {
    if (!pendingPraise || businessState !== 'happy') return
    const done = window.setTimeout(() => setPendingPraise(false), MASCOT_DURATIONS.pleased * 1000)
    return () => window.clearTimeout(done)
  }, [pendingPraise, businessState])

  if (!enabled) return null
  if (peeking && idle) return 'peek'
  if (wave && idle) return 'wave'
  if (ambient && idle) return ambient
  if (pendingPraise && businessState === 'happy') return 'pleased'
  return null
}

import { useEffect, useState } from 'react'

/**
 * 一次散步的时长，与 `mascot-stroll.css` 的动画周期一致：
 * 播完一轮正好回到原位（末帧是 `translateX(0)`），所以不需要额外的收尾动画。
 */
export const MASCOT_STROLL_DURATION_MS = 9_000

/**
 * 两次散步之间的间隔。
 *
 * 这里踩过一次坑：第一版为了「安静」定成 45 秒，结果用户刷新后盯着看，头 45 秒它
 * 一动不动，反馈是「没看到 bot 有动作」。原因在于吉祥物的姿态动画是在 512 的坐标系里
 * 画的，缩到 34px 之后眼睛只移动约 1px —— 真正肉眼可见的动作只有这段横向位移。
 * 间隔取 20 秒：走动占约三成时间，既不吵，随便看一会儿也一定能看到。
 */
export const MASCOT_STROLL_GAP_MS = 20_000

/**
 * 挂载后第一次散步的延迟。只等两秒多，刷新完抬眼就看到它动一下，
 * 不用先干等一个完整间隔 —— 「是不是坏了」多半就是这么来的。
 */
export const MASCOT_STROLL_FIRST_DELAY_MS = 2_500

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 空闲时「偶尔溜达一下」：隔 45 秒走一轮 9 秒，其余时间原地站着。
 *
 * 早先这里是常驻的 9 秒无限循环 —— bot 只要闲着就一直在左右晃，结果「一直在动」把
 * 真正有事的那些状态全淹没了（用户原话：「总是左右移动这个不是很好吧」）。
 * 现在默认安静，动一下才有信息量；`enabled` 转 false（有状态了、或退出 bot 模式）立刻站定。
 *
 * 定时器只在回调里 setState，不在 effect 体内同步 setState —— 这条状态纯装饰，不值得多渲染一次。
 */
export function useMascotStroll(enabled: boolean): boolean {
  const [strolling, setStrolling] = useState(false)

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      const stop = window.setTimeout(() => setStrolling(false), 0)
      return () => window.clearTimeout(stop)
    }

    let gapTimer: number | undefined
    let walkTimer: number | undefined

    const scheduleWalk = (delayMs: number) => {
      gapTimer = window.setTimeout(() => {
        setStrolling(true)
        walkTimer = window.setTimeout(() => {
          setStrolling(false)
          scheduleWalk(MASCOT_STROLL_GAP_MS)
        }, MASCOT_STROLL_DURATION_MS)
      }, delayMs)
    }

    scheduleWalk(MASCOT_STROLL_FIRST_DELAY_MS)

    return () => {
      if (gapTimer !== undefined) window.clearTimeout(gapTimer)
      if (walkTimer !== undefined) window.clearTimeout(walkTimer)
    }
  }, [enabled])

  return strolling
}

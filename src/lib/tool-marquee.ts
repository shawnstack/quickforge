/**
 * subagent 摘要卡「当前工具」跑马灯的动画控制（纯逻辑，DOM 能力通过参数注入，便于单元测试）。
 *
 * 行为约定（与侧栏会话标题跑马灯的节奏一致）：
 * - 仅在文本溢出且未开启 prefers-reduced-motion 时滚动；
 * - 单循环：线性滚动（MARQUEE_SCROLL_SPEED_PX_PER_SECOND）→ 端部停顿 → ease-out 回弹，
 *   循环间保留 MARQUEE_RESTART_PAUSE_MS 起始停顿；
 * - text 变化才重建动画（同值高频刷新不打断滚动）；
 * - running=false / 无文本 / 不溢出时退化为静态省略号文本并清理内联样式。
 */

export const MARQUEE_SCROLL_SPEED_PX_PER_SECOND = 35
export const MARQUEE_START_DELAY_MS = 400
export const MARQUEE_END_PAUSE_MS = 1000
export const MARQUEE_RESTART_PAUSE_MS = 1000

export type ToolMarqueeSpan = {
  textContent: string
  scrollWidth: number
  style: {
    visibility: string
    display: string
    transform: string
  }
}

export type ToolMarqueeHost = {
  readonly staticSpan: ToolMarqueeSpan
  readonly movingSpan: ToolMarqueeSpan
  getClientWidth(): number
}

export type ToolMarqueeAnimation = {
  cancel(): void
  readonly finished: Promise<unknown>
}

export type ToolMarqueeEnv = {
  prefersReducedMotion(): boolean
  animate(
    span: ToolMarqueeSpan,
    keyframes: Array<{ transform: string; offset: number; easing: string }>,
    options: { duration: number; fill: 'forwards' },
  ): ToolMarqueeAnimation
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(token: unknown): void
}

export class ToolMarqueeController {
  private animation: ToolMarqueeAnimation | undefined
  private restartTimer: unknown
  private generation = 0
  private animatedText: string | undefined
  private readonly host: ToolMarqueeHost
  private readonly env: ToolMarqueeEnv

  constructor(host: ToolMarqueeHost, env: ToolMarqueeEnv) {
    this.host = host
    this.env = env
  }

  /** 元素断开或停用时调用：作废所有待续循环并清理内联样式。 */
  dispose() {
    this.generation += 1
    this.clearRestartTimer()
    this.stopAnimation()
  }

  /**
   * 同步文本与运行状态。
   * restart=true 强制重新测量并重建动画（宽度变化路径使用）；
   * 默认同值刷新不打断进行中的滚动。
   */
  sync(text: string, running: boolean, restart = false) {
    this.clearRestartTimer()
    this.host.staticSpan.textContent = text
    this.host.movingSpan.textContent = text

    if (!running || !text || this.env.prefersReducedMotion()) {
      this.stopAnimation()
      return
    }

    // 临时以自然宽度显示 moving span 测量溢出距离。
    this.host.movingSpan.style.display = 'inline-block'
    const distance = this.host.movingSpan.scrollWidth - this.host.getClientWidth()
    this.host.movingSpan.style.display = ''
    if (distance <= 1 || this.host.getClientWidth() <= 0) {
      this.stopAnimation()
      return
    }

    if (!restart && this.animation && this.animatedText === text) return

    this.stopAnimation()
    const generation = ++this.generation
    this.restartTimer = this.env.setTimeout(() => {
      this.restartTimer = undefined
      if (generation !== this.generation) return
      this.runCycle(generation, text, distance)
    }, MARQUEE_START_DELAY_MS)
  }

  private runCycle(generation: number, text: string, distance: number) {
    if (generation !== this.generation) return
    const { staticSpan, movingSpan } = this.host
    staticSpan.style.visibility = 'hidden'
    movingSpan.style.display = 'inline-block'

    const scrollDurationMs = distance / MARQUEE_SCROLL_SPEED_PX_PER_SECOND * 1000
    const returnDurationMs = Math.min(500, Math.max(240, scrollDurationMs * 0.25))
    const totalDurationMs = scrollDurationMs + MARQUEE_END_PAUSE_MS + returnDurationMs
    const endOffset = scrollDurationMs / totalDurationMs
    const returnOffset = (scrollDurationMs + MARQUEE_END_PAUSE_MS) / totalDurationMs

    const animation = this.env.animate(movingSpan, [
      { transform: 'translateX(0)', offset: 0, easing: 'linear' },
      { transform: `translateX(-${distance}px)`, offset: endOffset, easing: 'linear' },
      { transform: `translateX(-${distance}px)`, offset: returnOffset, easing: 'ease-out' },
      { transform: 'translateX(0)', offset: 1, easing: 'linear' },
    ], {
      duration: totalDurationMs,
      fill: 'forwards',
    })
    this.animation = animation
    this.animatedText = text

    void animation.finished.then(() => {
      if (this.animation !== animation || generation !== this.generation) return
      animation.cancel()
      this.animation = undefined
      staticSpan.style.visibility = ''
      movingSpan.style.display = ''
      movingSpan.style.transform = ''
      this.restartTimer = this.env.setTimeout(() => {
        this.restartTimer = undefined
        if (generation !== this.generation) return
        this.runCycle(generation, text, distance)
      }, MARQUEE_RESTART_PAUSE_MS)
    }).catch(() => undefined)
  }

  private clearRestartTimer() {
    if (this.restartTimer !== undefined) {
      this.env.clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
  }

  private stopAnimation() {
    if (this.animation) {
      this.animation.cancel()
      this.animation = undefined
    }
    this.host.staticSpan.style.visibility = ''
    this.host.movingSpan.style.display = ''
    this.host.movingSpan.style.transform = ''
    this.animatedText = undefined
  }
}

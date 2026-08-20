/**
 * subagent 摘要卡「当前工具」跑马灯的动画控制（纯逻辑，DOM 能力通过参数注入，便于单元测试）。
 *
 * 行为约定（与侧栏会话标题跑马灯的节奏一致）：
 * - 仅在文本溢出且未开启 prefers-reduced-motion 时滚动；
 * - 单循环：线性滚动（MARQUEE_SCROLL_SPEED_PX_PER_SECOND）→ 端部停顿 → ease-out 回弹，
 *   循环间保留 MARQUEE_RESTART_PAUSE_MS 起始停顿；
 * - text 变化才重建动画（同值高频刷新不打断滚动）；
 * - 容器内有两个等价视图（各含 static + moving span），text 切换时旧视图向上滚出、
 *   新视图自下方滚入（MARQUEE_ROLL_*，新闻条方向）：滚动期间旧视图的横向动画不中断，
 *   滚动结束后新视图按既有起始延迟重建横向循环；滚动进行中再收到新文本时先就地结算
 *   当前滚动再从新文本重新开始；
 * - running=false / 无文本 / 不溢出 / reduced-motion / 首次出现（无旧文本）时不滚动，
 *   退化为静态省略号文本并清理内联样式。
 */

export const MARQUEE_SCROLL_SPEED_PX_PER_SECOND = 35
export const MARQUEE_START_DELAY_MS = 400
export const MARQUEE_END_PAUSE_MS = 1000
export const MARQUEE_RESTART_PAUSE_MS = 1000
/** 纵向切换滚动：时长与缓动（与 diff 里程计同族）。 */
export const MARQUEE_ROLL_DURATION_MS = 260
export const MARQUEE_ROLL_EASING = 'cubic-bezier(.22, 1, .36, 1)'

export type ToolMarqueeSpan = {
  textContent: string
  scrollWidth: number
  style: {
    visibility: string
    display: string
    transform: string
  }
}

/** 纵向滚动的目标（视图元素）：只需可写的 transform 与 visibility。 */
export type ToolMarqueeRollElement = {
  style: {
    transform: string
    visibility: string
  }
}

export type ToolMarqueeView = {
  readonly el: ToolMarqueeRollElement
  readonly staticSpan: ToolMarqueeSpan
  readonly movingSpan: ToolMarqueeSpan
}

export type ToolMarqueeHost = {
  /** 两个等价视图：当前展示其一，另一个在 text 切换时作为新文本的滚入位。 */
  readonly views: [ToolMarqueeView, ToolMarqueeView]
  getClientWidth(): number
}

export type ToolMarqueeAnimation = {
  cancel(): void
  readonly finished: Promise<unknown>
}

export type ToolMarqueeEnv = {
  prefersReducedMotion(): boolean
  animate(
    target: ToolMarqueeSpan | ToolMarqueeRollElement,
    keyframes: Array<{ transform: string; offset: number; easing: string }>,
    options: { duration: number; fill: 'forwards' },
  ): ToolMarqueeAnimation
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(token: unknown): void
}

type ViewRuntime = {
  readonly view: ToolMarqueeView
  animation?: ToolMarqueeAnimation
  animatedText?: string
  restartTimer?: unknown
}

type RollState = {
  readonly animations: Array<ToolMarqueeAnimation>
  readonly outgoing: ViewRuntime
  readonly incoming: ViewRuntime
  readonly text: string
  readonly generation: number
}

export class ToolMarqueeController {
  private readonly runtimes: [ViewRuntime, ViewRuntime]
  private current: ViewRuntime
  private roll: RollState | undefined
  private generation = 0
  private text = ''
  private running = false
  private readonly host: ToolMarqueeHost
  private readonly env: ToolMarqueeEnv

  constructor(host: ToolMarqueeHost, env: ToolMarqueeEnv) {
    this.host = host
    this.env = env
    this.runtimes = host.views.map((view) => ({ view })) as [ViewRuntime, ViewRuntime]
    this.current = this.runtimes[0]
    // 视图 1 初始隐藏，仅作为下一次 text 切换的滚入位。
    this.runtimes[1].view.el.style.visibility = 'hidden'
  }

  /** 元素断开或停用时调用：作废所有待续循环与纵向滚动并清理内联样式。 */
  dispose() {
    this.generation += 1
    if (this.roll) {
      this.roll.animations.forEach((animation) => animation.cancel())
      this.roll = undefined
    }
    for (const runtime of this.runtimes) {
      this.clearViewTimer(runtime)
      this.stopViewAnimation(runtime)
      runtime.view.el.style.transform = ''
    }
  }

  /**
   * 同步文本与运行状态。
   * restart=true 强制重新测量并重建当前视图动画（宽度变化路径使用）；
   * 默认同值刷新不打断进行中的滚动；text 变化时旧视图滚出、新视图滚入。
   */
  sync(text: string, running: boolean, restart = false) {
    this.running = running
    if (text === this.text) {
      // 同值刷新（SSE 高频、工具间隙保持）：不打断任何进行中的动画；
      // running 结束的同值刷新仍需停止动画（与旧契约一致）。
      if (!running) {
        this.finishRoll()
        this.clearViewTimer(this.current)
        this.stopViewAnimation(this.current)
        return
      }
      // 宽度变化仅重测当前视图（纵向滚动中则等其结束后自然重测）；
      // 当前视图完全静止（既无动画也无排程）时自愈排程，覆盖 dispose 后的同值恢复。
      if (restart && !this.roll) {
        this.scheduleHorizontal(this.current, text, true)
        return
      }
      if (!this.roll && this.current.restartTimer === undefined && this.current.animation === undefined) {
        this.scheduleHorizontal(this.current, text, false)
      }
      return
    }
    const previous = this.text
    this.text = text
    const rollEligible = Boolean(previous && text && running) && !this.env.prefersReducedMotion()
    // 上一次滚动尚未结束又收到新文本：先就地结算，再从新状态继续。
    this.finishRoll()
    if (!rollEligible) {
      this.applyInstant(text)
      return
    }
    this.beginRoll()
  }

  private applyInstant(text: string) {
    this.current.view.staticSpan.textContent = text
    this.current.view.movingSpan.textContent = text
    this.resetOtherView()
    this.scheduleHorizontal(this.current, text, true)
  }

  private beginRoll() {
    const outgoing = this.current
    const incoming = this.otherOf(outgoing)
    incoming.view.staticSpan.textContent = this.text
    incoming.view.movingSpan.textContent = this.text
    this.stopViewAnimation(incoming)
    const generation = ++this.generation
    incoming.view.el.style.visibility = ''
    incoming.view.el.style.transform = 'translateY(100%)'
    outgoing.view.el.style.transform = 'translateY(0)'
    const animations = [
      this.env.animate(outgoing.view.el, [
        { transform: 'translateY(0)', offset: 0, easing: MARQUEE_ROLL_EASING },
        { transform: 'translateY(-100%)', offset: 1, easing: MARQUEE_ROLL_EASING },
      ], { duration: MARQUEE_ROLL_DURATION_MS, fill: 'forwards' }),
      this.env.animate(incoming.view.el, [
        { transform: 'translateY(100%)', offset: 0, easing: MARQUEE_ROLL_EASING },
        { transform: 'translateY(0)', offset: 1, easing: MARQUEE_ROLL_EASING },
      ], { duration: MARQUEE_ROLL_DURATION_MS, fill: 'forwards' }),
    ]
    this.roll = { animations, outgoing, incoming, text: this.text, generation }
    void Promise.all(animations.map((animation) => animation.finished)).then(() => {
      if (!this.roll || this.roll.generation !== generation) return
      this.finishRoll()
    }).catch(() => undefined)
  }

  /** 就地结算进行中的纵向滚动（自然完成或被打断）：新视图就位、旧视图隐藏并停横向动画。 */
  private finishRoll() {
    const roll = this.roll
    if (!roll) return
    this.roll = undefined
    roll.animations.forEach((animation) => animation.cancel())
    this.stopViewAnimation(roll.outgoing)
    roll.outgoing.view.el.style.transform = ''
    roll.outgoing.view.el.style.visibility = 'hidden'
    roll.incoming.view.el.style.transform = ''
    roll.incoming.view.el.style.visibility = ''
    this.current = roll.incoming
    // 用滚动自身的文本排程（中途被打断时 this.text 已是新文本，但新当前视图展示的
    // 仍是本次滚动的文本；随后 beginRoll 的 generation 会让该排程自然失效）。
    this.scheduleHorizontal(roll.incoming, roll.text, true)
  }

  private scheduleHorizontal(runtime: ViewRuntime, text: string, restart: boolean) {
    this.clearViewTimer(runtime)
    if (!this.running || !text || this.env.prefersReducedMotion()) {
      this.stopViewAnimation(runtime)
      return
    }

    // 临时以自然宽度显示 moving span 测量溢出距离。
    runtime.view.movingSpan.style.display = 'inline-block'
    const distance = runtime.view.movingSpan.scrollWidth - this.host.getClientWidth()
    runtime.view.movingSpan.style.display = ''
    if (distance <= 1 || this.host.getClientWidth() <= 0) {
      this.stopViewAnimation(runtime)
      return
    }

    if (!restart && runtime.animation && runtime.animatedText === text) return

    this.stopViewAnimation(runtime)
    const generation = ++this.generation
    runtime.restartTimer = this.env.setTimeout(() => {
      runtime.restartTimer = undefined
      if (generation !== this.generation) return
      this.runCycle(runtime, generation, text, distance)
    }, MARQUEE_START_DELAY_MS)
  }

  private runCycle(runtime: ViewRuntime, generation: number, text: string, distance: number) {
    if (generation !== this.generation) return
    const { staticSpan, movingSpan } = runtime.view
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
    runtime.animation = animation
    runtime.animatedText = text

    void animation.finished.then(() => {
      if (runtime.animation !== animation || generation !== this.generation) return
      animation.cancel()
      runtime.animation = undefined
      staticSpan.style.visibility = ''
      movingSpan.style.display = ''
      movingSpan.style.transform = ''
      runtime.restartTimer = this.env.setTimeout(() => {
        runtime.restartTimer = undefined
        if (generation !== this.generation) return
        this.runCycle(runtime, generation, text, distance)
      }, MARQUEE_RESTART_PAUSE_MS)
    }).catch(() => undefined)
  }

  private otherOf(runtime: ViewRuntime): ViewRuntime {
    return this.runtimes[0] === runtime ? this.runtimes[1] : this.runtimes[0]
  }

  private resetOtherView() {
    const other = this.otherOf(this.current)
    this.clearViewTimer(other)
    this.stopViewAnimation(other)
    other.view.el.style.transform = ''
    other.view.el.style.visibility = 'hidden'
  }

  private clearViewTimer(runtime: ViewRuntime) {
    if (runtime.restartTimer !== undefined) {
      this.env.clearTimeout(runtime.restartTimer)
      runtime.restartTimer = undefined
    }
  }

  private stopViewAnimation(runtime: ViewRuntime) {
    if (runtime.animation) {
      runtime.animation.cancel()
      runtime.animation = undefined
    }
    runtime.view.staticSpan.style.visibility = ''
    runtime.view.movingSpan.style.display = ''
    runtime.view.movingSpan.style.transform = ''
    runtime.animatedText = undefined
  }
}

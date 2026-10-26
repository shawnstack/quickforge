/**
 * 思考等级滑杆（模型选择弹层底部的控制区）。
 *
 * 三种表现都由本模块自持，外部只需要给 `level` 和 `onChange`：
 * - **翻滚数值**：五个档位的文字常驻一列，用 `translateY` 滚到当前档。
 *   不用「新节点入场 + 旧节点退场」，因为快速连续换档时退场定时器还没跑完，
 *   多个绝对定位节点会叠在一起。
 * - **拖动条**：渐变轨道 + 单个白色圆圈，没有档位刻度文字（滚动本身就是刻度）。
 * - **粒子**：canvas 叠在轨道内，随档位改变密度与流速，并按圆角裁剪，
 *   保证粒子不会溢出滑动条。`prefers-reduced-motion` 下完全不启用。
 */

export type ThinkingSliderLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh'

export const THINKING_SLIDER_LEVELS: ThinkingSliderLevel[] = ['off', 'low', 'medium', 'high', 'xhigh']

/** 档位在轨道上的位置（0..1）。首末档留出圆心不掉出圆角的余量。 */
const LEVEL_POSITIONS = [0.05, 0.275, 0.5, 0.725, 0.95]

/** 每档三段配置：粒子上限 / 每帧补充量 / 流速倍率。超高明显更密更快。 */
const LEVEL_CAP = [4, 16, 38, 82, 160]
const LEVEL_RATE = [0.02, 0.12, 0.36, 0.8, 1.7]
const LEVEL_SPEED = [0.72, 0.84, 1, 1.28, 1.85]

/** 与 `.quickforge-thinking-slider-track` 的背景渐变停点一致，粒子按所处位置取色。 */
const GRADIENT_STOPS: Array<[number, [number, number, number]]> = [
  [0, [10, 143, 132]],
  [0.15, [15, 157, 148]],
  [0.33, [11, 147, 184]],
  [0.52, [10, 126, 201]],
  [0.73, [20, 111, 216]],
  [1, [47, 124, 246]],
]

const TRAIL = 0.55

type Particle = {
  x: number
  y: number
  baseY: number
  amp: number
  phase: number
  wave: number
  vx: number
  r: number
  tone: 'light' | 'brand'
  age: number
  fadeIn: number
  dead?: boolean
}

export type ThinkingSliderHandle = {
  element: HTMLDivElement
  setLevel: (level: ThinkingSliderLevel, options?: { instant?: boolean }) => void
  setDisabled: (disabled: boolean) => void
  destroy: () => void
}

export type ThinkingSliderOptions = {
  level: ThinkingSliderLevel
  /** 档位到展示文案的映射，由调用方注入以复用 i18n。 */
  labelFor: (level: ThinkingSliderLevel) => string
  onChange: (level: ThinkingSliderLevel) => void
  disabled?: boolean
  /** 标题文案（"思考等级"）。 */
  title: string
  /** 无障碍标签，默认与标题一致。 */
  ariaLabel?: string
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function createThinkingSlider(options: ThinkingSliderOptions): ThinkingSliderHandle {
  let level: ThinkingSliderLevel = options.level
  let disabled = Boolean(options.disabled)
  const reducedMotion = prefersReducedMotion()

  const element = document.createElement('div')
  element.className = 'quickforge-model-thinking'

  const head = document.createElement('div')
  head.className = 'quickforge-model-thinking-head'

  const title = document.createElement('span')
  title.className = 'quickforge-model-thinking-title'
  title.textContent = options.title

  const value = document.createElement('span')
  value.className = 'quickforge-model-thinking-value'
  const stack = document.createElement('span')
  stack.className = 'quickforge-model-thinking-stack'
  stack.dataset.instant = 'true'
  value.append(stack)

  head.append(title, value)

  const sliderWrap = document.createElement('div')
  sliderWrap.className = 'quickforge-model-thinking-slider'

  const track = document.createElement('div')
  track.className = 'quickforge-model-thinking-track'
  track.setAttribute('role', 'slider')
  track.tabIndex = 0
  track.setAttribute('aria-label', options.ariaLabel ?? options.title)
  track.setAttribute('aria-valuemin', '0')
  track.setAttribute('aria-valuemax', String(THINKING_SLIDER_LEVELS.length - 1))

  const canvas = document.createElement('canvas')
  canvas.className = 'quickforge-model-thinking-fx'
  canvas.setAttribute('aria-hidden', 'true')

  const knob = document.createElement('span')
  knob.className = 'quickforge-model-thinking-knob'

  track.append(canvas, knob)
  sliderWrap.append(track)
  element.append(head, sliderWrap)

  /* ---------------- 翻滚数值 ---------------- */
  const rows = THINKING_SLIDER_LEVELS.map((item) => {
    const row = document.createElement('span')
    row.textContent = options.labelFor(item)
    stack.append(row)
    return row
  })

  function lineHeight() {
    return rows[0]?.offsetHeight || 0
  }

  function positionStack(target: number) {
    const line = lineHeight()
    if (!line) return
    stack.style.transform = `translateY(${(-target * line).toFixed(2)}px)`
  }

  function renderValue(instant: boolean) {
    const index = THINKING_SLIDER_LEVELS.indexOf(level)
    stack.dataset.instant = instant ? 'true' : 'false'
    if (instant) {
      // 首帧定位不能带动画，否则会从上一档滑进来。
      requestAnimationFrame(() => { stack.dataset.instant = 'false' })
    }
    positionStack(index)
    track.setAttribute('aria-valuenow', String(index))
    track.setAttribute('aria-valuetext', options.labelFor(level))
    knob.style.left = `${(LEVEL_POSITIONS[index] * 100).toFixed(2)}%`
  }

  /* ---------------- 粒子 ---------------- */
  let particles: Particle[] = []
  let rafId = 0
  let dragging = false
  let flowOn = false
  let dpr = 1
  let fxW = 0
  let fxH = 0
  let context: CanvasRenderingContext2D | null = null

  try {
    context = canvas.getContext('2d')
  } catch {
    // jsdom 等无 canvas 实现的环境：滑杆仍然可用，只是没有粒子。
    context = null
  }

  /** 尺寸是否已经从布局中拿到。元素插入 DOM 前 getBoundingClientRect 全 0。 */
  function hasLayout() {
    return fxW > 0 && fxH > 0
  }

  function colorAt(ratio: number) {
    const clamped = Math.min(1, Math.max(0, ratio))
    for (let i = 1; i < GRADIENT_STOPS.length; i += 1) {
      const [p1, c1] = GRADIENT_STOPS[i]
      const [p0, c0] = GRADIENT_STOPS[i - 1]
      if (clamped <= p1) {
        const t = (clamped - p0) / (p1 - p0 || 1)
        const r = Math.round(c0[0] + (c1[0] - c0[0]) * t)
        const g = Math.round(c0[1] + (c1[1] - c0[1]) * t)
        const b = Math.round(c0[2] + (c1[2] - c0[2]) * t)
        return `rgb(${r} ${g} ${b})`
      }
    }
    return 'rgb(47 124 246)'
  }

  function resizeFx() {
    if (!context) return
    const rect = track.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    dpr = Math.min(2, window.devicePixelRatio || 1)
    fxW = rect.width
    fxH = rect.height
    canvas.width = Math.round(fxW * dpr)
    canvas.height = Math.round(fxH * dpr)
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function levelIndex() {
    return THINKING_SLIDER_LEVELS.indexOf(level)
  }

  function knobPx() {
    return LEVEL_POSITIONS[levelIndex()] * fxW
  }

  function levelCap() {
    return LEVEL_CAP[levelIndex()]
  }

  function trimToCap() {
    const cap = levelCap()
    if (particles.length > cap) particles = particles.slice(particles.length - cap)
  }

  function spawnTrail(count: number, speed = 1) {
    if (reducedMotion || !context || !fxW || !fxH) return
    const knobX = knobPx()
    const speedScale = LEVEL_SPEED[levelIndex()]
    const span = Math.max(20, knobX * TRAIL * (0.35 + speedScale * 0.62))
    for (let i = 0; i < count; i += 1) {
      const y = fxH / 2 + (Math.random() - 0.5) * fxH * 0.72
      particles.push({
        x: knobX - Math.random() * span,
        y,
        baseY: y,
        amp: 0.5 + Math.random() * 1.7,
        phase: Math.random() * Math.PI * 2,
        wave: 0.016 + Math.random() * 0.032,
        vx: -(0.34 + Math.random() * 0.62) * speed * speedScale,
        r: (0.75 + Math.random() * 1.35) * (0.85 + speedScale * 0.22),
        tone: Math.random() < 0.7 ? 'light' : 'brand',
        age: 0,
        fadeIn: 8 + Math.random() * 14,
      })
    }
    trimToCap()
  }

  function frame() {
    rafId = 0
    if (!context) return
    context.clearRect(0, 0, fxW, fxH)

    context.save()
    context.beginPath()
    const radius = Math.min(fxH / 2, fxW / 2)
    if (typeof context.roundRect === 'function') context.roundRect(0, 0, fxW, fxH, radius)
    else context.rect(0, 0, fxW, fxH)
    context.clip()

    const knobX = knobPx()
    const speedScale = LEVEL_SPEED[levelIndex()]
    const span = Math.max(20, knobX * TRAIL * (0.35 + speedScale * 0.62))

    const cap = levelCap()
    const rate = LEVEL_RATE[levelIndex()] * (dragging ? 1.6 : 1)
    if (flowOn && !disabled && particles.length < cap && knobX > 6) {
      let n = Math.floor(rate)
      if (Math.random() < rate - n) n += 1
      if (n > 0) spawnTrail(n, dragging ? 1.25 : 1)
    }

    for (const particle of particles) {
      particle.age += 1
      particle.x += particle.vx
      particle.phase += particle.wave
      particle.y = particle.baseY + Math.sin(particle.phase) * particle.amp

      const distance = knobX - particle.x
      let alpha = 1
      if (particle.age < particle.fadeIn) alpha = particle.age / particle.fadeIn
      if (distance >= 0) alpha *= Math.max(0, 1 - distance / span)
      else alpha *= Math.max(0, 1 - -distance / 14)
      if (particle.x < 18) alpha = Math.min(alpha, Math.max(0, particle.x / 18))

      if (alpha <= 0.03) {
        if (distance > span || particle.x < 18) particle.dead = true
        else continue
      }
      if (particle.dead) continue

      context.globalAlpha = alpha * 0.85
      context.fillStyle = particle.tone === 'light'
        ? (particle.r > 1.6 ? 'rgb(255 255 255)' : 'rgb(232 248 255)')
        : colorAt(particle.x / fxW)
      context.beginPath()
      context.arc(particle.x, particle.y, Math.max(0.4, particle.r * (0.55 + alpha * 0.55)), 0, Math.PI * 2)
      context.fill()
    }

    context.globalAlpha = 1
    context.restore()

    particles = particles.filter((particle) => !particle.dead && particle.x > -12)
    if (particles.length > levelCap()) trimToCap()

    if ((flowOn && !disabled && knobX > 6) || particles.length) rafId = requestAnimationFrame(frame)
    else if (fxW > 0) context.clearRect(0, 0, fxW, fxH)
  }

  function startFlow() {
    if (reducedMotion || !context) return
    resizeFx()
    // 元素还没进 DOM 时尺寸是 0：不启动循环（否则 rAF 会立刻因 knobX<=6 停掉，
    // 之后再也没有机会恢复）。等 ResizeObserver 拿到真实尺寸再启动。
    if (!hasLayout()) return
    flowOn = true
    if (!particles.length) {
      spawnTrail(Math.max(1, Math.round(levelCap() * 0.75)))
      for (const particle of particles) particle.age = particle.fadeIn
    }
    if (!rafId) rafId = requestAnimationFrame(frame)
  }

  function stopFlow() {
    flowOn = false
    particles = []
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    if (context && fxW > 0) context.clearRect(0, 0, fxW, fxH)
  }

  /* ---------------- 交互 ---------------- */
  function setLevel(next: ThinkingSliderLevel, renderOptions?: { instant?: boolean }) {
    const changed = next !== level
    level = next
    renderValue(Boolean(renderOptions?.instant))
    trimToCap()
    if (changed && !disabled) spawnTrail(6, 1.4)
  }

  function setDisabled(next: boolean) {
    disabled = next
    track.setAttribute('aria-disabled', String(next))
    track.tabIndex = next ? -1 : 0
    if (next) stopFlow()
    else if (flowOn) startFlow()
  }

  function indexFromX(clientX: number) {
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    let best = 0
    LEVEL_POSITIONS.forEach((position, index) => {
      if (Math.abs(position - ratio) < Math.abs(LEVEL_POSITIONS[best] - ratio)) best = index
    })
    return best
  }

  const onPointerDown = (event: PointerEvent) => {
    if (disabled) return
    event.preventDefault()
    if (typeof track.focus === 'function') track.focus()
    resizeFx()
    dragging = true
    sliderWrap.classList.add('is-dragging')
    // jsdom / 老浏览器可能没有 setPointerCapture，缺失时退化为 window 监听。
    if (typeof track.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        track.setPointerCapture(event.pointerId)
      } catch {
        /* 忽略：不影响拖动，只是失去自动捕获 */
      }
    }

    const applyIndex = (index: number) => {
      const next = THINKING_SLIDER_LEVELS[index]
      if (next === level) return
      setLevel(next)
      options.onChange(next)
    }

    applyIndex(indexFromX(event.clientX))

    const move = (moveEvent: PointerEvent) => {
      applyIndex(indexFromX(moveEvent.clientX))
    }
    const up = () => {
      dragging = false
      sliderWrap.classList.remove('is-dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (disabled) return
    const current = levelIndex()
    let next: number
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(current + 1, THINKING_SLIDER_LEVELS.length - 1)
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(current - 1, 0)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = THINKING_SLIDER_LEVELS.length - 1
    else return
    event.preventDefault()
    if (next === current) return
    setLevel(THINKING_SLIDER_LEVELS[next])
    options.onChange(level)
  }

  track.addEventListener('pointerdown', onPointerDown as EventListener)
  track.addEventListener('keydown', onKeyDown as EventListener)

  // 滑杆在被 append 到弹层之前就已创建，此时没有布局尺寸。用一个
  // ResizeObserver 等轨道拿到真实尺寸后再启动粒子循环；同时负责窗口/布局
  // 变化后的画布尺寸同步（弹层打开前 display 为 none、字体加载、缩放都会变）。
  let observer: ResizeObserver | null = null
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      const hadLayout = hasLayout()
      resizeFx()
      if (!hasLayout()) return
      if (!hadLayout) startFlow()
      else if (flowOn && !rafId) startFlow()
    })
    observer.observe(track)
  }

  renderValue(true)
  setDisabled(disabled)
  startFlow()

  return {
    element,
    setLevel,
    setDisabled,
    destroy: () => {
      stopFlow()
      observer?.disconnect()
      observer = null
      track.removeEventListener('pointerdown', onPointerDown as EventListener)
      track.removeEventListener('keydown', onKeyDown as EventListener)
    },
  }
}

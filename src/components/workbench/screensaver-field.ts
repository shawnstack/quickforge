import { deriveScreensaverPalette, type ScreensaverPalette } from './screensaver-palette'

/**
 * 屏保氛围场：一层 canvas 画底色渐变、三团缓慢游走的极光、视差星尘与偶发流星。
 * 一个 rAF 循环驱动全部；DPR 封顶、页面隐藏即停、动效为 0 或系统减弱动效时只画一帧。
 * 拿不到 2d context 时退化成空控制器，CSS 底色仍在，屏保不会白屏。
 */

export type ScreensaverFieldOptions = {
  accent: string
  motion: number
  glow: number
  density: number
  reducedMotion: boolean
}

export type ScreensaverField = {
  update: (options: ScreensaverFieldOptions) => void
  destroy: () => void
}

type Star = { x: number; y: number; z: number; radius: number; phase: number; twinkle: number }
type Meteor = { x: number; y: number; vx: number; vy: number; life: number; span: number }

const MAX_DPR = 1.75
const AURORA = [
  { key: 'accent', cx: 0.26, cy: 0.32, ax: 0.10, ay: 0.07, fx: 0.031, fy: 0.023, phase: 0, size: 0.62 },
  { key: 'companion', cx: 0.76, cy: 0.58, ax: 0.09, ay: 0.09, fx: 0.021, fy: 0.037, phase: 2.1, size: 0.55 },
  { key: 'counter', cx: 0.48, cy: 0.92, ax: 0.12, ay: 0.05, fx: 0.017, fy: 0.029, phase: 4.2, size: 0.48 },
] as const

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function starCount(density: number): number {
  return 26 + Math.round((Math.min(100, Math.max(0, density)) / 100) * 188)
}

function makeStars(count: number): Star[] {
  return Array.from({ length: count }, (_, index) => {
    const z = [0.34, 0.62, 1][index % 3]
    return {
      x: Math.random(),
      y: Math.random(),
      z,
      radius: 0.35 + Math.random() * 1.15,
      phase: Math.random() * Math.PI * 2,
      twinkle: 0.25 + Math.random() * 0.85,
    }
  })
}

export function createScreensaverField(canvas: HTMLCanvasElement, initial: ScreensaverFieldOptions): ScreensaverField {
  const ctx = canvas.getContext('2d')
  if (!ctx) return { update: () => {}, destroy: () => {} }

  let options = initial
  let palette: ScreensaverPalette = deriveScreensaverPalette(initial.accent)
  let stars = makeStars(starCount(initial.density))
  let meteor: Meteor | null = null
  let nextMeteorIn = 6 + Math.random() * 8
  let width = 0
  let height = 0
  let dpr = 1
  let clock = 0
  let last = 0
  let raf = 0
  let destroyed = false

  const speed = () => 0.16 + (options.motion / 100) * 1.55
  const animated = () => !options.reducedMotion && options.motion > 0

  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    const nextWidth = Math.max(1, Math.round(rect.width))
    const nextHeight = Math.max(1, Math.round(rect.height))
    const nextDpr = Math.min(MAX_DPR, globalThis.devicePixelRatio || 1)
    if (nextWidth === width && nextHeight === height && nextDpr === dpr) return
    width = nextWidth
    height = nextHeight
    dpr = nextDpr
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    draw()
  }

  const draw = () => {
    if (destroyed || width === 0 || height === 0) return
    const scale = Math.max(0.42, Math.min(1.6, Math.min(width, height) / 760))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1

    const base = ctx.createLinearGradient(0, 0, width * 0.35, height)
    base.addColorStop(0, palette.void)
    base.addColorStop(0.55, palette.deep)
    base.addColorStop(1, palette.void)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, width, height)

    ctx.globalCompositeOperation = 'lighter'
    const glow = options.glow / 100
    const reach = Math.max(width, height)
    for (const blob of AURORA) {
      const cx = (blob.cx + blob.ax * Math.sin(clock * blob.fx * Math.PI * 2 + blob.phase)) * width
      const cy = (blob.cy + blob.ay * Math.cos(clock * blob.fy * Math.PI * 2 + blob.phase)) * height
      const radius = reach * blob.size * (0.72 + glow * 0.5)
      const color = palette[blob.key]
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
      gradient.addColorStop(0, withAlpha(color, 0.05 + glow * 0.2))
      gradient.addColorStop(0.45, withAlpha(color, 0.02 + glow * 0.07))
      gradient.addColorStop(1, withAlpha(color, 0))
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
    }

    const horizon = ctx.createRadialGradient(width * 0.5, height * 1.06, 0, width * 0.5, height * 1.06, width * 0.7)
    horizon.addColorStop(0, withAlpha(palette.accent, 0.05 + glow * 0.12))
    horizon.addColorStop(1, withAlpha(palette.accent, 0))
    ctx.fillStyle = horizon
    ctx.fillRect(0, 0, width, height)

    for (const star of stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(clock * star.twinkle + star.phase)
      ctx.globalAlpha = (0.16 + star.z * 0.5) * (0.45 + twinkle * 0.55)
      ctx.fillStyle = star.z > 0.9 ? palette.numeral : palette.accent
      ctx.beginPath()
      ctx.arc(star.x * width, star.y * height, star.radius * star.z * scale, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    if (meteor) {
      const progress = meteor.life / meteor.span
      const fade = Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI)
      const tailX = meteor.x - meteor.vx * 0.16
      const tailY = meteor.y - meteor.vy * 0.16
      const trail = ctx.createLinearGradient(tailX, tailY, meteor.x, meteor.y)
      trail.addColorStop(0, withAlpha(palette.companion, 0))
      trail.addColorStop(1, withAlpha(palette.numeral, 0.5 * fade))
      ctx.strokeStyle = trail
      ctx.lineWidth = 1.4 * scale
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(tailX, tailY)
      ctx.lineTo(meteor.x, meteor.y)
      ctx.stroke()
    }

    ctx.globalCompositeOperation = 'source-over'
    const vignette = ctx.createRadialGradient(width * 0.5, height * 0.48, Math.min(width, height) * 0.24, width * 0.5, height * 0.5, reach * 0.78)
    vignette.addColorStop(0, withAlpha(palette.void, 0))
    vignette.addColorStop(1, withAlpha(palette.void, 0.72))
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, width, height)
  }

  const step = (delta: number) => {
    const factor = speed()
    clock += delta * factor
    for (const star of stars) {
      star.x += (0.0035 + star.z * 0.011) * delta * factor
      star.y += Math.sin(clock * 0.22 + star.phase) * 0.00022 * delta * factor
      if (star.x > 1.04) { star.x = -0.04; star.y = Math.random() }
      if (star.y > 1.04) star.y = -0.04
      else if (star.y < -0.04) star.y = 1.04
    }
    if (meteor) {
      meteor.x += meteor.vx * delta
      meteor.y += meteor.vy * delta
      meteor.life += delta
      if (meteor.life >= meteor.span) meteor = null
    } else {
      nextMeteorIn -= delta * factor
      if (nextMeteorIn <= 0) {
        nextMeteorIn = 7 + Math.random() * 11
        const span = 1.1 + Math.random() * 0.7
        const vx = width * (0.42 + Math.random() * 0.2)
        const vy = height * (0.16 + Math.random() * 0.12)
        meteor = { x: width * (0.05 + Math.random() * 0.4), y: height * (0.04 + Math.random() * 0.3), vx, vy, life: 0, span }
      }
    }
  }

  const frame = (time: number) => {
    if (destroyed) return
    const delta = last === 0 ? 0 : Math.min(0.05, (time - last) / 1000)
    last = time
    step(delta)
    draw()
    raf = requestAnimationFrame(frame)
  }

  const stop = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    last = 0
  }

  const start = () => {
    if (destroyed || raf) return
    if (!animated()) { draw(); return }
    if (typeof document !== 'undefined' && document.hidden) return
    raf = requestAnimationFrame(frame)
  }

  const onVisibility = () => {
    if (typeof document === 'undefined') return
    if (document.hidden) stop()
    else start()
  }

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => resize())
  observer?.observe(canvas)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
  resize()
  start()

  return {
    update(next) {
      const accentChanged = next.accent !== options.accent
      const countChanged = starCount(next.density) !== stars.length
      const wasAnimated = animated()
      options = next
      if (accentChanged) palette = deriveScreensaverPalette(next.accent)
      if (countChanged) stars = makeStars(starCount(next.density))
      if (!animated()) {
        stop()
        meteor = null
        draw()
        return
      }
      if (!wasAnimated) start()
      else if (!raf) start()
    },
    destroy() {
      destroyed = true
      stop()
      observer?.disconnect()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      stars = []
      meteor = null
    },
  }
}
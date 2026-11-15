import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScreensaverField } from '../../src/components/workbench/screensaver-field'

// 无 DOM 环境下用假 canvas / 假 rAF 队列跑真实循环：验证尺寸、单循环、销毁与降级。

type Gradient = { addColorStop: (offset: number, color: string) => void }

function makeContext() {
  const gradient: Gradient = { addColorStop: () => {} }
  return {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    lineCap: 'butt',
    setTransform: () => {},
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    fillRect: () => { calls.fillRect++ },
    beginPath: () => {},
    arc: () => { calls.arc++ },
    fill: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => { calls.stroke++ },
  }
}

const calls = { arc: 0, fillRect: 0, stroke: 0 }

function makeCanvas(rect: { width: number; height: number }, context: unknown) {
  return {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => rect,
  } as unknown as HTMLCanvasElement
}

let frames: Map<number, FrameRequestCallback>
let nextHandle: number
let observers: { callback: () => void; disconnected: boolean }[]
let visibilityListeners: (() => void)[]
let hidden: boolean

function runFrames(count: number, startAt = 1000) {
  for (let i = 0; i < count; i++) {
    const pending = [...frames.entries()]
    frames.clear()
    for (const [, callback] of pending) callback(startAt + i * 16)
  }
}

beforeEach(() => {
  calls.arc = 0
  calls.fillRect = 0
  calls.stroke = 0
  frames = new Map()
  nextHandle = 1
  observers = []
  visibilityListeners = []
  hidden = false
  vi.stubGlobal('devicePixelRatio', 2)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const handle = nextHandle++
    frames.set(handle, callback)
    return handle
  })
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => { frames.delete(handle) })
  vi.stubGlobal('ResizeObserver', class {
    private entry: { callback: () => void; disconnected: boolean }
    constructor(callback: () => void) {
      this.entry = { callback, disconnected: false }
      observers.push(this.entry)
    }
    observe() {}
    disconnect() { this.entry.disconnected = true }
  })
  vi.stubGlobal('document', {
    get hidden() { return hidden },
    addEventListener: (_type: string, listener: () => void) => { visibilityListeners.push(listener) },
    removeEventListener: (_type: string, listener: () => void) => {
      visibilityListeners = visibilityListeners.filter((item) => item !== listener)
    },
  })
})

afterEach(() => vi.unstubAllGlobals())

const base = { accent: '#3aa981', motion: 55, glow: 62, density: 55, reducedMotion: false }

describe('屏保氛围场运行时', () => {
  it('按 CSS 尺寸铺画布，DPR 封顶 1.75 而不是把每个设备像素都画一遍', () => {
    const canvas = makeCanvas({ width: 800, height: 500 }, makeContext())
    const field = createScreensaverField(canvas, base)
    expect(canvas.width).toBe(1400)
    expect(canvas.height).toBe(875)
    expect(calls.fillRect).toBeGreaterThan(0)
    field.destroy()
  })

  it('只有一个 rAF 循环：连跑多帧、反复 update 都不会叠出第二个', () => {
    const canvas = makeCanvas({ width: 800, height: 500 }, makeContext())
    const field = createScreensaverField(canvas, base)
    expect(frames.size).toBe(1)
    runFrames(30)
    expect(frames.size).toBe(1)
    for (let i = 0; i < 10; i++) {
      field.update({ ...base, glow: 20 + i * 7, accent: i % 2 ? '#6cb6ff' : '#3aa981' })
      runFrames(3)
      expect(frames.size).toBe(1)
    }
    field.destroy()
    expect(frames.size).toBe(0)
  })

  it('星尘密度真的改变每帧绘制量', () => {
    const canvas = makeCanvas({ width: 800, height: 500 }, makeContext())
    const field = createScreensaverField(canvas, { ...base, density: 0 })
    runFrames(1)
    const sparse = calls.arc
    calls.arc = 0
    field.update({ ...base, density: 100 })
    runFrames(1)
    expect(calls.arc).toBeGreaterThan(sparse * 3)
    field.destroy()
  })

  it('动效为 0 或系统减弱动效时只画一帧，不排循环', () => {
    const canvas = makeCanvas({ width: 800, height: 500 }, makeContext())
    const still = createScreensaverField(canvas, { ...base, motion: 0 })
    expect(frames.size).toBe(0)
    expect(calls.fillRect).toBeGreaterThan(0)
    still.update({ ...base, motion: 0, reducedMotion: true })
    expect(frames.size).toBe(0)
    still.update({ ...base, motion: 60 })
    expect(frames.size).toBe(1)
    still.destroy()

    const reduced = createScreensaverField(canvas, { ...base, reducedMotion: true })
    expect(frames.size).toBe(0)
    reduced.destroy()
  })

  it('页面隐藏即停、回到前台再起；销毁后取消循环、断开观察器与监听', () => {
    const canvas = makeCanvas({ width: 800, height: 500 }, makeContext())
    const field = createScreensaverField(canvas, base)
    expect(visibilityListeners.length).toBe(1)
    hidden = true
    visibilityListeners[0]()
    expect(frames.size).toBe(0)
    hidden = false
    visibilityListeners[0]()
    expect(frames.size).toBe(1)
    field.destroy()
    expect(frames.size).toBe(0)
    expect(observers[0].disconnected).toBe(true)
    expect(visibilityListeners.length).toBe(0)
    const before = calls.fillRect
    runFrames(5)
    expect(calls.fillRect).toBe(before)
  })

  it('容器尺寸变化后重新按新尺寸铺画布', () => {
    const rect = { width: 800, height: 500 }
    const canvas = makeCanvas(rect, makeContext())
    const field = createScreensaverField(canvas, base)
    rect.width = 360
    rect.height = 225
    observers[0].callback()
    expect(canvas.width).toBe(630)
    expect(canvas.height).toBe(394)
    field.destroy()
  })

  it('拿不到 2d context 时退化成空控制器，调用不抛错', () => {
    const canvas = makeCanvas({ width: 800, height: 500 }, null)
    const field = createScreensaverField(canvas, base)
    expect(frames.size).toBe(0)
    expect(() => { field.update({ ...base, glow: 10 }); field.destroy() }).not.toThrow()
  })
})
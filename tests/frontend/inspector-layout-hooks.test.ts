import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HookLifecycle, flushPromises } from './helpers/hook-lifecycle'
import { originalInspectorDomain } from './helpers/inspector-domain-fixture'

vi.mock('react', async () => (await import('./helpers/hook-lifecycle')).hookRuntime)

import { useInspectorLayoutState, useInspectorViewport, useInspectorVisibility, useInspectorWidth, useInspectorLayoutActions } from '../../src/components/workspace/useInspectorLayout'

function useCurrentLayout(props: ReturnType<typeof inputs>) {
  const state = useInspectorLayoutState(props)
  const options = { ...state, ...props }
  useInspectorViewport(options)
  useInspectorVisibility(options)
  useInspectorWidth(options)
  return { ...state, ...useInspectorLayoutActions(options) }
}
const useLayout = (process.env.QF_INSPECTOR_BASELINE_TEST === '1'
  ? originalInspectorDomain(readFileSync('.goal-runtime-refactor-baseline/Inspector-before-split.tsx', 'utf8'),
    [[729, 729], [731, 740], [744, 750], [774, 781], [958, 988], [1050, 1081], [1697, 1924]], [[133, 139], [245, 280]])
  : useCurrentLayout) as (props: ReturnType<typeof inputs>) => Layout
// Narrow test interface; the executed implementation is selected directly from source.
type Pointer = { clientX: number; pointerId: number; preventDefault: () => void; currentTarget: { setPointerCapture: () => void; releasePointerCapture: () => void } }
type Layout = {
  width: number; leftWidth: number; mounted: boolean; visible: boolean; fullscreen: boolean; fullscreenAnimating: boolean; mobileOverlay: boolean
  asideRef: { current: unknown }; startResizing: (event: Pointer) => void; resize: (event: Pointer) => void; stopResizing: (event: Pointer) => void
  startNavResizing: (event: Pointer) => void; navResize: (event: Pointer) => void; stopNavResizing: (event: Pointer) => void
  toggleFullscreen: (afterExit?: () => void) => void
}
function inputs() { return { open: true, onFullscreenChange: vi.fn(), leftSidebarWidth: 240, conversationMinWidth: 440, activePanelTab: undefined as { kind: string } | undefined, activeReaderTabId: undefined as string | undefined } }
let lifecycle: HookLifecycle
let frames: Map<number, FrameRequestCallback>
let windowEvents: EventTarget
let documentEvents: EventTarget
let media: EventTarget & { matches: boolean }
let storage: Map<string, string>
let frameId: number
const widthKey = 'quickforge_workspaceInspectorWidth_v2'
function frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)) }
function pointer(clientX: number): Pointer { return { clientX, pointerId: 1, preventDefault: vi.fn(), currentTarget: { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() } } }
function aside() {
  const animations: Array<{ onfinish?: () => void; oncancel?: () => void; cancel: () => void }> = []
  const element = { style: {} as Record<string, string>, removeAttribute: vi.fn(), getBoundingClientRect: () => ({ left: 1220, top: 32, width: 380, height: 868 }), animate: vi.fn(() => {
    const animation = { onfinish: undefined as (() => void) | undefined, oncancel: undefined as (() => void) | undefined, cancel: vi.fn() }
    animations.push(animation)
    return animation
  }) }
  return { element, animations }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  lifecycle = new HookLifecycle(); frames = new Map(); frameId = 0; storage = new Map()
  windowEvents = new EventTarget(); documentEvents = new EventTarget(); media = Object.assign(new EventTarget(), { matches: true })
  vi.stubGlobal('window', {
    innerWidth: 1600, innerHeight: 900, setTimeout, clearTimeout,
    addEventListener: vi.fn(windowEvents.addEventListener.bind(windowEvents)), removeEventListener: vi.fn(windowEvents.removeEventListener.bind(windowEvents)),
    matchMedia: () => media, getComputedStyle: () => ({ getPropertyValue: () => '32px' }),
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId }, cancelAnimationFrame: (id: number) => frames.delete(id),
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  })
  vi.stubGlobal('document', { body: { style: { cursor: 'crosshair', userSelect: 'text' } }, addEventListener: vi.fn(documentEvents.addEventListener.bind(documentEvents)), removeEventListener: vi.fn(documentEvents.removeEventListener.bind(documentEvents)) })
})
afterEach(() => { lifecycle.unmount(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('restores global width within viewport bounds and re-clamps on window resize, removing its listener', () => {
  storage.set(widthKey, '5000')
  const props = inputs(); const render = () => lifecycle.render(() => useLayout(props))
  expect(render().width).toBe(919)
  window.innerWidth = 1000
  windowEvents.dispatchEvent(new Event('resize'))
  expect(render().width).toBe(340)
  expect(storage.get(widthKey)).toBe('340')
  lifecycle.unmount()
  expect(window.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
})
it('coalesces outer resize RAFs, commits width on pointer stop and restores body styles', () => {
  const props = inputs(); const render = () => lifecycle.render(() => useLayout(props)); const node = aside()
  render().asideRef.current = node.element
  render().startResizing(pointer(500))
  render().resize(pointer(-500)); render().resize(pointer(-900))
  expect(frames.size).toBe(1)
  frame()
  expect(node.element.style.width).toBe('919px')
  render().stopResizing(pointer(-900))
  expect(render().width).toBe(919)
  expect(document.body.style).toEqual({ cursor: 'crosshair', userSelect: 'text' })
  expect(frames.size).toBe(0)
})
it('bounds navigation resize at 140/400 and cancels pending resize frames on unmount', () => {
  const props = inputs(); const render = () => lifecycle.render(() => useLayout(props))
  render().startNavResizing(pointer(500)); render().navResize(pointer(2000)); frame()
  expect(render().leftWidth).toBe(140)
  render().navResize(pointer(-1000)); render().stopNavResizing(pointer(-1000))
  expect(render().leftWidth).toBe(400)
  expect(document.body.style).toEqual({ cursor: '', userSelect: '' })
  const node = aside(); render().asideRef.current = node.element
  render().startResizing(pointer(500)); render().resize(pointer(400))
  render().startNavResizing(pointer(500)); render().navResize(pointer(400))
  expect(frames.size).toBe(2)
  lifecycle.unmount()
  expect(frames.size).toBe(0)
  expect(node.element.removeAttribute).toHaveBeenCalledWith('style')
})
it('opens after microtask/RAF and waits 180ms on close, cancelling stale close timers', async () => {
  const props = inputs(); const render = () => lifecycle.render(() => useLayout(props))
  expect(render().visible).toBe(false)
  await flushPromises(); frame(); expect(render().visible).toBe(true)
  props.open = false; render(); await flushPromises()
  expect(render().visible).toBe(false)
  vi.advanceTimersByTime(179); expect(render().mounted).toBe(true)
  props.open = true; render(); await flushPromises(); frame(); vi.advanceTimersByTime(1)
  expect(render().mounted).toBe(true)
  props.open = false; render(); vi.advanceTimersByTime(180)
  expect(render().mounted).toBe(false)
})
it('auto-expands content to 640 rather than max and skips viewport clamping on mobile overlay', async () => {
  const props = inputs(); props.activePanelTab = { kind: 'browser' }
  const render = () => lifecycle.render(() => useLayout(props))
  render(); await flushPromises(); frame(); render(); expect(render().width).toBe(640)
  media.matches = false; media.dispatchEvent(new Event('change')); render()
  window.innerWidth = 800; windowEvents.dispatchEvent(new Event('resize'))
  expect(render().width).toBe(640)
  expect(render().mobileOverlay).toBe(true)
})
it('preserves fullscreen animation geometry, Escape exit and delayed afterExit callback', async () => {
  const props = inputs(); const render = () => lifecycle.render(() => useLayout(props)); const node = aside()
  render().asideRef.current = node.element
  await flushPromises(); frame(); render()
  render().toggleFullscreen(); frame()
  expect(node.element.animate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ top: '32px', height: '868px', width: '1600px' })]), { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' })
  node.animations[0].onfinish?.(); render(); frame(); frame()
  expect(render().fullscreen).toBe(true)
  const event = new Event('keydown'); Object.defineProperty(event, 'key', { value: 'Escape' }); documentEvents.dispatchEvent(event); frame()
  node.animations[1].onfinish?.(); render(); frame(); frame()
  expect(render().fullscreen).toBe(false)
  render().toggleFullscreen(); frame(); node.animations[2].onfinish?.(); render(); frame(); frame()
  const afterExit = vi.fn(); render().toggleFullscreen(afterExit); frame(); node.animations[3].onfinish?.(); render()
  expect(afterExit).not.toHaveBeenCalled(); frame(); frame(); expect(afterExit).toHaveBeenCalledOnce()
  lifecycle.unmount()
  expect(document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
  expect(props.onFullscreenChange).toHaveBeenLastCalledWith(false)
})

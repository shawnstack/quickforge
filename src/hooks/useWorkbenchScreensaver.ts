import { useEffect, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { loadWorkbenchScreensaverSettings, screensaverDue } from '@/lib/workbench-screensaver-settings'

/**
 * 工作台屏保：设置开启后，页面无操作达到配置时长（默认 10 分钟）自动进入屏保；
 * 屏保期间任意操作立即退出。手动打开的工作台仍是看板，不受活动影响。
 * 设置页发起的预览只被点击/按键/滚轮关掉——鼠标划过要能继续看效果。
 */

// 不监听 scroll：流式输出与自动滚动也会派发 scroll，会把「无人操作」永远判成有人在。
// 用户真的滚动时，wheel / touchstart / pointerdown / keydown 已经覆盖。
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
const PREVIEW_EXIT_EVENTS = new Set<string>(['pointerdown', 'keydown', 'wheel', 'touchstart'])
const CHECK_INTERVAL_MS = 5_000

export function useWorkbenchScreensaver(): void {
  const enabled = useUIStore((s) => s.workbenchScreensaver.enabled)
  const idleMinutes = useUIStore((s) => s.workbenchScreensaver.idleMinutes)
  const mode = useUIStore((s) => s.workbenchScreensaverMode)
  const setWorkbenchOpen = useUIStore((s) => s.setWorkbenchOpen)
  const setWorkbenchScreensaver = useUIStore((s) => s.setWorkbenchScreensaver)
  const enterWorkbenchScreensaver = useUIStore((s) => s.enterWorkbenchScreensaver)
  const lastActivityRef = useRef(0)

  useEffect(() => {
    let alive = true
    let timer = 0
    const attempt = async () => {
      try {
        const value = await loadWorkbenchScreensaverSettings()
        if (alive) setWorkbenchScreensaver(value)
      } catch {
        // AppStorage 由 pi-chat 异步装配；未就绪时重试，避免屏保设置读不到。
        if (alive) timer = window.setTimeout(() => void attempt(), 1000)
      }
    }
    void attempt()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [setWorkbenchScreensaver])

  useEffect(() => {
    if (!enabled && useUIStore.getState().workbenchScreensaverMode === 'idle') setWorkbenchOpen(false)
  }, [enabled, setWorkbenchOpen])

  useEffect(() => {
    lastActivityRef.current = Date.now()
    const onActivity = (event: Event) => {
      lastActivityRef.current = Date.now()
      const current = useUIStore.getState().workbenchScreensaverMode
      if (current === 'idle') {
        setWorkbenchOpen(false)
        return
      }
      if (current === 'preview' && PREVIEW_EXIT_EVENTS.has(event.type)) setWorkbenchOpen(false)
    }
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { capture: true, passive: true })
    }
    const timer = window.setInterval(() => {
      const state = useUIStore.getState()
      const settings = state.workbenchScreensaver
      if (screensaverDue(lastActivityRef.current, Date.now(), settings.enabled, state.workbenchOpen, settings.idleMinutes)) {
        lastActivityRef.current = Date.now()
        enterWorkbenchScreensaver('idle')
      }
    }, CHECK_INTERVAL_MS)
    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity, { capture: true })
      }
      window.clearInterval(timer)
    }
  }, [enabled, idleMinutes, mode, setWorkbenchOpen, enterWorkbenchScreensaver])
}
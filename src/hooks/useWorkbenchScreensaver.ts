import { useEffect, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import {
  loadWorkbenchScreensaver,
  screensaverDue,
  WORKBENCH_SCREENSAVER_IDLE_MS,
} from '@/lib/workbench-screensaver-settings'

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
const CHECK_INTERVAL_MS = 5_000

/**
 * 工作台屏保：设置开启后，页面 30 分钟无操作自动进入工作台；
 * 屏保期间任意操作立即退出（如同屏保）。手动打开的工作台不受活动影响。
 */
export function useWorkbenchScreensaver(): void {
  const enabled = useUIStore((s) => s.workbenchScreensaver)
  const workbenchOpen = useUIStore((s) => s.workbenchOpen)
  const setWorkbenchOpen = useUIStore((s) => s.setWorkbenchOpen)
  const setWorkbenchScreensaver = useUIStore((s) => s.setWorkbenchScreensaver)
  const lastActivityRef = useRef(0)
  const screensaverActiveRef = useRef(false)

  useEffect(() => {
    let alive = true
    let timer = 0
    const attempt = async () => {
      try {
        const value = await loadWorkbenchScreensaver()
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
    if (!workbenchOpen) screensaverActiveRef.current = false
  }, [workbenchOpen])

  useEffect(() => {
    if (!enabled) return undefined
    lastActivityRef.current = Date.now()
    const onActivity = () => {
      lastActivityRef.current = Date.now()
      if (screensaverActiveRef.current) {
        screensaverActiveRef.current = false
        setWorkbenchOpen(false)
      }
    }
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { capture: true, passive: true })
    }
    const timer = window.setInterval(() => {
      const state = useUIStore.getState()
      if (screensaverDue(lastActivityRef.current, Date.now(), state.workbenchScreensaver, state.workbenchOpen)) {
        screensaverActiveRef.current = true
        lastActivityRef.current = Date.now()
        setWorkbenchOpen(true)
      }
    }, CHECK_INTERVAL_MS)
    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity, { capture: true })
      }
      window.clearInterval(timer)
      screensaverActiveRef.current = false
    }
  }, [enabled, setWorkbenchOpen])
}

export { WORKBENCH_SCREENSAVER_IDLE_MS }
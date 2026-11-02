import { useEffect, useMemo, useRef, useState } from 'react'
import { Globe } from 'lucide-react'
import { t } from '@/lib/i18n'
import { useUIStore } from '@/stores/ui-store'
import { getDesktopBrowserBridge, type DesktopBrowserState } from '@/lib/desktop-browser-bridge'

/**
 * 内嵌 AI 浏览器面板。
 *
 * DOM 里只放一块占位区域：真正的网页是主进程的原生 WebContentsView，永远盖在
 * DOM 之上。因此这个组件唯一的职责是「把占位区域的矩形和显隐意图同步给主进程」，
 * 外加一行只读状态（当前地址 / 标题 / 错误）。
 *
 * 两个必须显式处理的坑：
 * 1. 面板宽度有 CSS 过渡、窗口可缩放、标签可全屏 —— 矩形会连续变化，用
 *    ResizeObserver + rAF 合帧上报，避免每次原生 setBounds 都触发一次重排。
 * 2. 原生视图会盖住 DOM 浮层，所以设置弹窗打开时必须把它藏起来，否则弹窗下半截
 *    会被网页吃掉。
 */
export function AgentBrowserPanel() {
  // 桥对象必须稳定：每次渲染新建会让下面三个 effect 反复重跑（getState 写回 state 再触发渲染）。
  const bridge = useMemo(() => getDesktopBrowserBridge(), [])
  const settingsDialogOpen = useUIStore((state) => state.settingsDialogOpen)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastRectRef = useRef('')
  const [state, setState] = useState<DesktopBrowserState | null>(null)

  useEffect(() => {
    if (!bridge) return undefined
    let alive = true
    void bridge.getState().then((next) => {
      if (alive && next) setState(next)
    })
    const unsubscribe = bridge.onStateChange((next) => setState(next))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return undefined
    const element = containerRef.current
    if (!element) return undefined
    let frame = 0
    const report = () => {
      frame = 0
      const rect = element.getBoundingClientRect()
      const next = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
      if (next.width < 1 || next.height < 1) return
      const key = `${next.x}:${next.y}:${next.width}:${next.height}`
      if (key === lastRectRef.current) return
      lastRectRef.current = key
      void bridge.setBounds(next)
    }
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(report)
    }
    report()
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    window.addEventListener('resize', schedule)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return undefined
    const sync = () => {
      const hidden = settingsDialogOpen || document.visibilityState === 'hidden'
      void bridge.setVisible(!hidden)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      // 卸载即关闭：标签切走或面板收起后原生视图不能留在屏幕上。
      void bridge.setVisible(false)
    }
  }, [bridge, settingsDialogOpen])

  if (!bridge) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {t('agentBrowserUnavailable')}
      </div>
    )
  }

  const status = state?.error || state?.url || t('agentBrowserEmpty')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <Globe className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate" title={state?.url || undefined}>{status}</span>
        {state?.title ? <span className="truncate text-muted-foreground/50">· {state.title}</span> : null}
      </div>
      {/* 原生视图的定位锚点：这里不放任何可交互内容，浮层一律渲染在视图之外。 */}
      <div ref={containerRef} className="relative min-h-0 flex-1 bg-background" />
    </div>
  )
}

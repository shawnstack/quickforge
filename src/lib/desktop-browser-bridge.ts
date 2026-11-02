import { isDesktopApp } from '@/lib/desktop-app'

export type DesktopBrowserRect = { x: number; y: number; width: number; height: number }

export type DesktopBrowserState = {
  url: string
  title: string
  generation: number
  hasSnapshot: boolean
  visible: boolean
  error: string | null
}

/**
 * preload 暴露的窄桥（见 desktop/electron-preload.cjs）。
 *
 * 渲染进程只能：报告「原生视图该放在哪」「要不要显示」「当前状态是什么」。
 * 它既拿不到 webContents，也读不到网页内容 —— 内嵌浏览器的一切操作都发生在
 * 主进程，由 MCP 工具驱动。
 */
export type DesktopBrowserBridge = {
  isAvailable(): Promise<boolean>
  getState(): Promise<DesktopBrowserState | null>
  setBounds(rect: DesktopBrowserRect): Promise<boolean | null>
  setVisible(visible: boolean): Promise<boolean | null>
  onStateChange(callback: (state: DesktopBrowserState) => void): () => void
}

declare global {
  interface Window {
    QuickForgeDesktopBrowser?: DesktopBrowserBridge
  }
}

function normalizeState(value: unknown): DesktopBrowserState | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const error = typeof record.error === 'string' && record.error ? record.error : null
  return {
    url: typeof record.url === 'string' ? record.url : '',
    title: typeof record.title === 'string' ? record.title : '',
    generation: typeof record.generation === 'number' ? record.generation : 0,
    hasSnapshot: record.hasSnapshot === true,
    visible: record.visible === true,
    error,
  }
}

/** 桌面端且主进程桥已就绪时返回桥对象，否则返回 null（Web/移动端一律 null）。 */
export function getDesktopBrowserBridge(): DesktopBrowserBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = window.QuickForgeDesktopBrowser
  if (!bridge || typeof bridge.setBounds !== 'function') return null
  return {
    isAvailable: () => bridge.isAvailable(),
    getState: async () => normalizeState(await bridge.getState()),
    setBounds: (rect) => bridge.setBounds(rect),
    setVisible: (visible) => bridge.setVisible(visible),
    onStateChange: (callback) => bridge.onStateChange((state) => {
      const normalized = normalizeState(state)
      if (normalized) callback(normalized)
    }),
  }
}

/** 当前环境是否具备内嵌浏览器能力（不需要真正创建视图）。 */
export function isDesktopBrowserSupported(): boolean {
  return isDesktopApp() && Boolean(getDesktopBrowserBridge())
}

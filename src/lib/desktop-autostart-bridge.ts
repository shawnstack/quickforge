import { isDesktopApp } from '@/lib/desktop-app'

export type DesktopAutostartState = {
  /** 当前平台是否允许应用读写系统登录项（Windows / macOS）；Linux 上恒为 false。 */
  supported: boolean
  /** 系统里是否已经为本应用设置了登录时启动。 */
  openAtLogin: boolean
}

export const DEFAULT_DESKTOP_AUTOSTART_STATE: DesktopAutostartState = Object.freeze({
  supported: false,
  openAtLogin: false,
})

/**
 * 主进程回包一律过一遍归一化：桥参数来自渲染进程侧的可变对象，形状不可信。
 * 不支持的平台上 openAtLogin 强制为 false —— 别把残留值当真相渲染成「已开启」。
 */
export function normalizeDesktopAutostartState(value: unknown): DesktopAutostartState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_DESKTOP_AUTOSTART_STATE }
  const record = value as { supported?: unknown; openAtLogin?: unknown }
  const supported = record.supported === true
  return { supported, openAtLogin: supported && record.openAtLogin === true }
}

/**
 * preload 暴露的窄桥（见 desktop/electron-preload.cjs）。
 *
 * 渲染进程只能问「系统里现在是开还是关」和「帮我改成开/关」，路径、启动参数、
 * 注册表细节全部留在主进程 —— 否则就等于把「随便指定一个程序开机跑」的能力交给了页面。
 */
export type DesktopAutostartBridge = {
  getState(): Promise<DesktopAutostartState>
  setEnabled(enabled: boolean): Promise<DesktopAutostartState>
}

declare global {
  interface Window {
    QuickForgeDesktopAutostart?: DesktopAutostartBridge
  }
}

/** 桌面端且主进程桥已就绪时返回包装后的桥，否则返回 null（Web / 移动端一律 null）。 */
export function getDesktopAutostartBridge(): DesktopAutostartBridge | null {
  if (typeof window === 'undefined' || !isDesktopApp()) return null
  const bridge = window.QuickForgeDesktopAutostart
  if (!bridge || typeof bridge.getState !== 'function' || typeof bridge.setEnabled !== 'function') return null
  return {
    getState: async () => normalizeDesktopAutostartState(await bridge.getState()),
    setEnabled: async (enabled) => normalizeDesktopAutostartState(await bridge.setEnabled(Boolean(enabled))),
  }
}

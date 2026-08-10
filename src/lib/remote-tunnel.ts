import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

export type RemoteTunnelStateKind = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export type RemoteTunnelState = {
  state: RemoteTunnelStateKind
  error?: string
}

export type RemoteTunnelServiceInfo = {
  id?: string
  name?: string
  port?: number
  protocol?: string
}

export type RemoteTunnelDevice = {
  installationId: string
  name?: string
  online?: boolean
  services?: RemoteTunnelServiceInfo[]
}

export type RemoteTunnelDeviceList = {
  items: RemoteTunnelDevice[]
}

export type RemoteTunnelToken = {
  accessToken: string
  refreshToken: string
  cloudUrl: string
  email?: string
}

export type RemoteTunnelHasSession = {
  signedIn: boolean
  email?: string
  cloudUrl?: string
}

/**
 * 云远程访问原生插件（Android RemoteTunnelPlugin，Kotlin 实现；契约见
 * docs/design/remote-access-p2p.md §3.1/§3.2，勿改）：
 *
 * - setToken({accessToken, refreshToken, cloudUrl, email?})：把云账户令牌交给原生层，
 *   可选 email 为登录账号邮箱（原生层用于账号信息展示）。
 *   access token 仅进程内存；refresh token 由原生层经 Android Keystore 加密落盘。
 * - hasSession() → {signedIn, email?, cloudUrl?}：原生层是否已持有可用会话
 *   （Keystore 有 refresh token），并返回账号邮箱与云服务地址（旧会话 email 可能为 null）。
 * - signOut()：清除原生层会话与本地隧道。
 * - listDevices() → {items:[{installationId,name,online,services}]}：本账号在线 agent 设备。
 * - connect({installationId}) / disconnect() / retry() / getState()：WebRTC 隧道生命周期。
 * - remoteStateChanged({state,error})：connecting / connected / reconnecting / error 事件；
 *   reconnecting=断线后原生层自动指数退避重连中；idle=用户主动断开（不再重连）；
 *   error=不可恢复错误（如登录已过期），需用户重新登录。
 * - retry()：立即触发一次重连（无参，沿用原生层保存的目标设备）。
 *
 * 连接成功后原生层在 127.0.0.1:18080 开本地 TCP 隧道，HTTP 流量注入
 * X-QuickForge-Tunnel: 1 请求头；WebView 应导航到 http://127.0.0.1:18080/?quickforgeRemote=1。
 */
export interface RemoteTunnelPlugin {
  setToken(options: RemoteTunnelToken): Promise<void>
  hasSession(): Promise<RemoteTunnelHasSession>
  signOut(): Promise<void>
  listDevices(): Promise<RemoteTunnelDeviceList>
  connect(options: { installationId: string }): Promise<void>
  disconnect(): Promise<void>
  retry(): Promise<void>
  getState(): Promise<RemoteTunnelState>
  addListener(eventName: 'remoteStateChanged', listener: (state: RemoteTunnelState) => void): Promise<PluginListenerHandle>
}

export const RemoteTunnel = registerPlugin<RemoteTunnelPlugin>('RemoteTunnel')

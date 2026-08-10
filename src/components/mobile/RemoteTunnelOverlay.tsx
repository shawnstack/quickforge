import { useCallback, useEffect, useRef, useState } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'
import { Loader2, RefreshCw, WifiOff } from 'lucide-react'
import { isRemoteQuickForgeClient } from '@/lib/mobile-server'
import { RemoteTunnel, type RemoteTunnelState } from '@/lib/remote-tunnel'

/** 返回设备列表的地址（与 openMobileServerPicker('cloud') 一致，即原生壳连接页的云账户 tab）。 */
const DEVICE_LIST_URL = 'https://localhost/?connect=1&tab=cloud'
/** 原生层重连成功后在 127.0.0.1:18080 重新监听本地 HTTP 服务。 */
const TUNNEL_PROBE_URL = 'http://127.0.0.1:18080/'

/** Probe 本地隧道端口；超时 3s，失败重试至多 3 次（间隔 700ms），与连接页 navigateToTunnel 一致。 */
async function probeTunnel(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3000)
    try {
      await fetch(TUNNEL_PROBE_URL, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
      window.clearTimeout(timeout)
      return true
    } catch {
      window.clearTimeout(timeout)
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 700))
      }
    }
  }
  return false
}

/**
 * 远程页面断线覆盖层：仅在云远程客户端模式（http://127.0.0.1:18080/?quickforgeRemote=1）
 * 生效，桌面端与壳连接页不渲染。
 *
 * 原生层断线后自动指数退避重连，本组件负责在断线期间提示用户（可立即重试或返回设备
 * 列表），并在隧道恢复（connected 事件 + 18080 端口可访问）后刷新页面恢复远程界面。
 */
export function RemoteTunnelOverlay() {
  const [unavailable, setUnavailable] = useState(false)
  const [state, setState] = useState<RemoteTunnelState | null>(null)
  /** 本次会话内是否见过非 connected 状态（初始为 false，避免刚加载就 reload）。 */
  const [hadDisconnect, setHadDisconnect] = useState(false)
  const [reconnectCount, setReconnectCount] = useState(0)
  const [retrying, setRetrying] = useState(false)
  /** ref 镜像供事件回调/effect 读取最新值（不在 render 中使用）。 */
  const hadDisconnectRef = useRef(false)
  const reconnectCountRef = useRef(0)
  /** 防重入：probe + reload 同时只能有一路在跑。 */
  const recoveringRef = useRef(false)

  /** Probe 成功后刷新页面恢复远程界面；失败则保持覆盖层等待下一次状态事件。 */
  const recoverFromDisconnect = useCallback(async () => {
    if (recoveringRef.current) return
    recoveringRef.current = true
    try {
      if (await probeTunnel()) {
        hadDisconnectRef.current = false
        setHadDisconnect(false)
        setState(null)
        window.location.reload()
      }
    } finally {
      recoveringRef.current = false
    }
  }, [])

  useEffect(() => {
    let active = true
    let listener: PluginListenerHandle | undefined

    const markDisconnected = () => {
      if (!hadDisconnectRef.current) {
        hadDisconnectRef.current = true
        setHadDisconnect(true)
      }
    }

    const handleState = (next: RemoteTunnelState) => {
      if (!active) return
      setState(next)
      if (next.state !== 'connected') markDisconnected()
      if (next.state === 'reconnecting') {
        reconnectCountRef.current += 1
        setReconnectCount(reconnectCountRef.current)
      }
      if (next.state === 'connected' && hadDisconnectRef.current) {
        void recoverFromDisconnect()
      }
    }

    RemoteTunnel.getState()
      .then((initial) => {
        if (!active) return
        handleState(initial)
        return RemoteTunnel.addListener('remoteStateChanged', handleState)
          .then((handle) => {
            listener = handle
          })
      })
      .catch(() => {
        // 原生插件不可用（Web 预览等）：静默降级，不渲染覆盖层。
        if (active) setUnavailable(true)
      })

    return () => {
      active = false
      void listener?.remove()
    }
  }, [recoverFromDisconnect])

  // App 回前台补偿：后台期间事件可能错过，回前台时若隧道已恢复则同样 probe + reload。
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (!hadDisconnectRef.current) return
      void RemoteTunnel.getState()
        .then((current) => {
          if (current.state === 'connected' && hadDisconnectRef.current) {
            void recoverFromDisconnect()
          }
        })
        .catch(() => {
          // 插件不可用时静默。
        })
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [recoverFromDisconnect])

  // 非远程客户端模式（桌面端 / 壳连接页）：不渲染覆盖层（hooks 已无条件调用，无副作用影响）。
  if (!isRemoteQuickForgeClient()) return null
  if (unavailable || !state) return null
  // 连接正常且本次会话未断过线：隐藏覆盖层。
  if (state.state === 'connected' && !hadDisconnect) return null

  const isReconnecting = state.state === 'reconnecting' || state.state === 'connecting'
  const isRecovering = state.state === 'connected' && hadDisconnect

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await RemoteTunnel.retry()
    } catch {
      // 重连调用失败静默，后续 remoteStateChanged 事件仍会驱动 UI。
    } finally {
      setRetrying(false)
    }
  }

  const returnToDevices = () => {
    window.location.href = DEVICE_LIST_URL
  }

  let title = '连接已断开'
  let message = '不会自动重连，请返回设备列表。'
  if (isReconnecting) {
    message = `连接已断开，正在自动重连…（已重试 ${reconnectCount} 次）`
  } else if (isRecovering) {
    title = '正在恢复连接'
    message = '连接已恢复，正在刷新页面…'
  } else if (state.state === 'error') {
    title = '连接失败'
    message = state.error || '隧道连接失败，请重试'
    if (message.includes('登录已过期')) {
      message = `${message}，请重新登录`
    }
  }

  const primaryButtonClass = 'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-92 active:opacity-85 disabled:opacity-60'
  const secondaryButtonClass = 'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/45 hover:text-foreground active:bg-muted/65 disabled:opacity-60'

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-5 shadow-quickforge" role="status" aria-live="polite">
        <div className="flex items-start gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background shadow-quickforge">
            {isReconnecting ? <Loader2 className="size-5 animate-spin text-foreground/75" aria-hidden="true" /> : <WifiOff className="size-5 text-foreground/75" aria-hidden="true" />}
          </div>
          <div className="min-w-0 pt-0.5">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{message}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          {isReconnecting ? (
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => { void handleRetry() }}
              disabled={retrying}
            >
              {retrying ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
              立即重试
            </button>
          ) : null}
          <button
            type="button"
            className={isReconnecting ? secondaryButtonClass : primaryButtonClass}
            onClick={returnToDevices}
          >
            返回设备列表
          </button>
        </div>
      </div>
    </div>
  )
}

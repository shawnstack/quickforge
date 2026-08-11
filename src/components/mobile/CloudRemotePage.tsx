import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, Cloud, KeyRound, Loader2, LogOut, Mail, Monitor, RefreshCw, Server, ShieldCheck, Wifi } from 'lucide-react'
import { CLOUD_API_DEFAULT_BASE_URL, CloudRemoteClient, CloudRemoteClientError, type CloudRemoteDevice } from '@/lib/cloud-remote-client'
import { RemoteTunnel, type RemoteTunnelDevice, type RemoteTunnelHasSession, type RemoteTunnelState } from '@/lib/remote-tunnel'

/** 隧道连接成功后，原生层在 127.0.0.1:18080 提供本地 HTTP 服务（注入 X-QuickForge-Tunnel: 1）。 */
const TUNNEL_HOME_URL = 'http://127.0.0.1:18080/?quickforgeRemote=1'
const TUNNEL_PROBE_URL = 'http://127.0.0.1:18080/'

/** Probe the local tunnel port before navigating so WebView never hits a not-yet-listening server. */
async function navigateToTunnel(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3000)
    try {
      await fetch(TUNNEL_PROBE_URL, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
      window.clearTimeout(timeout)
      window.location.href = TUNNEL_HOME_URL
      return
    } catch {
      window.clearTimeout(timeout)
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 700))
      }
    }
  }
  throw new Error('本地隧道端口未就绪，请断开后重试')
}

type Phase = 'checking' | 'session-choice' | 'sign-in' | 'devices'
type CredentialMode = 'login' | 'register'

function errorMessage(error: unknown): string {
  if (error instanceof CloudRemoteClientError) {
    return error.message || '云服务请求失败，请稍后重试'
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}

/** 登录闭环错误提示：授权失败提示重新尝试，网络类错误提示检查云地址。 */
function signInErrorText(error: unknown): string {
  if (error instanceof CloudRemoteClientError) {
    if (error.code === 'cloud_remote_unsupported_crypto' || error.code === 'access_denied' || error.code === 'expired_token' || error.code === 'device_flow_timeout') {
      return error.message || '设备授权未完成，请重新尝试'
    }
    if (error.status === 0) {
      return '无法连接云服务，请检查“云服务地址”与网络后重试'
    }
    return error.message || '云服务请求失败，请稍后重试'
  }
  // 非 CloudRemoteClientError：多为 fetch / CapacitorHttp 网络层异常。
  return '无法连接云服务，请检查“云服务地址”与网络后重试'
}

function deviceLabel(device: RemoteTunnelDevice | CloudRemoteDevice): string {
  return device.name?.trim() || device.installationId
}

type CloudRemotePageProps = {
  /** 会话状态变化（原生探测 / 登录成功 / 切换账号 / 退出登录）时通知父组件，用于同步顶部“云账户”tab 的邮箱展示。 */
  onSessionChange?: (session: RemoteTunnelHasSession) => void
}

export function CloudRemotePage({ onSessionChange }: CloudRemotePageProps) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [credentialMode, setCredentialMode] = useState<CredentialMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [userCode, setUserCode] = useState('')
  const [showUserCode, setShowUserCode] = useState(false)
  const [baseUrl, setBaseUrl] = useState(CLOUD_API_DEFAULT_BASE_URL)
  const [showBaseUrl, setShowBaseUrl] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionChoiceAction, setSessionChoiceAction] = useState<'continue' | 'switch' | null>(null)
  const [devices, setDevices] = useState<(RemoteTunnelDevice | CloudRemoteDevice)[]>([])
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [tunnelState, setTunnelState] = useState<RemoteTunnelState | null>(null)
  const [sessionInfo, setSessionInfo] = useState<RemoteTunnelHasSession | null>(null)
  const clientRef = useRef<CloudRemoteClient | null>(null)

  const getClient = () => {
    if (!clientRef.current || clientRef.current.cloudUrl !== baseUrl.replace(/\/+$/, '')) {
      clientRef.current = new CloudRemoteClient(baseUrl)
    }
    return clientRef.current
  }

  // 原生层隧道状态事件：connected → 跳转本地隧道首页。
  useEffect(() => {
    let active = true
    RemoteTunnel.addListener('remoteStateChanged', (state) => {
      if (!active) return
      setTunnelState(state)
      if (state.state === 'connected') {
        void navigateToTunnel().catch((navigateError) => {
          if (!active) return
          setConnectingId(null)
          setTunnelState({ state: 'error', error: errorMessage(navigateError) })
          setError(errorMessage(navigateError))
          void RemoteTunnel.disconnect().catch(() => {})
        })
      } else if (state.state === 'reconnecting') {
        setConnectingId(null)
        setTunnelState(state)
      } else if (state.state === 'error') {
        setConnectingId(null)
        setError(state.error || '隧道连接失败，请重试')
      }
    }).catch(() => {
      // 原生插件暂不可用时静默降级（Web 预览等场景）。
    })
    return () => {
      active = false
    }
  }, [])

  const loadDevices = async () => {
    setBusy(true)
    setError('')
    try {
      // 优先走原生层（原生会话已就绪时无需 JS 侧令牌）。
      const result = await RemoteTunnel.listDevices()
      setDevices(result.items ?? [])
      setPhase('devices')
    } catch {
      // 原生列表不可用时降级云 API（需要 JS 侧令牌）。
      try {
        const result = await getClient().listDevices()
        setDevices(result.items)
        setPhase('devices')
      } catch (cloudError) {
        setError(errorMessage(cloudError))
        setPhase('sign-in')
      }
    } finally {
      setBusy(false)
    }
  }

  // 挂载时只检查原生会话；已有会话也等待用户明确选择是否继续。
  // 云地址预填：hasSession 返回已保存云地址且当前仍是默认值（用户未手动修改）时预填，避免覆盖用户改动。
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const session = await RemoteTunnel.hasSession()
        if (!active) return
        setSessionInfo(session)
        onSessionChange?.(session)
        const savedUrl = session.cloudUrl
        if (savedUrl) {
          setBaseUrl((current) => (current === CLOUD_API_DEFAULT_BASE_URL ? savedUrl : current))
        }
        setPhase(session.signedIn ? 'session-choice' : 'sign-in')
      } catch {
        if (active) setPhase('sign-in')
      }
    })()
    return () => {
      active = false
    }
  }, [onSessionChange])

  const handleContinueSession = async () => {
    setSessionChoiceAction('continue')
    try {
      await loadDevices()
    } finally {
      setSessionChoiceAction(null)
    }
  }

  const handleUseOtherAccount = async () => {
    setBusy(true)
    setSessionChoiceAction('switch')
    setError('')
    setNotice('')
    try {
      await RemoteTunnel.disconnect().catch(() => {})
      await RemoteTunnel.signOut()
      getClient().clearTokens()
      setDevices([])
      setConnectingId(null)
      setTunnelState(null)
      setPassword('')
      setPhase('sign-in')
      onSessionChange?.({ signedIn: false })
    } catch (signOutError) {
      setError(errorMessage(signOutError))
    } finally {
      setSessionChoiceAction(null)
      setBusy(false)
    }
  }

  const handleCredentialSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = email.trim()
    const manualCode = userCode.trim()
    if (!trimmedEmail || !password) {
      setError('请输入邮箱和密码')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const client = getClient()
      if (manualCode) {
        // 高级选项：直接批准电脑端已发起的 pending 授权（本机非发起方，无 deviceCode 可轮询令牌）。
        const session = credentialMode === 'register'
          ? await client.register(trimmedEmail, password, manualCode)
          : await client.login(trimmedEmail, password, manualCode)
        if (session.accessToken && session.refreshToken) {
          await RemoteTunnel.setToken({
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            cloudUrl: client.cloudUrl,
            email: trimmedEmail,
          })
          setSessionInfo({ signedIn: true, email: trimmedEmail, cloudUrl: client.cloudUrl })
          onSessionChange?.({ signedIn: true, email: trimmedEmail, cloudUrl: client.cloudUrl })
          await loadDevices()
        } else {
          setNotice('已在电脑端完成设备授权；若电脑端 QuickForge 正在等待授权，请返回电脑端确认。')
        }
        return
      }
      // 默认闭环：手机自动发起 Device Flow → 用返回的 userCode 立即批准自己 → 轮询兑换令牌。
      const device = await client.deviceAuthorization()
      await (credentialMode === 'register'
        ? client.register(trimmedEmail, password, device.userCode)
        : client.login(trimmedEmail, password, device.userCode))
      const tokens = await client.pollDeviceToken(device.deviceCode, device.interval)
      await RemoteTunnel.setToken({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        cloudUrl: client.cloudUrl,
        email: trimmedEmail,
      })
      setSessionInfo({ signedIn: true, email: trimmedEmail, cloudUrl: client.cloudUrl })
      onSessionChange?.({ signedIn: true, email: trimmedEmail, cloudUrl: client.cloudUrl })
      await loadDevices()
    } catch (submitError) {
      setError(signInErrorText(submitError))
    } finally {
      setBusy(false)
    }
  }
  const handleConnect = async (device: RemoteTunnelDevice | CloudRemoteDevice) => {
    setError('')
    setConnectingId(device.installationId)
    setTunnelState({ state: 'connecting' })
    try {
      const current = await RemoteTunnel.getState()
      if (current.state !== 'idle') {
        await RemoteTunnel.disconnect().catch(() => {})
      }
      await RemoteTunnel.connect({ installationId: device.installationId })
      // 后续状态由 remoteStateChanged 事件驱动。
    } catch (connectError) {
      setConnectingId(null)
      setError(errorMessage(connectError))
    }
  }

  const handleSignOut = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await RemoteTunnel.disconnect().catch(() => {})
      await RemoteTunnel.signOut()
    } catch (signOutError) {
      // 原生层清理失败不阻塞本地状态重置。
      setError(errorMessage(signOutError))
    } finally {
      getClient().clearTokens()
      setDevices([])
      setConnectingId(null)
      setTunnelState(null)
      setPassword('')
      setPhase('sign-in')
      setBusy(false)
      onSessionChange?.({ signedIn: false })
    }
  }

  if (phase === 'checking') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-foreground" role="status" aria-live="polite">
        <Loader2 className="size-7 animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 text-sm text-muted-foreground">正在检查云账户状态…</p>
      </main>
    )
  }

  if (phase === 'session-choice') {
    return (
      <section aria-labelledby="quickforge-cloud-remote-session-choice">
        <header className="mb-6 flex items-start gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background shadow-quickforge">
            <Cloud className="size-5 text-foreground/75" aria-hidden="true" />
          </div>
          <div className="min-w-0 pt-0.5">
            <h1 id="quickforge-cloud-remote-session-choice" className="text-lg font-semibold tracking-tight">云账户远程访问</h1>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">检测到此设备已登录。选择是否继续当前会话。</p>
          </div>
        </header>

        {/* 账号卡片：当前会话账号邮箱与云服务地址 */}
        <div className="rounded-2xl border border-border bg-background p-4 shadow-quickforge">
          <div className="flex items-center gap-2">
            <p className="truncate text-base font-semibold text-foreground">{sessionInfo?.email || '已登录账号'}</p>
            <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">会话有效</span>
          </div>
          {sessionInfo?.cloudUrl ? (
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{sessionInfo.cloudUrl}</p>
          ) : null}
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-background p-5 shadow-quickforge">
          <div className="flex gap-2.5 rounded-xl bg-muted/30 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>继续后才会加载当前账户的在线设备；也可以清理本机会话并重新登录。</p>
          </div>

          {error ? <p className="mt-4 text-sm text-destructive" role="alert">{error}</p> : null}

          <button
            type="button"
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-92 active:opacity-85 disabled:opacity-60"
            onClick={() => { void handleContinueSession() }}
            disabled={busy}
          >
            {sessionChoiceAction === 'continue' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Cloud className="size-4" aria-hidden="true" />}
            继续当前登录
          </button>
          <button
            type="button"
            className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/45 hover:text-foreground active:bg-muted/65 disabled:opacity-60"
            onClick={() => { void handleUseOtherAccount() }}
            disabled={busy}
          >
            {sessionChoiceAction === 'switch' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
            使用其他账号
          </button>
          {busy ? <p className="mt-2 text-center text-xs text-muted-foreground" role="status" aria-live="polite">{sessionChoiceAction === 'switch' ? '正在清理当前登录…' : '正在加载设备…'}</p> : null}
        </div>
      </section>
    )
  }

  if (phase === 'devices') {
    return (
      <section aria-labelledby="quickforge-cloud-remote-devices">
        <header className="mb-6 flex items-start gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background shadow-quickforge">
            <Cloud className="size-5 text-foreground/75" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h1 id="quickforge-cloud-remote-devices" className="text-lg font-semibold tracking-tight">云账户远程访问</h1>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">选择一台在线设备建立远程连接。</p>
          </div>
          <button
            type="button"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground active:bg-muted/65"
            onClick={() => { void loadDevices() }}
            disabled={busy}
            title="刷新设备列表"
            aria-label="刷新设备列表"
          >
            <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </header>

        {/* 当前账号：会话邮箱 + 云服务地址 + 切换账号 */}
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-border bg-background p-4 shadow-quickforge">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">当前账号</p>
            <p className="mt-0.5 truncate text-sm font-medium text-foreground">{sessionInfo?.email || '已登录账号'}</p>
            {sessionInfo?.cloudUrl ? (
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{sessionInfo.cloudUrl}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/45 hover:text-foreground active:bg-muted/65 disabled:opacity-60"
            onClick={() => { void handleUseOtherAccount() }}
            disabled={busy}
          >
            {sessionChoiceAction === 'switch' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
            切换账号
          </button>
        </div>

        {error ? <p className="mb-4 text-sm text-destructive" role="alert">{error}</p> : null}
        {notice ? <p className="mb-4 text-sm text-muted-foreground" role="status">{notice}</p> : null}
        {tunnelState && tunnelState.state !== 'idle' ? (
          <div className="mb-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
              {tunnelState.state === 'connecting' || tunnelState.state === 'reconnecting' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wifi className="size-4" aria-hidden="true" />}
              {tunnelState.state === 'connecting' ? '正在建立加密隧道…' : tunnelState.state === 'reconnecting' ? '连接中断，正在自动重连…' : tunnelState.state === 'connected' ? '隧道已就绪，正在打开远程界面…' : '连接已断开'}
            </p>
            {tunnelState.state === 'connected' || tunnelState.state === 'reconnecting' ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
                断线自动重连已开启，网络恢复后自动恢复连接
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-border bg-background">
          {devices.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Monitor className="mx-auto size-8 text-muted-foreground/50" aria-hidden="true" />
              <p className="mt-3 text-sm text-muted-foreground">没有可用的在线设备</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground/75">请确认电脑端 QuickForge 的云远程代理（agent）已登录并在线。</p>
            </div>
          ) : (
            devices.map((device) => {
              const connecting = connectingId === device.installationId
              return (
                <div key={device.installationId} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    className="flex min-h-[68px] w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/45 active:bg-muted/65 disabled:opacity-60"
                    onClick={() => { void handleConnect(device) }}
                    disabled={busy || connectingId !== null || device.online === false}
                    title={device.online === false ? '设备当前离线' : `连接 ${deviceLabel(device)}`}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/45 text-muted-foreground">
                      <Server className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{deviceLabel(device)}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${device.online === false ? 'bg-muted text-muted-foreground' : 'bg-emerald-500/10 text-emerald-600'}`}>
                          {device.online === false ? '离线' : '在线'}
                        </span>
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{device.installationId}</span>
                    </span>
                    {connecting ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground/65" aria-hidden="true" />
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <button
          type="button"
          className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/45 hover:text-foreground active:bg-muted/65 disabled:opacity-60"
          onClick={() => { void handleSignOut() }}
          disabled={busy}
        >
          <LogOut className="size-4" aria-hidden="true" />
          退出登录
        </button>
      </section>
    )
  }

  return (
    <section aria-labelledby="quickforge-cloud-remote-signin">
      <header className="mb-6 flex items-start gap-3.5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background shadow-quickforge">
          <Cloud className="size-5 text-foreground/75" aria-hidden="true" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h1 id="quickforge-cloud-remote-signin" className="text-lg font-semibold tracking-tight">云账户远程访问</h1>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">通过云账户加密隧道访问家中电脑：输入邮箱密码即可登录，手机自动完成设备授权。</p>

        </div>
      </header>

      <form className="rounded-2xl border border-border bg-background p-5 shadow-quickforge" onSubmit={handleCredentialSubmit}>
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-muted/40 p-1" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            aria-selected={credentialMode === 'login'}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${credentialMode === 'login' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => { setCredentialMode('login'); setError(''); setNotice('') }}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={credentialMode === 'register'}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${credentialMode === 'register' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => { setCredentialMode('register'); setError(''); setNotice('') }}
          >
            注册
          </button>
        </div>

        <div className="mb-5 flex gap-2.5 rounded-xl bg-muted/30 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>直连云 API（原生通道绕 CORS）。令牌仅存于内存，刷新令牌由系统安全存储保护。</p>
        </div>

        <label className="block text-sm font-medium" htmlFor="quickforge-cloud-remote-email">
          邮箱
        </label>
        <input
          id="quickforge-cloud-remote-email"
          type="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="email"
          value={email}
          onChange={(event) => { setEmail(event.target.value); setError(''); setNotice('') }}
          placeholder="you@example.com"
          className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:shadow-quickforge"
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="quickforge-cloud-remote-password">
          密码
        </label>
        <input
          id="quickforge-cloud-remote-password"
          type="password"
          autoComplete={credentialMode === 'register' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(event) => { setPassword(event.target.value); setError(''); setNotice('') }}
          placeholder={credentialMode === 'register' ? '至少 8 个字符' : '输入密码'}
          className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:shadow-quickforge"
        />

        <button
          type="button"
          className="mt-4 flex w-full items-center justify-between rounded-xl px-1 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setShowUserCode((visible) => !visible)}
          aria-expanded={showUserCode}
        >
          <span className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden="true" />
            设备验证码
            <span className="text-xs text-muted-foreground/70">（高级）</span>

          </span>
          <ChevronDown className={`size-4 transition-transform ${showUserCode ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {showUserCode ? (
          <div className="mt-1 rounded-xl bg-muted/30 px-3 py-2.5">
            <input
              id="quickforge-cloud-remote-usercode"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={userCode}
              onChange={(event) => { setUserCode(event.target.value); setError(''); setNotice('') }}
              placeholder="ABCD-2345"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm tracking-widest outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/50 focus:border-foreground/30 focus:shadow-quickforge"
            />
            <p className="mt-2 text-xs leading-5 text-muted-foreground">电脑端 QuickForge 已发起“云远程访问”授权时，可填写电脑端显示的验证码直接批准；通常无需填写。</p>

          </div>
        ) : null}

        <button
          type="button"
          className="mt-2 flex w-full items-center justify-between rounded-xl px-1 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setShowBaseUrl((visible) => !visible)}
          aria-expanded={showBaseUrl}
        >
          <span className="flex items-center gap-2">
            <Cloud className="size-4" aria-hidden="true" />
            云服务地址
          </span>
          <ChevronDown className={`size-4 transition-transform ${showBaseUrl ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {showBaseUrl ? (
          <div className="mt-1 rounded-xl bg-muted/30 px-3 py-2.5">
            <input
              id="quickforge-cloud-remote-baseurl"
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="url"
              spellCheck={false}
              value={baseUrl}
              onChange={(event) => { setBaseUrl(event.target.value); setError(''); setNotice('') }}
              placeholder="https://cloud.quickforge.app"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/50 focus:border-foreground/30 focus:shadow-quickforge"
            />
            <p className="mt-2 text-xs leading-5 text-muted-foreground">正式域名确定前的占位地址；仅在本次会话内生效，不持久化。</p>
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
        {notice ? <p className="mt-3 text-sm text-muted-foreground" role="status">{notice}</p> : null}

        <button
          type="submit"
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-92 active:opacity-85 disabled:opacity-60"
          disabled={busy}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Mail className="size-4" aria-hidden="true" />}
          {credentialMode === 'register' ? '注册并授权' : '登录'}
        </button>
        {busy ? (
          <p className="mt-2 text-center text-xs text-muted-foreground" role="status">正在发起安全登录…</p>

        ) : null}
      </form>

      <p className="mt-4 px-1 text-xs leading-5 text-muted-foreground/80">
        连接成功后将在本机 <span className="font-mono text-foreground/70">127.0.0.1:18080</span> 打开远程 QuickForge 界面；远程会话沿用与 Tailscale 相同的安全裁剪（终端、系统代理等不可用）。
      </p>
    </section>
  )
}

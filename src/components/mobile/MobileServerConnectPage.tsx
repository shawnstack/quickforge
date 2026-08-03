import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, Network, Server, ShieldCheck } from 'lucide-react'
import {
  buildMobileServerAppUrl,
  normalizeTailscaleServerUrl,
  readSavedMobileServerUrl,
  saveMobileServerUrl,
} from '@/lib/mobile-server'

export function MobileServerConnectPage() {
  const savedServerUrl = useMemo(() => readSavedMobileServerUrl(), [])
  const manualSelection = new URLSearchParams(window.location.search).get('connect') === '1'
  const [serverUrl, setServerUrl] = useState(savedServerUrl)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!manualSelection && savedServerUrl) {
      window.location.replace(buildMobileServerAppUrl(savedServerUrl))
    }
  }, [manualSelection, savedServerUrl])

  const connect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const normalized = normalizeTailscaleServerUrl(serverUrl)
      saveMobileServerUrl(normalized)
      window.location.assign(buildMobileServerAppUrl(normalized))
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : '无法连接到 QuickForge 服务')
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-8 text-foreground">
      <section className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-background shadow-quickforge">
            <Server className="size-5 text-foreground/80" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">连接 QuickForge</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">通过 Tailscale 安全访问你的电脑或服务器</p>
          </div>
        </div>

        <form className="rounded-2xl border border-border bg-background p-5 shadow-quickforge" onSubmit={connect}>
          <label className="block text-sm font-medium" htmlFor="quickforge-mobile-server">
            服务器地址
          </label>
          <input
            id="quickforge-mobile-server"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
            spellCheck={false}
            value={serverUrl}
            onChange={(event) => {
              setServerUrl(event.target.value)
              setError('')
            }}
            placeholder="http://电脑名.tailnet.ts.net:5176"
            className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:shadow-quickforge"
          />
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            支持 MagicDNS 完整域名（以 <code>.ts.net</code> 结尾）或 Tailscale <code>100.x</code> 地址。
          </p>
          {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
          <button
            type="submit"
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-92 active:opacity-85"
          >
            连接服务器
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </form>

        <div className="mt-5 space-y-3 text-xs leading-5 text-muted-foreground">
          <p className="flex gap-2.5">
            <Network className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            手机和服务端电脑需要登录同一个 Tailnet，且电脑端 QuickForge 已开启局域网完整访问。
          </p>
          <p className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            App 只保存服务器地址，不保存局域网访问密码。密码由 QuickForge 的 HttpOnly Cookie 会话管理。
          </p>
        </div>
      </section>
    </main>
  )
}

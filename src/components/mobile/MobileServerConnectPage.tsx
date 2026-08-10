import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, Check, ChevronRight, Cloud, MoreHorizontal, Pencil, Plus, Server, ShieldCheck, Trash2, X } from 'lucide-react'
import {
  buildMobileServerAppUrl,
  normalizeTailscaleServerUrl,
  readMobileServerSettings,
  saveMobileServerSettings,
  type MobileServerSettings,
} from '@/lib/mobile-server'
import { CloudRemotePage } from '@/components/mobile/CloudRemotePage'
import { RemoteTunnel, type RemoteTunnelHasSession } from '@/lib/remote-tunnel'

/** 跳转前连接动画的最小展示时长，避免“点击即跳转”让用户感知不到正在建立连接。 */
const CONNECT_ANIMATION_MS = 800

export function MobileServerConnectPage() {
  const initialSettings = useMemo(() => readMobileServerSettings(), [])
  const [settings, setSettings] = useState<MobileServerSettings>(initialSettings)
  const [connectingUrl, setConnectingUrl] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(initialSettings.urls.length === 0)
  const [serverUrl, setServerUrl] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [managingUrl, setManagingUrl] = useState<string | null>(null)
  const [editingUrl, setEditingUrl] = useState<string | null>(null)
  const [editingAlias, setEditingAlias] = useState('')
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null)
  // “服务器列表”保留 Tailscale 直连；“云账户”为云远程访问（RemoteTunnel 隧道）。
  // 支持 ?tab=servers|cloud 指定初始选中项（远程页面侧边栏“返回连接页”入口携带）。
  const [activeTab, setActiveTab] = useState<'servers' | 'cloud'>(() => {
    const tab = new URLSearchParams(location.search).get('tab')
    return tab === 'servers' ? 'servers' : 'cloud'
  })
  // 云账户登录态（挂载时静默探测，Web 预览等非 Capacitor 环境插件不可用则保持未登录态）。
  const [cloudSession, setCloudSession] = useState<RemoteTunnelHasSession>({ signedIn: false })

  // 连接动画展示完成后跳转到目标服务器；组件卸载（如用户按返回键）时取消跳转。
  useEffect(() => {
    if (!connectingUrl) return
    const timer = window.setTimeout(() => {
      window.location.assign(buildMobileServerAppUrl(connectingUrl))
    }, CONNECT_ANIMATION_MS)
    return () => window.clearTimeout(timer)
  }, [connectingUrl])

  // 挂载时探测云账户会话，用于 tab 上的已登录徽章。
  useEffect(() => {
    let active = true
    RemoteTunnel.hasSession()
      .then((session) => {
        if (active) setCloudSession(session)
      })
      .catch(() => {
        // 原生插件暂不可用时静默降级（Web 预览等场景）。
      })
    return () => {
      active = false
    }
  }, [])

  const normalizedPreview = useMemo(() => {
    if (!serverUrl.trim()) return ''
    try {
      return normalizeTailscaleServerUrl(serverUrl)
    } catch {
      return ''
    }
  }, [serverUrl])

  const persistSettings = (nextSettings: MobileServerSettings) => {
    saveMobileServerSettings(nextSettings)
    setSettings(nextSettings)
  }

  const resetAddForm = () => {
    setServerUrl('')
    setAliasInput('')
    setError('')
  }

  const openAddForm = () => {
    resetAddForm()
    setSaved(false)
    setManagingUrl(null)
    setEditingUrl(null)
    setShowAddForm(true)
  }

  const addServer = (connectAfterSave: boolean) => {
    try {
      const normalized = normalizeTailscaleServerUrl(serverUrl)
      const urls = settings.urls.includes(normalized) ? settings.urls : [...settings.urls, normalized]
      const alias = aliasInput.trim()
      const aliases = { ...(settings.aliases ?? {}) }
      if (alias) aliases[normalized] = alias
      const nextSettings = {
        urls,
        aliases,
        lastUsedUrl: connectAfterSave ? normalized : settings.lastUsedUrl || normalized,
      }
      persistSettings(nextSettings)
      resetAddForm()
      setSaved(true)
      if (connectAfterSave) {
        setConnectingUrl(normalized)
      } else {
        setShowAddForm(false)
      }
    } catch (saveError) {
      setSaved(false)
      setError(saveError instanceof Error ? saveError.message : '无法保存 QuickForge 服务地址')
    }
  }

  const connect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    addServer(true)
  }

  const connectServer = (url: string) => {
    try {
      persistSettings({ ...settings, lastUsedUrl: url })
      setConnectingUrl(url)
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : '无法连接到 QuickForge 服务')
    }
  }

  const deleteServer = (url: string) => {
    try {
      const urls = settings.urls.filter((item) => item !== url)
      const aliases = { ...(settings.aliases ?? {}) }
      delete aliases[url]
      const lastUsedUrl = settings.lastUsedUrl === url ? urls[0] || '' : settings.lastUsedUrl
      persistSettings({ urls, aliases, lastUsedUrl })
      setManagingUrl(null)
      setDeletingUrl(null)
      if (editingUrl === url) {
        setEditingUrl(null)
        setEditingAlias('')
      }
      if (urls.length === 0) setShowAddForm(true)
      setError('')
      setSaved(false)
    } catch (deleteError) {
      setDeletingUrl(null)
      setError(deleteError instanceof Error ? deleteError.message : '无法删除服务器地址')
    }
  }

  const startEditAlias = (url: string) => {
    setEditingUrl(url)
    setEditingAlias(settings.aliases?.[url] ?? '')
  }

  const cancelEditAlias = () => {
    setEditingUrl(null)
    setEditingAlias('')
  }

  const saveAlias = (url: string) => {
    const alias = editingAlias.trim()
    const aliases = { ...(settings.aliases ?? {}) }
    if (alias) aliases[url] = alias
    else delete aliases[url]
    persistSettings({ ...settings, aliases })
    cancelEditAlias()
    setManagingUrl(null)
  }

  const deletingLabel = deletingUrl
    ? settings.aliases?.[deletingUrl]?.trim() || deletingUrl
    : ''

  if (connectingUrl) {
    const connectingLabel = settings.aliases?.[connectingUrl]?.trim() || connectingUrl
    return (
      <main
        className="flex min-h-dvh flex-col items-center justify-center bg-background px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-foreground"
        role="status"
        aria-live="polite"
      >
        <div className="relative flex size-24 items-center justify-center" aria-hidden="true">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/10 [animation-delay:0.45s]" />
          <div className="relative flex size-14 items-center justify-center rounded-2xl border border-border bg-background shadow-quickforge">
            <Server className="size-6 text-foreground/75" />
          </div>
        </div>
        <p className="mt-9 text-sm font-medium text-foreground/85">正在建立连接…</p>
        <p className="mt-2 w-full max-w-xs truncate text-center font-mono text-xs text-muted-foreground">{connectingLabel}</p>
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-background px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-foreground">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-muted/40 p-1" role="tablist" aria-label="连接方式">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'servers'}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors ${activeTab === 'servers' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('servers')}
          >
            <Server className="size-4" aria-hidden="true" />
            服务器列表
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'cloud'}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors ${activeTab === 'cloud' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('cloud')}
          >
            <Cloud className="size-4" aria-hidden="true" />
            云账户
            {cloudSession.signedIn ? (
              <span className="max-w-24 truncate rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                {cloudSession.email || '已登录'}
              </span>
            ) : null}
          </button>
        </div>
        {activeTab === 'cloud' ? (
          <CloudRemotePage />
        ) : (
        <section className="mx-auto w-full max-w-md">
        <header className="mb-8 flex items-start gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background shadow-quickforge">
            <Server className="size-5 text-foreground/75" aria-hidden="true" />
          </div>
          <div className="min-w-0 pt-0.5">
            <h1 className="text-lg font-semibold tracking-tight">连接 QuickForge</h1>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">选择一台已保存的服务器，或添加新的 Tailscale 地址。</p>
          </div>
        </header>

        {settings.urls.length > 0 ? (
          <section aria-labelledby="quickforge-mobile-saved-servers">
            <div className="mb-2.5 flex items-center justify-between px-1">
              <h2 id="quickforge-mobile-saved-servers" className="text-xs font-medium text-muted-foreground">已保存的服务器</h2>
              <span className="text-xs text-muted-foreground/70">{settings.urls.length} 台</span>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-background">
              {settings.urls.map((url) => {
                const active = url === settings.lastUsedUrl
                const alias = settings.aliases?.[url]?.trim()
                const isManaging = managingUrl === url
                const isEditing = editingUrl === url
                return (
                  <div key={url} className="border-b border-border last:border-b-0">
                    <div className="flex min-h-[68px] items-stretch gap-1 p-1.5">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted/45 active:bg-muted/65"
                        onClick={() => connectServer(url)}
                        title={`连接 ${alias || url}`}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/45 text-muted-foreground">
                          <Server className="size-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{alias || 'QuickForge 服务器'}</span>
                            {active ? (
                              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">上次使用</span>
                            ) : null}
                          </span>
                          <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{url}</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground/65" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground active:bg-muted/65"
                        onClick={() => {
                          setManagingUrl(isManaging ? null : url)
                          if (isManaging) cancelEditAlias()
                        }}
                        aria-label={`管理 ${alias || url}`}
                        title="管理服务器"
                        aria-expanded={isManaging}
                      >
                        {isManaging ? <X className="size-4" aria-hidden="true" /> : <MoreHorizontal className="size-5" aria-hidden="true" />}
                      </button>
                    </div>

                    {isManaging ? (
                      <div className="border-t border-border bg-muted/30 px-3 py-3">
                        {isEditing ? (
                          <div>
                            <label className="block text-xs font-medium text-muted-foreground" htmlFor={`quickforge-mobile-alias-${url}`}>
                              服务器别名
                            </label>
                            <input
                              id={`quickforge-mobile-alias-${url}`}
                              autoFocus
                              autoCapitalize="none"
                              autoCorrect="off"
                              spellCheck={false}
                              value={editingAlias}
                              onChange={(event) => setEditingAlias(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') saveAlias(url)
                                if (event.key === 'Escape') cancelEditAlias()
                              }}
                              placeholder="例如：公司开发机"
                              className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:shadow-quickforge"
                            />
                            <div className="mt-2.5 flex justify-end gap-2">
                              <button
                                type="button"
                                className="inline-flex h-9 items-center justify-center rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                                onClick={cancelEditAlias}
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-92 active:opacity-85"
                                onClick={() => saveAlias(url)}
                              >
                                <Check className="size-4" aria-hidden="true" />
                                保存
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl text-sm text-foreground/80 transition-colors hover:bg-muted/60"
                              onClick={() => startEditAlias(url)}
                            >
                              <Pencil className="size-4 text-muted-foreground" aria-hidden="true" />
                              编辑别名
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl text-sm text-foreground/80 transition-colors hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setDeletingUrl(url)}
                            >
                              <Trash2 className="size-4 text-muted-foreground" aria-hidden="true" />
                              删除服务器
                            </button>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>

            {!showAddForm ? (
              <button
                type="button"
                className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/45 active:bg-muted/65"
                onClick={openAddForm}
              >
                <Plus className="size-4" aria-hidden="true" />
                添加服务器
              </button>
            ) : null}

            {saved && !showAddForm ? (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-muted-foreground" role="status">
                <Check className="size-4" aria-hidden="true" />
                服务器已保存
              </p>
            ) : null}
          </section>
        ) : null}

        {showAddForm ? (
          <section className={settings.urls.length > 0 ? 'mt-7' : ''} aria-labelledby="quickforge-mobile-add-server">
            <div className="mb-2.5 flex items-center justify-between px-1">
              <h2 id="quickforge-mobile-add-server" className="text-xs font-medium text-muted-foreground">
                {settings.urls.length > 0 ? '添加服务器' : '添加第一台服务器'}
              </h2>
              {settings.urls.length > 0 ? (
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
                  onClick={() => {
                    resetAddForm()
                    setShowAddForm(false)
                  }}
                >
                  收起
                </button>
              ) : null}
            </div>

            <form className="rounded-2xl border border-border bg-background p-5 shadow-quickforge" onSubmit={connect}>
              <div className="mb-5 flex gap-2.5 rounded-xl bg-muted/30 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>仅支持 Tailnet 内的 <span className="font-mono text-foreground/75">.ts.net</span> 或 <span className="font-mono text-foreground/75">100.64.0.0/10</span> 地址，未填写端口时默认使用 5176。</p>
              </div>

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
                  setSaved(false)
                }}
                placeholder="devbox.example.ts.net"
                className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:shadow-quickforge"
              />
              {normalizedPreview ? (
                <p className="mt-2 break-all text-xs text-muted-foreground">
                  将连接到 <span className="font-mono text-foreground/70">{normalizedPreview}</span>
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">请确保手机与服务器已登录同一个 Tailnet。</p>
              )}

              <label className="mt-5 block text-sm font-medium" htmlFor="quickforge-mobile-server-alias">
                服务器别名 <span className="font-normal text-muted-foreground">（可选）</span>
              </label>
              <input
                id="quickforge-mobile-server-alias"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={aliasInput}
                onChange={(event) => {
                  setAliasInput(event.target.value)
                  setError('')
                  setSaved(false)
                }}
                placeholder="例如：公司开发机"
                className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:shadow-quickforge"
              />

              {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}

              <button
                type="submit"
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-92 active:opacity-85"
              >
                保存并连接
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-xl text-sm text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground active:bg-muted/65"
                onClick={() => addServer(false)}
              >
                仅保存，稍后连接
              </button>
            </form>
          </section>
        ) : null}
        </section>
        )}
      </div>

      {deletingUrl ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center" role="presentation">
          <section className="w-full max-w-sm rounded-2xl border border-border bg-background p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="quickforge-mobile-delete-title">
            <h2 id="quickforge-mobile-delete-title" className="text-base font-semibold">删除这台服务器？</h2>
            <p className="mt-2 break-all text-sm leading-6 text-muted-foreground">
              “{deletingLabel}”将从已保存列表中移除，之后仍可重新添加。
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/45"
                onClick={() => setDeletingUrl(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="inline-flex h-11 items-center justify-center rounded-xl bg-destructive text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-92 active:opacity-85"
                onClick={() => deleteServer(deletingUrl)}
              >
                删除
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

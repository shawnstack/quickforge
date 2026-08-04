import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, Check, Pencil, Server, Trash2, X } from 'lucide-react'
import {
  buildMobileServerAppUrl,
  normalizeTailscaleServerUrl,
  readMobileServerSettings,
  saveMobileServerSettings,
  type MobileServerSettings,
} from '@/lib/mobile-server'

export function MobileServerConnectPage() {
  const initialSettings = useMemo(() => readMobileServerSettings(), [])
  const manualSelection = new URLSearchParams(window.location.search).get('connect') === '1'
  const [settings, setSettings] = useState<MobileServerSettings>(initialSettings)
  const [serverUrl, setServerUrl] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  // Inline alias editing for an existing server row.
  const [editingUrl, setEditingUrl] = useState<string | null>(null)
  const [editingAlias, setEditingAlias] = useState('')

  useEffect(() => {
    if (!manualSelection && initialSettings.lastUsedUrl) {
      window.location.replace(buildMobileServerAppUrl(initialSettings.lastUsedUrl))
    }
  }, [initialSettings, manualSelection])

  const persistSettings = (nextSettings: MobileServerSettings) => {
    saveMobileServerSettings(nextSettings)
    setSettings(nextSettings)
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
      setServerUrl('')
      setAliasInput('')
      setError('')
      setSaved(true)
      if (connectAfterSave) {
        window.location.assign(buildMobileServerAppUrl(normalized))
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
      window.location.assign(buildMobileServerAppUrl(url))
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
      if (editingUrl === url) {
        setEditingUrl(null)
        setEditingAlias('')
      }
      setError('')
      setSaved(false)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '无法删除服务器地址')
    }
  }

  const startEditAlias = (url: string) => {
    setEditingUrl(url)
    setEditingAlias(settings.aliases?.[url] ?? '')
  }

  const saveAlias = (url: string) => {
    const alias = editingAlias.trim()
    const aliases = { ...(settings.aliases ?? {}) }
    if (alias) aliases[url] = alias
    else delete aliases[url]
    persistSettings({ ...settings, aliases })
    setEditingUrl(null)
    setEditingAlias('')
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-8 text-foreground">
      <section className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-background shadow-quickforge">
            <Server className="size-5 text-foreground/80" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">服务器设置</h1>
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
              setSaved(false)
            }}
            placeholder="http://服务器地址:5176"
            className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:shadow-quickforge"
          />
          <label className="mt-4 block text-sm font-medium" htmlFor="quickforge-mobile-server-alias">
            别名（可选）
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
          <p className="mt-2 text-xs text-muted-foreground">不填写时，列表将直接显示服务器地址。</p>
          {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
          {saved && !error ? (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
              <Check className="size-4" aria-hidden="true" />
              已保存
            </p>
          ) : null}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/45 active:bg-muted/65"
              onClick={() => addServer(false)}
            >
              保存
            </button>
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-92 active:opacity-85"
            >
              保存并连接
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        </form>

        {settings.urls.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-background">
            {settings.urls.map((url) => {
              const active = url === settings.lastUsedUrl
              const alias = settings.aliases?.[url]?.trim()
              const isEditing = editingUrl === url
              return (
                <div
                  key={url}
                  className="flex items-center gap-2 border-b border-[color-mix(in_oklab,var(--border)_38%,transparent)] p-2 last:border-b-0"
                >
                  {isEditing ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <input
                        autoFocus
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={editingAlias}
                        onChange={(event) => setEditingAlias(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') saveAlias(url)
                          if (event.key === 'Escape') {
                            setEditingUrl(null)
                            setEditingAlias('')
                          }
                        }}
                        placeholder="输入别名，如：公司开发机"
                        aria-label={`${alias || url} 的别名`}
                        className="h-10 w-full min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:shadow-quickforge"
                      />
                      <button
                        type="button"
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-92 active:opacity-85"
                        onClick={() => saveAlias(url)}
                        aria-label="保存别名"
                        title="保存别名"
                      >
                        <Check className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
                        onClick={() => {
                          setEditingUrl(null)
                          setEditingAlias('')
                        }}
                        aria-label="取消"
                        title="取消"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted/45"
                        onClick={() => connectServer(url)}
                        title={url}
                      >
                        <span className="inline-flex size-5 shrink-0 items-center justify-center">
                          {active ? <Check className="size-4 text-foreground/65" aria-hidden="true" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          {alias ? (
                            <>
                              <span className="block truncate text-sm font-medium text-foreground">{alias}</span>
                              <span className="mt-0.5 block break-all font-mono text-xs text-muted-foreground">{url}</span>
                            </>
                          ) : (
                            <span className="block break-all font-mono text-sm text-foreground/80">{url}</span>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
                        onClick={() => startEditAlias(url)}
                        aria-label={`编辑 ${alias || url} 的别名`}
                        title="编辑别名"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
                        onClick={() => deleteServer(url)}
                        aria-label={`删除 ${alias || url}`}
                        title={`删除 ${alias || url}`}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ) : null}
      </section>
    </main>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Copy } from 'lucide-react'
import type { Api, Model } from '@mariozechner/pi-ai'
import { AppStorage, CustomProvidersStore, ProviderKeysStore, SessionsStore, SettingsStore, setAppStorage } from '@mariozechner/pi-web-ui'
import { Button } from '@/components/ui/button'
import { ChatPanelHost } from '@/components/chat/ChatPanelHost'
import { t } from '@/lib/i18n'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { copyTextToClipboard } from '@/lib/message-utils'
import { unlockSharedConversation, loadSharedModelProviders } from '@/lib/share-client'
import { defaultThinkingLevelForModel } from '@/lib/pi-chat'
import { openCustomOnlyModelSelector } from '@/lib/custom-model-selector'
import { SharedServerAgent } from '@/lib/shared-server-agent'
import type { SharedSessionState } from '@/lib/shared-server-agent'
import { cn } from '@/lib/utils'

function providerFromModel(model: Model<Api>) {
  return {
    id: `shared-${model.provider}`,
    name: model.provider,
    type: model.api,
    baseUrl: model.baseUrl ?? '',
    models: [model],
  }
}

async function sharedModelProviders(shareId: string, fallbackModel?: Model<Api>) {
  try {
    const payload = await loadSharedModelProviders(shareId)
    if (payload.providers?.length) return payload.providers
  } catch {
    // Keep the share page usable even if model listing is unavailable.
  }
  return fallbackModel ? [providerFromModel(fallbackModel)] : []
}

function createAgentFromState(shareId: string, state: SharedSessionState) {
  const model = (state.model ?? { provider: 'shared', id: 'shared' }) as Model<Api>
  return new SharedServerAgent(shareId, {
    ...state,
    model,
    thinkingLevel: state.thinkingLevel ?? defaultThinkingLevelForModel(model),
  })
}

function installSharedPageStorage(shareId: string, model?: Model<Api>) {
  const stores = {
    settings: new SettingsStore(),
    providerKeys: new ProviderKeysStore(),
    sessions: new SessionsStore(),
    customProviders: new CustomProvidersStore(),
  }
  const backend = new HttpStorageBackend('', {
    blockedStores: ['sessions', 'provider-keys'],
    fakeProviderKeys: model ? [model.provider] : undefined,
    storeOverrides: model
      ? {
          'custom-providers': {
            keys: async () => (await sharedModelProviders(shareId, model)).map((provider) => provider.name),
            get: async <T = unknown>(key: string) => {
              const providers = await sharedModelProviders(shareId, model)
              return (providers.find((provider) => provider.name === key) ?? null) as T | null
            },
            has: async (key) => (await sharedModelProviders(shareId, model)).some((provider) => provider.name === key),
          },
        }
      : undefined,
  })
  stores.settings.setBackend(backend)
  stores.providerKeys.setBackend(backend)
  stores.sessions.setBackend(backend)
  stores.customProviders.setBackend(backend)
  setAppStorage(new AppStorage(stores.settings, stores.providerKeys, stores.sessions, stores.customProviders, backend))
}

export function SharedConversationPage({ shareId }: { shareId: string }) {
  const [password, setPassword] = useState('')
  const [agent, setAgent] = useState<SharedServerAgent | null>(null)
  const [permission, setPermission] = useState<'read' | 'operate'>('read')
  const [title, setTitle] = useState('QuickForge 分享对话')
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const autoUnlockAttemptedRef = useRef(false)

  const operate = permission === 'operate'
  const unlocked = Boolean(agent)
  const workspaceToolsEnabled = Boolean(agent?.state.tools?.length)

  useEffect(() => {
    installSharedPageStorage(shareId, agent?.state.model)
  }, [agent?.state.model, shareId])

  useEffect(() => {
    return () => agent?.dispose()
  }, [agent])

  const unlock = useCallback(async (inputPassword = password.trim()) => {
    setError(undefined)
    setLoading(true)
    try {
      const result = await unlockSharedConversation(shareId, inputPassword)
      setPermission(result.permission)
      setTitle(result.title || result.share.titleSnapshot || 'QuickForge 分享对话')
      const state = await SharedServerAgent.loadState(shareId)
      installSharedPageStorage(shareId, state.model)
      const sharedAgent = createAgentFromState(shareId, state)
      setAgent(sharedAgent)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock shared conversation')
    } finally {
      setLoading(false)
    }
  }, [password, shareId])

  useEffect(() => {
    if (unlocked || loading || autoUnlockAttemptedRef.current) return
    autoUnlockAttemptedRef.current = true
    const timer = window.setTimeout(() => {
      void unlock('')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loading, unlock, unlocked])

  const copyAnswer = useCallback(async (text: string) => {
    await copyTextToClipboard(text)
  }, [])

  const openSharedModelSelector = useCallback(async () => {
    if (!agent || agent.permission !== 'operate') return
    try {
      const providers = await sharedModelProviders(shareId, agent.state.model)
      const models = providers.flatMap((provider) => provider.models ?? []) as Model<Api>[]
      if (!models.length) return
      openCustomOnlyModelSelector(agent.state.model, models, (model) => {
        installSharedPageStorage(shareId, model)
        void agent.updateModel(model).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to update model')
        })
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models')
    }
  }, [agent, shareId])

  const rollback = useCallback(async (messageIndex: number) => {
    if (!agent || agent.permission !== 'operate') return
    if (agent.state.isStreaming) {
      alert(t('generationStillRunning'))
      return
    }
    if (!window.confirm('确定回滚这个原对话吗？该操作会直接影响分享者本机中的这一个对话。')) return
    try {
      await agent.rollback(messageIndex)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to roll back')
    }
  }, [agent])

  if (!unlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
          <div className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="size-5 text-amber-500" />
            QuickForge 局域网对话分享
          </div>
           <p className="mt-2 text-sm text-muted-foreground">如果分享者设置了密码，请输入密码。未设置密码的链接会自动打开。</p>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void unlock() }}
            className="mt-5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            placeholder="密码"
            autoFocus
          />
          {error ? <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          <Button className="mt-5 w-full" onClick={() => void unlock()} disabled={loading || !password.trim()}>
            {loading ? t('loading') : '用密码打开分享对话'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className={cn('shrink-0 border-b px-4 py-3', operate ? 'border-red-300 bg-red-50 text-red-950' : 'border-border bg-card')}>
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {operate ? <AlertTriangle className="size-4 text-red-600" /> : null}
              {operate ? '可操作分享：正在操作分享者的原始对话' : '只读分享对话'}
            </div>
            <div className={cn('mt-1 truncate text-xs', operate ? 'text-red-800' : 'text-muted-foreground')}>
              {operate
                ? '发送消息、停止生成、回滚都会直接影响分享者本机中的这一个对话。Fork、侧栏、设置和完整后台 API 已禁用。'
                : '界面与正常对话保持一致，但你只能查看这一个对话，不能发送消息或修改内容。'}
            </div>
            <div className="mt-1 truncate text-sm font-medium">{title}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void copyTextToClipboard(window.location.href)} aria-label="复制分享链接" title="复制分享链接">
            <Copy className="size-4" />
          </Button>
        </div>
      </header>

      {error ? <div className="mx-auto w-full max-w-4xl px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <ChatPanelHost
        agent={agent}
        revision={0}
        yoloMode={workspaceToolsEnabled}
        workspaceToolsEnabled={workspaceToolsEnabled}
        onModelSelect={openSharedModelSelector}
        onToggleYoloMode={() => undefined}
        onRollbackFromMessage={rollback}
        onCopyAnswer={copyAnswer}
        onForkFromMessage={() => undefined}
        disableFork
        readOnly={!operate}
        bypassClientApiKeyCheck
      />
    </div>
  )
}

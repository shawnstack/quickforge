import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Copy, RotateCcw, Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { copyTextToClipboard, draftTextFromUserMessage } from '@/lib/message-utils'
import {
  abortSharedGeneration,
  loadSharedConversation,
  rollbackSharedConversation,
  sendSharedMessage,
  unlockSharedConversation,
  type SharedConversation,
} from '@/lib/share-client'
import { cn } from '@/lib/utils'

type MessageLike = {
  role?: string
  content?: unknown
  toolName?: string
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: string; text: string } => {
      return typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string'
    })
    .map((block) => block.text)
    .join('\n\n')
}

function messageText(message: MessageLike) {
  if (message.role === 'user' || message.role === 'user-with-attachments') return draftTextFromUserMessage(message as never)
  return textFromContent(message.content)
}

function visibleRole(message: MessageLike) {
  if (message.role === 'assistant') return 'Assistant'
  if (message.role === 'toolResult') return message.toolName ? `Tool: ${message.toolName}` : 'Tool'
  return 'You'
}

export function SharedConversationPage({ shareId }: { shareId: string }) {
  const [password, setPassword] = useState('')
  const [conversation, setConversation] = useState<SharedConversation>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const operate = conversation?.permission === 'operate'
  const unlocked = Boolean(conversation)

  const refresh = useCallback(async () => {
    setConversation(await loadSharedConversation(shareId))
  }, [shareId])

  useEffect(() => {
    if (!unlocked) return
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [shareId, unlocked, refresh])

  const unlock = async () => {
    if (!password.trim()) return
    setError(undefined)
    setLoading(true)
    try {
      await unlockSharedConversation(shareId, password.trim())
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock shared conversation')
    } finally {
      setLoading(false)
    }
  }

  const submit = async () => {
    if (!operate || !message.trim()) return
    const text = message.trim()
    setMessage('')
    setError(undefined)
    try {
      await sendSharedMessage(shareId, text)
      await refresh()
    } catch (err) {
      setMessage(text)
      setError(err instanceof Error ? err.message : 'Failed to send message')
    }
  }

  const rollback = async (messageIndex: number) => {
    if (!operate) return
    if (!window.confirm('确定回滚这个原对话吗？该操作会直接影响分享者本机中的这一个对话。')) return
    try {
      const result = await rollbackSharedConversation(shareId, messageIndex)
      setConversation(result.session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to roll back')
    }
  }

  const abort = async () => {
    try {
      await abortSharedGeneration(shareId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop generation')
    }
  }

  if (!unlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
          <div className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="size-5 text-amber-500" />
            QuickForge 局域网对话分享
          </div>
          <p className="mt-2 text-sm text-muted-foreground">请输入分享者提供的密码。分享链接只能访问这一个对话。</p>
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
            {loading ? t('loading') : '解锁分享对话'}
          </Button>
        </div>
      </div>
    )
  }

  const currentConversation = conversation
  if (!currentConversation) return null

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className={cn('shrink-0 border-b px-4 py-3', operate ? 'border-red-300 bg-red-50 text-red-950' : 'border-border bg-card')}>
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {operate ? <AlertTriangle className="size-4 text-red-600" /> : null}
            {operate ? '⚠ 你正在操作分享者的原始对话' : 'QuickForge 只读分享对话'}
          </div>
          <div className={cn('mt-1 text-xs', operate ? 'text-red-800' : 'text-muted-foreground')}>
            {operate
              ? '你的操作会直接影响分享者本机中的这一个对话。禁止 Fork，不能访问其他对话、项目、设置或密钥。'
              : '你只能查看这一个对话，不能发送消息或访问其他内容。'}
          </div>
          <div className="mt-2 truncate text-sm font-medium">{currentConversation.title}</div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-4xl space-y-4">
          {currentConversation.messages.map((raw, index) => {
            const item = raw as MessageLike
            const text = messageText(item)
            if (!text) return null
            const isUser = item.role === 'user' || item.role === 'user-with-attachments'
            const isAssistant = item.role === 'assistant'
            return (
              <div key={index} className={cn('group rounded-2xl border p-4 shadow-sm', isUser ? 'ml-auto max-w-[82%] border-primary/20 bg-primary/10' : 'mr-auto max-w-[92%] border-border bg-card')}>
                <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{visibleRole(item)}</span>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => void copyTextToClipboard(text)} aria-label={t('copy')}>
                      <Copy className="size-3.5" />
                    </Button>
                    {operate && (isUser || isAssistant) ? (
                      <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => void rollback(index)} aria-label={t('rollback')}>
                        <RotateCcw className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="whitespace-pre-wrap break-words text-sm leading-6">{text}</div>
              </div>
            )
          })}
        </div>
      </main>

      {error ? <div className="mx-auto w-full max-w-4xl px-4 pb-2 text-sm text-destructive">{error}</div> : null}

      <footer className="shrink-0 border-t border-border bg-background px-4 py-3">
        <div className="mx-auto max-w-4xl">
          {operate ? (
            <div className="rounded-xl border border-red-300 bg-red-50 p-3">
              <div className="mb-2 text-xs font-medium text-red-700">可操作模式：你发送的内容会进入原对话。Fork 已禁用。</div>
              <div className="flex gap-2">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="min-h-12 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  placeholder="发送到这个原对话..."
                />
                {currentConversation.isStreaming ? (
                  <Button variant="destructive" size="icon" onClick={() => void abort()} aria-label="Stop">
                    <Square className="size-4" />
                  </Button>
                ) : (
                  <Button size="icon" onClick={() => void submit()} disabled={!message.trim()} aria-label="Send">
                    <Send className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-3 text-center text-sm text-muted-foreground">只读分享：不能发送消息或操作对话。</div>
          )}
        </div>
      </footer>
    </div>
  )
}

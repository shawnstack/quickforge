import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import {
  feedBot,
  fetchBotMemory,
  patchBot,
  saveBotMemory,
  type BotMascot as BotMascotSettings,
  type BotSummary,
} from './bots-data'
import { BotMascot } from './mascot/BotMascot'
import { MASCOT_PALETTES } from './mascot/mascot-geometry'

const OVERLAY = 'fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4 py-6 backdrop-blur-[2px]'
const CARD = 'flex max-h-[min(88vh,46rem)] w-full flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-quickforge'
const FIELD = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring'
const BUTTON = 'inline-flex h-8 items-center justify-center rounded-lg px-3 text-sm transition-colors'
const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`
const GHOST = `${BUTTON} border border-border text-muted-foreground hover:text-foreground`

const INTERVAL_OPTIONS = [15, 30, 60, 180, 1440]

/**
 * 弹窗里的开关行：label 左、switch 右，hint 换行弱化。
 * 形象/心跳三处开关共用同一配方，避免各写一份 drift 出不同样式。
 */
function SwitchRow({
  label,
  checked,
  disabled,
  onToggle,
  hint,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onToggle: () => void
  hint?: string
}) {
  return (
    <div className="border-b border-border py-2 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-xs">{label}</div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          className={cn(
            'relative h-5 w-9 shrink-0 rounded-full transition-colors',
            checked ? 'bg-primary' : 'bg-muted',
          )}
          onClick={onToggle}
        >
          <span
            className={cn(
              'absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-[left] duration-160',
              checked ? 'left-[1.125rem]' : 'left-0.5',
            )}
          />
        </button>
      </div>
      {hint ? <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

function minutesLabel(minutes: number) {
  if (minutes >= 1440 && minutes % 1440 === 0) return t('everyDays').replace('{count}', String(minutes / 1440))
  if (minutes >= 60 && minutes % 60 === 0) return t('everyHours').replace('{count}', String(minutes / 60))
  return t('everyMinutes').replace('{count}', String(minutes))
}

/** 新建 bot：只问一个名字，其余（目录、记忆、会话）都由服务端建。 */
export function NewBotDialog({
  open,
  pending,
  error,
  onCancel,
  onCreate,
}: {
  open: boolean
  pending?: boolean
  error?: string | null
  onCancel: () => void
  onCreate: (name: string) => void
}) {
  const [name, setName] = useState('')

  const trimmed = name.trim()
  if (!open) return null

  return (
    <div className={OVERLAY} role="dialog" aria-modal="true" aria-label={t('newBot')}>
      <div className={cn(CARD, 'max-w-md')}>
        <div className="px-5 pt-4 pb-2">
          <div className="text-sm font-semibold">{t('newBot')}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{t('newBotHint')}</div>
        </div>
        <div className="flex flex-col gap-3 px-5 pb-4">
          <input
            className={FIELD}
            value={name}
            autoFocus
            placeholder={t('newBotNamePlaceholder')}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed && !pending) onCreate(trimmed)
              if (event.key === 'Escape') onCancel()
            }}
            aria-label={t('newBotName')}
          />
          <div className="truncate text-[11px] leading-4 text-muted-foreground">
            {t('newBotWorkspace').replace('{path}', '~/.quickforge/bots/')}
          </div>
          {error ? <div className="text-xs leading-5 text-destructive">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" className={GHOST} onClick={onCancel}>{t('cancel')}</button>
          <button
            type="button"
            className={PRIMARY}
            disabled={!trimmed || pending}
            onClick={() => onCreate(trimmed)}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : t('create')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** bot 设置弹窗：工作空间、记忆、技能、节拍。全是这个 bot 独享的东西。 */
export function BotSettingsDialog({
  bot,
  onClose,
  onChanged,
  onDeleted,
}: {
  bot: BotSummary | null
  onClose: () => void
  onChanged: (bot: BotSummary) => void
  onDeleted: (botId: string) => void
}) {
  const [memory, setMemory] = useState('')
  const [memoryLoading, setMemoryLoading] = useState(true)
  const [savingMemory, setSavingMemory] = useState(false)
  const [memorySaved, setMemorySaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 投喂：写进 .bot/inbox.md，不进会话消息流；投完清空，fedFlash 短暂提示。
  const [feedDraft, setFeedDraft] = useState('')
  const [feeding, setFeeding] = useState(false)
  const [fedFlash, setFedFlash] = useState(false)
  // 形象是拖色盘实时改的，先落草稿再防抖写回服务端，避免每拖一像素发一次 PATCH。
  const [mascotDraft, setMascotDraft] = useState<BotMascotSettings>(
    bot?.mascot ?? { body: '#0B0B0C', eye: '#FFFFFF', animated: true, showOnComposer: true },
  )
  const mascotTimer = useRef<number | null>(null)

  const botId = bot?.id ?? null

  // 注意：这里刻意不在 effect 体内同步 setState（会触发级联渲染）。
  // 切换 bot 时由宿主用 key 重挂这个弹窗，初始态就是 loading。
  useEffect(() => {
    if (!botId) return
    let cancelled = false
    fetchBotMemory(botId)
      .then((payload) => {
        if (cancelled) return
        setMemory(payload.content ?? '')
        setMemoryLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setMemoryLoading(false)
      })
    return () => { cancelled = true }
  }, [botId])

  useEffect(() => {
    if (!bot) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bot, onClose])

  const update = useCallback(async (patch: Parameters<typeof patchBot>[1]) => {
    if (!botId) return
    setBusy(true)
    setError(null)
    try {
      onChanged(await patchBot(botId, patch))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [botId, onChanged])

  const scheduleMascotSave = useCallback((next: BotMascotSettings) => {
    setMascotDraft(next)
    if (mascotTimer.current !== null) window.clearTimeout(mascotTimer.current)
    mascotTimer.current = window.setTimeout(() => {
      mascotTimer.current = null
      void update({ mascot: next })
    }, 350)
  }, [update])

  useEffect(() => () => {
    if (mascotTimer.current !== null) window.clearTimeout(mascotTimer.current)
  }, [])

  const intervalOptions = useMemo(() => {
    const list = [...INTERVAL_OPTIONS]
    const current = bot?.heartbeat?.intervalMinutes
    if (current && !list.includes(current)) list.push(current)
    return list.sort((a, b) => a - b)
  }, [bot?.heartbeat?.intervalMinutes])

  if (!bot) return null

  const heartbeat = bot.heartbeat

  return (
    <div
      className={OVERLAY}
      role="dialog"
      aria-modal="true"
      aria-label={t('botSettings')}
    >
      <button type="button" className="absolute inset-0 cursor-default" aria-label={t('close')} onClick={onClose} />
      <div className={cn(CARD, 'relative max-w-xl')}>
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          {/* 预览放弹窗顶部：改色的实时反馈就在「这是谁的设置」这个身份位上，
              比藏在形象区里直观；look 跟草稿联动，拖色盘时它跟着变。 */}
          <BotMascot state="idle" size={44} look={mascotDraft} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{bot.name}</div>
            <div className="text-[11px] leading-4 text-muted-foreground">{t('botSettings')}</div>
          </div>
          <button type="button" className={GHOST} onClick={onClose}>{t('close')}</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <section className="mb-5">
            <div className="mb-2 text-[11px] leading-4 text-muted-foreground">{t('botMascot')}</div>
            <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t('botMascotPalette')}>
              {MASCOT_PALETTES.map((palette) => {
                const active = mascotDraft.body === palette.body && mascotDraft.eye === palette.eye
                return (
                  <button
                    key={palette.id}
                    type="button"
                    className={cn(
                      'size-6 rounded-full border transition-[box-shadow,border-color]',
                      active
                        // 选中态用 color-mix 写透明度：语义色的 /NN 档位受旧产物白名单约束
                        ? 'border-[color-mix(in_oklab,var(--ring)_70%,transparent)] ring-2 ring-[color-mix(in_oklab,var(--ring)_45%,transparent)]'
                        : 'border-border hover:border-muted-foreground/50',
                    )}
                    style={{ backgroundColor: palette.body, boxShadow: `inset 0 0 0 3px ${palette.eye}` }}
                    aria-label={palette.id}
                    aria-pressed={active}
                    title={palette.id}
                    onClick={() => scheduleMascotSave({ ...mascotDraft, body: palette.body, eye: palette.eye })}
                  />
                )
              })}
            </div>
            {([
              ['botMascotBody', 'body'],
              ['botMascotEye', 'eye'],
            ] as const).map(([labelKey, field]) => (
              <div key={field} className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
                <div className="min-w-0 flex-1 text-xs">{t(labelKey)}</div>
                <span className="font-mono text-[11px] text-muted-foreground">{mascotDraft[field]}</span>
                <input
                  type="color"
                  className="h-7 w-9 shrink-0 rounded-md border border-border bg-background p-0.5"
                  value={mascotDraft[field]}
                  aria-label={t(labelKey)}
                  onChange={(event) => scheduleMascotSave({ ...mascotDraft, [field]: event.target.value.toUpperCase() })}
                />
              </div>
            ))}
            <SwitchRow
              label={t('botMascotAnimated')}
              checked={mascotDraft.animated}
              onToggle={() => scheduleMascotSave({ ...mascotDraft, animated: !mascotDraft.animated })}
              hint={t('botMascotAnimatedHint')}
            />
            <SwitchRow
              label={t('botMascotComposer')}
              checked={mascotDraft.showOnComposer !== false}
              onToggle={() => scheduleMascotSave({ ...mascotDraft, showOnComposer: mascotDraft.showOnComposer === false })}
              hint={t('botMascotComposerHint')}
            />
          </section>

          <section className="mb-5">
            <div className="mb-1 text-[11px] leading-4 text-muted-foreground">{t('botHeartbeat')}</div>
            <SwitchRow
              label={t('botHeartbeatEnabled')}
              checked={heartbeat?.enabled !== false}
              disabled={busy}
              onToggle={() => void update({ heartbeat: { enabled: heartbeat?.enabled === false } })}
            />
            <div className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1 text-xs">{t('botHeartbeatInterval')}</div>
              <select
                className="h-7 rounded-lg border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                value={heartbeat?.intervalMinutes ?? 60}
                disabled={busy}
                aria-label={t('botHeartbeatInterval')}
                onChange={(event) => void update({ heartbeat: { intervalMinutes: Number(event.target.value) } })}
              >
                {intervalOptions.map((minutes) => (
                  <option key={minutes} value={minutes}>{minutesLabel(minutes)}</option>
                ))}
              </select>
            </div>
            <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{t('botHeartbeatHint')}</div>
          </section>

          <section className="mb-5">
            <div className="mb-1 text-[11px] leading-4 text-muted-foreground">{t('botFeed')}</div>
            <textarea
              className={cn(FIELD, 'min-h-20 resize-y text-xs leading-5')}
              value={feedDraft}
              placeholder={t('botFeed')}
              onChange={(event) => {
                setFeedDraft(event.target.value)
                setFedFlash(false)
              }}
              aria-label={t('botFeed')}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className={GHOST}
                disabled={feeding || !feedDraft.trim()}
                onClick={async () => {
                  if (!botId || !feedDraft.trim()) return
                  setFeeding(true)
                  setError(null)
                  try {
                    await feedBot(botId, feedDraft)
                    setFeedDraft('')
                    setFedFlash(true)
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                  } finally {
                    setFeeding(false)
                  }
                }}
              >
                {feeding ? <Loader2 className="size-4 animate-spin" /> : t('botFeed')}
              </button>
              {fedFlash ? <span className="text-[11px] text-muted-foreground">{t('botFed')}</span> : null}
            </div>
            <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{t('botFeedHint')}</div>
          </section>

          <section className="mb-5">
            <div className="mb-1 text-[11px] leading-4 text-muted-foreground">{t('botMemory')}</div>
            {memoryLoading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />{t('loading')}
              </div>
            ) : (
              <textarea
                className={cn(FIELD, 'min-h-56 resize-y font-mono text-xs leading-5')}
                value={memory}
                spellCheck={false}
                onChange={(event) => {
                  setMemory(event.target.value)
                  setMemorySaved(false)
                }}
                aria-label={t('botMemory')}
              />
            )}
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className={GHOST}
                disabled={savingMemory}
                onClick={async () => {
                  if (!botId) return
                  setSavingMemory(true)
                  setError(null)
                  try {
                    await saveBotMemory(botId, memory)
                    setMemorySaved(true)
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                  } finally {
                    setSavingMemory(false)
                  }
                }}
              >
                {savingMemory ? <Loader2 className="size-4 animate-spin" /> : t('save')}
              </button>
              {memorySaved ? <span className="text-[11px] text-muted-foreground">{t('saved')}</span> : null}
            </div>
            <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{t('botMemoryHint')}</div>
          </section>

          <section>
            <div className="mb-1 text-[11px] leading-4 text-muted-foreground">{t('botWorkspace')}</div>
            <div className="truncate rounded-lg border border-border px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
              {bot.workspacePath}
            </div>
            <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{t('botWorkspaceHint')}</div>
          </section>

          {error ? <div className="mt-4 text-xs leading-5 text-destructive">{error}</div> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <div>
            <button
              type="button"
              className={cn(GHOST, 'text-destructive hover:text-destructive')}
              disabled={busy}
              onClick={() => {
                if (!botId) return
                onDeleted(botId)
              }}
            >
              {t('botDelete')}
            </button>
            <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{t('botDeleteHint')}</div>
          </div>
          <button type="button" className={GHOST} onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  )
}

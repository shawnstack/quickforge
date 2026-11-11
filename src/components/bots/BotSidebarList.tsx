import { useEffect, useState } from 'react'
import { Loader2, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import {
  activeRowClass,
  iconButtonClass,
  inactiveRowClass,
  sidebarRowClass,
  sidebarSessionTitleClass,
} from '../sidebar/chat-sidebar/sidebar-classes'
import type { BotStatusTone, BotSummary } from './bots-data'
import { botStatusSummary } from './bots-data'
import { BotMascot } from './mascot/BotMascot'
import { resolveMascotState } from './mascot/mascot-state'

/** 列表里没有当前会话的细粒度状态，只能用 bot 自身字段拼：出错 > 在忙 > 睡了。 */
function sidebarMascotState(bot: BotSummary) {
  return resolveMascotState({
    error: bot.heartbeat?.lastError,
    toolRunning: bot.busy,
    paused: bot.heartbeat?.enabled === false,
  })
}

/** 状态文字的配色：只有「出错」跳出来，其余按次要文字处理。 */
const STATUS_TONE_CLASS: Record<BotStatusTone, string> = {
  busy: 'text-muted-foreground',
  error: 'text-destructive',
  asleep: 'text-muted-foreground/50',
  idle: 'text-muted-foreground/50',
}

/** 「3 分钟前」这种相对时间，一分钟重算一次足够。 */
const STATUS_TICK_MS = 60_000

/**
 * bot 模式的侧栏：一行一个 bot，和会话列表同一套行样式。
 * 一个 bot 只有一条会话，所以这里不需要展开/折叠 —— 点一行就是打开那条会话。
 *
 * 行里只写显示名，**不显示目录名**：目录是 `bots/bot-<id 前 8 位>`（见
 * `server/bots.mjs` 的 `botWorkspacePath`），跟名字无关，那串 id 对人没意义。
 * 早先这里显示过目录尾段，因为当时目录名就等于 bot 名，结果一行里名字写了两遍。
 *
 * 右侧那截小字是运行状态（干活中 / 出错 / 睡了 / 上次醒来多久前）：行首那只吉祥物
 * 放大到 24px（球径约 14px）也只够看出「在动」，眼睛的动作还是演不出来，状态只能靠
 * 文字讲清楚（DESIGN_LANGUAGE「状态说明应保留文字」）。hover 时让位给设置按钮，和以前一样。
 */
export function BotSidebarList({
  sidebarOpen,
  bots,
  activeBotId,
  loading,
  error,
  onSelectBot,
  onOpenBotSettings,
}: {
  sidebarOpen: boolean
  bots: BotSummary[]
  activeBotId?: string
  loading?: boolean
  error?: string | null
  onSelectBot: (bot: BotSummary) => void
  onOpenBotSettings: (bot: BotSummary) => void
}) {
  const rowClass = sidebarRowClass(sidebarOpen)
  // 状态文字里带相对时间，隔一分钟刷新一次（列表很短，这点重渲染不值一提）。
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), STATUS_TICK_MS)
    return () => window.clearInterval(tick)
  }, [])

  return (
    <div className="flex flex-col px-2 pb-2 pt-1">
      <div className="flex items-center gap-1 px-2 py-1 text-[11px] leading-4 text-muted-foreground/50">
        <span className="min-w-0 flex-1 truncate">{t('bots')}</span>
        {bots.length > 0 ? <span className="shrink-0 tabular-nums">{bots.length}</span> : null}
      </div>

      {loading && bots.length === 0 ? (
        <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('loading')}
        </div>
      ) : null}

      {error ? (
        <div className="px-2 py-3 text-xs text-muted-foreground">{error}</div>
      ) : null}

      {!loading && !error && bots.length === 0 ? (
        <div className="px-2 py-3 text-xs leading-5 text-muted-foreground">{t('botEmptyHint')}</div>
      ) : null}

      {bots.map((bot) => {
        const active = bot.id === activeBotId
        const status = botStatusSummary(bot, now)
        return (
          <div key={bot.id} className={cn(rowClass, 'group w-full', active ? activeRowClass : inactiveRowClass)}>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => onSelectBot(bot)}
              aria-current={active ? 'true' : undefined}
              title={bot.name}
            >
              <BotMascot
                state={sidebarMascotState(bot)}
                // 行高由这只会话行内容撑起（py-1.5 + 24px），比原来的状态圆点大一圈。
                // 再小就只能当色点用 —— 18px 时球径 10px，眼睛 2px，演不出任何动作。
                size={24}
                look={bot.mascot}
                className="shrink-0"
              />
              <span className={sidebarSessionTitleClass}>{bot.name}</span>
              <span
                className={cn(
                  'ml-auto shrink-0 text-[11px] leading-4 tabular-nums transition-opacity group-hover:opacity-0',
                  STATUS_TONE_CLASS[status.tone],
                )}
              >
                {status.text}
              </span>
            </button>
            <button
              type="button"
              className={cn(iconButtonClass, 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100')}
              onClick={() => onOpenBotSettings(bot)}
              aria-label={t('botSettings')}
              title={t('botSettings')}
            >
              <Settings2 className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

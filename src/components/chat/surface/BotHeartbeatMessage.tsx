import { useState } from 'react'
import { t } from '@/lib/i18n'
import { MarkdownBlock } from './Markdown'
import { botHeartbeatTextOf } from './bot-heartbeat-message'
import type { AgentMessage } from './ChatTypes'

/**
 * 心跳唤醒的那一行。
 *
 * 一小时一次，但「没事的班次」服务端根本不写消息（server/bot-runner.mjs 的
 * markIdle 只记一笔记录），所以这里不需要合并规则——进流的每一班都是真动过手的。
 * 正文默认收起：这一行要回答「它什么时候自己醒的」，不是把心跳指令原文摊开。
 *
 * 外层套 `.qf-user-message` 是为了维持行序号与装饰层的配对契约（同
 * CompactionMessage），装饰层按 `data-quickforge-bot-heartbeat` 跳过编辑/回滚。
 */
export function BotHeartbeatMessage({ message }: { message: AgentMessage }) {
  const [open, setOpen] = useState(false)
  const time = formatWakeTime(message)
  return (
    <div className="qf-user-message quickforge-bot-heartbeat" data-quickforge-bot-heartbeat="true">
      <div className="mx-4 my-2 flex flex-col gap-1 border-l-2 border-border pl-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>{t('botHeartbeatSelfWake')}</span>
          {time ? <time className="tabular-nums">{time}</time> : null}
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? t('collapse') : t('expand')}
          </button>
        </div>
        {open ? (
          <div className="quickforge-bot-heartbeat-body">
            <MarkdownBlock content={botHeartbeatTextOf(message)} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 消息的 timestamp 有两种写法：prompt 通道包出来的是 ISO 字符串，从别处回填的
 * 可能是 epoch 毫秒。两种都认，认不出来就不显示时间——比显示 Invalid Date 好。
 */
function formatWakeTime(message: AgentMessage): string {
  const raw = (message as unknown as Record<string, unknown>).timestamp
  const date = typeof raw === 'number' || typeof raw === 'string' ? new Date(raw) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

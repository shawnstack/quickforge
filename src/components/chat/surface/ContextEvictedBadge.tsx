import { Scissors } from 'lucide-react'
import { t } from '@/lib/i18n'

/** Ledger entry snapshot consumed by the badge (subset of the wire entry). */
export type ContextEvictionEntry = {
  kind?: string
  reason?: string
  forgottenAt?: string
}

/**
 * 「已从上下文裁剪」徽标：一行、卡外顶部（a11y 安全，不嵌任何 summary 内）。
 * 正文仅图标+固定文案；账本里的 reason 不直接展示，仅并入悬停 title。
 * ToolMessage（卡内）与 AssistantMessage（消息行）共用，间距差异经 className 注入。
 */
export function ContextEvictedBadge({ entry, className = '' }: { entry?: ContextEvictionEntry; className?: string }) {
  const reason = typeof entry?.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : ''
  const title = reason ? `${t('contextEvictedBadgeTitle')}\n${reason}` : t('contextEvictedBadgeTitle')
  return (
    <div
      className={`flex min-w-0 items-center gap-1 text-[11px] leading-4 text-muted-foreground select-none ${className}`}
      title={title}
    >
      <Scissors className="inline-block size-3 shrink-0" aria-hidden="true" />
      <span className="shrink-0">{t('contextEvictedBadge')}</span>
    </div>
  )
}

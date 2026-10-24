import { createPortal } from 'react-dom'
import { Gauge, GitBranch } from 'lucide-react'
import { sessionTitle } from '@/lib/types'
import type { QuickForgeSessionMetadata } from '@/lib/types'
import { sessionHoverTipClass, sessionHoverTipMetaClass } from './sidebar-classes'

export type SessionHoverTipInfo = {
  sessionId?: string
  gitBranch?: string
  context?: {
    color: string
    label: string
    title: string
  }
}

/** 会话行悬停提示：展示标题，当前会话额外展示分支与上下文用量（fixed 定位由调用方计算）。 */
export function SessionHoverTip({
  position,
  session,
  hoverInfo,
}: {
  position: { x: number; y: number }
  session: QuickForgeSessionMetadata
  hoverInfo?: SessionHoverTipInfo
}) {
  const showRuntimeInfo = hoverInfo?.sessionId === session.id
  return createPortal(
    <div
      className={sessionHoverTipClass}
      style={{ left: position.x, top: position.y, transform: 'translateY(-50%)' }}
    >
      <div className="whitespace-normal break-words text-sm font-medium leading-5">{sessionTitle(session.title)}</div>
      {showRuntimeInfo && hoverInfo?.gitBranch ? (
        <div className={sessionHoverTipMetaClass}>
          <GitBranch className="size-4 shrink-0" />
          <span className="truncate">{hoverInfo.gitBranch}</span>
        </div>
      ) : null}
      {showRuntimeInfo && hoverInfo?.context ? (
        <div className={sessionHoverTipMetaClass} title={hoverInfo.context.title}>
          <Gauge className="size-4 shrink-0" />
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: hoverInfo.context.color }} />
          <span className="truncate">{hoverInfo.context.label}</span>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}

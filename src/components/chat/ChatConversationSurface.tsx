import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

type ChatConversationSurfaceProps = ComponentPropsWithoutRef<'div'>

export function ChatConversationSurface({ className, ...props }: ChatConversationSurfaceProps) {
  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--quickforge-main-bg)]',
        className,
      )}
      {...props}
    />
  )
}

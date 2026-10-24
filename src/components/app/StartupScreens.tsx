import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { StartupSplashIcon } from '@/components/startup-splash-icon'

export function StartupSplash({ exiting = false }: { exiting?: boolean }) {
  const label = t('loadingChatWorkspace')

  return (
    <div className={cn('quickforge-startup-splash', exiting && 'quickforge-startup-splash-exit')} role="status" aria-label={label}>
      <StartupSplashIcon />
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function ConversationLoadingScreen({ exiting = false }: { exiting?: boolean }) {
  const label = t('loadingConversation')

  return (
    <div className={cn('quickforge-conversation-loading', exiting && 'quickforge-conversation-loading-exit')} role="status" aria-live="polite" aria-label={label}>
      <div className="quickforge-conversation-loading-status" aria-hidden="true">
        <span>{label}</span>
        <span className="quickforge-conversation-loading-dots">
          <span>•</span>
          <span>•</span>
          <span>•</span>
        </span>
      </div>
      <div className="quickforge-conversation-loading-track" aria-hidden="true">
        <div className="quickforge-conversation-loading-runner" />
      </div>
      <span className="quickforge-conversation-loading-helper" aria-hidden="true">{t('loadingConversationPreparing')}</span>
    </div>
  )
}

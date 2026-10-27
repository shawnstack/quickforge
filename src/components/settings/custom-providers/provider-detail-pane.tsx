import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, Trash2 } from 'lucide-react'
import type { CustomProvider } from '@/storage'
import { t } from '@/lib/i18n'
import { protocolShortLabel } from './shared'

export type ProviderDetailPaneProps = {
  provider: CustomProvider
  isDraft: boolean
  onDelete: () => void
  onBack: () => void
  children: ReactNode
}

export function ProviderDetailPane(props: ProviderDetailPaneProps) {
  const { provider, isDraft, onDelete, onBack, children } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const menuAnchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen || typeof document === 'undefined') return
    const onDocClick = (event: MouseEvent) => {
      if (!menuAnchorRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [menuOpen])

  const displayName = provider.name.trim() || t('newProviderFallback')
  const initial = displayName.charAt(0).toUpperCase() || 'M'

  return (
    <div className="quickforge-providers-detail">
      <div className="quickforge-providers-detail-head">
        <button
          className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact quickforge-providers-back"
          type="button"
          onClick={onBack}
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          {t('back')}
        </button>
        <span className="quickforge-settings-avatar quickforge-providers-detail-avatar" aria-hidden="true">{initial}</span>
        <div className="quickforge-providers-detail-title">
          <div className="quickforge-providers-detail-name">
            {displayName}
            {isDraft ? <span className="quickforge-settings-badge quickforge-settings-badge-info">{t('providerDraftBadge')}</span> : null}
            <span className="quickforge-settings-badge quickforge-settings-badge-muted">{protocolShortLabel(provider)}</span>
          </div>
          <div className="quickforge-providers-detail-host">{provider.baseUrl}</div>
        </div>
        <div className="quickforge-providers-add-anchor" ref={menuAnchorRef}>
          <button
            className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen ? 'true' : 'false'}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {t('more')}
          </button>
          {menuOpen
            ? (
              <div className="quickforge-providers-popover quickforge-providers-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="quickforge-providers-popover-item quickforge-providers-menu-danger"
                  onClick={() => { setMenuOpen(false); onDelete() }}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  {t('deleteProvider')}
                </button>
              </div>
            )
            : null}
        </div>
      </div>
      <div className="quickforge-providers-detail-body">
        {children}
      </div>
    </div>
  )
}

export function ProviderDetailEmpty() {
  return (
    <div className="quickforge-providers-detail quickforge-providers-detail-empty">
      <div className="quickforge-settings-empty-row">{t('selectProviderHint')}</div>
    </div>
  )
}

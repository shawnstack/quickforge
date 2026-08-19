import { t } from '@/lib/i18n'
import { escapeHtml } from './html'

type PersistDegradedNoticeDeps = {
  panel: HTMLElement
  isDegraded: () => boolean
}

/**
 * Non-blocking warning shown at the top of the message list when the server
 * reports that an authoritative persist was skipped after CAS conflicts
 * (session.persistDegraded). Removed automatically once a persist succeeds.
 */
export function syncPersistDegradedNotice(deps: PersistDegradedNoticeDeps) {
  const { panel, isDegraded } = deps
  const existing = panel.querySelector<HTMLElement>('.quickforge-persist-degraded-notice')

  if (!isDegraded()) {
    existing?.remove()
    return
  }

  const text = t('persistDegradedWarning')
  if (existing) {
    const label = existing.querySelector<HTMLElement>('.quickforge-persist-degraded-text')
    if (label && label.textContent !== text) label.textContent = text
    return
  }

  const notice = document.createElement('div')
  notice.className = 'quickforge-persist-degraded-notice'
  notice.setAttribute('role', 'alert')
  notice.innerHTML = `<span class="quickforge-persist-degraded-dot" aria-hidden="true"></span><span class="quickforge-persist-degraded-text">${escapeHtml(text)}</span>`

  const messageList = panel.querySelector('message-list')
  if (messageList && messageList.firstElementChild !== notice) messageList.prepend(notice)
}

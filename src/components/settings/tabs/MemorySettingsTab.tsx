import { useEffect, useState } from 'react'
import { getAppStorage } from '@/storage'
import { loadMemorySettings, saveMemorySettings } from '@/lib/memory-settings'
import { t } from '@/lib/i18n'
import { InfoTip } from '@/components/ui/info-tip'
import { SettingsSwitch } from './shared'

type MemoryDocument = {
  enabled: boolean
  markdown: string
  path: string
  count?: number
}

export function MemorySettingsTab() {
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingDocument, setLoadingDocument] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [savedMarkdown, setSavedMarkdown] = useState('')
  const [memoryPath, setMemoryPath] = useState('~/.quickforge/MEMORY.md')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadDocument = async (showMessage = false) => {
    setLoadingDocument(true)
    setError('')
    if (showMessage) setMessage('')
    try {
      const response = await fetch('/api/memory', { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as MemoryDocument & { error?: string } | null
      if (!response.ok || !payload) throw new Error(payload?.error || t('requestFailed'))
      setMarkdown(payload.markdown)
      setSavedMarkdown(payload.markdown)
      setMemoryPath(payload.path || '~/.quickforge/MEMORY.md')
      if (showMessage) setMessage(t('memoryReloaded'))
    } finally {
      setLoadingDocument(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const [settings] = await Promise.all([
          loadMemorySettings(getAppStorage()),
          loadDocument(),
        ])
        if (cancelled) return
        setEnabled(settings.enabled)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const updateEnabled = async (next: boolean) => {
    const previous = enabled
    setEnabled(next)
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await saveMemorySettings(getAppStorage(), { enabled: next })
      setMessage(next ? t('memoryEnabledSaved') : t('memoryDisabledSaved'))
    } catch (err) {
      setEnabled(previous)
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setSaving(false)
    }
  }

  const reloadDocument = async () => {
    try {
      await loadDocument(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const saveDocument = async () => {
    if (!enabled || saving) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/memory', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markdown }),
      })
      const payload = await response.json().catch(() => null) as MemoryDocument & { error?: string } | null
      if (!response.ok || !payload) throw new Error(payload?.error || t('requestFailed'))
      setMarkdown(payload.markdown)
      setSavedMarkdown(payload.markdown)
      setMemoryPath(payload.path || '~/.quickforge/MEMORY.md')
      setMessage(t('memoryContentSaved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>
  }
  const dirty = markdown !== savedMarkdown
  const busy = saving || loadingDocument

  return (
    <div className="quickforge-settings-stack">
      <section className="quickforge-settings-section" aria-label={t('memory')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('globalMemory')}
              <InfoTip label={t('globalMemoryInfo')} />
            </div>
            <div className="quickforge-settings-row-description">{t('globalMemoryDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsSwitch checked={enabled} onChange={(checked) => void updateEnabled(checked)} disabled={saving} />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('memoryFile')}</div>
            <div className="quickforge-settings-row-description">{t('memoryFileDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <code className="text-xs text-muted-foreground">{memoryPath}</code>
          </div>
        </div>

        <div className="quickforge-settings-row quickforge-settings-row-align-start quickforge-memory-content-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('memoryContent')}</div>
            <div className="quickforge-settings-row-description">
              {enabled ? t('memoryContentDescription') : t('memoryContentDisabledDescription')}
            </div>
          </div>
          <div className="quickforge-memory-editor-control">
            <textarea
              className="quickforge-settings-textarea quickforge-settings-mono quickforge-memory-editor"
              value={markdown}
              disabled={!enabled || busy}
              spellCheck={false}
              onChange={(event) => {
                setMarkdown(event.currentTarget.value)
                setMessage('')
              }}
            ></textarea>
            <div className="quickforge-memory-editor-actions">
              <button
                className="quickforge-settings-button quickforge-settings-button-secondary"
                type="button"
                disabled={busy}
                onClick={() => void reloadDocument()}
              >{loadingDocument ? t('loading') : t('memoryReload')}</button>
              <button
                className="quickforge-settings-button quickforge-settings-button-primary"
                type="button"
                disabled={!enabled || busy || !dirty}
                onClick={() => void saveDocument()}
              >{saving ? t('saving') : t('memorySave')}</button>
            </div>
          </div>
        </div>
      </section>

      {message ? <div className="quickforge-settings-message">{message}</div> : null}
      {error ? <div className="quickforge-settings-alert">{error}</div> : null}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { t } from '@/lib/i18n'
import { InfoTip } from '@/components/ui/info-tip'
import { SettingsSwitch } from './shared'

// The note-writing prompt is an internal contract: the server owns it and never
// exposes it here, so users cannot break the "file name = one-sentence summary"
// format. This tab only surfaces the switch, the folder, and a read-only example.
type WorkingMemoryDocument = {
  enabled: boolean
  path: string
}

const FALLBACK_PATH = '~/.quickforge/working-memory'

async function requestWorkingMemory(body?: { enabled?: boolean }): Promise<WorkingMemoryDocument> {
  const response = await fetch('/api/working-memory', body
    ? {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    : { cache: 'no-store' })
  const payload = await response.json().catch(() => null) as (WorkingMemoryDocument & { error?: string }) | null
  if (!response.ok || !payload) throw new Error(payload?.error || t('requestFailed'))
  return payload
}

export function WorkingMemorySettingsTab() {
  const [enabled, setEnabled] = useState(false)
  const [folderPath, setFolderPath] = useState(FALLBACK_PATH)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const applyDocument = (payload: WorkingMemoryDocument) => {
    setEnabled(payload.enabled)
    setFolderPath(payload.path || FALLBACK_PATH)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const payload = await requestWorkingMemory()
        if (!cancelled) applyDocument(payload)
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
    setBusy(true)
    setMessage('')
    setError('')
    try {
      applyDocument(await requestWorkingMemory({ enabled: next }))
      setMessage(next ? t('workingMemoryEnabledSaved') : t('workingMemoryDisabledSaved'))
    } catch (err) {
      setEnabled(previous)
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>
  }

  return (
    <div className="quickforge-settings-stack">
      <section className="quickforge-settings-section" aria-label={t('workingMemory')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('workingMemoryEnabled')}
              <InfoTip label={t('workingMemoryEnabledInfo')} />
            </div>
            <div className="quickforge-settings-row-description">{t('workingMemoryEnabledDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsSwitch checked={enabled} onChange={(checked) => void updateEnabled(checked)} disabled={busy} />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('workingMemoryFolder')}
              <InfoTip label={t('workingMemoryFolderDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <code className="text-xs text-muted-foreground">{folderPath}</code>
          </div>
        </div>

        <div className="quickforge-settings-row quickforge-settings-row-align-start">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('workingMemoryNotesStyle')}</div>
            <div className="quickforge-settings-row-description">{t('workingMemoryNotesStyleDescription')}</div>
            <details className="quickforge-settings-note mt-2">
              <summary className="cursor-pointer select-none">{t('workingMemoryExample')}</summary>
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed">{t('workingMemoryExampleContent')}</pre>
            </details>
          </div>
        </div>
      </section>

      {message ? <div className="quickforge-settings-message">{message}</div> : null}
      {error ? <div className="quickforge-settings-alert">{error}</div> : null}
    </div>
  )
}

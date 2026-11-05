import { useEffect, useState } from 'react'
import { getDateLocale, t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { SettingsSwitch } from './shared'

// The note-writing prompt is an internal contract: the server owns it and never
// exposes it here, so users cannot break the "file name = one-sentence summary"
// format. This tab surfaces the switch, the folder, and a read-only note list.
type WorkingMemoryDocument = {
  enabled: boolean
  path: string
}

type WorkingMemoryNote = {
  name: string
  title: string
  updatedAt: number
}

type WorkingMemoryNotesPage = {
  notes: WorkingMemoryNote[]
  page: number
  pageSize: number
  total: number
}

const FALLBACK_PATH = '~/.quickforge/working-memory'
const PAGE_SIZE = 20

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : undefined),
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload) {
    const message = (payload as { error?: string } | null)?.error
    throw new Error(message || t('requestFailed'))
  }
  return payload as T
}

const fetchWorkingMemory = () => requestJson<WorkingMemoryDocument>('/api/working-memory')

const saveWorkingMemoryEnabled = (enabled: boolean) => requestJson<WorkingMemoryDocument>('/api/working-memory', {
  method: 'PUT',
  body: JSON.stringify({ enabled }),
})

const fetchWorkingMemoryNotes = (page: number) =>
  requestJson<WorkingMemoryNotesPage>(`/api/working-memory/notes?page=${page}&pageSize=${PAGE_SIZE}`)

const requestOpenWorkingMemoryNote = (name: string) =>
  requestJson<{ ok: boolean }>('/api/working-memory/notes/open', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })

function formatNoteTime(value: number) {
  if (!value) return '—'
  return new Date(value).toLocaleString(getDateLocale())
}

export function WorkingMemorySettingsTab() {
  const [enabled, setEnabled] = useState(false)
  const [folderPath, setFolderPath] = useState(FALLBACK_PATH)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [notes, setNotes] = useState<WorkingMemoryNote[]>([])
  const [noteTotal, setNoteTotal] = useState(0)
  const [notePage, setNotePage] = useState(1)
  const [notesLoading, setNotesLoading] = useState(true)
  const [notesError, setNotesError] = useState('')
  const [openingName, setOpeningName] = useState('')

  const applyDocument = (payload: WorkingMemoryDocument) => {
    setEnabled(payload.enabled)
    setFolderPath(payload.path || FALLBACK_PATH)
  }

  const loadNotes = async (page: number) => {
    try {
      const payload = await fetchWorkingMemoryNotes(page)
      setNotes(payload.notes)
      setNoteTotal(payload.total)
      setNotePage(payload.page)
      setNotesError('')
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setNotesLoading(false)
    }
  }

  // Switching page shows the loading line again; the initial load starts with
  // `notesLoading` already true so the effect itself stays side-effect free.
  const goToPage = (page: number) => {
    setNotesLoading(true)
    void loadNotes(page)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const payload = await fetchWorkingMemory()
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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const payload = await fetchWorkingMemoryNotes(1)
        if (cancelled) return
        setNotes(payload.notes)
        setNoteTotal(payload.total)
        setNotePage(payload.page)
        setNotesError('')
      } catch (err) {
        if (!cancelled) setNotesError(err instanceof Error ? err.message : t('requestFailed'))
      } finally {
        if (!cancelled) setNotesLoading(false)
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
      applyDocument(await saveWorkingMemoryEnabled(next))
      setMessage(next ? t('workingMemoryEnabledSaved') : t('workingMemoryDisabledSaved'))
    } catch (err) {
      setEnabled(previous)
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  const openNote = async (name: string) => {
    setOpeningName(name)
    setNotesError('')
    try {
      await requestOpenWorkingMemoryNote(name)
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setOpeningName('')
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>
  }

  const totalPages = Math.max(1, Math.ceil(noteTotal / PAGE_SIZE))

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
      </section>

      <section className="quickforge-settings-section" aria-label={t('workingMemoryNotes')}>
        <div className="quickforge-settings-list-header">
          <div>
            <div className="quickforge-settings-row-title">{t('workingMemoryNotes')}</div>
            <div className="quickforge-settings-row-description">{t('workingMemoryNotesDescription')}</div>
          </div>
          <span className="text-xs text-muted-foreground">{t('workingMemoryNotesCount', { total: noteTotal })}</span>
        </div>

        {notesLoading ? (
          <div className="quickforge-working-memory-empty">{t('loading')}</div>
        ) : notes.length === 0 ? (
          <div className="quickforge-working-memory-empty">{t('workingMemoryNotesEmpty')}</div>
        ) : (
          <ul className="quickforge-working-memory-list">
            {notes.map((note) => (
              <li className="quickforge-settings-list-item" key={note.name}>
                <div className="quickforge-settings-list-item-main">
                  <div className="quickforge-working-memory-note-title" title={note.name}>{note.title}</div>
                  <div className="quickforge-working-memory-note-meta">{formatNoteTime(note.updatedAt)}</div>
                </div>
                <div className="quickforge-settings-list-item-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={openingName === note.name}
                    onClick={() => void openNote(note.name)}
                  >
                    {openingName === note.name ? t('loading') : t('workingMemoryNotesOpen')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 ? (
          <div className="quickforge-working-memory-pager">
            <Button variant="ghost" size="sm" type="button" disabled={notePage <= 1} onClick={() => goToPage(notePage - 1)}>
              {t('workingMemoryNotesPrev')}
            </Button>
            <span>{t('workingMemoryNotesPage', { page: notePage, total: totalPages })}</span>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={notePage >= totalPages}
              onClick={() => goToPage(notePage + 1)}
            >
              {t('workingMemoryNotesNext')}
            </Button>
          </div>
        ) : null}

        {notesError ? <div className="quickforge-working-memory-note-error">{notesError}</div> : null}
      </section>

      {message ? <div className="quickforge-settings-message">{message}</div> : null}
      {error ? <div className="quickforge-settings-alert">{error}</div> : null}
    </div>
  )
}

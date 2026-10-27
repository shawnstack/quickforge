import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { t } from '@/lib/i18n'
import { InfoTip } from '@/components/ui/info-tip'
import { SettingsSelect, SettingsSwitch } from '../settings/tabs/shared'
import {
  fetchDreamingMemories,
  fetchDreamingOverview,
  fetchDreamingRun,
  fetchDreamingRuns,
  formatDreamingDuration,
  formatDreamingTimestamp,
  retireDreamingMemory,
  saveDreamingSettings,
  triggerDreamingRun,
  modelRefKey,
  type DreamingMemory,
  type DreamingOverview,
  type DreamingSettings,
  type DreamingRun,
  type DreamingRunDetail,
  type DreamingRunOperation,
} from './dreaming-data'

const STATUS_KEY = {
  running: 'dreamingStatusRunning',
  succeeded: 'dreamingStatusSucceeded',
  failed: 'dreamingStatusFailed',
  skipped: 'dreamingStatusSkipped',
} as const

const KIND_KEY = {
  fact: 'dreamingKindFact',
  preference: 'dreamingKindPreference',
  experience: 'dreamingKindExperience',
  pitfall: 'dreamingKindPitfall',
  decision: 'dreamingKindDecision',
} as const

const BADGE_TONE = {
  succeeded: 'quickforge-settings-badge-success',
  failed: 'quickforge-settings-badge-danger',
  running: 'quickforge-settings-badge-info',
  skipped: 'quickforge-settings-badge-muted',
} as const

/** Status dot: the single always-visible "is it working" signal. */
function statusDotState(overview: DreamingOverview | null): 'on' | 'off' | 'running' | 'error' {
  if (!overview) return 'off'
  if (overview.running) return 'running'
  if (!overview.settings.enabled) return 'off'
  if (overview.lastRun?.status === 'failed') return 'error'
  return 'on'
}

/** The same state, spelled out next to the dot so color alone never carries meaning. */
const STATE_TEXT_KEY = {
  on: 'dreamingStateOn',
  off: 'dreamingStateOff',
  running: 'dreamingStatusRunning',
  error: 'dreamingStateFailed',
} as const

const MODEL_SOURCE_KEY = {
  explicit: 'dreamingModelSourcePinned',
  active: 'dreamingModelSourceChat',
  catalog: 'dreamingModelSourceDefault',
  none: 'dreamingModelNone',
} as const

function modelSourceKey(source: keyof typeof MODEL_SOURCE_KEY): typeof MODEL_SOURCE_KEY[keyof typeof MODEL_SOURCE_KEY] {
  return MODEL_SOURCE_KEY[source]
}

function StatusBadge({ status }: { status: DreamingRun['status'] }) {
  return <span className={`quickforge-settings-badge ${BADGE_TONE[status]}`}>{t(STATUS_KEY[status])}</span>
}

function KindBadge({ kind }: { kind: string | null | undefined }) {
  if (!kind) return null
  return <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t(KIND_KEY[kind as keyof typeof KIND_KEY] ?? 'dreamingKindFact')}</span>
}

function ScopeBadge({ scope }: { scope: string | null | undefined }) {
  if (!scope) return null
  return (
    <span className="quickforge-settings-badge quickforge-settings-badge-muted">
      {scope === 'project' ? t('dreamingScopeProject') : t('dreamingScopeGlobal')}
    </span>
  )
}

/** Inline metric cluster, so a run's shape is readable without opening it.
 *  The +/-/~/✕ glyphs are shorthand; each span carries a title with the full word. */
function RunMetrics({ run }: { run: DreamingRun }) {
  return (
    <div className="quickforge-dreaming-metrics">
      <span>{t('dreamingRunSessions')} {run.sessionCount}</span>
      <span data-tone="added" title={`${t('dreamingRunCreated')} +${run.createdCount}`}>+{run.createdCount}</span>
      <span data-tone="changed" title={`${t('dreamingRunUpdated')} ~${run.updatedCount}`}>~{run.updatedCount}</span>
      <span data-tone="removed" title={`${t('dreamingRunRetired')} -${run.retiredCount}`}>-{run.retiredCount}</span>
      {run.rejectedCount > 0 ? <span title={`${t('dreamingRunRejected')} ✕${run.rejectedCount}`}>✕{run.rejectedCount}</span> : null}
      <span title={t('dreamingRunDuration')}>{formatDreamingDuration(run.durationMs)}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Run detail
// ---------------------------------------------------------------------------

function OperationRow({ operation, memories }: { operation: DreamingRunOperation; memories: DreamingRunDetail['memories'] }) {
  const memory = operation.id ? memories[operation.id] : undefined
  const replacement = operation.replacementId ? memories[operation.replacementId] : undefined
  const proposed = operation.content ?? null
  const stored = memory?.content ?? null
  const changed = Boolean(proposed && stored && proposed !== stored)
  const sessions = [...new Set((memory?.evidence ?? []).map((entry) => entry.sessionId))].slice(0, 4)

  return (
    <li className="quickforge-settings-list-item">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="quickforge-settings-badge">{operation.action}</span>
          <KindBadge kind={operation.kind} />
          <ScopeBadge scope={operation.scope} />
          {memory ? (
            <span
              className="quickforge-settings-badge quickforge-settings-badge-muted"
              title={`${t('dreamingMemoryConfidence')} ${memory.confidence.toFixed(2)} · ${t('dreamingMemoryStrength')} ${memory.strength.toFixed(1)}`}
            >
              {memory.confidence.toFixed(2)} / {memory.strength.toFixed(1)}
            </span>
          ) : null}
          {memory?.status && memory.status !== 'active' ? (
            <span className="quickforge-settings-badge quickforge-settings-badge-muted">{memory.status}</span>
          ) : null}
        </div>
        <span className="quickforge-dreaming-summary">{stored ?? proposed ?? operation.id ?? '—'}</span>
        {changed ? (
          <span className="text-xs text-muted-foreground">
            {t('dreamingRunBefore')} {proposed}
          </span>
        ) : null}
        {replacement ? (
          <span className="text-xs text-muted-foreground">→ {replacement.content}</span>
        ) : null}
        {sessions.length > 0 ? (
          <span className="text-xs text-muted-foreground">{t('dreamingMemoryEvidence')}: {sessions.join(', ')}</span>
        ) : null}
      </div>
    </li>
  )
}

function SectionToggle({
  title,
  count,
  description,
  defaultOpen = false,
  children,
}: {
  title: string
  count?: number
  description?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="quickforge-settings-section">
      <button
        className="quickforge-dreaming-toggle-row"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="quickforge-dreaming-toggle-label">
          <span className="quickforge-dreaming-chevron" data-open={open} aria-hidden="true">
            <ChevronDown size={14} strokeWidth={2} />
          </span>
          {title}
          {typeof count === 'number' ? <span className="quickforge-dreaming-toggle-count">{count}</span> : null}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 pb-2">
          {description ? <p className="quickforge-settings-row-description">{description}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  )
}

function RunInputList({ run }: { run: DreamingRun }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (run.sessions.length === 0) return <div className="quickforge-settings-empty-row">{t('dreamingRunNoInput')}</div>
  return (
    <>
      <ul className="quickforge-settings-list">
        {run.sessions.map((session) => (
          <li className="quickforge-settings-list-item" key={session.sessionId}>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <code className="text-xs text-muted-foreground">{session.sessionId}</code>
                <span className="text-xs text-muted-foreground">{formatDreamingTimestamp(session.updatedAt)}</span>
                <span className="quickforge-settings-badge quickforge-settings-badge-muted" title={t('dreamingInputMessages')}>{session.messageCount}</span>
                <span className="quickforge-settings-badge quickforge-settings-badge-muted" title={t('dreamingInputChars')}>{session.chars}</span>
              </div>
              <span className="quickforge-dreaming-summary">{session.title || '—'}</span>
              {expanded === session.sessionId ? <pre className="quickforge-dreaming-code">{session.preview}</pre> : null}
            </div>
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
              type="button"
              onClick={() => setExpanded(expanded === session.sessionId ? null : session.sessionId)}
            >
              {expanded === session.sessionId ? t('dreamingRunCollapse') : t('dreamingRunPreview')}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t('dreamingRunBudget').replace('{used}', String(run.inputChars)).replace('{sessions}', String(run.sessions.length))}
      </p>
    </>
  )
}

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<DreamingRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await fetchDreamingRun(runId)
        if (!cancelled) setDetail(next)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runId])

  if (loading) return <div className="quickforge-settings-note">{t('loading')}</div>
  if (error) return <div className="quickforge-settings-alert">{error}</div>
  if (!detail) return <div className="quickforge-settings-empty-row">{t('dreamingNoRuns')}</div>

  const { run, memories } = detail
  const applied = run.operations.filter((operation) => operation.phase === 'applied')
  const rejected = run.operations.filter((operation) => operation.phase === 'rejected')
  const decayed = run.operations.filter((operation) => operation.phase === 'decayed')

  return (
    <div className="quickforge-settings-stack">
      <div className="flex items-center justify-between gap-3">
        <button
          className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
          type="button"
          onClick={onBack}
        >
          ← {t('dreamingRunBack')}
        </button>
        <StatusBadge status={run.status} />
      </div>

      <div className="quickforge-dreaming-stats">
        {[
          { label: t('dreamingTriggerSchedule'), value: run.trigger === 'manual' ? t('dreamingTriggerManual') : t('dreamingTriggerSchedule') },
          { label: t('dreamingRunSessions'), value: String(run.sessionCount) },
          { label: t('dreamingRunCreated'), value: `+${run.createdCount}` },
          { label: t('dreamingRunUpdated'), value: `~${run.updatedCount}` },
          { label: t('dreamingRunRetired'), value: `-${run.retiredCount}` },
          { label: t('dreamingRunRejected'), value: `✕${run.rejectedCount}` },
          { label: t('dreamingRunDuration'), value: formatDreamingDuration(run.durationMs) },
        ].map(({ label, value }) => (
          <div key={label}>
            <div className="quickforge-dreaming-stat-label">{label}</div>
            <div className="quickforge-dreaming-stat-value">{value}</div>
          </div>
        ))}
      </div>

      <div className="quickforge-dreaming-meta">
        <span>{t('dreamingRunPeriod')} <strong>{formatDreamingTimestamp(run.periodFrom)} → {formatDreamingTimestamp(run.periodTo)}</strong></span>
        <span>{t('dreamingRunModel')} <strong>{run.modelLabel ?? '—'}</strong></span>
        <span>{t('dreamingRunLanguage')} <strong>{run.contentLanguage === 'zh' ? t('dreamingLanguageZh') : run.contentLanguage === 'en' ? t('dreamingLanguageEn') : t('dreamingLanguageAuto')}</strong></span>
      </div>

      {run.summary || run.error ? (
        <p className={run.error ? 'quickforge-dreaming-error' : 'quickforge-dreaming-summary'}>{run.summary ?? run.error}</p>
      ) : null}
      {run.summary && run.error ? <p className="quickforge-dreaming-error">{run.error}</p> : null}

      <SectionToggle title={t('dreamingRunInput')} count={run.sessions.length} description={t('dreamingRunInputDescription')}>
        <RunInputList run={run} />
      </SectionToggle>

      <SectionToggle title={t('dreamingRunOperations')} count={applied.length} description={t('dreamingRunOperationsDescription')} defaultOpen>
        {applied.length === 0 ? (
          <div className="quickforge-settings-empty-row">{t('dreamingRunNoOperations')}</div>
        ) : (
          <ul className="quickforge-settings-list">
            {applied.map((operation, index) => (
              <OperationRow key={`applied-${operation.id ?? index}-${index}`} operation={operation} memories={memories} />
            ))}
          </ul>
        )}
      </SectionToggle>

      {rejected.length > 0 ? (
        <SectionToggle title={t('dreamingRunRejections')} count={rejected.length} description={t('dreamingRunRejectionsDescription')}>
          <ul className="quickforge-settings-list">
            {rejected.map((operation, index) => (
              <li className="quickforge-settings-list-item" key={`rejected-${index}`}>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="quickforge-settings-badge">{operation.action ?? '?'}</span>
                    <KindBadge kind={operation.kind} />
                    <span className="quickforge-dreaming-error">{operation.reason}</span>
                  </div>
                  {operation.content ? <span className="quickforge-dreaming-summary">{operation.content}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </SectionToggle>
      ) : null}

      {decayed.length > 0 ? (
        <SectionToggle title={t('dreamingRunDecayed')} count={decayed.length} description={t('dreamingRunDecayedDescription')}>
          <ul className="quickforge-settings-list">
            {decayed.map((operation, index) => {
              const memory = operation.id ? memories[operation.id] : undefined
              return (
                <li className="quickforge-settings-list-item" key={`decayed-${index}`}>
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="quickforge-settings-badge">{operation.action}</span>
                      {memory ? (
                        <span
                          className="quickforge-settings-badge quickforge-settings-badge-muted"
                          title={`${t('dreamingMemoryConfidence')} ${memory.confidence.toFixed(2)} · ${t('dreamingMemoryStrength')} ${memory.strength.toFixed(1)}`}
                        >
                          {memory.confidence.toFixed(2)} / {memory.strength.toFixed(1)}
                        </span>
                      ) : null}
                    </div>
                    <span className="quickforge-dreaming-summary">{memory?.content ?? operation.id}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </SectionToggle>
      ) : null}

      {run.rawResponse ? (
        <SectionToggle title={t('dreamingRunRawResponse')} description={t('dreamingRunRawResponseDescription')}>
          <pre className="quickforge-dreaming-code">{run.rawResponse}</pre>
        </SectionToggle>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Memory list
// ---------------------------------------------------------------------------

function MemoryRow({ memory, onRetired }: { memory: DreamingMemory; onRetired: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const retire = async () => {
    setBusy(true)
    setError('')
    try {
      await retireDreamingMemory(memory.id)
      onRetired()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="quickforge-settings-list-item">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <KindBadge kind={memory.kind} />
          {memory.recallCount > 0 ? (
            <span
              className="quickforge-settings-badge quickforge-settings-badge-info"
              title={t('dreamingMemoryRecallTitle', { count: memory.recallCount })}
            >
              ×{memory.recallCount}
            </span>
          ) : null}
        </div>
        <span className="quickforge-dreaming-summary">{memory.content}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {memory.scope === 'project' ? t('dreamingScopeProject') : t('dreamingScopeGlobal')}
          {' · '}
          <span title={t('dreamingMemoryConfidence')}>{memory.confidence.toFixed(2)}</span>
          {' · '}
          <span title={t('dreamingMemoryStrength')}>{memory.strength.toFixed(1)}</span>
          {' · '}
          {formatDreamingTimestamp(memory.updatedAt)}
        </span>
        {error ? <span className="quickforge-dreaming-error">{error}</span> : null}
      </div>
      {memory.status === 'active' ? (
        <button
          className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
          type="button"
          disabled={busy}
          onClick={() => void retire()}
        >
          {t('dreamingMemoryRetire')}
        </button>
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

type TabView = 'memories' | 'runs'

export function DreamingSettingsTab() {
  const [overview, setOverview] = useState<DreamingOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [view, setView] = useState<TabView>('memories')

  const [runs, setRuns] = useState<DreamingRun[]>([])
  const [runPage, setRunPage] = useState(1)
  const [runTotal, setRunTotal] = useState(0)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const [memories, setMemories] = useState<DreamingMemory[]>([])
  const [memoryPage, setMemoryPage] = useState(1)
  const [memoryTotal, setMemoryTotal] = useState(0)
  const [memoryQuery, setMemoryQuery] = useState('')
  const [memoryStatus, setMemoryStatus] = useState('active')

  const pageSize = 10
  const settings = overview?.settings
  const busy = saving || running

  const loadOverview = useCallback(async () => {
    const next = await fetchDreamingOverview()
    setOverview(next)
    setRunning(next.running)
    return next
  }, [])

  const loadRuns = useCallback(async (page: number) => {
    const payload = await fetchDreamingRuns(page, pageSize)
    setRuns(payload.runs)
    setRunTotal(payload.total)
    setRunPage(payload.page)
  }, [])

  const loadMemories = useCallback(async (page: number, query: string, status: string) => {
    const payload = await fetchDreamingMemories({ page, pageSize, query, status })
    setMemories(payload.memories)
    setMemoryTotal(payload.total)
    setMemoryPage(payload.page)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await loadOverview()
        if (cancelled) return
        await Promise.all([loadRuns(1), loadMemories(1, '', 'active')])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadOverview, loadRuns, loadMemories])

  // Typing or switching the status filter re-searches after a short settle,
  // so neither a Search button nor Enter is needed. The initial load above
  // already covers the default query, hence the first-run skip.
  const skipFirstFilterRun = useRef(true)
  useEffect(() => {
    if (skipFirstFilterRun.current) {
      skipFirstFilterRun.current = false
      return
    }
    const timer = setTimeout(() => {
      void loadMemories(1, memoryQuery, memoryStatus)
    }, 300)
    return () => clearTimeout(timer)
  }, [memoryQuery, memoryStatus, loadMemories])

  const updateSettings = async (patch: Parameters<typeof saveDreamingSettings>[0]) => {
    const previous = settings
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const saved = await saveDreamingSettings(patch)
      setOverview((current) => (current ? { ...current, settings: saved, nextRunAt: saved.nextRunAt } : current))
      setMessage(t('dreamingSaved'))
    } catch (err) {
      if (previous) setOverview((current) => (current ? { ...current, settings: previous } : current))
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setSaving(false)
    }
  }

  const runNow = async () => {
    setRunning(true)
    setMessage('')
    setError('')
    try {
      const result = await triggerDreamingRun()
      setMessage(result.skipped ? t('dreamingRunSkipped') : t('dreamingRunQueued'))
      await loadOverview()
      await Promise.all([loadRuns(1), loadMemories(1, memoryQuery, memoryStatus)])
      if (!result.skipped) setView('runs')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setRunning(false)
    }
  }

  const memoryStatusOptions = useMemo(() => [
    { value: 'active', label: t('dreamingCountActive') },
    { value: 'retired', label: t('dreamingCountRetired') },
    { value: 'superseded', label: t('dreamingCountSuperseded') },
    { value: 'any', label: t('dreamingCountAll') },
  ], [])

  const modelOptions = useMemo(() => {
    const options = overview?.model?.available ?? []
    return [
      { value: '', label: t('dreamingModelFollowChat'), ref: null as DreamingSettings['modelRef'] },
      ...options.map((model) => ({
        value: modelRefKey(model.ref),
        label: `${model.name} (${model.provider})`,
        ref: model.ref as DreamingSettings['modelRef'],
      })),
    ]
  }, [overview])

  const languageOptions = useMemo(() => [
    { value: 'auto', label: t('dreamingLanguageAuto') },
    { value: 'zh', label: t('dreamingLanguageZh') },
    { value: 'en', label: t('dreamingLanguageEn') },
  ], [])

  if (loading || !settings) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>
  }

  if (selectedRunId) {
    return <RunDetail runId={selectedRunId} onBack={() => setSelectedRunId(null)} />
  }

  const dotState = statusDotState(overview)
  const effectiveModel = overview?.model
  const totalRunPages = Math.max(1, Math.ceil(runTotal / pageSize))
  const totalMemoryPages = Math.max(1, Math.ceil(memoryTotal / pageSize))

  return (
    <div className="quickforge-settings-stack">
      <section className="quickforge-dreaming-header" aria-label={t('dreamingTab')}>
        <div className="quickforge-dreaming-header-top">
          <div className="min-w-0">
            <div className="quickforge-dreaming-title">
              <span className="quickforge-dreaming-dot" data-state={dotState} aria-hidden="true" />
              {t('dreamingTab')}
              <span className="quickforge-dreaming-status-text" data-state={dotState}>{t(STATE_TEXT_KEY[dotState])}</span>
              <InfoTip label={t('dreamingEnabledInfo')} />
            </div>
            <p className="quickforge-dreaming-description">{t('dreamingDescription')}</p>
          </div>
          <div className="quickforge-dreaming-actions">
            <SettingsSwitch
              checked={settings.enabled}
              onChange={(checked) => void updateSettings({ enabled: checked })}
              disabled={saving}
              aria-label={t('dreamingEnabled')}
            />
            <button
              className="quickforge-settings-button quickforge-settings-button-primary quickforge-settings-button-compact"
              type="button"
              disabled={!settings.enabled || busy}
              onClick={() => void runNow()}
            >
              {running ? t('dreamingRunning') : t('dreamingRunNow')}
            </button>
          </div>
        </div>

        <div className="quickforge-dreaming-meta">
          <span>{t('dreamingNextRun')} <strong>{formatDreamingTimestamp(overview?.nextRunAt)}</strong></span>
          <span>{t('dreamingLastRun')} <strong>{formatDreamingTimestamp(settings.lastRunAt)}</strong></span>
          <span>{t('dreamingCountActive')} <strong>{overview?.counts.active ?? 0}</strong></span>
          <span>
            {t('dreamingRunModel')}{' '}
            <strong>
              {effectiveModel?.effective
                ? `${effectiveModel.effective} · ${t(modelSourceKey(effectiveModel.source))}`
                : t('dreamingModelNone')}
            </strong>
          </span>
          <span>{overview?.memoryDocument.hasAutoSection ? t('dreamingAutoSectionOnShort') : t('dreamingAutoSectionOffShort')}</span>
        </div>

        <div className="quickforge-dreaming-settings">
          <label className="quickforge-dreaming-field">
            <span className="quickforge-dreaming-field-label">{t('dreamingExecuteTime')}</span>
            <input
              className="quickforge-settings-input"
              type="time"
              value={settings.executeTime}
              disabled={!settings.enabled || !settings.scheduleEnabled || saving}
              onChange={(event) => void updateSettings({ executeTime: event.currentTarget.value })}
            />
          </label>

          <label className="quickforge-dreaming-field quickforge-dreaming-field-model">
            <span className="quickforge-dreaming-field-label">
              {t('dreamingModel')}
              <InfoTip label={t('dreamingModelInfo')} />
            </span>
            <SettingsSelect
              value={modelRefKey(settings.modelRef)}
              options={modelOptions}
              onChange={(value) => {
                const option = modelOptions.find((item) => item.value === value)
                void updateSettings({ modelRef: option?.ref ?? null })
              }}
              disabled={saving}
              searchable
              searchPlaceholder={t('dreamingModelSearchPlaceholder')}
              noResultsLabel={t('dreamingModelNoResults')}
              label={t('dreamingModel')}
            />
          </label>

          <label className="quickforge-dreaming-field">
            <span className="quickforge-dreaming-field-label">{t('dreamingLanguage')}</span>
            <SettingsSelect
              value={settings.contentLanguage}
              options={languageOptions}
              onChange={(value) => void updateSettings({ contentLanguage: value as typeof settings.contentLanguage })}
              disabled={saving}
              label={t('dreamingLanguage')}
            />
          </label>

          <label className="quickforge-dreaming-field">
            <span className="quickforge-dreaming-field-label">
              {t('dreamingSensitive')}
              <InfoTip label={t('dreamingSensitiveInfo')} />
            </span>
            <SettingsSwitch
              checked={settings.allowSensitive}
              onChange={(checked) => void updateSettings({ allowSensitive: checked })}
              disabled={!settings.enabled || saving}
            />
          </label>

          <label className="quickforge-dreaming-field">
            <span className="quickforge-dreaming-field-label">{t('dreamingSchedule')}</span>
            <SettingsSwitch
              checked={settings.scheduleEnabled}
              onChange={(checked) => void updateSettings({ scheduleEnabled: checked })}
              disabled={!settings.enabled || saving}
            />
          </label>
        </div>
      </section>

      <section className="quickforge-settings-section" aria-label={t('dreamingMemories')}>
        <div className="quickforge-settings-subtabs" role="tablist">
          <button
            className={`quickforge-settings-subtab ${view === 'memories' ? 'quickforge-settings-subtab-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={view === 'memories'}
            onClick={() => setView('memories')}
          >
            {t('dreamingMemories')} {overview?.counts.active ?? 0}
          </button>
          <button
            className={`quickforge-settings-subtab ${view === 'runs' ? 'quickforge-settings-subtab-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={view === 'runs'}
            onClick={() => setView('runs')}
          >
            {t('dreamingHistory')} {overview?.counts.runs ?? 0}
          </button>
        </div>

        {view === 'memories' ? (
          <>
            <div className="quickforge-dreaming-filters">
              <input
                className="quickforge-settings-input"
                type="search"
                value={memoryQuery}
                placeholder={t('dreamingMemorySearchPlaceholder')}
                onChange={(event) => setMemoryQuery(event.currentTarget.value)}
              />
              <SettingsSelect
                value={memoryStatus}
                options={memoryStatusOptions}
                onChange={setMemoryStatus}
                label={t('dreamingStatus')}
              />
            </div>

            {memories.length === 0 ? (
              <div className="quickforge-settings-empty-row">{t('dreamingNoMemories')}</div>
            ) : (
              <ul className="quickforge-settings-list">
                {memories.map((memory) => (
                  <MemoryRow
                    key={memory.id}
                    memory={memory}
                    onRetired={() => {
                      setMessage(t('dreamingMemoryRetired'))
                      void loadMemories(memoryPage, memoryQuery, memoryStatus)
                      void loadOverview()
                    }}
                  />
                ))}
              </ul>
            )}

            {totalMemoryPages > 1 ? (
              <div className="quickforge-dreaming-pager">
                <span className="text-xs text-muted-foreground">
                  {t('dreamingPage').replace('{page}', String(memoryPage)).replace('{total}', String(totalMemoryPages))}
                </span>
                <button
                  className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
                  type="button"
                  disabled={memoryPage <= 1}
                  onClick={() => void loadMemories(memoryPage - 1, memoryQuery, memoryStatus)}
                >{t('dreamingPrev')}</button>
                <button
                  className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
                  type="button"
                  disabled={memoryPage >= totalMemoryPages}
                  onClick={() => void loadMemories(memoryPage + 1, memoryQuery, memoryStatus)}
                >{t('dreamingNext')}</button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {runs.length === 0 ? (
              <div className="quickforge-settings-empty-row">{t('dreamingNoRuns')}</div>
            ) : (
              <div>
                {runs.map((run) => (
                  <button
                    className="quickforge-dreaming-row"
                    type="button"
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <span className="quickforge-dreaming-row-head">
                      <StatusBadge status={run.status} />
                      <span className="quickforge-dreaming-row-time">{formatDreamingTimestamp(run.startedAt)}</span>
                    </span>
                    <RunMetrics run={run} />
                    {run.summary ?? run.error ? (
                      <span className={run.error ? 'quickforge-dreaming-error' : 'quickforge-settings-row-description'}>
                        {run.summary ?? run.error}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}

            {totalRunPages > 1 ? (
              <div className="quickforge-dreaming-pager">
                <span className="text-xs text-muted-foreground">
                  {t('dreamingPage').replace('{page}', String(runPage)).replace('{total}', String(totalRunPages))}
                </span>
                <button
                  className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
                  type="button"
                  disabled={runPage <= 1}
                  onClick={() => void loadRuns(runPage - 1)}
                >{t('dreamingPrev')}</button>
                <button
                  className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
                  type="button"
                  disabled={runPage >= totalRunPages}
                  onClick={() => void loadRuns(runPage + 1)}
                >{t('dreamingNext')}</button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {message ? <div className="quickforge-settings-message">{message}</div> : null}
      {error ? <div className="quickforge-settings-alert">{error}</div> : null}
    </div>
  )
}

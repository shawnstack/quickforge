import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, ChevronDown } from 'lucide-react'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { SettingsSelect, SettingsSwitch } from '../settings/tabs/shared'
import {
  fetchDreamingExperiences,
  fetchDreamingOverview,
  fetchDreamingRun,
  fetchDreamingRuns,
  formatDreamingDuration,
  formatDreamingTimestamp,
  formatModelOptionLabel,
  restoreDreamingRun,
  saveDreamingSettings,
  triggerDreamingRun,
  modelRefKey,
  type DreamingAction,
  type DreamingExperience,
  type DreamingOverview,
  type DreamingRun,
  type DreamingRunDetail,
  type DreamingSettings,
} from './dreaming-data'

const STATUS_KEY = {
  running: 'dreamingStatusRunning',
  succeeded: 'dreamingStatusSucceeded',
  failed: 'dreamingStatusFailed',
  skipped: 'dreamingStatusSkipped',
} as const

const BADGE_TONE = {
  succeeded: 'quickforge-settings-badge-success',
  failed: 'quickforge-settings-badge-danger',
  running: 'quickforge-settings-badge-info',
  skipped: 'quickforge-settings-badge-muted',
} as const

const CARD = 'rounded-xl border border-[color-mix(in_oklab,var(--border)_72%,transparent)] bg-background'
const HAIRLINE = 'border-[color-mix(in_oklab,var(--border)_60%,transparent)]'

/** Label above control, shadcn field layout. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {hint ? <InfoTip label={hint} /> : null}
      </span>
      {children}
    </div>
  )
}

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

const ACTION_KEY = {
  write: 'dreamingActionWrite',
  rename: 'dreamingActionRename',
  archive: 'dreamingActionArchive',
} as const

function StatusBadge({ status }: { status: DreamingRun['status'] }) {
  return <span className={`quickforge-settings-badge ${BADGE_TONE[status]}`}>{t(STATUS_KEY[status])}</span>
}

/** Inline metric cluster, so a run's shape is readable without opening it. */
function RunMetrics({ run }: { run: DreamingRun }) {
  return (
    <div className="quickforge-dreaming-metrics">
      <span>{t('dreamingRunSessions')} {run.sessionCount}</span>
      <span data-tone="added" title={`${t('dreamingRunAdded')} +${run.createdCount}`}>+{run.createdCount}</span>
      <span data-tone="removed" title={`${t('dreamingRunRemoved')} -${run.retiredCount}`}>-{run.retiredCount}</span>
      <span title={t('dreamingRunDuration')}>{formatDreamingDuration(run.durationMs)}</span>
    </div>
  )
}

/** Stat tile strip, shadcn dashboard pattern; tones reuse the metrics palette. */
function StatStrip({ stats }: { stats: { label: string; value: string; tone?: 'added' | 'removed' }[] }) {
  return (
    <div className={`quickforge-dreaming-stats border-t ${HAIRLINE}`}>
      {stats.map(({ label, value, tone }) => (
        <div className="quickforge-dreaming-stat" data-tone={tone} key={label}>
          <span className="quickforge-dreaming-stat-label">{label}</span>
          <span className="quickforge-dreaming-stat-value">{value}</span>
        </div>
      ))}
    </div>
  )
}

function ActionList({ actions }: { actions: DreamingAction[] }) {
  if (actions.length === 0) return <p className="text-sm text-muted-foreground">{t('dreamingRunNoActions')}</p>
  return (
    <ul className="quickforge-dreaming-diff">
      {actions.map((action, index) => (
        <li
          className="quickforge-dreaming-diff-item"
          data-tone={action.kind === 'archive' ? 'removed' : 'added'}
          key={`${action.kind}|${action.scope}|${action.name}|${index}`}
        >
          <span className="quickforge-dreaming-diff-mark" aria-hidden="true">
            {action.kind === 'archive' ? '−' : action.kind === 'rename' ? '→' : '+'}
          </span>
          <div className="quickforge-dreaming-diff-body">
            <span className="quickforge-dreaming-diff-text">
              {action.title || action.name}
              {action.from ? ` ← ${action.from}` : ''}
            </span>
            <span className="quickforge-dreaming-diff-note">
              {t(ACTION_KEY[action.kind])} · {action.scope === 'experience' ? t('dreamingScopeExperience') : t('dreamingScopeWorking')}
            </span>
          </div>
        </li>
      ))}
    </ul>
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
    <section className={CARD}>
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
        <div className="flex flex-col gap-2 px-5 pb-3">
          {description ? <p className="quickforge-settings-row-description">{description}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Run detail
// ---------------------------------------------------------------------------

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<DreamingRunDetail | null>(null)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchDreamingRun(runId)
      .then((next) => { if (!cancelled) setDetail(next) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed')) })
    return () => { cancelled = true }
  }, [runId])

  const restore = async () => {
    setRestoring(true)
    setRestoreMessage('')
    setError('')
    try {
      const result = await restoreDreamingRun(runId)
      setRestoreMessage(t('dreamingRunRestored', {
        working: result.restored.workingMemoryFiles,
        experiences: result.restored.experienceFiles,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setRestoring(false)
    }
  }

  if (error) return <div className="quickforge-dreaming-error">{error}</div>
  if (!detail) return <div className="text-sm text-muted-foreground">{t('loading')}</div>

  const run = detail.run
  const operations = run.operations ?? {}
  const sessions = operations.sessions ?? []
  const actions = operations.actions ?? []
  const canRestore = Boolean(operations.snapshot)
  return (
    <div className="quickforge-settings-stack">
      <div>
        <Button variant="ghost" size="sm" type="button" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={2} />
          {t('dreamingRunBack')}
        </Button>
      </div>
      <section className={CARD} aria-label={t('dreamingRunDetail')}>
        {/* Header: title + state badges + when-it-ran meta. */}
        <div className="flex flex-wrap items-start justify-between gap-3 p-5">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-sm font-semibold">{t('dreamingRunDetail')}</h3>
            <p className="text-xs text-muted-foreground">
              {formatDreamingTimestamp(run.startedAt)} · {t('dreamingInputChars')} {run.inputChars}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={run.status} />
            <span className="quickforge-settings-badge quickforge-settings-badge-muted">
              {t(run.trigger === 'manual' ? 'dreamingTriggerManual' : 'dreamingTriggerSchedule')}
            </span>
            {run.modelLabel ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{run.modelLabel}</span> : null}
            {run.contentLanguage ? (
              <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('dreamingRunLanguage')}: {run.contentLanguage}</span>
            ) : null}
          </div>
        </div>

        <StatStrip
          stats={[
            { label: t('dreamingRunSessions'), value: String(run.sessionCount) },
            { label: t('dreamingRunAdded'), value: `+${run.createdCount}`, tone: 'added' },
            { label: t('dreamingRunRemoved'), value: `-${run.retiredCount}`, tone: 'removed' },
            { label: t('dreamingRunRenamed'), value: String(run.updatedCount) },
            { label: t('dreamingRunDuration'), value: formatDreamingDuration(run.durationMs) },
          ]}
        />

        {/* Body: failure reason first, then what the run concluded and changed. */}
        <div className={`flex flex-col gap-5 border-t p-5 ${HAIRLINE}`}>
          {run.error ? (
            <div className="quickforge-dreaming-alert" role="alert">
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
              <span className="quickforge-dreaming-alert-text">{run.error}</span>
            </div>
          ) : null}

          {run.summary ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t('dreamingRunSummary')}</span>
              <p className="text-sm leading-relaxed">{run.summary}</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium text-muted-foreground">{t('dreamingRunOperations')}</span>
            <ActionList actions={actions} />
          </div>

          {sessions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">{t('dreamingRunPerSession')}</span>
              <ul className="flex flex-col gap-2">
                {sessions.map((session) => (
                  <li className="quickforge-dreaming-diff-item" data-tone={session.ok ? 'added' : 'removed'} key={session.sessionId}>
                    <span className="quickforge-dreaming-diff-mark" aria-hidden="true">{session.ok ? '+' : '✕'}</span>
                    <div className="quickforge-dreaming-diff-body">
                      <span className="quickforge-dreaming-diff-text">
                        {session.sessionId} · {t('dreamingSessionToolCalls', { count: session.toolCalls })}
                      </span>
                      <span className="quickforge-dreaming-diff-note">
                        {session.ok ? (session.reply || t('dreamingSessionNoReply')) : session.error}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {operations.stopped ? (
            <p className="text-xs text-muted-foreground">{operations.stopped}</p>
          ) : null}

          {run.rawResponse ? (
            <SectionToggle title={t('dreamingRunRawResponse')} description={t('dreamingRunRawResponseDescription')}>
              <pre className="quickforge-dreaming-code">{run.rawResponse}</pre>
            </SectionToggle>
          ) : null}
        </div>

        {/* Footer: the one destructive-ish escape hatch, away from the reading flow. */}
        <div className={`flex flex-wrap items-center gap-2 border-t px-5 py-4 ${HAIRLINE}`}>
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={!canRestore || restoring}
            onClick={() => void restore()}
          >
            {restoring ? t('loading') : t('dreamingRunRestore')}
          </Button>
          {!canRestore ? <span className="text-xs text-muted-foreground">{t('dreamingRunRestoreUnavailable')}</span> : null}
          {restoreMessage ? <span className="text-xs text-muted-foreground">{restoreMessage}</span> : null}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

type TabView = 'experiences' | 'runs'

export function DreamingSettingsTab() {
  const [overview, setOverview] = useState<DreamingOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [view, setView] = useState<TabView>('experiences')

  const [runs, setRuns] = useState<DreamingRun[]>([])
  const [runPage, setRunPage] = useState(1)
  const [runTotal, setRunTotal] = useState(0)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const [experiences, setExperiences] = useState<DreamingExperience[]>([])
  const [experienceQuery, setExperienceQuery] = useState('')
  const [indexOpen, setIndexOpen] = useState(false)

  const pageSize = 20
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

  const loadExperiences = useCallback(async () => {
    const payload = await fetchDreamingExperiences()
    setExperiences(payload.experiences)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadOverview(), loadRuns(1), loadExperiences()])
      } catch (err) {
        setError(err instanceof Error ? err.message : t('requestFailed'))
      } finally {
        setLoading(false)
      }
    })()
  }, [loadExperiences, loadOverview, loadRuns])

  const updateSettings = async (patch: Partial<DreamingSettings>) => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await saveDreamingSettings(patch)
      await loadOverview()
      setMessage(t('dreamingSaved'))
    } catch (err) {
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
      await Promise.all([loadRuns(1), loadExperiences()])
      if (!result.skipped) setView('runs')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setRunning(false)
    }
  }

  const filteredExperiences = useMemo(() => {
    const query = experienceQuery.trim().toLowerCase()
    if (!query) return experiences
    return experiences.filter((entry) => (
      entry.title.toLowerCase().includes(query) || entry.whenToUse.toLowerCase().includes(query)
    ))
  }, [experienceQuery, experiences])

  const modelOptions = useMemo(() => {
    // Models without a resolvable reference cannot be pinned (their empty key
    // would collide with "follow chat"), so they are not listed.
    const options = (overview?.model?.available ?? []).filter((model) => model.ref)
    return [
      {
        value: '',
        // Naming the resolved model in the option keeps "follow chat" meaningful
        // without a separate status row.
        label: overview?.model?.effective
          ? `${t('dreamingModelFollowChat')} · ${overview.model.effective}`
          : t('dreamingModelFollowChat'),
        ref: null as DreamingSettings['modelRef'],
      },
      ...options.map((model) => ({
        value: modelRefKey(model.ref),
        label: formatModelOptionLabel(model.name, model.provider),
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
  const totalRunPages = Math.max(1, Math.ceil(runTotal / pageSize))

  return (
    <div className="quickforge-settings-stack">
      <section className={CARD} aria-label={t('dreamingTab')}>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="quickforge-dreaming-dot" data-state={dotState} aria-hidden="true" />
              {t('dreamingTab')}
              <span className="quickforge-settings-beta">{t('dreamingBeta')}</span>
              <span className="quickforge-dreaming-status-text" data-state={dotState}>{t(STATE_TEXT_KEY[dotState])}</span>
              <InfoTip label={t('dreamingEnabledInfo')} />
              <InfoTip label={t('dreamingBetaInfo')} />
            </div>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">{t('dreamingDescription')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={!settings.enabled || busy}
              onClick={() => void runNow()}
            >
              {running ? t('dreamingRunning') : t('dreamingRunNow')}
            </Button>
            <SettingsSwitch
              checked={settings.enabled}
              onChange={(checked) => void updateSettings({ enabled: checked })}
              disabled={saving}
              aria-label={t('dreamingEnabled')}
            />
          </div>
        </div>

        <StatStrip
          stats={[
            { label: t('dreamingNextRun'), value: formatDreamingTimestamp(overview?.nextRunAt) },
            { label: t('dreamingLastRun'), value: formatDreamingTimestamp(settings.lastRunAt) },
            { label: t('dreamingExperienceCount'), value: String(overview?.counts.experiences ?? 0) },
            { label: t('dreamingCandidateSkills'), value: String(overview?.counts.candidateSkills ?? 0) },
            { label: t('dreamingHistory'), value: String(overview?.counts.runs ?? 0) },
          ]}
        />

        <div className={`grid gap-4 border-t p-5 md:grid-cols-2 ${HAIRLINE}`}>
          <Field label={t('dreamingModel')} hint={t('dreamingModelInfo')}>
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
          </Field>

          <Field label={t('dreamingExecuteTime')} hint={t('dreamingExecuteTimeHint')}>
            <input
              className="h-9 w-full rounded-md border border-transparent bg-[color-mix(in_oklab,var(--muted)_60%,transparent)] px-2.5 text-sm text-foreground outline-none transition-colors focus:border-[color-mix(in_oklab,var(--border)_70%,transparent)] disabled:opacity-55"
              type="time"
              value={settings.executeTime}
              disabled={!settings.enabled || saving}
              onChange={(event) => void updateSettings({ executeTime: event.currentTarget.value })}
            />
          </Field>

          <Field label={t('dreamingLanguage')} hint={t('dreamingLanguageInfo')}>
            <SettingsSelect
              value={settings.contentLanguage}
              options={languageOptions}
              onChange={(value) => void updateSettings({ contentLanguage: value as typeof settings.contentLanguage })}
              disabled={saving}
              label={t('dreamingLanguage')}
            />
          </Field>

          <Field label={t('dreamingSensitive')} hint={t('dreamingSensitiveInfo')}>
            <div>
              <SettingsSwitch
                checked={settings.allowSensitive}
                onChange={(checked) => void updateSettings({ allowSensitive: checked })}
                disabled={!settings.enabled || saving}
              />
            </div>
          </Field>
        </div>

        {message ? <p className={`px-5 pb-4 text-xs ${HAIRLINE}`}>{message}</p> : null}
        {error ? <p className="quickforge-dreaming-error px-5 pb-4">{error}</p> : null}
      </section>

      <section className={CARD} aria-label={t('dreamingExperienceTab')}>
        <div className="quickforge-dreaming-tabs-wrap">
          <div className="quickforge-dreaming-tabs" role="tablist">
            <button
              className="quickforge-dreaming-tab"
              type="button"
              role="tab"
              aria-selected={view === 'experiences'}
              onClick={() => setView('experiences')}
            >
              {t('dreamingExperienceTab')}
              <span className="quickforge-dreaming-tab-count">{overview?.counts.experiences ?? 0}</span>
            </button>
            <button
              className="quickforge-dreaming-tab"
              type="button"
              role="tab"
              aria-selected={view === 'runs'}
              onClick={() => setView('runs')}
            >
              {t('dreamingHistory')}
              <span className="quickforge-dreaming-tab-count">{overview?.counts.runs ?? 0}</span>
            </button>
          </div>

          {view === 'experiences' ? (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <input
                className="h-8 w-full max-w-56 rounded-md border border-transparent bg-[color-mix(in_oklab,var(--muted)_60%,transparent)] px-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--border)_70%,transparent)]"
                type="search"
                value={experienceQuery}
                placeholder={t('dreamingExperienceSearchPlaceholder')}
                onChange={(event) => setExperienceQuery(event.currentTarget.value)}
              />
            </div>
          ) : null}
        </div>

        {view === 'experiences' ? (
          <div className="flex flex-col gap-3 p-5">
            <p className="quickforge-settings-row-description">{t('dreamingExperienceDescription')}</p>
            {filteredExperiences.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('dreamingExperienceEmpty')}</div>
            ) : (
              <ul className="quickforge-recall-list">
                {filteredExperiences.map((entry) => (
                  <li className="quickforge-recall-item" key={entry.name}>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="quickforge-recall-content">{entry.title}</span>
                        {entry.candidateSkill ? (
                          <span className="quickforge-settings-badge quickforge-settings-badge-info">
                            {t('dreamingExperienceCandidateSkill')}
                          </span>
                        ) : null}
                      </div>
                      {entry.whenToUse ? (
                        <span className="text-xs text-muted-foreground">
                          {t('dreamingExperienceWhenToUse')}: {entry.whenToUse}
                        </span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {t('dreamingExperienceMeta', { chars: entry.chars, when: formatDreamingTimestamp(entry.updatedAt) })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-2">
              <button
                aria-expanded={indexOpen}
                className="quickforge-dreaming-advanced-toggle"
                type="button"
                onClick={() => setIndexOpen((value) => !value)}
              >
                {t('dreamingExperienceIndex')}
                <span className="quickforge-dreaming-chevron" data-open={indexOpen} aria-hidden="true">
                  <ChevronDown size={14} strokeWidth={2} />
                </span>
              </button>
              {indexOpen ? (
                <>
                  <p className="quickforge-settings-row-description">{t('dreamingExperienceIndexDescription')}</p>
                  <pre className="quickforge-dreaming-code">{overview?.experienceIndex || t('dreamingExperienceEmpty')}</pre>
                </>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{t('dreamingExperienceReadOnly')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-5">
            <p className="quickforge-settings-row-description">{t('dreamingHistoryDescription')}</p>
            {runs.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('dreamingNoRuns')}</div>
            ) : (
              <ul className="quickforge-settings-list">
                {runs.map((run) => (
                  <li className="quickforge-settings-list-item" key={run.id}>
                    <button
                      className="flex min-w-0 flex-1 flex-col gap-1 text-left"
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={run.status} />
                        <span className="quickforge-settings-badge quickforge-settings-badge-muted">
                          {t(run.trigger === 'manual' ? 'dreamingTriggerManual' : 'dreamingTriggerSchedule')}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDreamingTimestamp(run.startedAt)}</span>
                      </span>
                      <RunMetrics run={run} />
                      {run.summary ? <span className="quickforge-dreaming-summary">{run.summary}</span> : null}
                      {run.error ? <span className="quickforge-dreaming-error">{run.error}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {totalRunPages > 1 ? (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <Button variant="ghost" size="sm" type="button" disabled={runPage <= 1} onClick={() => void loadRuns(runPage - 1)}>
                  {t('dreamingPrev')}
                </Button>
                <span>{t('dreamingPage', { page: runPage, total: totalRunPages })}</span>
                <Button variant="ghost" size="sm" type="button" disabled={runPage >= totalRunPages} onClick={() => void loadRuns(runPage + 1)}>
                  {t('dreamingNext')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}

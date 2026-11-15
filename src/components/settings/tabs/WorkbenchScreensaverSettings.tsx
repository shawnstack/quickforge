import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Dices, Maximize2, RotateCcw } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import {
  DEFAULT_WORKBENCH_SCREENSAVER,
  normalizeWorkbenchScreensaver,
  randomizeScreensaverAppearance,
  saveWorkbenchScreensaverSettings,
  SCREENSAVER_ACCENTS,
  SCREENSAVER_CLOCK_RANGE,
  SCREENSAVER_IDLE_PRESETS,
  SCREENSAVER_IDLE_RANGE,
  SCREENSAVER_PERCENT_RANGE,
  type WorkbenchScreensaverSettings,
} from '@/lib/workbench-screensaver-settings'
import { WorkbenchScreensaver, type ScreensaverData } from '@/components/workbench/WorkbenchScreensaver'
import { SettingsNumberInput } from './SettingsNumberInput'
import { SettingsSwitch } from './shared'

/**
 * 屏保设置：左侧缩略预览与右侧参数区同屏，任何一项改动立刻反映到预览上。
 * 预览用示例数据（真实数据要等工作台轮询），全屏预览按钮走真数据。
 */

const ACCENT_LABEL_KEYS = ['ssAccentJade', 'ssAccentBlue', 'ssAccentAmber', 'ssAccentMagenta', 'ssAccentAcid', 'ssAccentCoral'] as const
const SAVE_DEBOUNCE_MS = 300

function sampleData(now: number): ScreensaverData {
  return {
    now,
    schedule: [
      { key: 'sample-1', name: t('ssSampleDocBot'), at: now + 12 * 60_000 + 34_000 },
      { key: 'sample-2', name: t('ssSampleDigestTask'), at: now + 47 * 60_000 },
      { key: 'sample-3', name: t('ssSampleQaBot'), at: now + 96 * 60_000 },
    ],
    running: [{ key: 'sample-run', name: t('ssSampleMainBot'), since: now - 214_000 }],
    today: { sessions: 18, tokens: 1_284_000, taskRuns: 26, taskSuccess: 25 },
    fleet: [
      { key: 'f1', name: t('ssSampleMainBot'), tone: 'ok' },
      { key: 'f2', name: t('ssSampleDocBot'), tone: 'idle' },
      { key: 'f3', name: t('ssSampleQaBot'), tone: 'idle' },
      { key: 'f4', name: t('ssSampleDigestTask'), tone: 'asleep' },
      { key: 'f5', name: t('ssSampleDigestTask'), tone: 'asleep' },
    ],
    errors: 0,
  }
}

/** 复用应用既有滑杆皮肤（quickforge-font-size-slider），只把量程换成本项的。 */
function RangeRow({
  label,
  value,
  min,
  max,
  suffix,
  onInput,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix?: string
  onInput: (value: number) => void
  onCommit: (value: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const input = inputRef.current
    if (!input) return undefined
    const commit = () => onCommit(Number(input.value))
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  }, [onCommit])
  const progress = ((value - min) / (max - min)) * 100
  return (
    <div className="quickforge-screensaver-control">
      <span className="quickforge-screensaver-control-label">{label}</span>
      <input
        ref={inputRef}
        className="quickforge-font-size-slider quickforge-screensaver-slider"
        style={{ '--quickforge-font-size-slider-progress': `${progress}%` } as CSSProperties}
        type="range"
        min={String(min)}
        max={String(max)}
        step="1"
        value={String(value)}
        aria-label={label}
        onInput={(event) => onInput(Number(event.currentTarget.value))}
      />
      <span className="quickforge-settings-value-badge quickforge-screensaver-badge">{value}{suffix}</span>
    </div>
  )
}

export function WorkbenchScreensaverSettings({ active, onError }: { active?: boolean; onError: (message: string) => void }) {
  const settings = useUIStore((s) => s.workbenchScreensaver)
  const setSettings = useUIStore((s) => s.setWorkbenchScreensaver)
  const enterScreensaver = useUIStore((s) => s.enterWorkbenchScreensaver)
  const [now, setNow] = useState(() => Date.now())
  const [saved, setSaved] = useState(false)
  const [idleDraft, setIdleDraft] = useState<string | null>(null)
  const pendingRef = useRef(settings)
  const dirtyRef = useRef(false)
  const timerRef = useRef(0)

  useEffect(() => {
    if (active === false) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])

  const flush = useCallback(async () => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    try {
      await saveWorkbenchScreensaverSettings(pendingRef.current)
      setSaved(true)
      onError('')
    } catch {
      onError(t('requestFailed'))
    }
  }, [onError])

  useEffect(() => () => {
    window.clearTimeout(timerRef.current)
    if (dirtyRef.current) void saveWorkbenchScreensaverSettings(pendingRef.current).catch(() => {})
  }, [])

  const update = useCallback((patch: Partial<WorkbenchScreensaverSettings>) => {
    const next = normalizeWorkbenchScreensaver({ ...pendingRef.current, ...patch })
    pendingRef.current = next
    dirtyRef.current = true
    setSettings(next)
    setSaved(false)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
  }, [flush, setSettings])

  const commitIdle = (value: string | number) => {
    const parsed = Number(value)
    update({ idleMinutes: Number.isFinite(parsed) ? parsed : settings.idleMinutes })
    setIdleDraft(null)
  }

  const panels: { key: 'showSchedule' | 'showRunning' | 'showToday'; label: string }[] = [
    { key: 'showSchedule', label: t('ssNextUp') },
    { key: 'showRunning', label: t('wbNow') },
    { key: 'showToday', label: t('wbToday') },
  ]

  return (
    <div className="quickforge-settings-group">
      <div className="quickforge-appearance-group-head">
        <h3 className="quickforge-settings-group-title">{t('workbenchScreensaverTitle')}</h3>
        <span className="quickforge-appearance-group-description">
          {t('workbenchScreensaverHint', { minutes: settings.idleMinutes })}
        </span>
        {saved ? <span className="quickforge-screensaver-saved" role="status">{t('defaultOptionsSaved')}</span> : null}
      </div>

      <section className="quickforge-settings-section quickforge-screensaver" aria-label={t('workbenchScreensaverTitle')}>
        <div className="quickforge-screensaver-layout">
          <div className="quickforge-screensaver-preview">
            <div className="quickforge-screensaver-stage">
              <WorkbenchScreensaver settings={settings} data={sampleData(now)} mode="preview" embedded />
            </div>
            <div className="quickforge-screensaver-preview-foot">
              <span>{t('workbenchScreensaverSample')}</span>
              <button
                type="button"
                className="quickforge-settings-button quickforge-settings-button-secondary quickforge-screensaver-fullpreview"
                onClick={() => enterScreensaver('preview')}
              >
                <Maximize2 className="size-3.5" aria-hidden="true" />
                {t('workbenchScreensaverFullPreview')}
              </button>
            </div>
          </div>

          <div className="quickforge-screensaver-controls">
            <div className="quickforge-screensaver-control quickforge-screensaver-control--switch">
              <span className="quickforge-screensaver-control-label">{t('workbenchScreensaverEnable')}</span>
              <SettingsSwitch
                checked={settings.enabled}
                label={t('workbenchScreensaverEnable')}
                onChange={(next) => update({ enabled: next })}
              />
            </div>

            <div className="quickforge-screensaver-field">
              <div className="quickforge-screensaver-control">
                <span className="quickforge-screensaver-control-label">{t('workbenchScreensaverIdle')}</span>
                <input
                  className="quickforge-font-size-slider quickforge-screensaver-slider"
                  style={{ '--quickforge-font-size-slider-progress': `${((settings.idleMinutes - SCREENSAVER_IDLE_RANGE.min) / (SCREENSAVER_IDLE_RANGE.max - SCREENSAVER_IDLE_RANGE.min)) * 100}%` } as CSSProperties}
                  type="range"
                  min={String(SCREENSAVER_IDLE_RANGE.min)}
                  max={String(SCREENSAVER_IDLE_RANGE.max)}
                  step="1"
                  value={String(settings.idleMinutes)}
                  aria-label={t('workbenchScreensaverIdle')}
                  onInput={(event) => { setIdleDraft(null); update({ idleMinutes: Number(event.currentTarget.value) }) }}
                />
                <SettingsNumberInput
                  className="quickforge-settings-input quickforge-screensaver-number"
                  min={String(SCREENSAVER_IDLE_RANGE.min)}
                  max={String(SCREENSAVER_IDLE_RANGE.max)}
                  step="1"
                  aria-label={t('workbenchScreensaverIdleNumber')}
                  value={idleDraft ?? String(settings.idleMinutes)}
                  onInput={setIdleDraft}
                  onCommit={commitIdle}
                />
                <span className="quickforge-screensaver-unit">{t('ssMinutes')}</span>
              </div>
              <div className="quickforge-screensaver-presets" role="group" aria-label={t('workbenchScreensaverIdle')}>
                {SCREENSAVER_IDLE_PRESETS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className={cn('quickforge-screensaver-chip', settings.idleMinutes === minutes && 'is-on')}
                    aria-pressed={settings.idleMinutes === minutes}
                    onClick={() => commitIdle(minutes)}
                  >
                    {minutes}
                  </button>
                ))}
              </div>
            </div>

            <div className="quickforge-screensaver-control">
              <span className="quickforge-screensaver-control-label">{t('workbenchScreensaverAccent')}</span>
              <div className="quickforge-screensaver-swatches" role="group" aria-label={t('workbenchScreensaverAccent')}>
                {SCREENSAVER_ACCENTS.map((accent, index) => (
                  <button
                    key={accent}
                    type="button"
                    className={cn('quickforge-screensaver-swatch', settings.accent === accent && 'is-on')}
                    style={{ '--quickforge-screensaver-swatch': accent } as CSSProperties}
                    aria-pressed={settings.accent === accent}
                    aria-label={t(ACCENT_LABEL_KEYS[index])}
                    title={t(ACCENT_LABEL_KEYS[index])}
                    onClick={() => update({ accent })}
                  />
                ))}
              </div>
            </div>

            <RangeRow
              label={t('workbenchScreensaverMotion')}
              value={settings.motion}
              min={SCREENSAVER_PERCENT_RANGE.min}
              max={SCREENSAVER_PERCENT_RANGE.max}
              onInput={(motion) => update({ motion })}
              onCommit={(motion) => update({ motion })}
            />
            <RangeRow
              label={t('workbenchScreensaverGlow')}
              value={settings.glow}
              min={SCREENSAVER_PERCENT_RANGE.min}
              max={SCREENSAVER_PERCENT_RANGE.max}
              onInput={(glow) => update({ glow })}
              onCommit={(glow) => update({ glow })}
            />
            <RangeRow
              label={t('workbenchScreensaverDensity')}
              value={settings.density}
              min={SCREENSAVER_PERCENT_RANGE.min}
              max={SCREENSAVER_PERCENT_RANGE.max}
              onInput={(density) => update({ density })}
              onCommit={(density) => update({ density })}
            />
            <RangeRow
              label={t('workbenchScreensaverClock')}
              value={settings.clockScale}
              min={SCREENSAVER_CLOCK_RANGE.min}
              max={SCREENSAVER_CLOCK_RANGE.max}
              suffix="%"
              onInput={(clockScale) => update({ clockScale })}
              onCommit={(clockScale) => update({ clockScale })}
            />

            <div className="quickforge-screensaver-control quickforge-screensaver-control--switch">
              <span className="quickforge-screensaver-control-label" title={t('workbenchScreensaverDriftHint')}>
                {t('workbenchScreensaverDrift')}
              </span>
              <SettingsSwitch
                checked={settings.drift}
                label={t('workbenchScreensaverDrift')}
                onChange={(drift) => update({ drift })}
              />
            </div>

            <div className="quickforge-screensaver-control">
              <span className="quickforge-screensaver-control-label">{t('workbenchScreensaverPanels')}</span>
              <div className="quickforge-screensaver-presets" role="group" aria-label={t('workbenchScreensaverPanels')}>
                {panels.map((panel) => (
                  <button
                    key={panel.key}
                    type="button"
                    className={cn('quickforge-screensaver-chip', settings[panel.key] && 'is-on')}
                    aria-pressed={settings[panel.key]}
                    onClick={() => update({ [panel.key]: !settings[panel.key] })}
                  >
                    {panel.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="quickforge-screensaver-actions">
              <button
                type="button"
                className="quickforge-settings-button quickforge-settings-button-secondary"
                onClick={() => update(randomizeScreensaverAppearance(pendingRef.current))}
              >
                <Dices className="size-3.5" aria-hidden="true" />
                {t('workbenchScreensaverRandom')}
              </button>
              <button
                type="button"
                className="quickforge-settings-button quickforge-settings-button-secondary"
                onClick={() => update({ ...DEFAULT_WORKBENCH_SCREENSAVER, enabled: settings.enabled })}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                {t('workbenchScreensaverReset')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
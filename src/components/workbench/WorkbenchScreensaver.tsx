import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { t, getDateLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { formatTokenCount, type TodayStats } from '@/lib/workbench-today-stats'
import type { WorkbenchScreensaverSettings } from '@/lib/workbench-screensaver-settings'
import { deriveScreensaverPalette } from './screensaver-palette'
import { createScreensaverField, type ScreensaverField, type ScreensaverFieldOptions } from './screensaver-field'
import { fmtHm, fmtSpan, pad } from './workbench-format'
import './workbench-screensaver.css'

/**
 * 工作台屏保：无操作到点后接管全屏，任意输入立即退出（预览模式只认点击与按键）。
 * 数据由工作台已有的轮询喂进来，屏保自己不发请求；设置页的缩略预览复用同一组件与样式。
 */

export type ScreensaverData = {
  now: number
  schedule: { key: string; name: string; at: number }[]
  running: { key: string; name: string; since: number }[]
  today: TodayStats | null
  fleet: { key: string; name: string; tone: 'ok' | 'idle' | 'asleep' | 'err' }[]
  errors: number
}

const ROTATE_MS = 9_000
const FLEET_CAP = 14
const RUNNING_CAP = 3

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  )
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)')
      const onChange = () => setReduced(query.matches)
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    }
    return undefined
  }, [])
  return reduced
}

function utcOffsetLabel(now: number): string {
  const minutes = -new Date(now).getTimezoneOffset()
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  return rest === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${pad(rest)}`
}

export function WorkbenchScreensaver({
  settings,
  data,
  mode,
  embedded = false,
  onExit,
}: {
  settings: WorkbenchScreensaverSettings
  data: ScreensaverData
  mode: 'idle' | 'preview'
  embedded?: boolean
  onExit?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fieldRef = useRef<ScreensaverField | null>(null)
  const reducedMotion = useReducedMotion()
  const [rotate, setRotate] = useState(0)

  const fieldOptions = useMemo<ScreensaverFieldOptions>(() => ({
    accent: settings.accent,
    motion: settings.motion,
    glow: settings.glow,
    density: settings.density,
    reducedMotion,
  }), [settings.accent, settings.motion, settings.glow, settings.density, reducedMotion])
  const optionsRef = useRef(fieldOptions)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const field = createScreensaverField(canvas, optionsRef.current)
    fieldRef.current = field
    return () => { field.destroy(); fieldRef.current = null }
  }, [])

  useEffect(() => {
    optionsRef.current = fieldOptions
    fieldRef.current?.update(fieldOptions)
  }, [fieldOptions])

  const scheduleCount = Math.min(data.schedule.length, 3)
  useEffect(() => {
    if (scheduleCount < 2) return undefined
    const timer = window.setInterval(() => setRotate((n) => n + 1), ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [scheduleCount])

  const palette = useMemo(() => deriveScreensaverPalette(settings.accent), [settings.accent])
  const speed = 0.16 + (settings.motion / 100) * 1.55
  const style = {
    '--qf-ss-accent': palette.accent,
    '--qf-ss-companion': palette.companion,
    '--qf-ss-counter': palette.counter,
    '--qf-ss-void': palette.void,
    '--qf-ss-deep': palette.deep,
    '--qf-ss-haze': palette.haze,
    '--qf-ss-numeral': palette.numeral,
    '--qf-ss-muted': palette.muted,
    '--qf-ss-glow': String(settings.glow / 100),
    '--qf-ss-clock-scale': String(settings.clockScale / 100),
    '--qf-ss-drift-x': `${Math.round(47 / speed)}s`,
    '--qf-ss-drift-y': `${Math.round(61 / speed)}s`,
    '--qf-ss-sweep': `${Math.round(16 / speed)}s`,
  } as CSSProperties

  const date = new Date(data.now)
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  const dateText = new Intl.DateTimeFormat(getDateLocale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(date)

  const next = scheduleCount > 0 ? data.schedule[rotate % scheduleCount] : null
  const overdue = next ? next.at <= data.now : false
  const cards = [settings.showSchedule, settings.showRunning, settings.showToday].filter(Boolean).length
  const cardStyle = { ...style, '--qf-ss-card-count': String(Math.max(1, cards)) } as CSSProperties

  return (
    <div
      className={cn('qf-ss', embedded ? 'qf-ss--embed' : 'qf-ss--full', mode === 'preview' && 'qf-ss--preview', (!settings.drift || reducedMotion) && 'is-static')}
      style={cardStyle}
      role={embedded ? 'group' : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label={embedded ? t('workbenchScreensaverPreview') : t('workbenchScreensaverTitle')}
    >
      <canvas ref={canvasRef} className="qf-ss__field" aria-hidden="true" />
      <div className="qf-ss__sheen" aria-hidden="true" />
      <div className="qf-ss__sweep" aria-hidden="true" />
      <div className="qf-ss__grain" aria-hidden="true" />

      {data.errors > 0 ? (
        <div className="qf-ss__alert" role="status">
          <i aria-hidden="true" />
          <span>{t('ssErrors', { count: data.errors })}</span>
        </div>
      ) : null}

      <div className="qf-ss__drift">
        <div className="qf-ss__drift-y">
          <div className="qf-ss__stage">
            <div className="qf-ss__brand">
              <span className="qf-ss__mark" aria-hidden="true" />
              <span>QuickForge</span>
              <span className="qf-ss__badge">{mode === 'preview' ? t('workbenchScreensaverPreview') : t('ssBadge')}</span>
              {data.fleet.length > 0 ? (
                <span className="qf-ss__fleet" aria-label={t('wbFleet')}>
                  {data.fleet.slice(0, FLEET_CAP).map((bot) => (
                    <i key={bot.key} data-tone={bot.tone} title={bot.name} />
                  ))}
                </span>
              ) : null}
            </div>

            <div className="qf-ss__clock" role="timer" aria-live="off" aria-label={`${hours}:${minutes}:${seconds}`}>
              {[...hours].map((digit, index) => (
                <span key={`h${index}-${digit}`} className="qf-ss__flap"><span>{digit}</span></span>
              ))}
              <span className="qf-ss__colon" aria-hidden="true">:</span>
              {[...minutes].map((digit, index) => (
                <span key={`m${index}-${digit}`} className="qf-ss__flap"><span>{digit}</span></span>
              ))}
              <span className="qf-ss__seconds">
                <b>{seconds}</b>
                <i>{utcOffsetLabel(data.now)}</i>
              </span>
            </div>

            <div className="qf-ss__date">
              <span>{dateText}</span>
              <em>{date.getFullYear()}-{pad(date.getMonth() + 1)}-{pad(date.getDate())}</em>
            </div>

            <div className="qf-ss__runway" aria-hidden="true">
              {Array.from({ length: 22 }, (_, index) => (
                <i key={index} style={{ animationDelay: `${index * 0.11}s` }} />
              ))}
            </div>

            {cards > 0 ? (
              <div className="qf-ss__cards">
                {settings.showSchedule ? (
                  <section className="qf-ss__card" aria-label={t('ssNextUp')}>
                    <div className="qf-ss__card-label"><i aria-hidden="true" />{t('ssNextUp')}</div>
                    <div className={cn('qf-ss__card-value', overdue && 'is-overdue')}>
                      {next ? (overdue ? `+${fmtSpan(data.now - next.at)}` : fmtSpan(next.at - data.now)) : '--:--:--'}
                    </div>
                    <div className="qf-ss__card-sub">
                      {next ? <><span>{next.name}</span><b>{fmtHm(next.at)}</b></> : <span>{t('ssNoSchedule')}</span>}
                    </div>
                  </section>
                ) : null}

                {settings.showRunning ? (
                  <section className={cn('qf-ss__card', 'qf-ss__card--running', data.running.length === 0 && 'qf-ss__card--idle')} aria-label={t('wbNow')}>
                    <div className="qf-ss__card-label">
                      <i className={data.running.length > 0 ? 'qf-ss__live-dot' : undefined} aria-hidden="true" />{t('wbNow')}
                    </div>
                    <div className="qf-ss__card-value">{data.running.length}</div>
                    {data.running.length > 0 ? (
                      <div className="qf-ss__card-list">
                        {data.running.slice(0, RUNNING_CAP).map((item) => (
                          <div key={item.key} className="qf-ss__card-sub">
                            <span>{item.name}</span>
                            <b>{fmtSpan(data.now - item.since)}</b>
                          </div>
                        ))}
                      </div>
                    ) : <div className="qf-ss__card-sub"><span>{t('wbNowEmpty')}</span></div>}
                  </section>
                ) : null}

                {settings.showToday ? (
                  <section className="qf-ss__card qf-ss__card--today" aria-label={t('wbToday')}>
                    <div className="qf-ss__card-label"><i aria-hidden="true" />{t('wbToday')} · {t('wbTodayTokens')}</div>
                    <div className="qf-ss__card-value">{data.today?.tokens != null ? formatTokenCount(data.today.tokens) : '—'}</div>
                    <div className="qf-ss__card-sub">
                      <span>{t('wbTodaySessions')}</span>
                      <b>{data.today?.sessions ?? '—'}</b>
                      <span>· {t('wbTodayTasks')}</span>
                      <b>{data.today?.taskRuns ?? '—'}</b>
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="qf-ss__foot">
        {mode === 'preview' ? (
          <>
            <span>{t('ssPreviewExitHint')}</span>
            {onExit ? <button type="button" className="qf-ss__exit" onClick={onExit}>{t('ssExitPreview')}</button> : null}
          </>
        ) : (
          <>
            <kbd>{t('ssAnyKey')}</kbd>
            <span>{t('ssExitHint', { minutes: settings.idleMinutes })}</span>
          </>
        )}
      </div>
    </div>
  )
}
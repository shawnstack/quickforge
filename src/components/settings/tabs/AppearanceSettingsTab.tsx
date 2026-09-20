import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { getAppStorage } from '@/storage'
import {
  getCurrentTheme,
  loadAppearanceSettings,
  saveAppearanceSettings,
  type AppTheme,
} from '@/lib/appearance-settings'
import {
  applyFontSizeSettings,
  DEFAULT_FONT_SIZE_SETTINGS,
  FONT_SIZE_RANGE,
  loadFontSizeSettings,
  normalizeFontSizeSettings,
  saveFontSizeSettings,
  type FontSizeSettings,
} from '@/lib/font-size-settings'
import { t } from '@/lib/i18n'
import { InfoTip } from '@/components/ui/info-tip'

const THEME_OPTIONS: { value: AppTheme; label: () => string }[] = [
  { value: 'light', label: () => t('lightTheme') },
  { value: 'dark', label: () => t('darkTheme') },
]

/**
 * 提交字号设置：先立即应用 CSS 变量，再持久化（与原设置页 tab 的 change 行为一致；
 * 持久化失败向上抛错由调用方展示）。供 tests/frontend/appearance-settings-tab.test.ts 复用。
 */
async function applyAndSaveFontSize(settings: FontSizeSettings): Promise<void> {
  applyFontSizeSettings(settings)
  await saveFontSizeSettings(getAppStorage(), settings)
}

function fontSizeRangeProgress(value: number) {
  return ((value - FONT_SIZE_RANGE.min) / (FONT_SIZE_RANGE.max - FONT_SIZE_RANGE.min)) * 100
}

/**
 * 字号滑杆：React 的 onChange 等价于原生 input 事件（拖动过程中连续触发），
 * 而「松手才提交」的原生 change 语义需经 ref 附加原生监听保持不变。
 */
export function FontSizeSlider({
  value,
  onInput,
  onCommit,
}: {
  value: number
  onInput: (value: string) => void
  onCommit: (value: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const commit = () => onCommit(input.value)
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  }, [onCommit])

  return (
    <input
      ref={inputRef}
      className="quickforge-font-size-slider"
      style={{ '--quickforge-font-size-slider-progress': `${fontSizeRangeProgress(value)}%` } as CSSProperties}
      type="range"
      min={String(FONT_SIZE_RANGE.min)}
      max={String(FONT_SIZE_RANGE.max)}
      step="1"
      value={String(value)}
      onInput={(event) => onInput(event.currentTarget.value)}
    />
  )
}

export function AppearanceSettingsTab() {
  const [theme, setTheme] = useState<AppTheme>(() => getCurrentTheme())
  const [interfaceFontSizePx, setInterfaceFontSizePx] = useState(DEFAULT_FONT_SIZE_SETTINGS.interfaceFontSizePx)
  const [messageFontSizePx, setMessageFontSizePx] = useState(DEFAULT_FONT_SIZE_SETTINGS.messageFontSizePx)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const storage = getAppStorage()
        const [appearance, fontSize] = await Promise.all([
          loadAppearanceSettings(storage),
          loadFontSizeSettings(storage),
        ])
        if (cancelled) return
        setTheme(appearance.theme)
        setInterfaceFontSizePx(fontSize.interfaceFontSizePx)
        setMessageFontSizePx(fontSize.messageFontSizePx)
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

  // Theme is a discrete choice: apply + persist instantly on click.
  const selectTheme = async (next: AppTheme) => {
    if (theme === next) return
    setTheme(next)
    try {
      await saveAppearanceSettings(getAppStorage(), { theme: next })
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const currentFontSizeSettings = (): FontSizeSettings =>
    normalizeFontSizeSettings({ interfaceFontSizePx, messageFontSizePx })

  const updateFontSize = (settings: FontSizeSettings) => {
    const normalized = normalizeFontSizeSettings(settings)
    setInterfaceFontSizePx(normalized.interfaceFontSizePx)
    setMessageFontSizePx(normalized.messageFontSizePx)
  }

  const updateInterfaceFontSize = (value: string) => {
    updateFontSize({
      ...currentFontSizeSettings(),
      interfaceFontSizePx: Number(value) || DEFAULT_FONT_SIZE_SETTINGS.interfaceFontSizePx,
    })
  }

  const updateMessageFontSize = (value: string) => {
    updateFontSize({
      ...currentFontSizeSettings(),
      messageFontSizePx: Number(value) || DEFAULT_FONT_SIZE_SETTINGS.messageFontSizePx,
    })
  }

  const saveFontSize = async (key: keyof FontSizeSettings, value: string) => {
    try {
      await applyAndSaveFontSize(normalizeFontSizeSettings({ ...currentFontSizeSettings(), [key]: Number(value) }))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const renderThemeOption = (option: { value: AppTheme; label: () => string }) => {
    const selected = theme === option.value
    return (
      <button
        key={option.value}
        type="button"
        className={`quickforge-settings-segmented-option${selected ? ' quickforge-settings-segmented-option-active' : ''}`}
        aria-pressed={selected ? 'true' : 'false'}
        onClick={() => void selectTheme(option.value)}
      >
        {option.label()}
      </button>
    )
  }

  const renderFontSizeSlider = (
    labelText: string,
    note: string | null,
    value: number,
    onInput: (value: string) => void,
    key: keyof FontSizeSettings,
  ) => (
    <div className="quickforge-settings-row" key={labelText}>
      <div className="quickforge-settings-row-main">
        <div className="quickforge-settings-row-title">
          {labelText}
          {note ? <InfoTip label={note} /> : null}
        </div>
        <div className="quickforge-settings-row-description">{t('fontSizeRangeDescription')}</div>
      </div>
      <div className="quickforge-settings-row-control quickforge-settings-slider-control">
        <span className="quickforge-settings-value-badge">{value}px</span>
        <FontSizeSlider value={value} onInput={onInput} onCommit={(next) => void saveFontSize(key, next)} />
      </div>
    </div>
  )

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>
  }

  return (
    <div className="quickforge-settings-stack">
      <section className="quickforge-settings-section" aria-label={t('appearance')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('theme')}
              <InfoTip label={t('themeDescription')} />
            </div>
            <div className="quickforge-settings-row-description">{t('themeDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control">
            <div className="quickforge-settings-segmented" role="group" aria-label={t('theme')}>
              {THEME_OPTIONS.map((option) => renderThemeOption(option))}
            </div>
          </div>
        </div>

        {renderFontSizeSlider(
          t('interfaceFontSize'),
          null,
          interfaceFontSizePx,
          (value) => updateInterfaceFontSize(value),
          'interfaceFontSizePx',
        )}

        {renderFontSizeSlider(
          t('messageFontSize'),
          t('messageFontSizeNote'),
          messageFontSizePx,
          (value) => updateMessageFontSize(value),
          'messageFontSizePx',
        )}
      </section>

      {error ? <span className="quickforge-settings-error">{error}</span> : null}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Check, Moon, Sun } from 'lucide-react'
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
  ariaLabel,
}: {
  value: number
  onInput: (value: string) => void
  onCommit: (value: string) => void
  ariaLabel?: string
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
      aria-label={ariaLabel}
      onInput={(event) => onInput(event.currentTarget.value)}
    />
  )
}

function ThemePreview({ theme }: { theme: AppTheme }) {
  return (
    <span className="quickforge-appearance-theme-preview" data-preview-theme={theme} aria-hidden="true">
      <span className="quickforge-appearance-theme-sidebar">
        <span className="quickforge-appearance-theme-sidebar-line"></span>
        <span className="quickforge-appearance-theme-sidebar-line"></span>
        <span className="quickforge-appearance-theme-sidebar-line"></span>
        <span className="quickforge-appearance-theme-sidebar-line"></span>
      </span>
      <span className="quickforge-appearance-theme-main">
        <span className="quickforge-appearance-theme-heading-line"></span>
        <span className="quickforge-appearance-theme-content-line is-wide"></span>
        <span className="quickforge-appearance-theme-content-line is-short"></span>
        <span className="quickforge-appearance-theme-bubble"></span>
      </span>
    </span>
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
    const ThemeIcon = option.value === 'light' ? Sun : Moon
    return (
      <button
        key={option.value}
        type="button"
        className="quickforge-appearance-theme-tile"
        aria-pressed={selected ? 'true' : 'false'}
        onClick={() => void selectTheme(option.value)}
      >
        <ThemePreview theme={option.value} />
        <span className="quickforge-appearance-theme-label">
          <ThemeIcon className="size-4" aria-hidden="true" />
          <span>{option.label()}</span>
          <span className="quickforge-appearance-theme-check" aria-hidden="true">
            {selected ? <Check className="size-3" /> : null}
          </span>
        </span>
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
      </div>
      <div className="quickforge-settings-row-control quickforge-settings-slider-control">
        <span className="quickforge-settings-value-badge">{value}px</span>
        <FontSizeSlider value={value} onInput={onInput} onCommit={(next) => void saveFontSize(key, next)} ariaLabel={labelText} />
      </div>
    </div>
  )

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>
  }

  return (
    <div className="quickforge-settings-stack">
      <div className="quickforge-settings-group">
        <div className="quickforge-appearance-group-head">
          <h3 className="quickforge-settings-group-title">{t('theme')}</h3>
          <span className="quickforge-appearance-group-description">{t('themeDescription')}</span>
        </div>
        <div className="quickforge-appearance-theme-grid" role="group" aria-label={t('theme')}>
          {THEME_OPTIONS.map((option) => renderThemeOption(option))}
        </div>
      </div>

      <div className="quickforge-settings-group">
        <div className="quickforge-appearance-group-head">
          <h3 className="quickforge-settings-group-title">{t('fontSize')}</h3>
          <span className="quickforge-appearance-group-description">{t('fontSizeRangeDescription')}</span>
        </div>
        <section className="quickforge-settings-section" aria-label={t('fontSize')}>
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
      </div>

      <div className="quickforge-settings-group">
        <div className="quickforge-appearance-group-head">
          <h3 className="quickforge-settings-group-title">{t('appearancePreview')}</h3>
          <span className="quickforge-appearance-group-description">{t('appearancePreviewDescription')}</span>
        </div>
        <section className="quickforge-settings-section quickforge-appearance-preview" aria-label={t('appearancePreview')}>
          <div className="quickforge-appearance-preview-head" style={{ fontSize: `${interfaceFontSizePx}px` }}>
            {t('appearancePreview')}
          </div>
          <div className="quickforge-appearance-preview-thread">
            <div className="quickforge-appearance-preview-user" style={{ fontSize: `${messageFontSizePx}px` }}>
              {t('appearancePreviewUser')}
            </div>
            <div className="quickforge-appearance-preview-assistant" style={{ fontSize: `${messageFontSizePx}px` }}>
              {t('appearancePreviewAssistant')}
            </div>
          </div>
        </section>
      </div>

      {error ? <span className="quickforge-settings-error">{error}</span> : null}
    </div>
  )
}

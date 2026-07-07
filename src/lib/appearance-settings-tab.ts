import { getAppStorage, SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import {
  getCurrentTheme,
  loadAppearanceSettings,
  saveAppearanceSettings,
  type AppTheme,
} from '@/lib/appearance-settings'
import {
  DEFAULT_FONT_SIZE_SETTINGS,
  FONT_SIZE_RANGE,
  applyFontSizeSettings,
  loadFontSizeSettings,
  normalizeFontSizeSettings,
  saveFontSizeSettings,
  type FontSizeSettings,
} from '@/lib/font-size-settings'
import { t } from '@/lib/i18n'
import './info-tip'

const THEME_OPTIONS: { value: AppTheme; label: () => string }[] = [
  { value: 'light', label: () => t('lightTheme') },
  { value: 'dark', label: () => t('darkTheme') },
]

class AppearanceSettingsTab extends SettingsTab {
  private theme: AppTheme = getCurrentTheme()
  private interfaceFontSizePx = DEFAULT_FONT_SIZE_SETTINGS.interfaceFontSizePx
  private messageFontSizePx = DEFAULT_FONT_SIZE_SETTINGS.messageFontSizePx
  private loading = true
  private error = ''

  override getTabName(): string {
    return t('appearance')
  }

  override async connectedCallback() {
    super.connectedCallback()
    await this.loadSettings()
  }

  private async loadSettings() {
    this.loading = true
    this.error = ''
    this.requestUpdate()

    try {
      const storage = getAppStorage()
      const [appearance, fontSize] = await Promise.all([
        loadAppearanceSettings(storage),
        loadFontSizeSettings(storage),
      ])
      this.theme = appearance.theme
      this.interfaceFontSizePx = fontSize.interfaceFontSizePx
      this.messageFontSizePx = fontSize.messageFontSizePx
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  // Theme is a discrete choice: apply + persist instantly on click.
  private async selectTheme(theme: AppTheme) {
    if (this.theme === theme) return
    this.theme = theme
    this.requestUpdate()
    try {
      await saveAppearanceSettings(getAppStorage(), { theme })
      this.error = ''
      this.requestUpdate()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
      this.requestUpdate()
    }
  }

  private currentFontSizeSettings(): FontSizeSettings {
    return normalizeFontSizeSettings({
      interfaceFontSizePx: this.interfaceFontSizePx,
      messageFontSizePx: this.messageFontSizePx,
    })
  }

  private previewFontSize(settings: FontSizeSettings) {
    const normalized = normalizeFontSizeSettings(settings)
    this.interfaceFontSizePx = normalized.interfaceFontSizePx
    this.messageFontSizePx = normalized.messageFontSizePx
    applyFontSizeSettings(normalized)
    this.requestUpdate()
  }

  private updateInterfaceFontSize(value: string) {
    this.previewFontSize({
      ...this.currentFontSizeSettings(),
      interfaceFontSizePx: Number(value) || DEFAULT_FONT_SIZE_SETTINGS.interfaceFontSizePx,
    })
  }

  private updateMessageFontSize(value: string) {
    this.previewFontSize({
      ...this.currentFontSizeSettings(),
      messageFontSizePx: Number(value) || DEFAULT_FONT_SIZE_SETTINGS.messageFontSizePx,
    })
  }

  private async saveFontSize() {
    try {
      await saveFontSizeSettings(getAppStorage(), this.currentFontSizeSettings())
      this.error = ''
      this.requestUpdate()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
      this.requestUpdate()
    }
  }

  private renderThemeOption(option: { value: AppTheme; label: () => string }) {
    const selected = this.theme === option.value
    return html`
      <button
        type="button"
        class="quickforge-settings-segmented-option ${selected ? 'quickforge-settings-segmented-option-active' : ''}"
        aria-pressed=${selected ? 'true' : 'false'}
        @click=${() => this.selectTheme(option.value)}
      >
        ${option.label()}
      </button>
    `
  }

  private getFontSizeRangeProgress(value: number) {
    return ((value - FONT_SIZE_RANGE.min) / (FONT_SIZE_RANGE.max - FONT_SIZE_RANGE.min)) * 100
  }

  private renderFontSizeSlider(
    label: string,
    note: string | null,
    value: number,
    onInput: (value: string) => void,
  ) {
    return html`
      <div class="quickforge-settings-row">
        <div class="quickforge-settings-row-main">
          <div class="quickforge-settings-row-title">
            ${label}
            ${note ? html`<quickforge-info-tip .label=${note}></quickforge-info-tip>` : null}
          </div>
          <div class="quickforge-settings-row-description">${t('fontSizeRangeDescription')}</div>
        </div>
        <div class="quickforge-settings-row-control quickforge-settings-slider-control">
          <span class="quickforge-settings-value-badge">${value}px</span>
          <input
            class="quickforge-font-size-slider"
            style=${`--quickforge-font-size-slider-progress: ${this.getFontSizeRangeProgress(value)}%`}
            type="range"
            min=${String(FONT_SIZE_RANGE.min)}
            max=${String(FONT_SIZE_RANGE.max)}
            step="1"
            .value=${String(value)}
            @input=${(event: Event) => onInput((event.target as HTMLInputElement).value)}
            @change=${() => this.saveFontSize()}
          />
        </div>
      </div>
    `
  }

  override render(): TemplateResult {
    if (this.loading) {
      return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
    }

    return html`
      <div class="quickforge-settings-stack">
        <section class="quickforge-settings-section" aria-label=${t('appearance')}>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('theme')}
                <quickforge-info-tip .label=${t('themeDescription')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('themeDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              <div class="quickforge-settings-segmented" role="group" aria-label=${t('theme')}>
                ${THEME_OPTIONS.map((option) => this.renderThemeOption(option))}
              </div>
            </div>
          </div>

          ${this.renderFontSizeSlider(
            t('interfaceFontSize'),
            null,
            this.interfaceFontSizePx,
            (value) => this.updateInterfaceFontSize(value),
          )}

          ${this.renderFontSizeSlider(
            t('messageFontSize'),
            t('messageFontSizeNote'),
            this.messageFontSizePx,
            (value) => this.updateMessageFontSize(value),
          )}
        </section>

        ${this.error ? html`<span class="quickforge-settings-error">${this.error}</span>` : null}
      </div>
    `
  }
}

const tagName = 'quickforge-appearance-settings-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, AppearanceSettingsTab)
}

export function createAppearanceSettingsTab() {
  return document.createElement(tagName) as AppearanceSettingsTab
}

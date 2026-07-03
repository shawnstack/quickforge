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
    const isDark = option.value === 'dark'
    return html`
      <button
        type="button"
        class="group flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
          selected
            ? 'border-primary ring-1 ring-primary'
            : 'border-border hover:border-foreground/30'
        }"
        @click=${() => this.selectTheme(option.value)}
      >
        <div
          class="flex h-16 overflow-hidden rounded-md border ${
            isDark ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-200 bg-white'
          }"
        >
          <div class="w-1/4 ${isDark ? 'bg-zinc-800' : 'bg-zinc-100'}"></div>
          <div class="flex flex-1 flex-col gap-1.5 p-2">
            <div class="h-1.5 w-3/4 rounded-full ${isDark ? 'bg-zinc-600' : 'bg-zinc-300'}"></div>
            <div class="h-1.5 w-1/2 rounded-full ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}"></div>
            <div class="h-1.5 w-2/3 rounded-full ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}"></div>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-foreground">${option.label()}</span>
          <span
            class="flex size-4 items-center justify-center rounded-full border ${
              selected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
            }"
          >
            ${selected
              ? html`<svg class="size-3 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2.5 6l2.5 2.5 4.5-5"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>`
              : null}
          </span>
        </div>
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
      <label class="grid gap-2 text-sm">
        <div class="flex items-center justify-between gap-3">
          <span class="inline-flex items-center gap-1.5 text-foreground">
            ${label}
            ${note ? html`<quickforge-info-tip .label=${note}></quickforge-info-tip>` : null}
          </span>
          <span class="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">${value}px</span>
        </div>
        <input
          class="quickforge-font-size-slider w-full"
          style=${`--quickforge-font-size-slider-progress: ${this.getFontSizeRangeProgress(value)}%`}
          type="range"
          min=${String(FONT_SIZE_RANGE.min)}
          max=${String(FONT_SIZE_RANGE.max)}
          step="1"
          .value=${String(value)}
          @input=${(event: Event) => onInput((event.target as HTMLInputElement).value)}
          @change=${() => this.saveFontSize()}
        />
        <div class="flex justify-between text-xs text-muted-foreground">
          <span>${FONT_SIZE_RANGE.min}px</span>
          <span>${FONT_SIZE_RANGE.max}px</span>
        </div>
      </label>
    `
  }

  override render(): TemplateResult {
    if (this.loading) {
      return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
    }

    return html`
      <div class="flex flex-col gap-6">
        <div>
          <h3 class="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            ${t('appearance')}
            <quickforge-info-tip .label=${t('appearanceDescription')}></quickforge-info-tip>
          </h3>
        </div>

        <div class="grid max-w-xl gap-3 rounded-lg border border-border p-4">
          <div>
            <h4 class="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              ${t('theme')}
              <quickforge-info-tip .label=${t('themeDescription')}></quickforge-info-tip>
            </h4>
          </div>
          <div class="grid grid-cols-2 gap-3">
            ${THEME_OPTIONS.map((option) => this.renderThemeOption(option))}
          </div>
        </div>

        <div class="grid max-w-xl gap-4 rounded-lg border border-border p-4">
          <div>
            <h4 class="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              ${t('fontSize')}
              <quickforge-info-tip .label=${t('fontSizeDescription')}></quickforge-info-tip>
            </h4>
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
        </div>

        ${this.error ? html`<span class="text-sm text-destructive">${this.error}</span>` : null}
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

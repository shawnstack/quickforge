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

type FontSizePresetValue = 'small' | 'default' | 'large' | 'extraLarge'
type InterfaceFontSizeSettings = Pick<FontSizeSettings, 'baseFontSizePx' | 'bodyFontSizePx'>

type InterfaceFontSizePreset = {
  value: FontSizePresetValue
  label: () => string
  settings: InterfaceFontSizeSettings
}

type MessageFontSizePreset = {
  value: FontSizePresetValue
  label: () => string
  messageFontSizePx: number
}

const INTERFACE_FONT_SIZE_PRESETS: InterfaceFontSizePreset[] = [
  { value: 'small', label: () => t('fontSizeSmall'), settings: { baseFontSizePx: 13, bodyFontSizePx: 11 } },
  { value: 'default', label: () => t('fontSizeDefault'), settings: DEFAULT_FONT_SIZE_SETTINGS },
  { value: 'large', label: () => t('fontSizeLarge'), settings: { baseFontSizePx: 15, bodyFontSizePx: 13 } },
  { value: 'extraLarge', label: () => t('fontSizeExtraLarge'), settings: { baseFontSizePx: 16, bodyFontSizePx: 14 } },
]

const MESSAGE_FONT_SIZE_PRESETS: MessageFontSizePreset[] = [
  { value: 'small', label: () => t('fontSizeSmall'), messageFontSizePx: 14 },
  { value: 'default', label: () => t('fontSizeDefault'), messageFontSizePx: DEFAULT_FONT_SIZE_SETTINGS.messageFontSizePx },
  { value: 'large', label: () => t('fontSizeLarge'), messageFontSizePx: 17 },
  { value: 'extraLarge', label: () => t('fontSizeExtraLarge'), messageFontSizePx: 18 },
]

class AppearanceSettingsTab extends SettingsTab {
  private theme: AppTheme = getCurrentTheme()
  private baseFontSizePx = DEFAULT_FONT_SIZE_SETTINGS.baseFontSizePx
  private bodyFontSizePx = DEFAULT_FONT_SIZE_SETTINGS.bodyFontSizePx
  private messageFontSizePx = DEFAULT_FONT_SIZE_SETTINGS.messageFontSizePx
  private advancedFontSizeOpen = false
  private loading = true
  private fontSizeSaved = false
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
      this.baseFontSizePx = fontSize.baseFontSizePx
      this.bodyFontSizePx = fontSize.bodyFontSizePx
      this.messageFontSizePx = fontSize.messageFontSizePx
      this.advancedFontSizeOpen = !this.currentInterfaceFontSizePreset() || !this.currentMessageFontSizePreset()
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
      baseFontSizePx: this.baseFontSizePx,
      bodyFontSizePx: this.bodyFontSizePx,
      messageFontSizePx: this.messageFontSizePx,
    })
  }

  private currentInterfaceFontSizePreset() {
    const settings = this.currentFontSizeSettings()
    return INTERFACE_FONT_SIZE_PRESETS.find((preset) => (
      preset.settings.baseFontSizePx === settings.baseFontSizePx
        && preset.settings.bodyFontSizePx === settings.bodyFontSizePx
    ))
  }

  private currentMessageFontSizePreset() {
    const settings = this.currentFontSizeSettings()
    return MESSAGE_FONT_SIZE_PRESETS.find((preset) => preset.messageFontSizePx === settings.messageFontSizePx)
  }

  private async applyAndSaveFontSize(settings: FontSizeSettings) {
    const normalized = normalizeFontSizeSettings(settings)
    this.baseFontSizePx = normalized.baseFontSizePx
    this.bodyFontSizePx = normalized.bodyFontSizePx
    this.messageFontSizePx = normalized.messageFontSizePx
    this.fontSizeSaved = false
    applyFontSizeSettings(normalized)
    this.requestUpdate()

    try {
      await saveFontSizeSettings(getAppStorage(), normalized)
      this.fontSizeSaved = true
      this.error = ''
      this.requestUpdate()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
      this.requestUpdate()
    }
  }

  private async selectInterfaceFontSizePreset(preset: InterfaceFontSizePreset) {
    this.advancedFontSizeOpen = false
    await this.applyAndSaveFontSize({
      ...this.currentFontSizeSettings(),
      ...preset.settings,
    })
  }

  private async selectMessageFontSizePreset(preset: MessageFontSizePreset) {
    this.advancedFontSizeOpen = false
    await this.applyAndSaveFontSize({
      ...this.currentFontSizeSettings(),
      messageFontSizePx: preset.messageFontSizePx,
    })
  }

  // Advanced font size: preview live on input, persist on explicit save.
  private updateBaseFontSize(value: string) {
    this.baseFontSizePx = Number(value) || DEFAULT_FONT_SIZE_SETTINGS.baseFontSizePx
    applyFontSizeSettings(this.currentFontSizeSettings())
    this.fontSizeSaved = false
    this.requestUpdate()
  }

  private updateBodyFontSize(value: string) {
    this.bodyFontSizePx = Number(value) || DEFAULT_FONT_SIZE_SETTINGS.bodyFontSizePx
    applyFontSizeSettings(this.currentFontSizeSettings())
    this.fontSizeSaved = false
    this.requestUpdate()
  }

  private updateMessageFontSize(value: string) {
    this.messageFontSizePx = Number(value) || DEFAULT_FONT_SIZE_SETTINGS.messageFontSizePx
    applyFontSizeSettings(this.currentFontSizeSettings())
    this.fontSizeSaved = false
    this.requestUpdate()
  }

  private async saveFontSize() {
    await this.applyAndSaveFontSize(this.currentFontSizeSettings())
  }

  private async resetFontSize() {
    await this.applyAndSaveFontSize(DEFAULT_FONT_SIZE_SETTINGS)
  }

  private toggleAdvancedFontSize() {
    this.advancedFontSizeOpen = !this.advancedFontSizeOpen
    this.requestUpdate()
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

  private renderInterfaceFontSizePreset(preset: InterfaceFontSizePreset) {
    const selected = this.currentInterfaceFontSizePreset()?.value === preset.value
    return this.renderFontSizePresetButton(selected, preset.label(), () => this.selectInterfaceFontSizePreset(preset))
  }

  private renderMessageFontSizePreset(preset: MessageFontSizePreset) {
    const selected = this.currentMessageFontSizePreset()?.value === preset.value
    return this.renderFontSizePresetButton(selected, preset.label(), () => this.selectMessageFontSizePreset(preset))
  }

  private renderFontSizePresetButton(selected: boolean, label: string, onClick: () => void) {
    return html`
      <button
        type="button"
        class="rounded-md border px-3 py-2 text-sm transition-colors ${
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-background text-foreground hover:bg-accent'
        }"
        @click=${onClick}
      >
        ${label}
      </button>
    `
  }

  override render(): TemplateResult {
    if (this.loading) {
      return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
    }

    const currentInterfacePreset = this.currentInterfaceFontSizePreset()
    const currentMessagePreset = this.currentMessageFontSizePreset()

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

          <div class="grid gap-2">
            <div class="flex items-center gap-2 text-sm text-foreground">
              <span>${t('interfaceFontSize')}</span>
              ${currentInterfacePreset ? null : html`<span class="text-xs text-muted-foreground">${t('customFontSize')}</span>`}
            </div>
            <div class="grid max-w-md grid-cols-2 gap-2 sm:grid-cols-4">
              ${INTERFACE_FONT_SIZE_PRESETS.map((preset) => this.renderInterfaceFontSizePreset(preset))}
            </div>
          </div>

          <div class="grid gap-2">
            <div class="flex items-center gap-2 text-sm text-foreground">
              <span>${t('messageFontSize')}</span>
              <quickforge-info-tip .label=${t('messageFontSizeNote')}></quickforge-info-tip>
              ${currentMessagePreset ? null : html`<span class="text-xs text-muted-foreground">${t('customFontSize')}</span>`}
            </div>
            <div class="grid max-w-md grid-cols-2 gap-2 sm:grid-cols-4">
              ${MESSAGE_FONT_SIZE_PRESETS.map((preset) => this.renderMessageFontSizePreset(preset))}
            </div>
          </div>

          <button
            type="button"
            class="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            @click=${() => this.toggleAdvancedFontSize()}
          >
            <span>${this.advancedFontSizeOpen ? '▾' : '▸'}</span>
            <span>${t('advancedFontSizeSettings')}</span>
          </button>

          ${this.advancedFontSizeOpen
            ? html`
                <div class="grid gap-3 border-t border-border pt-3">
                  <div class="grid gap-3 md:grid-cols-3">
                    <label class="grid max-w-xs gap-1.5 text-sm">
                      <span class="text-foreground">${t('baseFontSize')}</span>
                      <input
                        class="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        type="number"
                        min="12"
                        max="18"
                        step="1"
                        .value=${String(this.baseFontSizePx)}
                        @input=${(event: Event) => this.updateBaseFontSize((event.target as HTMLInputElement).value)}
                      />
                    </label>
                    <label class="grid max-w-xs gap-1.5 text-sm">
                      <span class="inline-flex items-center gap-1.5 text-foreground">
                        ${t('bodyFontSize')}
                        <quickforge-info-tip .label=${t('bodyFontSizeNote')}></quickforge-info-tip>
                      </span>
                      <input
                        class="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        type="number"
                        min="11"
                        max="16"
                        step="1"
                        .value=${String(this.bodyFontSizePx)}
                        @input=${(event: Event) => this.updateBodyFontSize((event.target as HTMLInputElement).value)}
                      />
                    </label>
                    <label class="grid max-w-xs gap-1.5 text-sm">
                      <span class="inline-flex items-center gap-1.5 text-foreground">
                        ${t('messageFontSize')}
                        <quickforge-info-tip .label=${t('messageFontSizeNote')}></quickforge-info-tip>
                      </span>
                      <input
                        class="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        type="number"
                        min="13"
                        max="20"
                        step="1"
                        .value=${String(this.messageFontSizePx)}
                        @input=${(event: Event) => this.updateMessageFontSize((event.target as HTMLInputElement).value)}
                      />
                    </label>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                      type="button"
                      @click=${() => this.saveFontSize()}
                    >
                      ${t('save')}
                    </button>
                    <button
                      class="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-accent"
                      type="button"
                      @click=${() => this.resetFontSize()}
                    >
                      ${t('restoreDefault')}
                    </button>
                  </div>
                </div>
              `
            : null}

          ${this.fontSizeSaved
            ? html`<span class="text-sm text-muted-foreground">${t('fontSizeSaved')}</span>`
            : null}
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

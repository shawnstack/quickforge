import { SettingsTab } from '@mariozechner/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { applyAppLanguage, getAppLanguage, t, type AppLanguage } from '@/lib/i18n'

class LanguageSettingsTab extends SettingsTab {
  private selectedLanguage: AppLanguage = getAppLanguage()

  override getTabName(): string {
    return t('language')
  }

  private updateLanguage(value: string) {
    this.selectedLanguage = value === 'zh' ? 'zh' : 'en'
    this.requestUpdate()
  }

  private applyLanguage() {
    if (!applyAppLanguage(this.selectedLanguage)) {
      alert(t('noLanguageChange'))
    }
  }

  override render(): TemplateResult {
    return html`
      <div class="flex flex-col gap-6">
        <div>
          <h3 class="mb-2 text-sm font-semibold text-foreground">${t('language')}</h3>
          <p class="text-sm text-muted-foreground">${t('languageDescription')}</p>
        </div>

        <label class="grid max-w-sm gap-1.5 text-sm">
          <span class="text-foreground">${t('displayLanguage')}</span>
          <select
            class="rounded-md border border-input bg-background px-3 py-2 text-sm"
            .value=${this.selectedLanguage}
            @change=${(event: Event) => this.updateLanguage((event.target as HTMLSelectElement).value)}
          >
            <option value="zh">${t('simplifiedChinese')}</option>
            <option value="en">${t('english')}</option>
          </select>
        </label>

        <div>
          <button
            class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            type="button"
            @click=${() => this.applyLanguage()}
          >
            ${t('apply')}
          </button>
        </div>
      </div>
    `
  }
}

const tagName = 'fastcode-language-settings-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, LanguageSettingsTab)
}

export function createLanguageSettingsTab() {
  return document.createElement(tagName) as LanguageSettingsTab
}

import { getAppStorage, SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { loadMemorySettings, saveMemorySettings } from '@/lib/memory-settings'
import { t } from '@/lib/i18n'
import './info-tip'

type MemoryDocument = {
  enabled: boolean
  markdown: string
  path: string
  count?: number
}

class MemorySettingsTab extends SettingsTab {
  private enabled = true
  private loading = true
  private saving = false
  private loadingDocument = false
  private markdown = ''
  private savedMarkdown = ''
  private memoryPath = '~/.quickforge/MEMORY.md'
  private message = ''
  private error = ''

  override getTabName(): string {
    return t('memory')
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
      const [settings] = await Promise.all([
        loadMemorySettings(getAppStorage()),
        this.loadDocument(),
      ])
      this.enabled = settings.enabled
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private async loadDocument(showMessage = false) {
    this.loadingDocument = true
    this.error = ''
    if (showMessage) this.message = ''
    this.requestUpdate()
    try {
      const response = await fetch('/api/memory', { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as MemoryDocument & { error?: string } | null
      if (!response.ok || !payload) throw new Error(payload?.error || t('requestFailed'))
      this.markdown = payload.markdown
      this.savedMarkdown = payload.markdown
      this.memoryPath = payload.path || this.memoryPath
      if (showMessage) this.message = t('memoryReloaded')
    } finally {
      this.loadingDocument = false
      this.requestUpdate()
    }
  }

  private async updateEnabled(enabled: boolean) {
    const previous = this.enabled
    this.enabled = enabled
    this.saving = true
    this.message = ''
    this.error = ''
    this.requestUpdate()
    try {
      await saveMemorySettings(getAppStorage(), { enabled })
      this.message = enabled ? t('memoryEnabledSaved') : t('memoryDisabledSaved')
    } catch (error) {
      this.enabled = previous
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.saving = false
      this.requestUpdate()
    }
  }

  private async reloadDocument() {
    try {
      await this.loadDocument(true)
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
      this.requestUpdate()
    }
  }

  private async saveDocument() {
    if (!this.enabled || this.saving) return
    this.saving = true
    this.message = ''
    this.error = ''
    this.requestUpdate()
    try {
      const response = await fetch('/api/memory', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markdown: this.markdown }),
      })
      const payload = await response.json().catch(() => null) as MemoryDocument & { error?: string } | null
      if (!response.ok || !payload) throw new Error(payload?.error || t('requestFailed'))
      this.markdown = payload.markdown
      this.savedMarkdown = payload.markdown
      this.memoryPath = payload.path || this.memoryPath
      this.message = t('memoryContentSaved')
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.saving = false
      this.requestUpdate()
    }
  }

  private renderSwitch() {
    return html`
      <label class="quickforge-settings-switch" aria-disabled=${this.saving ? 'true' : 'false'}>
        <input
          type="checkbox"
          .checked=${this.enabled}
          ?disabled=${this.saving}
          @change=${(event: Event) => void this.updateEnabled((event.target as HTMLInputElement).checked)}
        />
        <span aria-hidden="true"></span>
      </label>
    `
  }

  override render(): TemplateResult {
    if (this.loading) return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
    const dirty = this.markdown !== this.savedMarkdown
    const busy = this.saving || this.loadingDocument

    return html`
      <div class="quickforge-settings-stack">
        <section class="quickforge-settings-section" aria-label=${t('memory')}>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('globalMemory')}
                <quickforge-info-tip .label=${t('globalMemoryInfo')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('globalMemoryDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">${this.renderSwitch()}</div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('memoryFile')}</div>
              <div class="quickforge-settings-row-description">${t('memoryFileDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
              <code class="text-xs text-muted-foreground">${this.memoryPath}</code>
            </div>
          </div>

          <div class="quickforge-settings-row quickforge-settings-row-align-start quickforge-memory-content-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('memoryContent')}</div>
              <div class="quickforge-settings-row-description">${this.enabled ? t('memoryContentDescription') : t('memoryContentDisabledDescription')}</div>
            </div>
            <div class="quickforge-memory-editor-control">
              <textarea
                class="quickforge-settings-textarea quickforge-settings-mono quickforge-memory-editor"
                .value=${this.markdown}
                ?disabled=${!this.enabled || busy}
                spellcheck="false"
                @input=${(event: Event) => {
                  this.markdown = (event.target as HTMLTextAreaElement).value
                  this.message = ''
                  this.requestUpdate()
                }}
              ></textarea>
              <div class="quickforge-memory-editor-actions">
                <button
                  class="quickforge-settings-button quickforge-settings-button-secondary"
                  type="button"
                  ?disabled=${busy}
                  @click=${() => void this.reloadDocument()}
                >${this.loadingDocument ? t('loading') : t('memoryReload')}</button>
                <button
                  class="quickforge-settings-button quickforge-settings-button-primary"
                  type="button"
                  ?disabled=${!this.enabled || busy || !dirty}
                  @click=${() => void this.saveDocument()}
                >${this.saving ? t('saving') : t('memorySave')}</button>
              </div>
            </div>
          </div>

          <div class="quickforge-settings-note">${t('memoryCurrentSessionNote')}</div>
        </section>

        ${this.message ? html`<div class="quickforge-settings-message">${this.message}</div>` : null}
        ${this.error ? html`<div class="quickforge-settings-alert">${this.error}</div>` : null}
      </div>
    `
  }
}

const tagName = 'quickforge-memory-settings-tab'

if (!customElements.get(tagName)) customElements.define(tagName, MemorySettingsTab)

export function createMemorySettingsTab() {
  return document.createElement(tagName) as MemorySettingsTab
}

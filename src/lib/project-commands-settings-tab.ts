import { SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { t } from '@/lib/i18n'
import type { ProjectInfo } from '@/lib/types'

class ProjectCommandsSettingsTab extends SettingsTab {
  private loading = true
  private saving = false
  private saved = false
  private error = ''
  private project?: ProjectInfo
  private commandDir = ''

  override getTabName(): string {
    return t('projectCommands')
  }

  override async connectedCallback() {
    super.connectedCallback()
    await this.loadProject()
  }

  private async loadProject() {
    this.loading = true
    this.error = ''
    this.requestUpdate()

    try {
      const response = await fetch('/api/project')
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
      this.project = payload?.project
      this.commandDir = typeof this.project?.commandDir === 'string' ? this.project.commandDir : ''
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private updateCommandDir(value: string) {
    this.commandDir = value
    this.saved = false
    this.requestUpdate()
  }

  private async save() {
    if (!this.project || this.saving) return
    this.saving = true
    this.saved = false
    this.error = ''
    this.requestUpdate()

    try {
      const response = await fetch(`/api/project/${encodeURIComponent(this.project.id)}/command-dir`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandDir: this.commandDir }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
      this.project = payload?.project ?? this.project
      this.commandDir = typeof this.project?.commandDir === 'string' ? this.project.commandDir : ''
      this.saved = true
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.saving = false
      this.requestUpdate()
    }
  }

  override render(): TemplateResult {
    if (this.loading) {
      return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
    }

    if (!this.project) {
      return html`
        <div class="flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-foreground">${t('projectCommands')}</h3>
          <p class="text-sm text-muted-foreground">${t('selectProjectForCommands')}</p>
          ${this.error ? html`<div class="text-sm text-destructive">${this.error}</div>` : null}
        </div>
      `
    }

    return html`
      <div class="flex flex-col gap-6">
        <div>
          <h3 class="mb-2 text-sm font-semibold text-foreground">${t('projectCommands')}</h3>
          <p class="text-sm text-muted-foreground">${t('projectCommandsDescription')}</p>
        </div>

        <div class="grid gap-1.5 text-sm">
          <span class="text-foreground">${t('project')}</span>
          <div class="break-all rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            ${this.project.name} · ${this.project.path}
          </div>
        </div>

        <label class="grid max-w-xl gap-1.5 text-sm">
          <span class="text-foreground">${t('commandDirectories')}</span>
          <textarea
            class="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
            .value=${this.commandDir}
            placeholder=${t('commandDirectoryPlaceholder')}
            @input=${(event: Event) => this.updateCommandDir((event.target as HTMLTextAreaElement).value)}
          ></textarea>
          <span class="text-xs leading-5 text-muted-foreground">${t('commandDirectoryHelp')}</span>
        </label>

        <div class="rounded-lg border border-border p-4 text-xs leading-5 text-muted-foreground">
          <div class="mb-1 font-medium text-foreground">${t('commandDirectoryExamples')}</div>
          <ul class="list-disc space-y-1 pl-5">
            <li>.ai/commands</li>
            <li>.claude/commands</li>
            <li>.opencode/commands</li>
            <li>D:\\shared\\ai-commands</li>
          </ul>
        </div>

        <div class="flex items-center gap-3">
          <button
            class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60"
            type="button"
            ?disabled=${this.saving}
            @click=${() => this.save()}
          >
            ${this.saving ? t('saving') : t('save')}
          </button>
          ${this.saved ? html`<span class="text-sm text-muted-foreground">${t('projectCommandsSaved')}</span>` : null}
          ${this.error ? html`<span class="text-sm text-destructive">${this.error}</span>` : null}
        </div>
      </div>
    `
  }
}

const tagName = 'quickforge-project-commands-settings-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, ProjectCommandsSettingsTab)
}

export function createProjectCommandsSettingsTab() {
  return document.createElement(tagName) as ProjectCommandsSettingsTab
}

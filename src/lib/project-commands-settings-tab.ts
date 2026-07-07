import { SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { t } from '@/lib/i18n'
import type { ProjectInfo } from '@/lib/types'
import './info-tip'

type CommandSummary = {
  name: string
  description?: string
  argumentHint?: string
  relativePath?: string
}

class ProjectCommandsSettingsTab extends SettingsTab {
  private loading = true
  private saving = false
  private saved = false
  private error = ''
  private message = ''
  private projects: ProjectInfo[] = []
  private project?: ProjectInfo
  private commandDir = ''
  private commands: CommandSummary[] = []
  private loadingCommands = false
  private saveTimer: number | null = null
  private lastSavedCommandDir = ''
  private pendingSaveAfterCurrent = false

  override getTabName(): string {
    return t('projectCommands')
  }

  override async connectedCallback() {
    super.connectedCallback()
    await this.loadProjects()
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : undefined),
        ...init?.headers,
      },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
    return payload as T
  }

  private async loadProjects() {
    this.loading = true
    this.error = ''
    this.requestUpdate()

    try {
      const payload = await this.request<{ project?: ProjectInfo; projects?: ProjectInfo[] }>('/api/project')
      this.projects = payload?.projects ?? (payload?.project ? [payload.project] : [])
      this.project = payload?.project ?? this.projects[0]
      this.commandDir = typeof this.project?.commandDir === 'string' ? this.project.commandDir : ''
      this.lastSavedCommandDir = this.commandDir
      await this.loadCommands()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private selectProject(event: Event) {
    this.clearSaveTimer()
    const select = event.target as HTMLSelectElement
    const selected = this.projects.find((item) => item.id === select.value)
    if (!selected) return
    this.project = selected
    this.commandDir = typeof selected.commandDir === 'string' ? selected.commandDir : ''
    this.lastSavedCommandDir = this.commandDir
    this.saved = false
    this.message = ''
    this.error = ''
    this.commands = []
    this.requestUpdate()
    void this.loadCommands()
  }

  private async loadCommands() {
    if (!this.project?.id) return
    this.loadingCommands = true
    this.requestUpdate()
    try {
      const payload = await this.request<{ commands: CommandSummary[] }>(
        `/api/project/commands?projectId=${encodeURIComponent(this.project.id)}`,
      )
      this.commands = payload?.commands ?? []
    } catch {
      this.commands = []
    } finally {
      this.loadingCommands = false
      this.requestUpdate()
    }
  }

  private updateCommandDir(value: string) {
    this.commandDir = value
    this.saved = false
    this.message = ''
    this.scheduleSave()
    this.requestUpdate()
  }

  private clearSaveTimer() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
  }

  private scheduleSave() {
    this.clearSaveTimer()
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 800)
  }

  override disconnectedCallback() {
    this.clearSaveTimer()
    super.disconnectedCallback()
  }

  private async save() {
    if (!this.project) return
    if (this.saving) {
      this.pendingSaveAfterCurrent = true
      return
    }

    const projectId = this.project.id
    const commandDir = this.commandDir
    if (commandDir === this.lastSavedCommandDir) return

    this.saving = true
    this.saved = false
    this.error = ''
    this.message = ''
    this.requestUpdate()

    try {
      const payload = await this.request<{ project?: ProjectInfo }>(
        `/api/project/${encodeURIComponent(projectId)}/command-dir`,
        { method: 'PUT', body: JSON.stringify({ commandDir }) },
      )
      if (this.project?.id === projectId) {
        this.project = payload?.project ?? this.project
        if (this.project) {
          const index = this.projects.findIndex((item) => item.id === this.project!.id)
          if (index >= 0) this.projects[index] = this.project
        }
        this.commandDir = typeof this.project?.commandDir === 'string' ? this.project.commandDir : commandDir
        this.lastSavedCommandDir = this.commandDir
        this.saved = true
        await this.loadCommands()
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.saving = false
      if (this.pendingSaveAfterCurrent) {
        this.pendingSaveAfterCurrent = false
        this.scheduleSave()
      }
      this.requestUpdate()
    }
  }

  private async openCommandDir() {
    if (!this.project) return
    this.error = ''
    this.message = ''
    this.requestUpdate()
    try {
      await this.request('/api/project/open-path', {
        method: 'POST',
        body: JSON.stringify({ path: '.ai/commands', projectId: this.project.id }),
      })
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
      this.requestUpdate()
    }
  }

  private async createCommand() {
    if (!this.project) return
    const name = window.prompt(t('newCommandPrompt'))
    if (!name?.trim()) return
    this.error = ''
    this.message = ''
    this.requestUpdate()
    try {
      const result = await this.request<{ ok: boolean; reason?: string; name?: string }>(
        '/api/project/command',
        { method: 'POST', body: JSON.stringify({ name: name.trim(), projectId: this.project.id }) },
      )
      if (result.ok) {
        this.message = t('commandCreated', { name: result.name ?? name.trim() })
        await this.loadCommands()
      } else if (result.reason === 'exists') {
        this.error = t('commandAlreadyExists', { name: result.name ?? name.trim() })
      } else {
        this.error = t('invalidCommandName')
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.requestUpdate()
    }
  }

  override render(): TemplateResult {
    if (this.loading) {
      return html`<div class="quickforge-settings-note">${t('loading')}</div>`
    }

    if (this.projects.length === 0) {
      return html`
        <div class="quickforge-settings-stack">
          <div class="quickforge-settings-note">${t('selectProjectForCommands')}</div>
          ${this.error ? html`<div class="quickforge-settings-alert">${this.error}</div>` : null}
        </div>
      `
    }

    return html`
      <div class="quickforge-settings-stack">
        <section class="quickforge-settings-section" aria-label=${t('projectCommands')}>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('project')}</div>
              <div class="quickforge-settings-row-description">
                ${this.project?.path ? this.project.path : t('projectCommandsProjectDescription')}
              </div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
              <select
                class="quickforge-settings-select"
                .value=${this.project?.id ?? ''}
                @change=${(event: Event) => this.selectProject(event)}
              >
                ${this.projects.map((item) => html`<option value=${item.id} ?selected=${item.id === this.project?.id}>${item.name}</option>`)}
              </select>
            </div>
          </div>

          <div class="quickforge-settings-row quickforge-settings-row-align-start">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('commandDirectories')}
                <quickforge-info-tip .label=${t('commandDirectoryHelp')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('commandDirectoriesDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
              <textarea
                class="quickforge-settings-textarea quickforge-settings-mono"
                .value=${this.commandDir}
                placeholder=${t('commandDirectoryPlaceholder')}
                @input=${(event: Event) => this.updateCommandDir((event.target as HTMLTextAreaElement).value)}
              ></textarea>
            </div>
          </div>

          <div class="quickforge-settings-row quickforge-settings-row-align-start">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('commandDirectoryExamples')}</div>
              <div class="quickforge-settings-row-description">${t('commandDirectoryExamplesDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-settings-code-list">
              <code>.ai/commands</code>
              <code>.claude/commands</code>
              <code>.opencode/commands</code>
              <code>D:\shared\ai-commands</code>
            </div>
          </div>
        </section>

        <section class="quickforge-settings-section" aria-label=${t('loadedCommands', { count: this.commands.length })}>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('loadedCommands', { count: this.commands.length })}</div>
              <div class="quickforge-settings-row-description">${t('loadedCommandsDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
              <button
                class="quickforge-settings-button quickforge-settings-button-secondary"
                type="button"
                ?disabled=${this.loadingCommands}
                @click=${() => this.openCommandDir()}
              >
                ${t('openCommandDir')}
              </button>
              <button
                class="quickforge-settings-button quickforge-settings-button-primary"
                type="button"
                ?disabled=${this.loadingCommands}
                @click=${() => this.createCommand()}
              >
                ${t('createCommand')}
              </button>
            </div>
          </div>

          <div class="quickforge-settings-nested-list">
            ${this.loadingCommands
              ? html`<div class="quickforge-settings-empty-row">${t('loading')}</div>`
              : this.commands.length === 0
                ? html`<div class="quickforge-settings-empty-row">${t('noCommandsLoaded')}</div>`
                : this.commands.map((command) => {
                    const hint = command.argumentHint ? ` ${command.argumentHint}` : ''
                    return html`
                      <div class="quickforge-settings-subrow">
                        <div class="quickforge-settings-row-main">
                          <div class="quickforge-settings-row-title">
                            <code class="quickforge-settings-command-name">/${command.name}${hint}</code>
                          </div>
                          <div class="quickforge-settings-row-description">
                            ${command.description || t('noDescription')}
                          </div>
                        </div>
                        ${command.relativePath
                          ? html`<div class="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-settings-readonly-value">${command.relativePath}</div>`
                          : null}
                      </div>
                    `
                  })}
          </div>
        </section>

        ${this.saving ? html`<div class="quickforge-settings-note">${t('saving')}</div>` : null}
        ${this.saved ? html`<div class="quickforge-settings-message">${t('projectCommandsSaved')}</div>` : null}
        ${this.message ? html`<div class="quickforge-settings-message">${this.message}</div>` : null}
        ${this.error ? html`<div class="quickforge-settings-alert">${this.error}</div>` : null}
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

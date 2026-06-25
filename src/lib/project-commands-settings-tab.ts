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
      await this.loadCommands()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private selectProject(event: Event) {
    const select = event.target as HTMLSelectElement
    const selected = this.projects.find((item) => item.id === select.value)
    if (!selected) return
    this.project = selected
    this.commandDir = typeof selected.commandDir === 'string' ? selected.commandDir : ''
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
    this.requestUpdate()
  }

  private async save() {
    if (!this.project || this.saving) return
    this.saving = true
    this.saved = false
    this.error = ''
    this.message = ''
    this.requestUpdate()

    try {
      const payload = await this.request<{ project?: ProjectInfo }>(
        `/api/project/${encodeURIComponent(this.project.id)}/command-dir`,
        { method: 'PUT', body: JSON.stringify({ commandDir: this.commandDir }) },
      )
      this.project = payload?.project ?? this.project
      if (this.project) {
        const index = this.projects.findIndex((item) => item.id === this.project!.id)
        if (index >= 0) this.projects[index] = this.project
      }
      this.commandDir = typeof this.project?.commandDir === 'string' ? this.project.commandDir : ''
      this.saved = true
      await this.loadCommands()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.saving = false
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
      return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
    }

    if (this.projects.length === 0) {
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
          <h3 class="mb-2 text-sm font-semibold text-foreground">
            ${t('projectCommands')}
            <quickforge-info-tip .label=${t('projectCommandsDescription')}></quickforge-info-tip>
          </h3>
        </div>

        <div class="grid max-w-xl gap-1.5 text-sm">
          <span class="text-foreground">${t('project')}</span>
          <select
            class="rounded-md border border-input bg-background px-3 py-2 text-sm"
            .value=${this.project?.id ?? ''}
            @change=${(event: Event) => this.selectProject(event)}
          >
            ${this.projects.map((item) => html`<option value=${item.id} ?selected=${item.id === this.project?.id}>${item.name}</option>`)}
          </select>
          ${this.project?.path
            ? html`<span class="break-all text-xs text-muted-foreground">${this.project.path}</span>`
            : null}
        </div>

        <label class="grid max-w-xl gap-1.5 text-sm">
          <span class="inline-flex items-center gap-1.5 text-foreground">
            ${t('commandDirectories')}
            <quickforge-info-tip .label=${t('commandDirectoryHelp')}></quickforge-info-tip>
          </span>
          <textarea
            class="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
            .value=${this.commandDir}
            placeholder=${t('commandDirectoryPlaceholder')}
            @input=${(event: Event) => this.updateCommandDir((event.target as HTMLTextAreaElement).value)}
          ></textarea>
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

        <div class="flex flex-wrap items-center gap-3">
          <button
            class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60"
            type="button"
            ?disabled=${this.saving}
            @click=${() => this.save()}
          >
            ${this.saving ? t('saving') : t('save')}
          </button>
          ${this.saved ? html`<span class="text-sm text-muted-foreground">${t('projectCommandsSaved')}</span>` : null}
          ${this.message ? html`<span class="text-sm text-muted-foreground">${this.message}</span>` : null}
          ${this.error ? html`<span class="text-sm text-destructive">${this.error}</span>` : null}
        </div>

        <section class="rounded-lg border border-border p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 class="text-sm font-semibold text-foreground">
              ${t('loadedCommands', { count: this.commands.length })}
            </h4>
            <div class="flex items-center gap-2">
              <button
                class="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/50 disabled:opacity-60"
                type="button"
                ?disabled=${this.loadingCommands}
                @click=${() => this.openCommandDir()}
              >
                ${t('openCommandDir')}
              </button>
              <button
                class="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                type="button"
                ?disabled=${this.loadingCommands}
                @click=${() => this.createCommand()}
              >
                ${t('createCommand')}
              </button>
            </div>
          </div>

          ${this.loadingCommands
            ? html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
            : this.commands.length === 0
              ? html`<p class="text-sm text-muted-foreground">${t('noCommandsLoaded')}</p>`
              : html`<ul class="grid gap-2">
                  ${this.commands.map((command) => {
                    const hint = command.argumentHint ? ` ${command.argumentHint}` : ''
                    return html`
                      <li class="grid gap-0.5 text-sm">
                        <span class="text-foreground">
                          <code class="text-xs">/${command.name}${hint}</code>
                          ${command.description ? html` — <span class="text-muted-foreground">${command.description}</span>` : null}
                        </span>
                        ${command.relativePath ? html`<span class="text-xs text-muted-foreground">${command.relativePath}</span>` : null}
                      </li>
                    `
                  })}
                </ul>`}
        </section>
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

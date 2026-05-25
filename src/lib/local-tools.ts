import { registerToolRenderer } from '@mariozechner/pi-web-ui'
import { html, nothing } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import { t, type AppTextKey } from '@/lib/i18n'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { extractQuickForgeTiming, type QuickForgeToolTiming } from '@/lib/tool-execution-events'

type ToolResultLike = {
  isError?: boolean
  content?: Array<{ type: string; text?: string }>
  details?: unknown
}

type ToolStatusKey = 'running' | 'done' | 'error' | 'called'

type ToolDiffDetails = {
  format?: string
  path?: string
  addedLines?: number
  removedLines?: number
  oldLineCount?: number
  newLineCount?: number
  truncated?: boolean
  text?: string
}

const DIFF_BLOCK_STYLE = {
  maxHeight: '28rem',
  overflow: 'auto',
  border: '1px solid color-mix(in oklab, var(--border) 75%, transparent)',
  borderRadius: '0.75rem',
  background: 'color-mix(in oklab, var(--muted) 28%, transparent)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: '0.78rem',
  lineHeight: '1.45',
}
const DIFF_LINE_BASE_STYLE = {
  minHeight: '1.35em',
  padding: '0 0.75rem',
  whiteSpace: 'pre',
}
const DIFF_BADGE_BASE_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '999px',
  padding: '0.05rem 0.45rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: '0.72rem',
  fontWeight: '650',
}

function stringifyValue(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
  }
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function resultText(result: ToolResultLike | undefined) {
  return result?.content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n') ?? ''
}

function summarizeParams(toolName: string, params: Record<string, unknown> | undefined) {
  if (!params) return ''
  if (toolName === 'run_command' && typeof params.command === 'string') return params.command
  if (toolName === 'activate_skill' && typeof params.name === 'string') return params.name
  if (toolName === 'read_skill_resource' && typeof params.path === 'string') return params.path
  if ('path' in params && typeof params.path === 'string') return params.path
  if ('query' in params && typeof params.query === 'string') return params.query
  return ''
}

function getDiffDetails(details: unknown): ToolDiffDetails | undefined {
  if (!details || typeof details !== 'object') return undefined
  const diff = (details as { diff?: unknown }).diff
  if (!diff || typeof diff !== 'object') return undefined
  const candidate = diff as ToolDiffDetails
  return typeof candidate.text === 'string' ? candidate : undefined
}

function detailsWithoutDiffText(details: unknown) {
  if (!details || typeof details !== 'object') return details
  const record = details as Record<string, unknown>
  const diff = record.diff
  if (!diff || typeof diff !== 'object') return details
  const { text: _text, ...diffSummary } = diff as Record<string, unknown>
  void _text
  return {
    ...record,
    diff: diffSummary,
  }
}

function runtimeIdsFromDetails(details: unknown) {
  if (!details || typeof details !== 'object') return {}
  const record = details as Record<string, unknown>
  return {
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
  }
}

async function terminateCommand(sessionId: string, toolCallId: string, button: HTMLButtonElement) {
  const originalText = button.textContent || t('terminateCommand')
  button.disabled = true
  button.textContent = t('commandTerminateRequested')
  try {
    const response = await fetch(`/api/agents/${encodeURIComponent(sessionId)}/abort-tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolCallId }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } catch {
    button.disabled = false
    button.textContent = originalText
  }
}

function diffLineClass(line: string) {
  if (line.startsWith('+++') || line.startsWith('---')) return 'quickforge-diff-file'
  if (line.startsWith('@@')) return 'quickforge-diff-hunk'
  if (line.startsWith('+')) return 'quickforge-diff-add'
  if (line.startsWith('-')) return 'quickforge-diff-del'
  return 'quickforge-diff-context'
}

function diffLineStyle(line: string) {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return {
      ...DIFF_LINE_BASE_STYLE,
      background: 'color-mix(in oklab, var(--muted) 48%, transparent)',
      color: 'color-mix(in oklab, var(--muted-foreground) 88%, transparent)',
    }
  }
  if (line.startsWith('@@')) {
    return {
      ...DIFF_LINE_BASE_STYLE,
      background: 'color-mix(in oklab, rgb(37 99 235) 10%, transparent)',
      color: 'rgb(37 99 235)',
    }
  }
  if (line.startsWith('+')) {
    return {
      ...DIFF_LINE_BASE_STYLE,
      background: 'color-mix(in oklab, rgb(34 197 94) 16%, transparent)',
      color: 'rgb(22 101 52)',
    }
  }
  if (line.startsWith('-')) {
    return {
      ...DIFF_LINE_BASE_STYLE,
      background: 'color-mix(in oklab, rgb(239 68 68) 14%, transparent)',
      color: 'rgb(153 27 27)',
    }
  }
  return {
    ...DIFF_LINE_BASE_STYLE,
    color: 'var(--foreground)',
  }
}

function renderDiff(diff: ToolDiffDetails) {
  const lines = diff.text?.split('\n') ?? []
  const addedLines = Number(diff.addedLines ?? 0)
  const removedLines = Number(diff.removedLines ?? 0)

  return html`
    <div>
      <div class="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span>Diff</span>
        <span
          class="quickforge-diff-badge quickforge-diff-badge-add"
          style=${styleMap({
            ...DIFF_BADGE_BASE_STYLE,
            background: 'color-mix(in oklab, rgb(34 197 94) 16%, transparent)',
            color: 'rgb(22 101 52)',
          })}
        >+${addedLines}</span>
        <span
          class="quickforge-diff-badge quickforge-diff-badge-del"
          style=${styleMap({
            ...DIFF_BADGE_BASE_STYLE,
            background: 'color-mix(in oklab, rgb(239 68 68) 14%, transparent)',
            color: 'rgb(153 27 27)',
          })}
        >-${removedLines}</span>
        ${diff.truncated ? html`<span class="text-muted-foreground/80">truncated</span>` : nothing}
      </div>
      <div class="quickforge-diff-block" style=${styleMap(DIFF_BLOCK_STYLE)}>${lines.map((line) => html`
        <div class=${diffLineClass(line)} style=${styleMap(diffLineStyle(line))}>${line || ' '}</div>
      `)}</div>
    </div>
  `
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`

  const seconds = ms / 1000
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.round(seconds)}s`

  const minutes = Math.floor(seconds / 60)
  const restSeconds = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}m ${restSeconds}s`
}

function elapsedMsFromTiming(timing: QuickForgeToolTiming | undefined) {
  if (!timing) return undefined
  if (typeof timing.durationMs === 'number') return timing.durationMs
  if (typeof timing.startedAt === 'number') return Date.now() - timing.startedAt
  return undefined
}

class QuickForgeElapsedTime extends HTMLElement {
  private timer: ReturnType<typeof setInterval> | undefined

  connectedCallback() {
    this.render()
    if (this.getAttribute('running') === 'true') {
      this.timer = setInterval(() => this.render(), 500)
    }
  }

  disconnectedCallback() {
    if (this.timer) clearInterval(this.timer)
  }

  private render() {
    const durationMs = Number(this.getAttribute('duration-ms'))
    const startedAt = Number(this.getAttribute('started-at'))
    const ms = Number.isFinite(durationMs) && durationMs >= 0
      ? durationMs
      : Number.isFinite(startedAt) && startedAt > 0
        ? Date.now() - startedAt
        : 0
    this.textContent = formatDuration(ms)
  }
}

if (!customElements.get('quickforge-elapsed-time')) {
  customElements.define('quickforge-elapsed-time', QuickForgeElapsedTime)
}

function renderTiming(timing: QuickForgeToolTiming | undefined, status: ToolStatusKey) {
  const elapsedMs = elapsedMsFromTiming(timing)
  if (elapsedMs === undefined) return nothing
  return html`
    <quickforge-elapsed-time
      class="text-xs text-muted-foreground/70"
      started-at=${String(timing?.startedAt ?? '')}
      duration-ms=${typeof timing?.durationMs === 'number' ? String(timing.durationMs) : ''}
      running=${String(status === 'running')}
    ></quickforge-elapsed-time>
  `
}

function toolIconClass() {
  return 'text-emerald-600 dark:text-emerald-500'
}

function renderToolIcon(toolName: string) {
  const className = `quickforge-tool-type-icon shrink-0 ${toolIconClass()}`

  if (toolName === 'edit_file') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>`
  if (toolName === 'write_file') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/></svg>`
  if (toolName === 'read_file') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`
  if (toolName === 'grep_files') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`
  if (toolName === 'read_skill_resource') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z"/></svg>`
  if (toolName === 'run_command') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>`
  if (toolName === 'activate_skill') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 2.1 8.5 8.5 2.1 9.9l6.4 1.4 1.4 6.4 1.4-6.4 6.4-1.4-6.4-1.4Z"/><path d="M19 15v4"/><path d="M21 17h-4"/></svg>`
  return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z"/></svg>`
}

function statusIconClass(status: ToolStatusKey) {
  if (status === 'error') return 'text-destructive'
  if (status === 'running') return 'text-primary animate-spin'
  if (status === 'done') return 'text-emerald-600 dark:text-emerald-500'
  return 'text-muted-foreground/70'
}

function renderStatusIcon(status: ToolStatusKey) {
  const className = `quickforge-tool-status-icon shrink-0 ${statusIconClass(status)}`
  const label = t(status)

  if (status === 'running') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label=${label}><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>`
  if (status === 'done') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label=${label}><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m9 11 3 3L22 4"/></svg>`
  if (status === 'error') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label=${label}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`
  return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label=${label}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>`
}

function renderStatus(status: ToolStatusKey, timing: QuickForgeToolTiming | undefined) {
  return html`
    <span class="shrink-0 inline-flex items-center gap-1.5" title=${t(status)}>
      ${renderStatusIcon(status)}${renderTiming(timing, status)}
    </span>
  `
}

function renderTerminateCommandButton(toolName: string, status: ToolStatusKey, details: unknown) {
  if (toolName !== 'run_command' || status !== 'running') return nothing
  const { sessionId, toolCallId } = runtimeIdsFromDetails(details)
  if (!sessionId || !toolCallId) return nothing
  return html`
    <button
      type="button"
      class="shrink-0 rounded-md border border-destructive/25 px-2 py-0.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
      title=${t('terminateCommandTitle')}
      @click=${(event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        void terminateCommand(sessionId, toolCallId, event.currentTarget as HTMLButtonElement)
      }}
    >${t('terminateCommand')}</button>
  `
}

// ---------------------------------------------------------------------------
// Tool renderers (UI display only)
// These map tool names to custom renderers so the ChatPanel shows input/output
// in a rich format (code blocks, console output, etc.) instead of raw JSON.
//
// Tool definitions (name, description, parameters) live ONLY on the server:
//   server/tools/definitions.mjs  — canonical source
//   GET /api/tools                — served as JSON
// ---------------------------------------------------------------------------

class LocalWorkspaceToolRenderer {
  private toolName: string
  private labelKey: AppTextKey

  constructor(toolName: string, labelKey: AppTextKey) {
    this.toolName = toolName
    this.labelKey = labelKey
  }

  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const status: ToolStatusKey = result?.isError ? 'error' : isStreaming ? 'running' : result ? 'done' : 'called'
    const timing = extractQuickForgeTiming(result?.details)
    const summary = summarizeParams(this.toolName, params)
    const toolDisplaySettings = getCachedToolDisplaySettings()
    const showToolDetails = toolDisplaySettings.showToolDetails
    const expandToolsByDefault = toolDisplaySettings.expandToolsByDefault
    const input = showToolDetails ? stringifyValue(params) : ''
    const output = resultText(result)
    const diff = getDiffDetails(result?.details)
    const details = showToolDetails ? stringifyValue(diff ? detailsWithoutDiffText(result?.details) : result?.details) : ''
    const variant = result?.isError ? 'error' : 'default'

    return {
      isCustom: false,
      content: html`
        <details class="group/tool" ?open=${expandToolsByDefault}>
          <summary class="flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
            <svg class="shrink-0 transition-transform group-open/tool:rotate-90" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
            ${renderToolIcon(this.toolName)}
            <span class="min-w-0 flex-1 truncate">${t(this.labelKey)}${summary ? html`<span class="text-muted-foreground/70"> · ${summary}</span>` : ''}</span>
            ${renderTerminateCommandButton(this.toolName, status, result?.details)}
            ${renderStatus(status, timing)}
          </summary>
          <div class="mt-3 space-y-3">
            ${input ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('input')}</div><code-block .code=${input} language="json"></code-block></div>` : ''}
            ${output ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('output')}</div>${this.toolName === 'run_command' ? html`<console-block .content=${output} .variant=${variant}></console-block>` : html`<code-block .code=${output} language="text"></code-block>`}</div>` : ''}
            ${diff ? renderDiff(diff) : ''}
            ${details ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('details')}</div><code-block .code=${details} language="json"></code-block></div>` : ''}
          </div>
        </details>
      `,
    }
  }
}

// Register renderers at import time
for (const [name, label] of [
  ['read_file', 'readFile'],
  ['grep_files', 'searchFiles'],
  ['write_file', 'writeFile'],
  ['edit_file', 'editFile'],
  ['run_command', 'runCommand'],
  ['activate_skill', 'activateSkill'],
  ['read_skill_resource', 'readSkillResource'],
] as Array<[string, AppTextKey]>) {
  registerToolRenderer(name, new LocalWorkspaceToolRenderer(name, label))
}

// Tool execution is entirely server-side. The ChatPanel never calls .execute()
// on client-side tools — it only reads state.tools for display purposes.
// Returning tool metadata is enough for the renderer to resolve names/labels.
export function getLocalWorkspaceTools(tools: unknown[] = []): AgentTool[] {
  return tools as AgentTool[]
}

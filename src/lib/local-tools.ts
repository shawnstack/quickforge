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
    .join('\\n') ?? ''
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
  const lines = diff.text?.split('\\n') ?? []
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
      <pre class="quickforge-diff-block" style=${styleMap(DIFF_BLOCK_STYLE)}>${lines.map((line) => html`
        <div class=${diffLineClass(line)} style=${styleMap(diffLineStyle(line))}>${line || ' '}</div>
      `)}</pre>
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
  if (elapsedMs === undefined) return ''
  return html`
    <span class="text-muted-foreground/70"> · </span>
    <quickforge-elapsed-time
      started-at=${String(timing?.startedAt ?? '')}
      duration-ms=${typeof timing?.durationMs === 'number' ? String(timing.durationMs) : ''}
      running=${String(status === 'running')}
    ></quickforge-elapsed-time>
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
            <svg class="shrink-0 ${status === 'error' ? 'text-destructive' : status === 'running' ? 'text-primary' : 'text-green-600 dark:text-green-500'}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 8 4 4-4 4"/><path d="M13 16h4"/><rect width="18" height="14" x="3" y="5" rx="2"/></svg>
            <span class="min-w-0 flex-1 truncate">${t(this.labelKey)}${summary ? html`<span class="text-muted-foreground/70"> · ${summary}</span>` : ''}</span>
            <span class="shrink-0 text-xs ${status === 'error' ? 'text-destructive' : status === 'running' ? 'text-primary' : 'text-muted-foreground'}">${t(status)}${renderTiming(timing, status)}</span>
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
  ['replace_in_files', 'replaceInFiles'],
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

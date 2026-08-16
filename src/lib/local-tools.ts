import { registerToolRenderer } from '@earendil-works/pi-web-ui'
import { html, LitElement, nothing } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import { t, type AppTextKey } from '@/lib/i18n'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { extractQuickForgeTiming, type QuickForgeToolTiming } from '@/lib/tool-execution-events'
import { artifactPreviewMode, type ArtifactKind } from '@/components/workspace/artifact-preview-utils'
import { formatManageGlobalMemoryOutput } from '@/lib/global-memory-tool-output'
import { generatedImageAssetUrl, parseGeneratedImageDetails } from '@/lib/generated-image-assets'
import {
  OPEN_SUBAGENT_RUN_EVENT,
  buildSubagentRunPayload,
  canOpenSubagentRunPayload,
  resolveSubagentRunPayloadForOpen,
  shouldPublishSubagentRunPayload,
  subagentRunBodyBlocks,
  subagentRunStore,
  type SubagentRunPayload,
} from '@/lib/subagent-run-detail'
import { decorateSubagentProcessBlocks } from '@/components/chat/panel-decoration'

type ToolResultLike = {
  toolCallId?: string
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
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace)',
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
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace)',
  fontSize: '0.72rem',
  fontWeight: '650',
}

function toolStatus(result: ToolResultLike | undefined, isStreaming?: boolean): ToolStatusKey {
  const details = isRecord(result?.details) ? result.details : undefined
  if (result?.isError || details?.aborted === true || details?.timedOut === true) return 'error'
  if (isStreaming) return 'running'
  return result ? 'done' : 'called'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function acpDisplayMetadata(params: Record<string, unknown> | undefined, details?: unknown) {
  const fromParams = isRecord(params?.__quickforgeAcp) ? params.__quickforgeAcp : undefined
  const detailRecord = isRecord(details) ? details : undefined
  const fromDetails = isRecord(detailRecord?.__quickforgeAcp) ? detailRecord.__quickforgeAcp : undefined
  return fromDetails ?? fromParams
}

function paramsWithoutInternalMetadata(params: Record<string, unknown> | undefined) {
  if (!params || !('__quickforgeAcp' in params)) return params
  const { __quickforgeAcp: _metadata, ...visible } = params
  void _metadata
  return visible
}

function detailsWithoutInternalMetadata(details: unknown) {
  if (!isRecord(details) || !('__quickforgeAcp' in details)) return details
  const { __quickforgeAcp: _metadata, ...visible } = details
  void _metadata
  return visible
}

function commandStatusFromDetails(details: Record<string, unknown>, isStreaming?: boolean) {
  if (details.running === true || isStreaming) return 'Status: running'
  const flags = [
    details.timedOut ? 'timed out' : null,
    details.aborted ? 'aborted' : null,
  ].filter(Boolean)
  const suffix = flags.length ? ` (${flags.join(', ')})` : ''
  const code = details.code ?? 'unknown'
  const signal = typeof details.signal === 'string' && details.signal ? `, signal: ${details.signal}` : ''
  return `Exit code: ${code}${signal}${suffix}`
}

function runCommandOutputFromDetails(params: Record<string, unknown> | undefined, details: unknown, isStreaming?: boolean) {
  const detailRecord = isRecord(details) ? details : undefined
  const command = typeof detailRecord?.command === 'string'
    ? detailRecord.command
    : typeof params?.command === 'string'
      ? params.command
      : ''
  if (!command || !detailRecord) return ''

  const stdout = typeof detailRecord?.stdout_preview === 'string'
    ? detailRecord.stdout_preview
    : typeof detailRecord?.stdout === 'string'
      ? detailRecord.stdout
      : ''
  const stderr = typeof detailRecord?.stderr_preview === 'string'
    ? detailRecord.stderr_preview
    : typeof detailRecord?.stderr === 'string'
      ? detailRecord.stderr
      : ''
  const hasOutput = Boolean(stdout || stderr)
  const hasStatus = detailRecord.running === true
    || detailRecord.code !== undefined
    || detailRecord.signal !== undefined
    || detailRecord.timedOut === true
    || detailRecord.aborted === true
  if (!hasOutput && !hasStatus && !isStreaming) return ''

  return [
    `Command: ${command}`,
    commandStatusFromDetails(detailRecord, isStreaming),
    '',
    'STDOUT:',
    stdout || '(empty)',
    '',
    'STDERR:',
    stderr || '(empty)',
  ].join('\n')
}

function toolOutputText(toolName: string, params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
  const output = resultText(result)
  if (toolName === 'manage_global_memory') {
    return formatManageGlobalMemoryOutput(result, isStreaming, t) || output
  }
  if (output) return output
  if (toolName === 'run_command') return runCommandOutputFromDetails(params, result?.details, isStreaming)
  return ''
}

function detailString(details: unknown, key: string) {
  return isRecord(details) && typeof details[key] === 'string' ? details[key] : ''
}

function summarizeParams(toolName: string, params: Record<string, unknown> | undefined, result?: ToolResultLike) {
  if (!params && !result?.details) return ''
  if (toolName === 'run_command' && typeof params?.command === 'string') return params.command
  if (toolName === 'generate_image') {
    const prompt = typeof params?.prompt === 'string' ? params.prompt.trim() : ''
    return prompt.length > 100 ? `${prompt.slice(0, 100)}…` : prompt
  }
  if (toolName === 'present_files') {
    const files = Array.isArray(params?.files) ? params.files : Array.isArray(result?.details && (result.details as Record<string, unknown>).files) ? (result?.details as Record<string, unknown>).files as unknown[] : []
    const paths = files.map((item) => typeof item === 'string' ? item : isRecord(item) && typeof item.path === 'string' ? item.path : '').filter(Boolean)
    return paths.length ? paths.slice(0, 3).join(', ') + (paths.length > 3 ? ` +${paths.length - 3}` : '') : ''
  }
  if (toolName === 'grep_files') {
    const query = typeof params?.query === 'string' && params.query
      ? params.query
      : detailString(result?.details, 'query')
    const path = typeof params?.path === 'string' && params.path
      ? params.path
      : detailString(result?.details, 'path') || '.'
    const regex = Boolean(params?.regex || (isRecord(result?.details) && isRecord(result.details.searchOptions) && result.details.searchOptions.regex))
    const mode = regex ? 'regex' : 'text'
    const scope = path && path !== '.' ? ` in ${path}` : ' in current workspace'
    return query ? `${mode}: ${query}${scope}` : `searching${scope}`
  }
  if (toolName === 'activate_skill' && typeof params?.name === 'string') return params.name
  if (toolName === 'read_skill_resource' && typeof params?.path === 'string') return params.path
  if (params && 'path' in params && typeof params.path === 'string') return params.path
  if (params && 'query' in params && typeof params.query === 'string') return params.query
  if (params && 'search_query' in params && typeof params.search_query === 'string') return params.search_query
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
  const originalLabel = button.getAttribute('aria-label') || t('terminateCommand')
  button.disabled = true
  button.setAttribute('aria-label', t('commandTerminateRequested'))
  button.setAttribute('title', t('commandTerminateRequested'))
  try {
    const response = await fetch(`/api/agents/${encodeURIComponent(sessionId)}/abort-tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolCallId }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } catch {
    button.disabled = false
    button.setAttribute('aria-label', originalLabel)
    button.setAttribute('title', t('terminateCommandTitle'))
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

function renderInlineDiffStats(toolName: string, diff: ToolDiffDetails | undefined) {
  if ((toolName !== 'write_file' && toolName !== 'edit_file') || !diff) return nothing

  const addedLines = Number(diff.addedLines ?? 0)
  const removedLines = Number(diff.removedLines ?? 0)

  return html`
    <span class="quickforge-tool-meta-hover shrink-0 inline-flex items-center gap-1" title="+${addedLines} -${removedLines}">
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
    </span>
  `
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

  static get observedAttributes() {
    return ['duration-ms', 'running', 'started-at']
  }

  connectedCallback() {
    this.render()
    this.syncTimer()
  }

  disconnectedCallback() {
    this.stopTimer()
  }

  attributeChangedCallback() {
    this.render()
    this.syncTimer()
  }

  private readNumberAttribute(name: string) {
    const value = this.getAttribute(name)
    if (value === null || value.trim() === '') return undefined
    const numberValue = Number(value)
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined
  }

  private syncTimer() {
    if (this.getAttribute('running') === 'true' && this.readNumberAttribute('duration-ms') === undefined) {
      if (!this.timer) this.timer = setInterval(() => this.render(), 500)
    } else {
      this.stopTimer()
    }
  }

  private stopTimer() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  private render() {
    const durationMs = this.readNumberAttribute('duration-ms')
    const startedAt = this.readNumberAttribute('started-at')
    const ms = durationMs !== undefined
      ? durationMs
      : startedAt !== undefined && startedAt > 0
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
      class="quickforge-tool-meta-hover text-xs text-muted-foreground/70"
      started-at=${String(timing?.startedAt ?? '')}
      duration-ms=${typeof timing?.durationMs === 'number' ? String(timing.durationMs) : ''}
      running=${String(status === 'running')}
    ></quickforge-elapsed-time>
  `
}

function toolIconClass() {
  return 'text-muted-foreground/60'
}

function renderToolIcon(toolName: string) {
  const className = `quickforge-tool-type-icon shrink-0 ${toolIconClass()}`

  if (toolName === 'manage_global_memory') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/></svg>`
  if (toolName === 'edit_file') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>`
  if (toolName === 'write_file') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/></svg>`
  if (toolName === 'read_file') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`
  if (toolName === 'grep_files') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`
  if (toolName === 'present_files') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M10 13.5 8 16l2 2.5"/><path d="m14 13.5 2 2.5-2 2.5"/></svg>`
  if (toolName === 'generate_image') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/><path d="m14 19.5-2-2a2 2 0 0 0-2.8 0L5.5 21"/></svg>`
  if (toolName === 'read_skill_resource') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z"/></svg>`
  if (toolName === 'run_command') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>`
  if (toolName === 'run_subagent') return html`<svg class=${className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`
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
  const metaClass = status === 'done' ? 'quickforge-tool-meta-hover' : 'quickforge-tool-meta-important'
  return html`
    <span class="${metaClass} shrink-0 inline-flex items-center gap-1.5" title=${t(status)}>
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
      class="shrink-0 inline-flex size-5 items-center justify-center text-foreground transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
      title=${t('terminateCommandTitle')}
      aria-label=${t('terminateCommandTitle')}
      @click=${(event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        void terminateCommand(sessionId, toolCallId, event.currentTarget as HTMLButtonElement)
      }}
    ><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.4"/></svg></button>
  `
}

// 对话流工具卡片是 Lit 渲染器（React 树之外），无法直接调用 React 的 openArtifactPreview。
// 通过 window CustomEvent 桥接：点击预览按钮 → 派发事件 → App.tsx 监听 → 复用现有预览逻辑。
export const PREVIEW_ARTIFACT_EVENT = 'quickforge:preview-artifact'

type PreviewableArtifact = {
  path: string
  kind?: ArtifactKind
}

function previewableArtifact(path: string, kind?: string): PreviewableArtifact | undefined {
  const normalizedKind = kind === 'html' || kind === 'image' || kind === 'markdown' || kind === 'code' || kind === 'unknown'
    ? kind
    : undefined
  return artifactPreviewMode(path, normalizedKind) ? { path, kind: normalizedKind } : undefined
}

// 从工具参数中解析出可展示的文件（若存在）。
// write_file/edit_file 取单个已知文件；present_files 按 defaultPreview 优先，
// 否则取第一个可在 Browser 或 Reader 中打开的文件。找不到则不渲染按钮。
function resolvePreviewableArtifact(toolName: string, params: Record<string, unknown> | undefined): PreviewableArtifact | undefined {
  if (toolName === 'write_file' || toolName === 'edit_file') {
    const path = params && 'path' in params && typeof params.path === 'string' ? params.path : ''
    return path ? previewableArtifact(path) : undefined
  }
  if (toolName === 'present_files') {
    const files = params && Array.isArray(params.files) ? params.files : []
    const entries = files
      .map((item) => {
        if (typeof item === 'string') return { path: item, kind: undefined }
        if (!isRecord(item) || typeof item.path !== 'string') return undefined
        return {
          path: item.path,
          kind: typeof item.kind === 'string' ? item.kind : undefined,
        }
      })
      .filter((entry): entry is { path: string; kind: string | undefined } => Boolean(entry))
    const defaultPreview = params && typeof params.defaultPreview === 'string' ? params.defaultPreview : ''
    const defaultEntry = entries.find((entry) => entry.path === defaultPreview)
    if (defaultEntry) {
      const artifact = previewableArtifact(defaultEntry.path, defaultEntry.kind)
      if (artifact) return artifact
    }
    for (const entry of entries) {
      const artifact = previewableArtifact(entry.path, entry.kind)
      if (artifact) return artifact
    }
  }
  return undefined
}

function renderPreviewButton(toolName: string, params: Record<string, unknown> | undefined) {
  const artifact = resolvePreviewableArtifact(toolName, params)
  if (!artifact) return nothing
  return html`
    <button
      type="button"
      class="shrink-0 inline-flex size-5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      title=${t('previewArtifact')}
      aria-label=${t('previewArtifact')}
      @click=${(event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        window.dispatchEvent(new CustomEvent(PREVIEW_ARTIFACT_EVENT, { detail: artifact }))
      }}
    ><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></button>
  `
}

const toolDetailsOpen = new Map<string, boolean>()
const MAX_TOOL_DETAILS_OPEN_ENTRIES = 200

function rememberToolDetailsOpen(key: string, open: boolean) {
  if (!key) return
  if (!toolDetailsOpen.has(key) && toolDetailsOpen.size >= MAX_TOOL_DETAILS_OPEN_ENTRIES) {
    const oldestKey = toolDetailsOpen.keys().next().value
    if (oldestKey) toolDetailsOpen.delete(oldestKey)
  }
  toolDetailsOpen.set(key, open)
}

function toolDetailsStateKey(toolName: string, params: Record<string, unknown> | undefined, details: unknown) {
  const { toolCallId } = runtimeIdsFromDetails(details)
  return toolCallId || `${toolName}:${stringifyValue(params)}`
}

// ---------------------------------------------------------------------------
// subagent 运行详情：聊天摘要点击后在 Workspace Inspector Tab 中打开。
// 数据由 buildSubagentRunPayload 构建；ServerAgent 的 tool_execution_* SSE 是实时发布主通道，
// renderer 仅回填 canonical 首次快照或以恢复终态修正已有非终态快照；
// 运行详情 Tab 通过 subagent-run-detail-body 复用 renderSubagentRunBody；
// 聊天内不再展开重复展示完整过程。
// ---------------------------------------------------------------------------

function renderSubagentRunSummary(payload: SubagentRunPayload) {
  const canOpen = canOpenSubagentRunPayload(payload)
  const title = canOpen ? t('viewSubagentRunDetails') : payload.statusLabel
  return html`
    <div class="quickforge-subagent-tool">
      <button
        type="button"
        class="quickforge-tool-summary flex w-full cursor-pointer list-none items-center gap-2 text-left text-sm text-muted-foreground select-none disabled:cursor-not-allowed disabled:opacity-70"
        title=${title}
        aria-label=${`${payload.statusLabel} · ${title}`}
        aria-disabled=${String(!canOpen)}
        ?disabled=${!canOpen}
        @click=${() => {
          if (!canOpen) return
          // canonical 运行可取 SSE store 的最新同 ID 快照；历史 fallback 必须使用当前消息载荷。
          const payloadForOpen = resolveSubagentRunPayloadForOpen(payload, subagentRunStore.get(payload.runId))
          window.dispatchEvent(new CustomEvent(OPEN_SUBAGENT_RUN_EVENT, { detail: { runId: payloadForOpen.runId, payload: payloadForOpen } }))
        }}
      >
        ${renderToolIcon('run_subagent')}
        <span class="quickforge-subagent-title min-w-0">
          <span class="quickforge-subagent-label">${payload.statusLabel}</span>
          ${renderStatus(payload.status, payload.timing)}
        </span>
      </button>
    </div>
  `
}

/**
 * 唯一 subagent 运行详情模板，由 Workspace Inspector 的运行 Tab 使用。
 * 展示层级与顺序遵循 subagentRunBodyBlocks（与 Git 历史最终态的聊天内展示一致）：
 * task/context/expectedOutput → detailed 摘要 → trace → 无 trace 时 output → input/details。
 */
export function renderSubagentRunBody(payload: SubagentRunPayload) {
  const bodyBlocks = new Set(subagentRunBodyBlocks(payload))
  const pendingToolCalls = new Set(payload.pendingToolCalls)
  return html`
    <div class="mt-3 space-y-3">
      ${bodyBlocks.has('task') ? html`<div class="quickforge-subagent-task space-y-1 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground/70">
        ${payload.task ? html`<div><span class="font-medium text-foreground/75">${t('subagentTask')}:</span> ${payload.task}</div>` : nothing}
        ${payload.context ? html`<div><span class="font-medium text-foreground/75">${t('subagentContext')}:</span> ${payload.context}</div>` : nothing}
        ${payload.expectedOutput ? html`<div><span class="font-medium text-foreground/75">${t('subagentExpectedOutput')}:</span> ${payload.expectedOutput}</div>` : nothing}
      </div>` : nothing}
      ${bodyBlocks.has('summary') ? html`<div class="quickforge-subagent-summary rounded-lg border border-border/75 bg-muted/20 px-3 py-2.5 text-sm">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span class="font-medium text-foreground/85">${payload.label}</span>
          ${payload.toolCalls !== undefined ? html`<span>${t('subagentToolCalls')}: ${payload.toolCalls}</span>` : nothing}
          ${payload.timing ? html`<span>${renderTiming(payload.timing, payload.status)}</span>` : nothing}
        </div>
        ${payload.allowedTools.length > 0 ? html`<div class="mt-2 flex flex-wrap gap-1.5">${payload.allowedTools.map((tool) => html`<span class="rounded-full bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground/80">${tool}</span>`)}</div>` : nothing}
      </div>` : nothing}
      ${bodyBlocks.has('trace') ? html`<div class="quickforge-subagent-trace rounded-lg border border-border bg-background/60 p-2.5"><message-list data-quickforge-subagent-process="true" data-quickforge-subagent-streaming=${String(payload.status === 'running')} .messages=${payload.traceMessages} .tools=${payload.tools} .pendingToolCalls=${pendingToolCalls} .isStreaming=${false}></message-list></div>` : nothing}
      ${bodyBlocks.has('output') ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('subagentResult')}</div><code-block .code=${payload.output} language="text"></code-block></div>` : nothing}
      ${bodyBlocks.has('input') ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('input')}</div><code-block .code=${payload.input} language="json"></code-block></div>` : nothing}
      ${bodyBlocks.has('details') ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('details')}</div><code-block .code=${payload.details} language="json"></code-block></div>` : nothing}
    </div>
  `
}

/**
 * Workspace Inspector 的 subagent Tab 通过它复用 renderSubagentRunBody。
 * 渲染到 light DOM（createRenderRoot 返回 this），保证全局样式与内联卡片一致。
 *
 * 每次渲染后复用聊天的 decorateSubagentProcessBlocks，对内部
 * message-list[data-quickforge-subagent-process] 应用与聊天内一致的
 * process folding / 过程分组装饰与交互：首次挂载、payload 实时更新、
 * 运行状态变化（streaming 标志变化）都会重新装饰；装饰幂等且基于
 * 元素持有的处理器，卸载即随 DOM 一起回收，无需额外监听器清理。
 */
export class SubagentRunDetailBodyElement extends LitElement {
  static properties = {
    payload: { attribute: false },
  }

  payload?: SubagentRunPayload

  /** 防止连续更新叠加多次装饰；更新期间若又渲染，则在当前轮结束后补跑一次。 */
  private __processDecorationScheduled = false
  private __processDecorationPending = false
  private __processDecorationDisposed = false

  createRenderRoot() {
    return this
  }

  connectedCallback() {
    super.connectedCallback?.()
    this.__processDecorationDisposed = false
  }

  disconnectedCallback() {
    this.__processDecorationDisposed = true
    super.disconnectedCallback?.()
  }

  render() {
    if (!this.payload) return html`<div class="rounded-lg border border-border bg-background/60 px-3 py-6 text-center text-sm text-muted-foreground/70">${t('subagentRunEmpty')}</div>`
    return renderSubagentRunBody(this.payload)
  }

  updated() {
    this.scheduleProcessDecoration()
  }

  /** 等 Lit 与 message-list 自身渲染完成后，对最新 DOM 执行一次过程装饰。 */
  private scheduleProcessDecoration() {
    if (this.__processDecorationDisposed) return
    if (this.__processDecorationScheduled) {
      this.__processDecorationPending = true
      return
    }
    this.__processDecorationScheduled = true
    void (async () => {
      try {
        await this.updateComplete
        if (this.__processDecorationDisposed || !this.isConnected) return
        const messageList = this.querySelector<HTMLElement & { updateComplete?: Promise<unknown> }>(
          'message-list[data-quickforge-subagent-process="true"]',
        )
        const messageListUpdate = messageList?.updateComplete
        if (messageListUpdate) await messageListUpdate
        if (this.__processDecorationDisposed || !this.isConnected) return
        decorateSubagentProcessBlocks(this)
      } catch {
        // 装饰失败不应影响详情展示（与聊天侧 decorateMessages 的容错一致）。
      } finally {
        this.__processDecorationScheduled = false
        if (this.__processDecorationPending && !this.__processDecorationDisposed) {
          this.__processDecorationPending = false
          this.scheduleProcessDecoration()
        }
      }
    })()
  }
}

if (!customElements.get('subagent-run-detail-body')) {
  customElements.define('subagent-run-detail-body', SubagentRunDetailBodyElement)
}

class SubagentToolRenderer {
  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const toolDisplaySettings = getCachedToolDisplaySettings()
    const payload = buildSubagentRunPayload(params, result, isStreaming, toolDisplaySettings.toolDisplayMode, t, result?.toolCallId)
    // renderer 仅发布 canonical 安全快照：首次可回填；若 SSE 快照仍是非终态，恢复出的
    // done/error 可修正它；其余已有快照不覆盖，保持 SSE 实时路径权威。
    const existing = subagentRunStore.get(payload.runId)
    if (shouldPublishSubagentRunPayload(payload, existing)) subagentRunStore.publish(payload)

    return {
      isCustom: false,
      content: renderSubagentRunSummary(payload),
    }
  }
}

class GenerateImageToolRenderer {
  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const status = toolStatus(result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const details = parseGeneratedImageDetails(result?.details)
    const summary = summarizeParams('generate_image', params, result)
    const output = resultText(result)
    const model = details?.model || (typeof params?.model === 'string' ? params.model : '')

    return {
      isCustom: true,
      content: html`
        <div class="quickforge-generated-image-tool space-y-3">
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            ${renderToolIcon('generate_image')}
            <span class="min-w-0 flex-1 truncate">${t('generateImage')}${summary ? html`<span class="text-muted-foreground/70"> · ${summary}</span>` : nothing}</span>
            ${renderStatus(status, timing)}
          </div>
          ${details ? html`
            <div class=${details.assets.length > 1 ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : 'grid grid-cols-1 gap-3'}>
              ${details.assets.map((asset, index) => {
                const url = generatedImageAssetUrl(details, asset)
                const label = t('generatedImageAlt', { index: index + 1 })
                return html`
                  <figure class="overflow-hidden rounded-lg border border-border bg-background/60">
                    <a href=${url} target="_blank" rel="noopener noreferrer" title=${t('openGeneratedImage')} aria-label=${t('openGeneratedImage')}>
                      <img class="block max-h-[32rem] w-full object-contain" src=${url} alt=${label} loading="lazy" referrerpolicy="no-referrer" />
                    </a>
                    <figcaption class="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                      <span class="min-w-0 flex-1 truncate">${model || asset.mimeType}</span>
                      <a class="text-muted-foreground transition-colors hover:text-foreground" href=${url} download=${asset.assetId} title=${t('downloadGeneratedImage')} aria-label=${t('downloadGeneratedImage')}>${t('downloadGeneratedImage')}</a>
                    </figcaption>
                  </figure>
                `
              })}
            </div>
            ${details.text ? html`<div class="text-sm leading-relaxed text-muted-foreground">${details.text}</div>` : nothing}
          ` : status === 'running' ? html`
            <div class="rounded-lg border border-border bg-background/60 px-3 py-6 text-center text-sm text-muted-foreground">${t('generatingImage')}</div>
          ` : output ? html`<code-block .code=${output} language="text"></code-block>` : nothing}
        </div>
      `,
    }
  }
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
    const status = toolStatus(result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const visibleParams = paramsWithoutInternalMetadata(params)
    const visibleDetails = detailsWithoutInternalMetadata(result?.details)
    const acpMetadata = acpDisplayMetadata(params, result?.details)
    const acpTitle = typeof acpMetadata?.title === 'string' && acpMetadata.title
      ? acpMetadata.title
      : typeof acpMetadata?.kind === 'string' ? acpMetadata.kind : ''
    const acpKind = typeof acpMetadata?.kind === 'string' && acpMetadata.kind !== acpTitle ? acpMetadata.kind : ''
    const summary = summarizeParams(this.toolName, visibleParams, result)
    const toolDisplaySettings = getCachedToolDisplaySettings()
    const detailed = toolDisplaySettings.toolDisplayMode === 'detailed'
    const input = detailed ? stringifyValue(visibleParams) : ''
    const output = toolOutputText(this.toolName, visibleParams, result, isStreaming)
    const diff = getDiffDetails(visibleDetails)
    const details = detailed ? stringifyValue(diff ? detailsWithoutDiffText(visibleDetails) : visibleDetails) : ''
    const detailsKey = toolDetailsStateKey(this.toolName, visibleParams, result?.details)
    const detailsOpen = toolDetailsOpen.get(detailsKey) ?? detailed
    const variant = result?.isError ? 'error' : 'default'

    return {
      // QuickForge process rows are intentionally borderless. Rendering as
      // custom content prevents pi-web-ui from adding its default tool card
      // before the DOM decoration pass moves the tool into the Process group.
      isCustom: true,
      content: html`
        <div class="quickforge-local-tool-shell">
          <details class="group/tool quickforge-local-tool" ?open=${detailsOpen} @toggle=${(event: Event) => {
            if (event.isTrusted) rememberToolDetailsOpen(detailsKey, (event.currentTarget as HTMLDetailsElement).open)
          }}>
            <summary class="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
              ${renderToolIcon(this.toolName)}
              <span class="quickforge-tool-title min-w-0">
                <span class="quickforge-tool-label">${acpTitle ? html`OpenCode<span class="quickforge-tool-summary-detail text-muted-foreground/70"> · ${acpTitle}${acpKind ? `/${acpKind}` : ''}</span>` : t(this.labelKey)}${summary ? html`<span class="quickforge-tool-summary-detail text-muted-foreground/70"> · ${summary}</span>` : ''}</span>
                <svg class="quickforge-tool-chevron shrink-0 group-open/tool:rotate-90" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                ${renderInlineDiffStats(this.toolName, diff)}
                ${renderStatus(status, timing)}
              </span>
            </summary>
            <div class="mt-3 space-y-3">
              ${input ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('input')}</div><code-block .code=${input} language="json"></code-block></div>` : ''}
              ${output ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('output')}</div>${this.toolName === 'run_command' ? html`<console-block .content=${output} .variant=${variant}></console-block>` : html`<code-block .code=${output} language="text"></code-block>`}</div>` : ''}
              ${diff ? renderDiff(diff) : ''}
              ${details ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('details')}</div><code-block .code=${details} language="json"></code-block></div>` : ''}
            </div>
          </details>
          <span class="quickforge-tool-actions inline-flex shrink-0 items-center gap-1">
            ${renderPreviewButton(this.toolName, visibleParams)}
            ${renderTerminateCommandButton(this.toolName, status, result?.details)}
          </span>
        </div>
      `,
    }
  }
}

class OpenCodeToolRenderer {
  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const status = toolStatus(result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const metadata = acpDisplayMetadata(params, result?.details)
    const title = typeof metadata?.title === 'string' && metadata.title
      ? metadata.title
      : typeof metadata?.kind === 'string' && metadata.kind
        ? metadata.kind
        : 'tool'
    const kind = typeof metadata?.kind === 'string' && metadata.kind && metadata.kind !== title ? metadata.kind : ''
    const visibleParams = paramsWithoutInternalMetadata(params)
    const visibleDetails = detailsWithoutInternalMetadata(result?.details)
    const toolDisplaySettings = getCachedToolDisplaySettings()
    const detailed = toolDisplaySettings.toolDisplayMode === 'detailed'
    const input = detailed ? stringifyValue(visibleParams) : ''
    const output = resultText(result)
    const diff = getDiffDetails(visibleDetails)
    const details = detailed ? stringifyValue(diff ? detailsWithoutDiffText(visibleDetails) : visibleDetails) : ''
    const detailsKey = toolDetailsStateKey('opencode_tool', visibleParams, result?.details)
    const detailsOpen = toolDetailsOpen.get(detailsKey) ?? detailed

    return {
      isCustom: true,
      content: html`
        <div class="quickforge-local-tool-shell quickforge-opencode-tool-shell">
          <details class="group/tool quickforge-local-tool quickforge-opencode-tool" ?open=${detailsOpen} @toggle=${(event: Event) => {
            if (event.isTrusted) rememberToolDetailsOpen(detailsKey, (event.currentTarget as HTMLDetailsElement).open)
          }}>
            <summary class="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
              ${renderToolIcon('opencode_tool')}
              <span class="quickforge-tool-title min-w-0">
                <span class="quickforge-tool-label">OpenCode<span class="quickforge-tool-summary-detail text-muted-foreground/70"> · ${title}${kind ? `/${kind}` : ''}</span></span>
                <svg class="quickforge-tool-chevron shrink-0 group-open/tool:rotate-90" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                ${renderStatus(status, timing)}
              </span>
            </summary>
            <div class="mt-3 space-y-3">
              ${input ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('input')}</div><code-block .code=${input} language="json"></code-block></div>` : nothing}
              ${output ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('output')}</div><code-block .code=${output} language=${outputLanguageFromText(output)}></code-block></div>` : nothing}
              ${diff ? renderDiff(diff) : nothing}
              ${details ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('details')}</div><code-block .code=${details} language="json"></code-block></div>` : nothing}
            </div>
          </details>
        </div>
      `,
    }
  }
}

function parseMcpToolName(toolName: string) {
  if (!toolName.startsWith('mcp__')) return null
  const rest = toolName.slice('mcp__'.length)
  const separatorIndex = rest.indexOf('__')
  if (separatorIndex <= 0 || separatorIndex >= rest.length - 2) return null
  return {
    serverName: rest.slice(0, separatorIndex),
    toolName: rest.slice(separatorIndex + 2),
  }
}

function mcpToolInfo(toolName: string, details: unknown) {
  const parsed = parseMcpToolName(toolName)
  const detailRecord = isRecord(details) ? details : undefined
  const serverName = typeof detailRecord?.server === 'string' && detailRecord.server
    ? detailRecord.server
    : parsed?.serverName ?? ''
  const originalToolName = typeof detailRecord?.tool === 'string' && detailRecord.tool
    ? detailRecord.tool
    : parsed?.toolName ?? toolName
  return parsed || detailRecord?.mcp === true
    ? { serverName, toolName: originalToolName }
    : null
}

function outputLanguageFromText(text: string) {
  if (!text) return 'text'
  try {
    JSON.parse(text)
    return 'json'
  } catch {
    return 'text'
  }
}

class McpToolRenderer {
  private toolName: string
  private label?: string

  constructor(toolName: string, label?: string) {
    this.toolName = toolName
    this.label = label
  }

  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const status = toolStatus(result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const info = mcpToolInfo(this.toolName, result?.details) ?? parseMcpToolName(this.toolName)
    const serverName = info?.serverName ?? ''
    const originalToolName = info?.toolName ?? this.toolName
    const summary = summarizeParams(this.toolName, params, result)
    const toolDisplaySettings = getCachedToolDisplaySettings()
    const detailed = toolDisplaySettings.toolDisplayMode === 'detailed'
    const input = detailed ? stringifyValue(params) : ''
    const output = toolOutputText(this.toolName, params, result, isStreaming)
    const details = detailed ? stringifyValue(result?.details) : ''
    const detailsKey = toolDetailsStateKey(this.toolName, params, result?.details)
    const detailsOpen = toolDetailsOpen.get(detailsKey) ?? detailed
    const title = this.label && this.label !== originalToolName
      ? `${this.label} (${originalToolName})`
      : originalToolName

    return {
      isCustom: false,
      content: html`
        <details class="group/tool quickforge-mcp-tool" ?open=${detailsOpen} @toggle=${(event: Event) => {
          if (event.isTrusted) rememberToolDetailsOpen(detailsKey, (event.currentTarget as HTMLDetailsElement).open)
        }}>
          <summary class="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
            ${renderToolIcon(this.toolName)}
            <span class="quickforge-tool-title min-w-0">
              <span class="quickforge-tool-label">MCP${serverName ? html`<span class="quickforge-tool-summary-detail text-muted-foreground/70"> · ${serverName}</span>` : nothing}<span class="quickforge-tool-summary-detail text-muted-foreground/70"> · ${title}</span>${summary ? html`<span class="quickforge-tool-summary-detail text-muted-foreground/70"> · ${summary}</span>` : nothing}</span>
              <svg class="quickforge-tool-chevron shrink-0 group-open/tool:rotate-90" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
              ${renderStatus(status, timing)}
            </span>
          </summary>
          <div class="mt-3 space-y-3">
            ${input ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('input')}</div><code-block .code=${input} language="json"></code-block></div>` : nothing}
            ${output ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('output')}</div><code-block .code=${output} language=${outputLanguageFromText(output)}></code-block></div>` : nothing}
            ${details ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('details')}</div><code-block .code=${details} language="json"></code-block></div>` : nothing}
          </div>
        </details>
      `,
    }
  }
}

const registeredMcpToolRenderers = new Set<string>()

function registerMcpToolRenderers(tools: unknown[]) {
  for (const tool of tools) {
    if (!isRecord(tool) || typeof tool.name !== 'string') continue
    if (!parseMcpToolName(tool.name) || registeredMcpToolRenderers.has(tool.name)) continue
    const label = typeof tool.label === 'string'
      ? tool.label
      : typeof tool.description === 'string'
        ? tool.description.replace(/^\[MCP:[^\]]+\]\s*/, '')
        : undefined
    registerToolRenderer(tool.name, new McpToolRenderer(tool.name, label))
    registeredMcpToolRenderers.add(tool.name)
  }
}

// Register renderers at import time
for (const [name, label] of [
  ['manage_global_memory', 'manageGlobalMemory'],
  ['read_file', 'readFile'],
  ['grep_files', 'searchFiles'],
  ['write_file', 'writeFile'],
  ['edit_file', 'editFile'],
  ['run_command', 'runCommand'],
  ['present_files', 'presentFiles'],
  ['activate_skill', 'activateSkill'],
  ['read_skill_resource', 'readSkillResource'],
] as Array<[string, AppTextKey]>) {
  registerToolRenderer(name, new LocalWorkspaceToolRenderer(name, label))
}

registerToolRenderer('run_subagent', new SubagentToolRenderer())
registerToolRenderer('generate_image', new GenerateImageToolRenderer())
registerToolRenderer('opencode_tool', new OpenCodeToolRenderer())

// Tool execution is entirely server-side. The ChatPanel never calls .execute()
// on client-side tools — it only reads state.tools for display purposes.
// Returning tool metadata is enough for the renderer to resolve names/labels.
export function getLocalWorkspaceTools(tools: unknown[] = []): AgentTool[] {
  registerMcpToolRenderers(tools)
  return tools as AgentTool[]
}

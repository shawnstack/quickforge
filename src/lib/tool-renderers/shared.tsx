/* eslint-disable react-refresh/only-export-components -- exports React node factories and shared helpers consumed by the tool renderer modules. */
import { createElement, Fragment, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { Check, Copy } from 'lucide-react'
import { t } from '@/lib/i18n'
import { HIGHLIGHT_TOKEN_CLASSES, highlightCode } from '@/lib/code-highlight'
import { copyTextToClipboard } from '@/lib/message-utils'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import { type QuickForgeToolTiming } from '@/lib/tool-execution-events'
import { artifactFileName, artifactPreviewMode, type ArtifactKind } from '@/components/workspace/artifact-preview-utils'
import { FileIcon } from '@/components/workspace/file-icon'
import { formatManageGlobalMemoryOutput } from '@/lib/global-memory-tool-output'
import { ToolMarqueeController, type ToolMarqueeEnv, type ToolMarqueeView } from '@/lib/tool-marquee'
import { parseDiffFileInfo, parseDiffRows, diffLineNumber, type DiffRow } from '@/lib/diff-view'

/**
 * T4（self-hosted-chat-ui）：QuickForge 工具渲染器的 React 公共构件。
 *
 * 原 src/lib/local-tools.ts 中的 html`` 模板渲染器逐个迁到 React
 * （src/lib/tool-renderers/ 下按工具分文件）；本模块承载所有渲染器共用的
 * 纯函数、DOM 自定义元素与 React 节点工厂。视觉契约保持不变：
 * - class 链与 DOM 结构逐字复刻原模板（CSS 与 DOM 装饰层依赖这些类名）；
 * - 内联 SVG 图标原样保留（stroke-width 等属性改为 JSX 驼峰写法）；
 * - 代码与日志直接输出 React DOM，不依赖自定义元素（class 链见 qf-code-block / qf-console-block）。
 */

export type ToolResultLike = {
  toolCallId?: string
  isError?: boolean
  content?: Array<{ type: string; text?: string }>
  details?: unknown
}

export type ToolStatusKey = 'running' | 'done' | 'error' | 'called'

export type ToolDiffDetails = {
  format?: string
  path?: string
  addedLines?: number
  removedLines?: number
  oldLineCount?: number
  newLineCount?: number
  truncated?: boolean
  text?: string
}

export function toolStatus(result: ToolResultLike | undefined, isStreaming?: boolean): ToolStatusKey {
  const details = isRecord(result?.details) ? result.details : undefined
  if (result?.isError || details?.aborted === true || details?.timedOut === true) return 'error'
  if (isStreaming) return 'running'
  return result ? 'done' : 'called'
}

export function stringifyValue(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
  }
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

export function resultText(result: ToolResultLike | undefined) {
  return result?.content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n') ?? ''
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function commandStatusFromDetails(details: Record<string, unknown>, isStreaming?: boolean) {
  if (details.running === true || isStreaming) return t('toolCommandStatusRunning')
  const flags = [
    details.timedOut ? t('toolCommandStatusTimedOut') : null,
    details.aborted ? t('toolCommandStatusAborted') : null,
  ].filter(Boolean)
  const suffix = flags.length ? ` (${flags.join(', ')})` : ''
  const code = details.code ?? t('toolCommandExitCodeUnknown')
  const signal = typeof details.signal === 'string' && details.signal ? t('toolCommandSignalSuffix', { signal: details.signal }) : ''
  return `${t('toolCommandExitCode', { code: String(code) })}${signal}${suffix}`
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
    t('toolCommandLabel', { command }),
    commandStatusFromDetails(detailRecord, isStreaming),
    '',
    t('toolCommandStdoutLabel'),
    stdout || t('toolCommandEmptyOutput'),
    '',
    t('toolCommandStderrLabel'),
    stderr || t('toolCommandEmptyOutput'),
  ].join('\n')
}

export function toolOutputText(toolName: string, params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
  const output = resultText(result)
  if (toolName === 'manage_global_memory') {
    return formatManageGlobalMemoryOutput(result, isStreaming, t) || output
  }
  if (output) return output
  if (toolName === 'run_command') return runCommandOutputFromDetails(params, result?.details, isStreaming)
  return ''
}

export function getDiffDetails(details: unknown): ToolDiffDetails | undefined {
  if (!details || typeof details !== 'object') return undefined
  const diff = (details as { diff?: unknown }).diff
  if (!diff || typeof diff !== 'object') return undefined
  const candidate = diff as ToolDiffDetails
  const hasText = typeof candidate.text === 'string'
  const hasCounts = typeof candidate.addedLines === 'number' || typeof candidate.removedLines === 'number'
  return hasText || hasCounts ? candidate : undefined
}

export function detailsWithoutDiffText(details: unknown) {
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

export function runtimeIdsFromDetails(details: unknown) {
  if (!details || typeof details !== 'object') return {}
  const record = details as Record<string, unknown>
  return {
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
  }
}

export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`

  const seconds = ms / 1000
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.round(seconds)}s`

  const minutes = Math.floor(seconds / 60)
  const restSeconds = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}m ${restSeconds}s`
}

export function elapsedMsFromTiming(timing: QuickForgeToolTiming | undefined) {
  if (!timing) return undefined
  if (typeof timing.durationMs === 'number') return timing.durationMs
  if (typeof timing.startedAt === 'number') return Date.now() - timing.startedAt
  return undefined
}

// ---------------------------------------------------------------------------
// attribute 驱动的自定义元素（React 通过 attribute 传参，与原用法等价）
// ---------------------------------------------------------------------------

// node 测试环境无 DOM：以空基类兜底，模块可安全导入（define 仍有 typeof 守卫）。
const customElementBase = typeof HTMLElement === 'undefined'
  ? (class {} as unknown as typeof HTMLElement)
  : HTMLElement

class QuickForgeElapsedTime extends customElementBase {
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

if (typeof customElements !== 'undefined' && !customElements.get('quickforge-elapsed-time')) {
  customElements.define('quickforge-elapsed-time', QuickForgeElapsedTime)
}

const marqueeEnv: ToolMarqueeEnv = {
  prefersReducedMotion: () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  animate: (target, keyframes, options) => (target as unknown as Animatable).animate(keyframes as Keyframe[], options as KeyframeAnimationOptions),
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (token) => clearTimeout(token as ReturnType<typeof setTimeout>),
}

/**
 * subagent 摘要卡的「当前工具」跑马灯（attribute 驱动模式，保证高频重渲染下
 * 元素实例与动画生命周期稳定）。动画时序由 ToolMarqueeController 承担（纯逻辑
 * 可单测）：仅溢出且非 reduced-motion 时滚动，同值刷新不打断；text 切换时双视图
 * 纵向滚动（旧文上滚出、新文自下滚入），容器定高一行（见 .quickforge-subagent-marquee）。
 */
class QuickForgeToolMarquee extends customElementBase {
  private controller: ToolMarqueeController | undefined
  private resizeObserver: ResizeObserver | undefined
  private ready = false

  static get observedAttributes() {
    return ['text', 'running']
  }

  connectedCallback() {
    const views = this.marqueeViews()
    // 新控制器始终从第一组视图接管；重连前可能停在第二组，先归一化可见位。
    views[0].el.style.visibility = ''
    // 非当前视图整体对辅助技术隐藏（瞬态滚入内容不重复播报）。
    ;(views[1].el as HTMLElement).setAttribute('aria-hidden', 'true')
    this.controller = new ToolMarqueeController({
      views,
      getClientWidth: () => this.clientWidth,
    }, marqueeEnv)
    this.ready = true
    if (typeof ResizeObserver === 'function') {
      // 对话列宽变化时在下一帧重新测量并重建动画。
      this.resizeObserver = new ResizeObserver(() => this.scheduleRestart())
      this.resizeObserver.observe(this)
    }
    this.sync()
  }

  disconnectedCallback() {
    this.ready = false
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = undefined
    }
    this.controller?.dispose()
    this.controller = undefined
  }

  attributeChangedCallback() {
    if (!this.ready) return
    this.sync()
  }

  private marqueeViews(): [ToolMarqueeView, ToolMarqueeView] {
    const existing = Array.from(this.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('quickforge-marquee-view'),
    )
    if (existing.length === 2) {
      const views = existing.map((el) => {
        const staticSpan = el.querySelector<HTMLElement>('.quickforge-marquee-static')
        const movingSpan = el.querySelector<HTMLElement>('.quickforge-marquee-moving')
        return staticSpan && movingSpan ? { el, staticSpan, movingSpan } : undefined
      })
      if (views[0] && views[1]) return [views[0], views[1]]
    }

    this.replaceChildren()
    const views = [0, 1].map(() => {
      const el = document.createElement('span')
      el.className = 'quickforge-marquee-view'
      const staticSpan = document.createElement('span')
      staticSpan.className = 'quickforge-marquee-static'
      const movingSpan = document.createElement('span')
      movingSpan.className = 'quickforge-marquee-moving'
      movingSpan.setAttribute('aria-hidden', 'true')
      el.appendChild(staticSpan)
      el.appendChild(movingSpan)
      this.appendChild(el)
      return { el, staticSpan, movingSpan }
    })
    return [views[0], views[1]]
  }

  private sync() {
    this.controller?.sync(this.getAttribute('text') || '', this.getAttribute('running') === 'true')
  }

  private scheduleRestart() {
    requestAnimationFrame(() => {
      if (this.ready) this.controller?.sync(this.getAttribute('text') || '', this.getAttribute('running') === 'true', true)
    })
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('quickforge-tool-marquee')) {
  customElements.define('quickforge-tool-marquee', QuickForgeToolMarquee)
}

/** React 版耗时徽标：仍是 quickforge-elapsed-time 自定义元素（attribute 传参）。 */
export function renderTiming(timing: QuickForgeToolTiming | undefined, status: ToolStatusKey) {
  const elapsedMs = elapsedMsFromTiming(timing)
  if (elapsedMs === undefined) return null
  return createElement('quickforge-elapsed-time', {
    class: 'quickforge-tool-meta-hover text-xs text-muted-foreground',
    'started-at': String(timing?.startedAt ?? ''),
    'duration-ms': typeof timing?.durationMs === 'number' ? String(timing.durationMs) : '',
    running: String(status === 'running'),
  })
}

/** React 版 subagent 跑马灯：仍是 quickforge-tool-marquee 自定义元素（attribute 传参）。 */
export function renderToolMarquee(text: string, ariaLabel: string, className: string) {
  return createElement('quickforge-tool-marquee', {
    class: className,
    text,
    running: 'true',
    'aria-label': ariaLabel,
  })
}

// ---------------------------------------------------------------------------
// 图标 / 状态（原内联 SVG 逐字转为 JSX，仅属性名驼峰化）
// ---------------------------------------------------------------------------

function toolIconClass() {
  return 'text-muted-foreground'
}

export function renderToolIcon(toolName: string) {
  const className = `quickforge-tool-type-icon shrink-0 ${toolIconClass()}`

  if (toolName === 'manage_global_memory') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 18V5" /><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" /><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" /><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" /><path d="M18 18a4 4 0 0 0 2-7.464" /><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" /><path d="M6 18a4 4 0 0 1-2-7.464" /><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" /></svg>
  if (toolName === 'edit_file') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" /></svg>
  if (toolName === 'write_file') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M12 18v-6" /><path d="M9 15h6" /></svg>
  if (toolName === 'read_file') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></svg>
  if (toolName === 'grep_files') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
  if (toolName === 'present_files') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M10 13.5 8 16l2 2.5" /><path d="m14 13.5 2 2.5-2 2.5" /></svg>
  if (toolName === 'generate_image') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /><path d="m14 19.5-2-2a2 2 0 0 0-2.8 0L5.5 21" /></svg>
  if (toolName === 'read_skill_resource') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z" /></svg>
  if (toolName === 'run_command') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" /></svg>
  if (toolName === 'run_subagent') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>
  if (toolName === 'ask_user') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" x2="12.01" y1="17" y2="17" /></svg>
  if (toolName === 'todo_write') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
  if (toolName === 'activate_skill') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.9 2.1 8.5 8.5 2.1 9.9l6.4 1.4 1.4 6.4 1.4-6.4 6.4-1.4-6.4-1.4Z" /><path d="M19 15v4" /><path d="M21 17h-4" /></svg>
  return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z" /></svg>
}

/** 折叠摘要行右侧的旋转箭头（group-open/tool:rotate-90 与原模板一致）。 */
export function renderToolChevron() {
  return <svg className="quickforge-tool-chevron shrink-0 group-open/tool:rotate-90" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
}

function statusIconClass(status: ToolStatusKey) {
  if (status === 'error') return 'text-destructive'
  if (status === 'running') return 'text-primary animate-spin'
  return 'text-muted-foreground'
}

export function renderStatusIcon(status: ToolStatusKey) {
  if (status === 'done') return null
  const className = `quickforge-tool-status-icon shrink-0 ${statusIconClass(status)}`
  const label = t(status)

  if (status === 'running') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
  if (status === 'error') return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></svg>
  return <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /></svg>
}

export function renderStatus(status: ToolStatusKey, timing: QuickForgeToolTiming | undefined) {
  const icon = renderStatusIcon(status)
  const timingElement = renderTiming(timing, status)
  if (icon === null && timingElement === null) return null
  const metaClass = status === 'done' ? 'quickforge-tool-meta-hover' : 'quickforge-tool-meta-important'
  return (
    <span className={`${metaClass} shrink-0 inline-flex items-center gap-1.5`} title={t(status)}>
      {icon}{timingElement}
    </span>
  )
}

// ---------------------------------------------------------------------------
// diff 渲染（契约不变：两列网格、display:contents 行、单智能行号列）
// ---------------------------------------------------------------------------

export function renderInlineDiffStats(diff: ToolDiffDetails | undefined) {
  if (!diff) return null

  const addedLines = Number(diff.addedLines ?? 0)
  const removedLines = Number(diff.removedLines ?? 0)
  return (
    <span className="quickforge-diff-stats shrink-0">
      <span className="quickforge-diff-stats-add">+{addedLines}</span>
      <span className="quickforge-diff-stats-del">−{removedLines}</span>
    </span>
  )
}

export function renderDiffRow(row: DiffRow) {
  if (row.kind === 'gap') {
    return (
      <div
        className={`quickforge-diff-gap${row.first ? ' quickforge-diff-gap-first' : ''}`}
        aria-label={t('diffOmittedLines', { count: row.count })}
      >⋯</div>
    )
  }
  return (
    <div className={`quickforge-diff-row quickforge-diff-row-${row.kind}`}>
      <span className="quickforge-diff-ln">{diffLineNumber(row) ?? ''}</span>
      <span className="quickforge-diff-code">{row.text || ' '}</span>
    </div>
  )
}

export function renderDiff(diff: ToolDiffDetails, isNewFile = false) {
  const hasText = typeof diff.text === 'string'
  const diffText = hasText ? diff.text as string : ''
  const fileInfo = hasText ? parseDiffFileInfo(diffText) : null
  const format = diff.format === 'raw' ? 'raw' : 'unified'
  const newFile = isNewFile || fileInfo?.isNewFile === true || format === 'raw'

  return (
    <div className="quickforge-diff-view">
      {(diff.truncated || newFile) ? (
        <div className="quickforge-diff-state">
          {newFile ? <span>{t('diffNewFile')}</span> : null}
          {diff.truncated ? <span>{t('diffTruncated')}</span> : null}
        </div>
      ) : null}
      {hasText
        ? diffText !== ''
          ? <div className="quickforge-diff-block">{parseDiffRows(diffText, format, Boolean(diff.truncated)).map((row, index) => <Fragment key={index}>{renderDiffRow(row)}</Fragment>)}</div>
          : <div className="quickforge-diff-empty">{t('diffNoChanges')}</div>
        : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 操作按钮：终止命令 / 预览产物（window CustomEvent 桥接保持不变）
// ---------------------------------------------------------------------------

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

export function renderTerminateCommandButton(toolName: string, status: ToolStatusKey, details: unknown) {
  if (toolName !== 'run_command' || status !== 'running') return null
  const { sessionId, toolCallId } = runtimeIdsFromDetails(details)
  if (!sessionId || !toolCallId) return null
  return (
    <button
      type="button"
      className="shrink-0 inline-flex size-5 items-center justify-center text-foreground transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
      title={t('terminateCommandTitle')}
      aria-label={t('terminateCommandTitle')}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void terminateCommand(sessionId, toolCallId, event.currentTarget as HTMLButtonElement)
      }}
    ><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.4" /></svg></button>
  )
}

// 工具卡片通过 window CustomEvent 桥接触发预览：点击预览按钮 → 派发事件 →
// App.tsx 监听 → 复用现有预览逻辑（与 React ChatSurface 树外组件共享同一入口）。
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

/** read_file 摘要点击预览的绝对路径护栏（兼容 / 与 \ 分隔符、盘符与 ~ 前缀）。 */
function isNonWorkspaceClickablePath(path: string) {
  return path.startsWith('~') || path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(path)
}

// 从工具参数中解析出可展示的文件（若存在）。
// write_file/edit_file/read_file 取单个已知文件；present_files 按 defaultPreview 优先，
// 否则取第一个可在 Browser 或 Reader 中打开的文件。找不到则不渲染按钮/不可点击。
// read_file 的 path 可能是工作区外的绝对路径（如 ~/.claude/CLAUDE.md、盘符路径）：
// 预览链路（App.tsx openArtifactPreview → 工作区文件 API）只认工作区内路径——
// 工作区外绝对路径会被服务端 403 拒绝，`~` 前缀也不会被展开；渲染层拿不到
// 工作区根目录、无法区分「工作区内绝对路径」，故绝对路径一律视为不可预览。
function resolvePreviewableArtifact(toolName: string, params: Record<string, unknown> | undefined): PreviewableArtifact | undefined {
  if (toolName === 'write_file' || toolName === 'edit_file') {
    const path = params && 'path' in params && typeof params.path === 'string' ? params.path : ''
    return path ? previewableArtifact(path) : undefined
  }
  if (toolName === 'read_file') {
    const path = params && 'path' in params && typeof params.path === 'string' ? params.path : ''
    if (!path || isNonWorkspaceClickablePath(path)) return undefined
    return previewableArtifact(path)
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

/** 预览点击桥接：预览按钮与摘要行文件图标共用同一入口——先
 * preventDefault + stopPropagation 阻断 summary 的 details 折叠开关，
 * 再经 window CustomEvent 派发给 App.tsx 的 openArtifactPreview。 */
function previewArtifactClickHandler(artifact: PreviewableArtifact) {
  return (event: { preventDefault(): void; stopPropagation(): void }) => {
    event.preventDefault()
    event.stopPropagation()
    window.dispatchEvent(new CustomEvent(PREVIEW_ARTIFACT_EVENT, { detail: artifact }))
  }
}

export function renderPreviewButton(toolName: string, params: Record<string, unknown> | undefined) {
  // 摘要区文件元素（write_file / edit_file / read_file）整体即预览入口（见
  // renderToolFileSummary），右侧眼睛按钮仅保留 present_files——多文件摘要
  // 无法整体充当入口，需要独立按钮。
  if (toolName !== 'present_files') return null
  const artifact = resolvePreviewableArtifact(toolName, params)
  if (!artifact) return null
  return (
    <button
      type="button"
      className="shrink-0 inline-flex size-5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      title={t('previewArtifact')}
      aria-label={t('previewArtifact')}
      onClick={previewArtifactClickHandler(artifact)}
    ><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg></button>
  )
}

// write_file / edit_file / read_file 摘要区的文件元素：与工作区文件管理同源的 Material
// 文件类型图标 + 仅文件名（basename，兼容 / 与 \ 分隔符）作为一个整体渲染，
// 可见文本不含目录与完整路径；hover title 保留完整路径（信息不丢失）。
// 路径可预览（resolvePreviewableArtifact 有值）时整体即预览入口，复用
// previewArtifactClickHandler（阻断 summary 折叠开关后派发预览事件）；
// 不可预览时静态展示、不可点击。其余工具摘要保持纯文本完整路径不变。
// 预览入口的 hover 反馈克制为仅 basename 文本下划线（group-hover 定位到
// 文件名 span，图标不下划线），颜色与透明度保持不变。
export function renderToolFileSummary(toolName: 'write_file' | 'edit_file' | 'read_file', params: Record<string, unknown> | undefined) {
  const path = params && typeof params.path === 'string' && params.path ? params.path : ''
  if (!path) return null
  const artifact = resolvePreviewableArtifact(toolName, params)
  const className = 'quickforge-tool-file-summary inline-flex min-w-0 max-w-full items-center gap-1'
  const content = (
    <>
      <FileIcon path={path} className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate underline-offset-4 group-hover:underline">{artifactFileName(path)}</span>
    </>
  )
  if (!artifact) {
    return <span className={className} title={path}>{content}</span>
  }
  return (
    <button
      type="button"
      className={`${className} group cursor-pointer`}
      title={path}
      onClick={previewArtifactClickHandler(artifact)}
    >{content}</button>
  )
}

// ---------------------------------------------------------------------------
// 折叠状态随 React 实例保存，主聊天 / side chat / Inspector 不共享交互状态；
// 用户手动开合按 toolCall id 记入模块级记忆（上限 100 条，最旧先淘汰），
// remount（流式消息迁入历史列表、分页窗口重建）后初始值优先取记忆——
// 对齐旧 local-tools.ts 的 rememberToolDetailsOpen 语义。
// ---------------------------------------------------------------------------

/** toolCall id → 手动开合记忆；导出仅供测试直接驱动与清理。 */
export const toolDetailsOpenMemory = new Map<string, boolean>()
const MAX_TOOL_DETAILS_OPEN_MEMORY_ENTRIES = 100

// ToolMessage 每次 render 后把 toolCall 桥接数据同步到 .qf-tool-message 根节点；
// ToolDetails 从最近的宿主节点读取 toolCall id 作为记忆 key（旧版
// runtimeIdsFromDetails 的 DOM 等价物）。子组件 effect 先于宿主 effect 执行，
// 挂载当次 commit 可能还读不到 key，因此恢复记忆的 effect 不带依赖、在
// key 可用前每次 render 重试。
type ToolDetailsHostElement = HTMLElement & { toolCall?: { id?: string } }

function toolDetailsStateKey(element: HTMLDetailsElement | null): string {
  const host = element?.closest('.qf-tool-message') as ToolDetailsHostElement | null
  return host?.toolCall?.id || ''
}

/** 记录一次手动开合；重复 touch 刷新 LRU 位置，超限时淘汰最旧条目。 */
export function rememberToolDetailsOpen(key: string, open: boolean) {
  if (!key) return
  if (!toolDetailsOpenMemory.has(key) && toolDetailsOpenMemory.size >= MAX_TOOL_DETAILS_OPEN_MEMORY_ENTRIES) {
    const oldestKey = toolDetailsOpenMemory.keys().next().value
    if (oldestKey) toolDetailsOpenMemory.delete(oldestKey)
  }
  toolDetailsOpenMemory.delete(key)
  toolDetailsOpenMemory.set(key, open)
}

export function ToolDetails({ initiallyOpen, ...props }: Omit<ComponentProps<'details'>, 'open' | 'onToggle'> & { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const memoryAppliedRef = useRef(false)

  // remount 后优先取记忆（无记忆时保持 initiallyOpen）；用户已手动 toggle
  // 则不再覆盖本次会话内的最新操作。effect 保持无依赖：子组件 effect 先于
  // 宿主桥接 effect 执行，key 可能到下一次 commit 才可读，需重试到成功。
  // eslint-disable-next-line react-hooks/exhaustive-deps -- memoryAppliedRef guards the retry loop; setOpen fires at most once.
  useEffect(() => {
    if (memoryAppliedRef.current) return
    const remembered = toolDetailsOpenMemory.get(toolDetailsStateKey(detailsRef.current))
    if (remembered === undefined) return
    memoryAppliedRef.current = true
    setOpen(remembered)
  })

  return (
    <details
      {...props}
      ref={detailsRef}
      open={open}
      onToggle={(event) => {
        // 只记录用户手动开合（React 重设 open 属性触发的 toggle 写回同值，无副作用）。
        rememberToolDetailsOpen(toolDetailsStateKey(event.currentTarget), event.currentTarget.open)
        memoryAppliedRef.current = true
        setOpen(event.currentTarget.open)
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// 代码与日志：纯 React DOM，保留复制、滚动与原有轻量边框；代码用聊天侧
// CodeBlock.tsx 同一套轻量高亮（qf-hl-* token class）与 2000ms copied 复制
// 反馈，保持同一应用内两套代码块交互一致（工具卡旧版即无“在终端运行”
// 按钮与 SVG/Mermaid 预览菜单，这里同样不渲染）。
// ---------------------------------------------------------------------------

/** 与聊天 CodeBlock 一致的复制反馈时长（copied 状态保持 2000ms，同旧版 mini-lit copy-button）。 */
const TOOL_CODE_COPY_FEEDBACK_MS = 2000

function ToolCodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), TOOL_CODE_COPY_FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [copied])

  // 与 CodeBlock 一致：plain 段渲染为裸文本节点，pre>code 文本保持逐字，
  // 复制按钮绑定的始终是原始 code 而非高亮 span。
  const highlightSegments = useMemo(() => highlightCode(code, language), [code, language])
  const copyLabel = copied ? t('copied') : t('copy')

  return (
    <div className="qf-code-block block rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-xs text-muted-foreground font-mono">{language}</span>
        <button
          type="button"
          data-qf-action="copy-code"
          className={`pointer-events-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground${copied ? ' text-emerald-600 hover:text-emerald-600' : ''}`}
          title={copyLabel}
          aria-label={copyLabel}
          onClick={() => { void copyTextToClipboard(code).then(() => setCopied(true)).catch(() => {}) }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <div className="overflow-auto max-h-96">
        <pre className="!bg-transparent !border-0 !rounded-none m-0 px-4 pb-4 text-xs text-foreground font-mono"><code className={`language-${language}`}>{highlightSegments.map((segment, index) => (
          segment.token === 'plain'
            ? segment.text
            : <span key={index} className={HIGHLIGHT_TOKEN_CLASSES[segment.token]}>{segment.text}</span>
        ))}</code></pre>
      </div>
    </div>
  )
}

export function renderCodeBlock(code: string, language = 'text') {
  return <ToolCodeBlock code={code} language={language} />
}

export function renderConsoleBlock(content: string, variant: 'default' | 'error') {
  return <div className={`qf-console-block rounded-md border p-3 font-mono text-xs ${variant === 'error' ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-border bg-muted/30 text-foreground'}`}><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{content}</pre></div>
}

/** 渲染器共用的详细模式判断（输入/输出/原始 JSON 仅 detailed 模式展示）。 */
export function toolDisplayDetailed() {
  return getCachedToolDisplaySettings().toolDisplayMode === 'detailed'
}

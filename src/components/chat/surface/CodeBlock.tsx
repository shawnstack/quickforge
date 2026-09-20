/* eslint-disable react-refresh/only-export-components -- exports the CodeBlock component plus the pure code-block helpers covered by tests. */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Code as CodeIcon, Copy, Download, Eye, Play } from 'lucide-react'
import { t } from '@/lib/i18n'
import { HIGHLIGHT_TOKEN_CLASSES, highlightCode } from '@/lib/code-highlight'
import { copyTextToClipboard } from '@/lib/message-utils'
import { createMermaidSvgDataUrl, isMermaidLanguage, renderMermaidSvg } from '@/lib/mermaid-renderer'
import { cn } from '@/lib/utils'
import { useAssistantStreaming, useCommandActionsEnabled } from './surface-context'

/**
 * React code block for chat messages. The code-block capabilities that the
 * removed `panel-decoration` decorators used to inject are now rendered here
 * directly by React, per fenced code block:
 *  - a title bar with the fenced language + a copy button,
 *  - the source rendered with the self-hosted lightweight highlighter
 *    (`src/lib/code-highlight.ts`, no dependency): known languages get
 *    `qf-hl-<token>` spans inside `pre>code`; an unregistered language name
 *    gets the highlighter's conservative generic pass (comments/strings/
 *    numbers/common keywords, standing in for the legacy `highlightAuto`),
 *    while `text`/`plaintext`, a missing language and oversized blocks fall
 *    back to plain verbatim text,
 *  - a `svg` preview panel (rendered image + enlarge lightbox + ⋯ menu with
 *    preview/source toggle, copy-source and download),
 *  - a `mermaid` diagram preview (rendered via `mermaid-renderer` + ⋯ menu),
 *  - a "run in terminal" button for shell languages that dispatches the
 *    `quickforge:execute-markdown-command` window event.
 */

/** Fenced languages that get the "run in terminal" affordance. */
const SHELL_CODE_LANGUAGES = new Set([
  'bash', 'sh', 'shell', 'zsh', 'fish', 'cmd', 'bat', 'batch', 'powershell', 'ps1', 'terminal', 'console',
])

/** Commands that require an extra confirmation before running in the terminal. */
const DANGEROUS_COMMAND_PATTERN = /\b(rm\s+-rf|sudo|chmod\b|chown\b|npm\s+publish|pnpm\s+publish|yarn\s+publish|git\s+push|curl\b[^\n|;]*\|\s*(sh|bash)|wget\b[^\n|;]*\|\s*(sh|bash))\b/i

/** Active/external SVG content is never inlined into the preview image. */
const SVG_PREVIEW_UNSAFE_PATTERN = /<\s*(script|foreignObject)\b|\son[a-z]+\s*=|javascript\s*:/i

/** Legacy hardcoded aria-label for the SVG preview (no i18n key existed). */
const SVG_PREVIEW_LABEL = 'SVG preview'
/**
 * Title-bar copy button, which replaced mini-lit's `copy-button` (that
 * component reset its "copied" state after 2000ms).
 */
const COPY_BUTTON_FEEDBACK_MS = 2000
/**
 * ⋯ menu copy-source actions, which replaced the decoration layer's
 * `showCopiedFeedback` (1200ms, `panel-decoration/code-blocks.ts` at the
 * removal baseline).
 */
const MENU_COPY_FEEDBACK_MS = 1200

/**
 * Broadcast fired when a code-block menu opens; every other open menu in the
 * same markdown block (`details` scoped to `.qf-markdown-block`, falling back
 * to `document` when rendered outside one) listens and closes itself.
 * Replaces the legacy decoration pass's
 * `closeSvgCodeBlockMenus(block.closest('markdown-block') ?? document, menu)`
 * mutual exclusion and, firing from the native `<details>` `toggle` →
 * `onToggle` → effect path, covers keyboard opens too.
 */
const CODE_BLOCK_MENU_OPEN_EVENT = 'quickforge:code-block-menu-open'

/** Extract the fenced language from a react-markdown `code` element `className`. */
export function codeBlockLanguage(className: string | undefined) {
  return className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.trim() || undefined
}

/**
 * Title-bar label, mirroring the legacy `<code-block>` (`language ||
 * 'plaintext'`, rendered verbatim — no case folding). Markdown fences without
 * an info string pass `text` (see `Markdown.tsx`), which is what the legacy
 * markdown layer rendered for them.
 */
export function codeBlockLanguageLabel(language: string | undefined) {
  return (language ?? '').trim() || 'plaintext'
}

export function isShellCodeLanguage(language: string | undefined) {
  return SHELL_CODE_LANGUAGES.has((language ?? '').trim().toLowerCase())
}

/** An SVG block is previewable only when it is a self-contained, safe `<svg>` document. */
export function isPreviewableSvg(svg: string) {
  const trimmed = svg.trim()
  return /^<svg[\s>]/i.test(trimmed) && /<\/svg>\s*$/i.test(trimmed) && !SVG_PREVIEW_UNSAFE_PATTERN.test(trimmed)
}

export function createSvgPreviewUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Strip common shell prompts (`$`, `>`, `PS C:\>`) so the command can be executed verbatim. */
export function normalizeShellCommand(command: string) {
  return command
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line
      .replace(/^\s*\$\s+/, '')
      .replace(/^\s*>\s+/, '')
      .replace(/^\s*PS\s+[^>\n]+>\s+/i, ''))
    .join('\n')
    .trim()
}

export function commandLineCount(command: string) {
  return command.split('\n').map((line) => line.trim()).filter(Boolean).length
}

export function isDangerousShellCommand(command: string) {
  return DANGEROUS_COMMAND_PATTERN.test(command)
}

/** Payload of the `quickforge:execute-markdown-command` window event (unchanged contract). */
export function createExecuteMarkdownCommandDetail(command: string) {
  return {
    command,
    confirm: commandLineCount(command) > 1,
    dangerous: isDangerousShellCommand(command),
  }
}

function downloadTextFile(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

type MermaidRender = {
  source: string
  svg: string
  dataUrl: string
  error: boolean
}

type DetectedContext = {
  assistant: boolean
}

type CodeBlockMenuAction = {
  action: string
  label: string
  icon: ReactNode
  /**
   * Copy-source actions keep the menu open so the item's 1200ms "copied"
   * feedback (legacy `showCopiedFeedback`) stays visible; download and
   * preview/source mode toggles close it (legacy `code-blocks.ts` semantics).
   */
  keepsMenuOpen?: boolean
  onSelect: () => void
}

/**
 * Whether running a menu action closes the menu. Copy-source actions keep it
 * open so their 1200ms "copied" feedback stays visible; download and
 * preview/source mode toggles close it (legacy `code-blocks.ts` semantics).
 */
export function closesCodeBlockMenu(action: Pick<CodeBlockMenuAction, 'keepsMenuOpen'>) {
  return !action.keepsMenuOpen
}

/**
 * The legacy `⋯` toolbar was a native `<details>` menu closed by a global
 * outside-pointerdown / Escape handler. Reproduced here per instance.
 */
function CodeBlockMenu({ actions, copiedAction }: { actions: CodeBlockMenuAction[]; copiedAction: string | null }) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const closeOnOutsideEvent = (event: Event) => {
      const details = detailsRef.current
      if (!details?.open) return
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return
      if (event.type === 'pointerdown' && details.contains(event.target as Node)) return
      details.open = false
    }
    const closeOnOtherMenuOpen = (event: Event) => {
      if ((event as CustomEvent).detail === detailsRef.current) return
      if (detailsRef.current?.open) detailsRef.current.open = false
    }
    // Mutual exclusion: announce this menu inside the owning markdown block
    // (legacy `block.closest('markdown-block') ?? document` scope), then listen
    // for later opens. The dispatch below happens before the listener is
    // attached, so a menu never closes itself; the already-open instances hear
    // it synchronously. Outside pointerdown / Escape stay document-wide.
    const scope: EventTarget = detailsRef.current?.closest('.qf-markdown-block') ?? document
    scope.dispatchEvent(new CustomEvent(CODE_BLOCK_MENU_OPEN_EVENT, { detail: detailsRef.current }))
    document.addEventListener('pointerdown', closeOnOutsideEvent, true)
    document.addEventListener('keydown', closeOnOutsideEvent)
    scope.addEventListener(CODE_BLOCK_MENU_OPEN_EVENT, closeOnOtherMenuOpen)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideEvent, true)
      document.removeEventListener('keydown', closeOnOutsideEvent)
      scope.removeEventListener(CODE_BLOCK_MENU_OPEN_EVENT, closeOnOtherMenuOpen)
    }
  }, [open])

  return (
    <details className="quickforge-svg-code-menu" ref={detailsRef} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="quickforge-svg-code-menu-trigger" title={t('moreActions')} aria-label={t('moreActions')}>⋯</summary>
      <div className="quickforge-svg-code-menu-content" role="menu">
        {actions.map((action) => {
          const copied = Boolean(action.keepsMenuOpen) && copiedAction === action.action
          const label = copied ? t('copied') : action.label
          return (
            <button
              key={action.action}
              type="button"
              role="menuitem"
              className={cn('quickforge-svg-code-menu-item', copied && 'text-emerald-600')}
              data-qf-action={action.action}
              title={label}
              aria-label={label}
              onClick={() => {
                if (closesCodeBlockMenu(action) && detailsRef.current) detailsRef.current.open = false
                action.onSelect()
              }}
            >
              {copied ? <Check size={15} /> : action.icon}
            </button>
          )
        })}
      </div>
    </details>
  )
}

/**
 * Title-bar copy button — the React replacement for mini-lit's `copy-button`,
 * which the legacy code-block rendered with `showText`: a successful copy kept
 * the icon (swapped to a check) **and** appended a visible `Copied!` text for
 * 2000ms, while `title` stayed constant (`Copy code`, i.e. the `copy` key). The
 * icon swap alone carries no feedback in an icon-only button.
 */
export function CodeBlockCopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button
      type="button"
      data-qf-action="copy-code"
      className={cn(
        'pointer-events-auto inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground',
        // Idle: square icon button sized like the run button. Copied: the legacy
        // button grew to fit the visible feedback text (existing button/text classes).
        copied ? 'h-7 gap-1 px-1.5 text-xs text-emerald-600 hover:text-emerald-600' : 'size-7',
      )}
      title={t('copy')}
      aria-label={t('copy')}
      onClick={onCopy}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? <span>{t('copied')}</span> : null}
    </button>
  )
}

export type CodeBlockProps = {
  language?: string
  source: string
  /**
   * Context overrides. `isAssistant` falls back to a mount-time DOM probe
   * (`.qf-assistant-message` ancestor), which mirrors the legacy decoration
   * layer's selector gate while keeping `MarkdownBlock` props-free.
   * `isStreaming` and `commandActionsEnabled` come from the enclosing surface
   * context instead (`AssistantStreamingContext` / `CommandActionsEnabledContext`,
   * provided by `ChatSurface` and by the subagent run-detail trace) — whether a
   * message is still streaming, and whether terminal command actions are
   * available, are host/message decisions rather than DOM-shape inferences.
   */
  isAssistant?: boolean
  isStreaming?: boolean
  commandActionsEnabled?: boolean
}

/**
 * A fenced code block for chat messages.
 *
 * The frame reproduces the legacy `code-block` recipe (border + rounded-lg +
 * title bar) already reused by `tool-renderers/shared.tsx#renderCodeBlock`, so
 * the chat surface keeps one consistent code-block visual.
 *
 * Memoized: `MarkdownBlock` re-renders whenever its parent does, so a stream
 * update in one message would otherwise re-run the highlight/mermaid render
 * path for every unchanged code block in the list. Props are primitives
 * (language/source/flags) and context changes still bypass the memo.
 */
export const CodeBlock = memo(function CodeBlock({ language, source, isAssistant, isStreaming, commandActionsEnabled }: CodeBlockProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [detected, setDetected] = useState<DetectedContext | null>(null)
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const [mermaid, setMermaid] = useState<MermaidRender | null>(null)
  // `durationMs` remembers which legacy path fired the feedback: the title-bar
  // button (2000ms) or a ⋯ menu copy action (1200ms).
  const [copyFeedback, setCopyFeedback] = useState<{ action: string; nonce: number; durationMs: number } | null>(null)
  const [lightbox, setLightbox] = useState<{ src: string; label: string } | null>(null)

  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    setDetected({
      // The assistant-message ancestor is a structural placement signal that is
      // still cheaper to probe than to thread through the Markdown pipeline.
      assistant: Boolean(element.closest('.qf-assistant-message')),
    })
  }, [])

  const assistant = isAssistant ?? detected?.assistant ?? false
  // Streaming comes from the enclosing surface (local streaming container /
  // running subagent trace), never from a `.qf-streaming-message` DOM probe:
  // the subagent trace has no such ancestor, so probing it re-rendered every
  // mermaid/SVG preview on each in-flight code block update.
  const contextStreaming = useAssistantStreaming()
  const streaming = isStreaming ?? contextStreaming
  // Terminal command actions come from the surface context (`!sideChat &&
  // !readOnly` at the host — the legacy `enableTerminalCommandActions` gate).
  // The composer-presence DOM probe that used to stand in for it wrongly
  // enabled the button in Side Chat, which also renders a composer. An
  // explicit prop still wins (tests / direct embedding).
  const contextCommandActions = useCommandActionsEnabled()
  const runInTerminalEnabled = commandActionsEnabled ?? contextCommandActions

  const label = codeBlockLanguageLabel(language)
  const shellBlock = isShellCodeLanguage(language)
  // Capability gates stay case-insensitive (legacy decorators lowercased the
  // language); only the displayed label keeps the fenced spelling.
  const svgSource = (language ?? '').trim().toLowerCase() === 'svg' ? source.trim() : ''
  const svgPreviewEnabled = Boolean(svgSource) && isPreviewableSvg(svgSource) && assistant && !streaming
  const mermaidPreviewEnabled = isMermaidLanguage(language) && assistant && !streaming
  const supportedPreview = svgPreviewEnabled || mermaidPreviewEnabled

  useEffect(() => {
    if (!mermaidPreviewEnabled) return
    let cancelled = false
    void renderMermaidSvg(source)
      .then((svg) => {
        if (cancelled) return
        setMermaid({ source, svg, dataUrl: createMermaidSvgDataUrl(svg), error: false })
      })
      .catch(() => {
        if (cancelled) return
        setMermaid({ source, svg: '', dataUrl: '', error: true })
      })
    return () => { cancelled = true }
  }, [mermaidPreviewEnabled, source])

  useEffect(() => {
    if (!copyFeedback) return
    // Per-path duration: 2000ms for the title-bar button, 1200ms for menu copies.
    const timer = window.setTimeout(() => setCopyFeedback(null), copyFeedback.durationMs)
    return () => window.clearTimeout(timer)
  }, [copyFeedback])

  useEffect(() => {
    if (!lightbox) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [lightbox])

  const flashCopied = useCallback((action: string, durationMs: number) => {
    setCopyFeedback({ action, nonce: Date.now(), durationMs })
  }, [])

  const copy = useCallback((action: string, text: string, durationMs: number) => {
    // `copyTextToClipboard` uses `navigator.clipboard` (patched by
    // `clipboard-polyfill` for non-secure HTTP contexts) with an
    // execCommand fallback. `durationMs` keeps the legacy split: 2000ms for
    // the title-bar button, 1200ms for the ⋯ menu copy-source actions.
    void copyTextToClipboard(text).then(() => flashCopied(action, durationMs)).catch(() => {})
  }, [flashCopied])

  const copiedAction = copyFeedback?.action ?? null
  // Highlighted segments are memoized per source; plain runs render as bare
  // text nodes so the `pre>code` text (copy/selection target) stays verbatim —
  // the copy button keeps binding the raw `source`, not the highlighted spans.
  const highlightSegments = useMemo(() => highlightCode(source, language), [source, language])
  const svgPreviewUrl = useMemo(() => (svgPreviewEnabled ? createSvgPreviewUrl(svgSource) : ''), [svgPreviewEnabled, svgSource])
  const mermaidState = mermaid && mermaid.source === source ? mermaid : null
  const mermaidPreviewUrl = mermaidPreviewEnabled && mermaidState && !mermaidState.error ? mermaidState.dataUrl : ''
  const previewUrl = mode === 'preview' ? svgPreviewUrl || mermaidPreviewUrl : ''
  const showPreview = previewUrl !== ''
  const previewIsMermaid = showPreview && mermaidPreviewUrl !== ''
  const previewAlt = previewIsMermaid ? t('mermaidPreviewLabel') : SVG_PREVIEW_LABEL
  const previewTitle = previewIsMermaid ? t('mermaidEnlargePreview') : t('svgEnlargePreview')
  const mermaidError = mermaidPreviewEnabled && mermaidState?.error === true

  const menuActions: CodeBlockMenuAction[] = []
  if (svgPreviewEnabled) {
    menuActions.push(
      { action: 'svg-preview-mode', label: t('svgPreviewMode'), icon: <Eye size={15} />, onSelect: () => setMode('preview') },
      { action: 'svg-source-mode', label: t('svgSourceMode'), icon: <CodeIcon size={15} />, onSelect: () => setMode('source') },
      { action: 'copy-svg-source', label: t('copySvgSource'), icon: <Copy size={15} />, keepsMenuOpen: true, onSelect: () => copy('copy-svg-source', svgSource, MENU_COPY_FEEDBACK_MS) },
      {
        action: 'download-svg',
        label: t('downloadSvg'),
        icon: <Download size={15} />,
        onSelect: () => downloadTextFile(`quickforge-svg-${Date.now()}.svg`, svgSource, 'image/svg+xml;charset=utf-8'),
      },
    )
  } else if (mermaidPreviewEnabled) {
    menuActions.push(
      { action: 'mermaid-preview-mode', label: t('svgPreviewMode'), icon: <Eye size={15} />, onSelect: () => setMode('preview') },
      { action: 'mermaid-source-mode', label: t('svgSourceMode'), icon: <CodeIcon size={15} />, onSelect: () => setMode('source') },
      { action: 'copy-mermaid-source', label: t('copyMermaidSource'), icon: <Copy size={15} />, keepsMenuOpen: true, onSelect: () => copy('copy-mermaid-source', source.trim(), MENU_COPY_FEEDBACK_MS) },
      {
        action: 'download-mermaid-svg',
        label: t('downloadMermaidSvg'),
        icon: <Download size={15} />,
        onSelect: () => {
          if (!mermaidState || mermaidState.error) return
          downloadTextFile(`quickforge-mermaid-${Date.now()}.svg`, mermaidState.svg, 'image/svg+xml;charset=utf-8')
        },
      },
    )
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'qf-code-block qf-markdown-code-block my-2 block overflow-hidden rounded-lg border border-border',
        supportedPreview && 'quickforge-svg-code-block',
        showPreview && 'relative',
      )}
    >
      {showPreview ? (
        <>
          <div
            className={cn('quickforge-svg-code-preview', previewIsMermaid && 'quickforge-mermaid-code-preview')}
            aria-label={previewAlt}
          >
            <img
              src={previewUrl}
              alt={previewAlt}
              title={previewTitle}
              onClick={() => setLightbox({ src: previewUrl, label: previewAlt })}
            />
          </div>
          {/* Legacy menu offset: top 0.75rem / right 0.35rem (was top-1 right-1). */}
          <div className="absolute top-[0.75rem] right-[0.35rem] z-[2]">
            <CodeBlockMenu actions={menuActions} copiedAction={copiedAction} />
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-muted-foreground font-mono">{label}</span>
            <div className="flex items-center gap-1">
              {supportedPreview ? (
                <CodeBlockMenu actions={menuActions} copiedAction={copiedAction} />
              ) : (
                <CodeBlockCopyButton
                  copied={copiedAction === 'copy-code'}
                  onCopy={() => copy('copy-code', source, COPY_BUTTON_FEEDBACK_MS)}
                />
              )}
              {/* Legacy order: the run button is appended after the copy button
                  ([copy][run]) and only assistant messages get it — the old
                  decoration selector was 'assistant-message markdown-block
                  code-block', keeping user messages / thinking blocks clean. */}
              {shellBlock && runInTerminalEnabled && assistant ? (
                <button
                  type="button"
                  data-qf-action="execute-markdown-command"
                  className="pointer-events-auto inline-flex size-8 items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-500/10 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400 dark:hover:text-emerald-300"
                  title={t('executeInTerminal')}
                  aria-label={t('executeInTerminal')}
                  disabled={streaming}
                  onClick={() => {
                    const latestCommand = normalizeShellCommand(source)
                    if (!latestCommand) return
                    window.dispatchEvent(new CustomEvent('quickforge:execute-markdown-command', {
                      detail: createExecuteMarkdownCommandDetail(latestCommand),
                    }))
                  }}
                >
                  <Play size={16} />
                </button>
              ) : null}
            </div>
          </div>
          {mermaidError ? (
            <div className="quickforge-mermaid-code-error px-3">{t('mermaidRenderFailed')}</div>
          ) : null}
          <div className="overflow-auto max-h-96">
            <pre className="!bg-transparent !border-0 !rounded-none m-0 px-4 pb-4 text-xs text-foreground font-mono">
              <code className={`language-${label}`}>
                {highlightSegments.map((segment, index) => (
                  segment.token === 'plain'
                    ? segment.text
                    : <span key={index} className={HIGHLIGHT_TOKEN_CLASSES[segment.token]}>{segment.text}</span>
                ))}
              </code>
            </pre>
          </div>
        </>
      )}
      {lightbox ? (
        <div
          className="quickforge-svg-code-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.label}
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox.src} alt={lightbox.label} onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </div>
  )
})

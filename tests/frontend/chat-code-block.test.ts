import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  CodeBlock,
  CodeBlockCopyButton,
  closesCodeBlockMenu,
  codeBlockLanguage,
  codeBlockLanguageLabel,
  commandLineCount,
  createExecuteMarkdownCommandDetail,
  createSvgPreviewUrl,
  isDangerousShellCommand,
  isPreviewableSvg,
  isShellCodeLanguage,
  normalizeShellCommand,
} from '../../src/components/chat/surface/CodeBlock'
import { MarkdownBlock, isSafeMarkdownImageSrc } from '../../src/components/chat/surface/Markdown'
import { CommandActionsEnabledContext, AssistantStreamingContext } from '../../src/components/chat/surface/surface-context'

// Deterministic t stub — assertions pin the i18n keys, not the locale.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

// Source pinning for the interactive <details>-menu wiring that
// renderToStaticMarkup cannot exercise (same pattern as
// chat-surface-behavior-alignment.test.ts).
const codeBlockSource = readFileSync(new URL('../../src/components/chat/surface/CodeBlock.tsx', import.meta.url), 'utf8')

/** Whole `<button …>` tag for a given `data-qf-action` hook. */
function actionTag(markup: string, action: string) {
  return markup.match(new RegExp(`<button[^>]*data-qf-action="${action}"[^>]*>`))?.[0] ?? ''
}

/** Inner markup of the rendered `<code>` element. */
function codeInnerMarkup(markup: string) {
  return markup.match(/<code[^>]*>([\s\S]*)<\/code>/)?.[1] ?? ''
}

/** Markup → visible text (tags stripped, React entity escapes decoded). */
function visibleCodeText(markup: string) {
  return codeInnerMarkup(markup)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

function renderCodeBlock(props: Parameters<typeof CodeBlock>[0]) {
  return renderToStaticMarkup(createElement(CodeBlock, props))
}

describe('code block helpers', () => {
  it('extracts the fenced language from a react-markdown className', () => {
    expect(codeBlockLanguage('language-bash')).toBe('bash')
    expect(codeBlockLanguage('foo language-typescript bar')).toBe('typescript')
    expect(codeBlockLanguage(undefined)).toBeUndefined()
  })

  it('labels blocks like the legacy code-block (language verbatim || plaintext)', () => {
    expect(codeBlockLanguageLabel(undefined)).toBe('plaintext')
    expect(codeBlockLanguageLabel('  ')).toBe('plaintext')
    // Legacy <code-block> rendered `this.language` verbatim — no case folding.
    expect(codeBlockLanguageLabel(' Python ')).toBe('Python')
  })

  it('recognizes shell code languages', () => {
    expect(isShellCodeLanguage('BASH')).toBe(true)
    expect(isShellCodeLanguage('powershell')).toBe(true)
    expect(isShellCodeLanguage('python')).toBe(false)
    expect(isShellCodeLanguage(undefined)).toBe(false)
  })

  it('only treats self-contained SVG documents as previewable', () => {
    expect(isPreviewableSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBe(true)
    expect(isPreviewableSvg('<svg><rect/>')).toBe(false)
    expect(isPreviewableSvg('<div/>')).toBe(false)
    expect(isPreviewableSvg('<svg><script>alert(1)</script></svg>')).toBe(false)
    expect(isPreviewableSvg('<svg><foreignObject/></svg>')).toBe(false)
    expect(isPreviewableSvg('<svg onload="alert(1)"></svg>')).toBe(false)
    expect(isPreviewableSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toBe(false)
  })

  it('creates an encoded SVG preview data URL', () => {
    const url = createSvgPreviewUrl('<svg xmlns="http://www.w3.org/2000/svg"><text>开始</text></svg>')
    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(url.split(',')[1])).toContain('<text>开始</text>')
  })

  it('normalizes shell prompts out of a command', () => {
    expect(normalizeShellCommand('$ npm test\n> echo hi\nPS C:\\> dir')).toBe('npm test\necho hi\ndir')
    expect(normalizeShellCommand('  \n  ')).toBe('')
  })

  it('counts only non-empty command lines', () => {
    expect(commandLineCount('a\n\n  b  \n')).toBe(2)
  })

  it('flags dangerous commands', () => {
    expect(isDangerousShellCommand('rm -rf /')).toBe(true)
    expect(isDangerousShellCommand('git push origin main')).toBe(true)
    expect(isDangerousShellCommand('npm test')).toBe(false)
  })

  it('builds the execute-markdown-command event detail', () => {
    expect(createExecuteMarkdownCommandDetail('npm test')).toEqual({ command: 'npm test', confirm: false, dangerous: false })
    expect(createExecuteMarkdownCommandDetail('npm test\nnpm run build')).toEqual({
      command: 'npm test\nnpm run build',
      confirm: true,
      dangerous: false,
    })
    expect(createExecuteMarkdownCommandDetail('rm -rf /')).toEqual({ command: 'rm -rf /', confirm: false, dangerous: true })
  })
})

describe('CodeBlock rendering', () => {
  it('renders a plain block with the language label and a copy button', () => {
    const markup = renderCodeBlock({ language: 'python', source: 'print(1)' })

    expect(markup).toContain('qf-code-block')
    expect(markup).toContain('language-python')
    // Highlighted spans render inside pre>code; the visible text stays verbatim.
    expect(visibleCodeText(markup)).toBe('print(1)')
    expect(actionTag(markup, 'copy-code')).toContain('title="copy"')
    // User messages / non-assistant blocks get no terminal or preview affordances.
    expect(markup).not.toContain('data-qf-action="execute-markdown-command"')
  })

  it('adds an enabled run-in-terminal button for assistant shell blocks', () => {
    const markup = renderCodeBlock({ language: 'bash', source: 'npm run test', isAssistant: true, commandActionsEnabled: true })

    const runButton = actionTag(markup, 'execute-markdown-command')
    expect(runButton).toContain('title="executeInTerminal"')
    expect(runButton).not.toContain(' disabled=""')
    expect(actionTag(markup, 'copy-code')).not.toBe('')
  })

  it('disables the run-in-terminal button while streaming', () => {
    const markup = renderCodeBlock({
      language: 'bash',
      source: 'npm run test',
      isAssistant: true,
      isStreaming: true,
      commandActionsEnabled: true,
    })

    expect(actionTag(markup, 'execute-markdown-command')).toContain(' disabled=""')
  })

  it('omits the run button when terminal actions are disabled', () => {
    const markup = renderCodeBlock({ language: 'bash', source: 'npm run test', isAssistant: true, commandActionsEnabled: false })

    expect(markup).not.toContain('data-qf-action="execute-markdown-command"')
    expect(actionTag(markup, 'copy-code')).not.toBe('')
  })

  it('renders an SVG preview panel with the preview/source toolbar', () => {
    const markup = renderCodeBlock({
      language: 'svg',
      source: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>',
      isAssistant: true,
    })

    expect(markup).toContain('quickforge-svg-code-preview')
    expect(markup).toContain('data:image/svg+xml')
    // Legacy ⋯ menu offset: top 0.75rem / right 0.35rem.
    expect(markup).toContain('top-[0.75rem]')
    expect(markup).toContain('right-[0.35rem]')
    expect(markup).not.toContain('top-1 right-1')
    expect(markup).toContain('data-qf-action="svg-preview-mode"')
    expect(markup).toContain('data-qf-action="svg-source-mode"')
    expect(markup).toContain('data-qf-action="copy-svg-source"')
    expect(markup).toContain('data-qf-action="download-svg"')
    // Preview mode hides the raw source; the plain copy button is replaced by the toolbar.
    expect(markup).not.toContain('language-svg')
    expect(markup).not.toContain('data-qf-action="copy-code"')
  })

  it('falls back to a plain block for unsafe or malformed SVG', () => {
    for (const source of ['<svg onload="alert(1)"></svg>', '<svg><rect/>']) {
      const markup = renderCodeBlock({ language: 'svg', source, isAssistant: true })
      expect(markup).not.toContain('quickforge-svg-code-preview')
      expect(markup).toContain('language-svg')
      expect(actionTag(markup, 'copy-code')).not.toBe('')
    }
  })

  it('keeps capability gates case-insensitive while the title bar keeps the fenced spelling', () => {
    // Legacy decorators lowercased the language before the SVG check…
    const preview = renderCodeBlock({
      language: 'SVG',
      source: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      isAssistant: true,
    })
    expect(preview).toContain('quickforge-svg-code-preview')

    // …while the legacy <code-block> title bar rendered `this.language` verbatim.
    const plain = renderCodeBlock({ language: 'SVG', source: '<svg><rect/>', isAssistant: false })
    expect(plain).toContain('>SVG</span>')
    expect(plain).toContain('<code class="language-SVG">')
  })

  it('does not decorate SVG blocks outside assistant messages', () => {
    const markup = renderCodeBlock({
      language: 'svg',
      source: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      isAssistant: false,
    })

    expect(markup).not.toContain('quickforge-svg-code-preview')
    expect(markup).toContain('language-svg')
  })

  it('renders the mermaid toolbar for assistant blocks (preview resolves async)', () => {
    const markup = renderCodeBlock({ language: 'mermaid', source: 'graph TD; A-->B;', isAssistant: true })

    expect(markup).toContain('quickforge-svg-code-menu')
    expect(markup).toContain('data-qf-action="mermaid-preview-mode"')
    expect(markup).toContain('data-qf-action="mermaid-source-mode"')
    expect(markup).toContain('data-qf-action="copy-mermaid-source"')
    expect(markup).toContain('data-qf-action="download-mermaid-svg"')
    expect(markup).toContain('language-mermaid')
    expect(markup).not.toContain('quickforge-svg-code-preview')
  })

  it('keeps mermaid source (no toolbar) while the message is streaming', () => {
    const markup = renderCodeBlock({ language: 'mermaid', source: 'graph TD; A-->B;', isAssistant: true, isStreaming: true })

    expect(markup).toContain('language-mermaid')
    expect(markup).not.toContain('quickforge-svg-code-preview')
    expect(markup).not.toContain('data-qf-action="mermaid-preview-mode"')
  })

  it('reads the streaming gate from the surface context, not from a DOM ancestor', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>'
    const wrapped = (streaming: boolean) => renderToStaticMarkup(
      createElement(
        AssistantStreamingContext.Provider,
        { value: streaming },
        createElement(CodeBlock, { language: 'svg', source: svg, isAssistant: true }),
      ),
    )

    // Streaming: source only, no preview (and no mount-time DOM probe could have
    // told this block otherwise — there is no `.qf-streaming-message` anywhere).
    const streaming = wrapped(true)
    expect(streaming).not.toContain('quickforge-svg-code-preview')
    expect(streaming).toContain('language-svg')

    // Settled: the preview comes back.
    const settled = wrapped(false)
    expect(settled).toContain('quickforge-svg-code-preview')
    expect(settled).toContain('data:image/svg+xml')

    // The default (no provider) stays fail-closed like the other surface context.
    const bare = renderCodeBlock({ language: 'svg', source: svg, isAssistant: true })
    expect(bare).toContain('quickforge-svg-code-preview')
  })
})

describe('CodeBlock legacy interaction alignment', () => {
  it('keeps the menu open after a copy-source action; download and mode toggles close it', () => {
    // Legacy code-blocks.ts: only copy-source left the menu open so the item's
    // "copied" feedback (legacy `showCopiedFeedback`, 1200ms — distinct from
    // the 2000ms title-bar copy button) stayed visible.
    expect(closesCodeBlockMenu({ keepsMenuOpen: true })).toBe(false)
    expect(closesCodeBlockMenu({})).toBe(true)
    // Exactly the two copy-source actions keep the menu open…
    expect(codeBlockSource.match(/keepsMenuOpen: true/g)).toHaveLength(2)
    expect(codeBlockSource).toContain("action: 'copy-svg-source'")
    expect(codeBlockSource).toContain("action: 'copy-mermaid-source'")
    // …and the item click handler consults that decision before closing.
    expect(codeBlockSource).toMatch(/if \(closesCodeBlockMenu\(action\) && detailsRef\.current\) detailsRef\.current\.open = false/)
    // The copied feedback lives on the menu item itself (legacy showCopiedFeedback).
    expect(codeBlockSource).toContain("const label = copied ? t('copied') : action.label")
    expect(codeBlockSource).toContain('{copied ? <Check size={15} /> : action.icon}')
  })

  it('keeps the legacy per-path copy feedback durations: title bar 2000ms, ⋯ menu 1200ms', () => {
    // Title-bar copy button = mini-lit `copy-button` (2000ms "copied" reset).
    expect(codeBlockSource).toContain('const COPY_BUTTON_FEEDBACK_MS = 2000')
    expect(codeBlockSource).toMatch(/copy\('copy-code', source, COPY_BUTTON_FEEDBACK_MS\)/)
    // ⋯ menu copy actions = decoration layer `showCopiedFeedback` (1200ms).
    expect(codeBlockSource).toContain('const MENU_COPY_FEEDBACK_MS = 1200')
    expect(codeBlockSource).toMatch(/copy\('copy-svg-source', svgSource, MENU_COPY_FEEDBACK_MS\)/)
    expect(codeBlockSource).toMatch(/copy\('copy-mermaid-source', source\.trim\(\), MENU_COPY_FEEDBACK_MS\)/)
    // The flash records its own duration and the reset timer reads it back, so
    // the old single shared constant cannot collapse the two paths again.
    expect(codeBlockSource).toContain('setCopyFeedback({ action, nonce: Date.now(), durationMs })')
    expect(codeBlockSource).toContain('window.setTimeout(() => setCopyFeedback(null), copyFeedback.durationMs)')
    expect(codeBlockSource).not.toContain('const COPY_FEEDBACK_MS')
  })

  it('closes every other open code-block menu in the same markdown block (keyboard opens included)', () => {
    expect(codeBlockSource).toContain("const CODE_BLOCK_MENU_OPEN_EVENT = 'quickforge:code-block-menu-open'")
    // The broadcast fires from the open effect, which is fed by the native
    // <details> toggle event — so click and keyboard opens are both covered…
    // Mutual exclusion is scoped to the owning markdown block, mirroring the
    // legacy `closeSvgCodeBlockMenus(block.closest('markdown-block') ?? document, menu)`.
    expect(codeBlockSource).toContain("const scope: EventTarget = detailsRef.current?.closest('.qf-markdown-block') ?? document")
    expect(codeBlockSource).toContain('scope.dispatchEvent(new CustomEvent(CODE_BLOCK_MENU_OPEN_EVENT, { detail: detailsRef.current }))')
    // …and each open instance closes itself for another menu's broadcast,
    // never for its own, detaching the listener on close/unmount.
    expect(codeBlockSource).toMatch(/if \(\(event as CustomEvent\)\.detail === detailsRef\.current\) return/)
    expect(codeBlockSource).toContain('scope.addEventListener(CODE_BLOCK_MENU_OPEN_EVENT, closeOnOtherMenuOpen)')
    expect(codeBlockSource).toContain('scope.removeEventListener(CODE_BLOCK_MENU_OPEN_EVENT, closeOnOtherMenuOpen)')
    // Outside pointerdown / Escape stay document-wide (legacy shared handlers).
    expect(codeBlockSource).toContain("document.addEventListener('pointerdown', closeOnOutsideEvent, true)")
    expect(codeBlockSource).toContain("document.addEventListener('keydown', closeOnOutsideEvent)")
  })

  it('renders the shell toolbar buttons in the legacy order [copy][run]', () => {
    const markup = renderCodeBlock({ language: 'bash', source: 'npm run test', isAssistant: true, commandActionsEnabled: true })

    const copyAt = markup.indexOf('data-qf-action="copy-code"')
    const runAt = markup.indexOf('data-qf-action="execute-markdown-command"')
    expect(copyAt).toBeGreaterThan(-1)
    expect(runAt).toBeGreaterThan(-1)
    expect(copyAt).toBeLessThan(runAt)
  })

  it('keeps the run button out of non-assistant blocks even when command actions are enabled', () => {
    // No isAssistant prop: outside an assistant message (user messages /
    // thinking blocks / tool cards) the detected fallback stays false, so the
    // legacy 'assistant-message markdown-block code-block' selector gate keeps
    // the button out — even with terminal actions explicitly enabled.
    const markup = renderCodeBlock({ language: 'bash', source: 'npm run test', commandActionsEnabled: true })

    expect(markup).not.toContain('data-qf-action="execute-markdown-command"')
    expect(actionTag(markup, 'copy-code')).not.toBe('')
    // The gate itself is pinned in the source.
    expect(codeBlockSource).toContain('{shellBlock && runInTerminalEnabled && assistant ? (')
  })
})

describe('CodeBlock copy feedback (legacy copy-button parity)', () => {
  function renderCopyButton(copied: boolean) {
    return renderToStaticMarkup(createElement(CodeBlockCopyButton, { copied, onCopy: () => {} }))
  }

  it('renders a visible "copied" text next to the check icon', () => {
    // 旧 mini-lit `copy-button` 在 `showText` 下渲染 `<span>Copied!</span>`
    // （不只是把图标换成 check），由 CodeBlock 的 2000ms 计时器复位。
    const copied = renderCopyButton(true)
    const idle = renderCopyButton(false)

    expect(copied).toMatch(/<span[^>]*>copied<\/span>/)
    expect(copied).toContain('data-qf-action="copy-code"')
    expect(idle).not.toMatch(/<span[^>]*>copied<\/span>/)
  })

  it('keeps the copy title/aria-label constant instead of swapping copy → copied', () => {
    // 旧实现 title 恒为 `Copy code`（i18n `copy` key），反馈只走可见文本。
    for (const copied of [false, true]) {
      const markup = renderCopyButton(copied)
      expect(markup).toContain('title="copy"')
      expect(markup).toContain('aria-label="copy"')
      expect(markup).not.toContain('title="copied"')
    }
  })

  it('renders the zh/en visible feedback text from the i18n dictionary', async () => {
    const realI18n = (await vi.importActual('@/lib/i18n')) as typeof import('../../src/lib/i18n')

    realI18n.applyAppLanguageFromSnapshot('zh')
    expect(realI18n.t('copied')).toBe('已复制')

    realI18n.applyAppLanguageFromSnapshot('en')
    expect(realI18n.t('copied')).toBe('Copied')
  })
})

describe('MarkdownBlock code fences', () => {
  it('routes fenced code through the code-block recipe', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBlock, { content: '```bash\nnpm run test\n```' }))

    expect(markup).toContain('qf-code-block')
    expect(markup).toContain('language-bash')
    expect(actionTag(markup, 'copy-code')).not.toBe('')
  })

  it('renders a fence without an info string with the legacy text label', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBlock, { content: '```\nplain output\n```' }))

    // Legacy markdown layer emitted `<code-block language="text">` for fences
    // without an info string, so the title bar read `text`, not `plaintext`.
    expect(markup).toContain('>text</span>')
    expect(markup).toContain('<code class="language-text">')
    expect(markup).not.toContain('language-plaintext')
  })

  it('keeps the fenced language spelling in the title bar', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBlock, { content: '```Python\nprint(1)\n```' }))

    // Legacy <code-block> rendered `this.language` verbatim (no case folding).
    expect(markup).toContain('>Python</span>')
    expect(markup).toContain('<code class="language-Python">')
  })

  it('keeps inline code inline (no code block frame)', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBlock, { content: 'use `npm ci` now' }))

    expect(markup).toContain('<code')
    expect(markup).toContain('bg-muted')
    expect(markup).not.toContain('bg-muted/35')
    expect(markup).not.toContain('qf-code-block')
  })

  it('keeps mermaid fences as source blocks in the server-rendered markup', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBlock, { content: '```mermaid\ngraph TD; A-->B;\n```' }))

    expect(markup).toContain('language-mermaid')
    expect(markup).toContain('graph TD; A--&gt;B;')
  })
})

describe('MarkdownBlock image safety', () => {
  it('renders safe image sources and keeps the alt text', () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownBlock, { content: '![chart](https://example.com/chart.png "Quarterly")' }),
    )

    expect(markup).toContain('src="https://example.com/chart.png"')
    expect(markup).toContain('alt="chart"')
    expect(markup).toContain('title="Quarterly"')
  })

  it('strips dangerous image schemes from the rendered markup', () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownBlock, { content: '![pwn](javascript:alert(1)) and ![doc](vbscript:msgbox)' }),
    )

    expect(markup).toContain('<img')
    expect(markup).not.toContain('javascript:')
    expect(markup).not.toContain('vbscript:')
  })

  it('allows http(s), data:image, blob and relative sources, blocks everything else', () => {
    expect(isSafeMarkdownImageSrc('https://example.com/a.png')).toBe(true)
    expect(isSafeMarkdownImageSrc('http://example.com/a.png')).toBe(true)
    expect(isSafeMarkdownImageSrc('data:image/png;base64,aGk=')).toBe(true)
    expect(isSafeMarkdownImageSrc('blob:https://example.com/xyz')).toBe(true)
    expect(isSafeMarkdownImageSrc('./images/a.png')).toBe(true)

    expect(isSafeMarkdownImageSrc('javascript:alert(1)')).toBe(false)
    expect(isSafeMarkdownImageSrc('vbscript:msgbox')).toBe(false)
    expect(isSafeMarkdownImageSrc('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isSafeMarkdownImageSrc('file:///etc/passwd')).toBe(false)
  })
})

describe('CodeBlock command-action context', () => {
  const shell = { language: 'bash', source: 'npm run test', isAssistant: true }

  function renderInSurface(enabled: boolean) {
    return renderToStaticMarkup(
      createElement(
        CommandActionsEnabledContext.Provider,
        { value: enabled },
        createElement(CodeBlock, shell),
      ),
    )
  }

  it('renders the run-in-terminal button when the surface enables command actions', () => {
    expect(renderInSurface(true)).toContain('data-qf-action="execute-markdown-command"')
  })

  it('omits the run-in-terminal button when the surface disables command actions (side chat / read-only)', () => {
    const markup = renderInSurface(false)

    expect(markup).not.toContain('data-qf-action="execute-markdown-command"')
    expect(actionTag(markup, 'copy-code')).not.toBe('')
  })

  it('stays fail-closed outside a surface (no provider), replacing the composer DOM probe', () => {
    const markup = renderToStaticMarkup(createElement(CodeBlock, shell))

    expect(markup).not.toContain('data-qf-action="execute-markdown-command"')
  })
})

describe('CodeBlock syntax highlighting', () => {
  it('renders qf-hl spans inside pre>code for known languages', () => {
    const markup = renderCodeBlock({ language: 'typescript', source: 'const total = 42 // answer' })

    expect(markup).toContain('<pre')
    expect(markup).toContain('<code class="language-typescript">')
    expect(markup).toContain('<span class="qf-hl-keyword">const</span>')
    expect(markup).toContain('<span class="qf-hl-number">42</span>')
    expect(markup).toContain('<span class="qf-hl-comment">// answer</span>')
  })

  it('keeps the verbatim source as the code text (selection target)', () => {
    const source = 'if (x < 2) { return "a&b" }'
    const markup = renderCodeBlock({ language: 'javascript', source })

    expect(visibleCodeText(markup)).toBe(source)
    expect(codeInnerMarkup(markup)).toContain('qf-hl-string')
    // React escapes the source text; spans never alter the characters.
    expect(codeInnerMarkup(markup)).toContain('&quot;a&amp;b&quot;')
  })

  it('keeps the copy button next to highlighted spans (copies the raw source)', () => {
    // The copy handler binds the `source` prop directly (see CodeBlock), so the
    // clipboard always gets the original text; this pins that the highlighted
    // DOM itself also still carries the full verbatim text.
    const markup = renderCodeBlock({ language: 'bash', source: 'echo "hi"' })

    expect(actionTag(markup, 'copy-code')).not.toBe('')
    expect(markup).toContain('<span class="qf-hl-builtin">echo</span>')
    expect(visibleCodeText(markup)).toBe('echo "hi"')
  })

  it('renders unknown languages without highlight spans (legacy plain behavior)', () => {
    const markup = renderCodeBlock({ language: 'kotlin', source: 'val x = 1' })

    expect(markup).toContain('language-kotlin')
    expect(markup).not.toContain('qf-hl-')
    expect(visibleCodeText(markup)).toBe('val x = 1')
  })

  it('keeps mermaid sources plain', () => {
    const markup = renderCodeBlock({ language: 'mermaid', source: 'graph TD; A-->B;' })

    expect(markup).not.toContain('qf-hl-')
    expect(visibleCodeText(markup)).toBe('graph TD; A-->B;')
  })

  it('highlights SVG source blocks that fall back from the preview', () => {
    const markup = renderCodeBlock({ language: 'svg', source: '<svg><rect/></svg>', isAssistant: false })

    expect(markup).toContain('<span class="qf-hl-tag">svg</span>')
    expect(visibleCodeText(markup)).toBe('<svg><rect/></svg>')
  })
})

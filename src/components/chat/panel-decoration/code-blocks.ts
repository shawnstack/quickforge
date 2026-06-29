import { t } from '@/lib/i18n'
import { copyTextToClipboard } from '@/lib/message-utils'
import { replaceSvg } from '../chat-utils'
import { copiedIcon, copyIcon, runIcon } from './icons'

type CodeBlockElement = HTMLElement & {
  code?: string
  language?: string
  getDecodedCode?: () => string
}

const SHELL_CODE_LANGUAGES = new Set(['bash', 'sh', 'shell', 'zsh', 'fish', 'cmd', 'bat', 'batch', 'powershell', 'ps1', 'terminal', 'console'])
const DANGEROUS_COMMAND_PATTERN = /\b(rm\s+-rf|sudo|chmod\b|chown\b|npm\s+publish|pnpm\s+publish|yarn\s+publish|git\s+push|curl\b[^\n|;]*\|\s*(sh|bash)|wget\b[^\n|;]*\|\s*(sh|bash))\b/i
const SVG_PREVIEW_UNSAFE_PATTERN = /<\s*(script|foreignObject)\b|\son[a-z]+\s*=|javascript\s*:/i

function showCopiedFeedback(button: HTMLButtonElement, defaultTitle: string, defaultIcon: string) {
  const copiedTitle = t('copied')
  const previousTimer = Number(button.dataset.quickforgeCopyFeedbackTimer)
  if (previousTimer) window.clearTimeout(previousTimer)

  replaceSvg(button, copiedIcon)
  button.title = copiedTitle
  button.setAttribute('aria-label', copiedTitle)
  button.style.color = 'rgb(5 150 105)'

  const timer = window.setTimeout(() => {
    replaceSvg(button, defaultIcon)
    button.title = defaultTitle
    button.setAttribute('aria-label', defaultTitle)
    button.style.color = ''
    delete button.dataset.quickforgeCopyFeedbackTimer
  }, 1200)
  button.dataset.quickforgeCopyFeedbackTimer = String(timer)
}

function createIconActionButton(
  action: string,
  title: string,
  icon: string,
  onClick: (button: HTMLButtonElement) => Promise<void> | void,
) {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.quickforgeAction = action
  button.title = title
  button.setAttribute('aria-label', title)
  replaceSvg(button, icon)
  button.className = 'pointer-events-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
  button.onclick = (event) => {
    event.stopPropagation()
    void onClick(button)
  }
  return button
}

function decodeCodeBlockText(block: CodeBlockElement) {
  if (typeof block.getDecodedCode === 'function') {
    try { return block.getDecodedCode() } catch { /* fallback below */ }
  }
  const raw = typeof block.code === 'string' ? block.code : block.getAttribute('code') ?? ''
  if (!raw) return ''
  try {
    return decodeURIComponent(escape(window.atob(raw)))
  } catch {
    return raw
  }
}

function normalizeShellCommand(command: string) {
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

function commandLineCount(command: string) {
  return command.split('\n').map((line) => line.trim()).filter(Boolean).length
}

function isShellCodeBlock(block: CodeBlockElement) {
  const language = String(block.language ?? block.getAttribute('language') ?? '').trim().toLowerCase()
  return SHELL_CODE_LANGUAGES.has(language)
}

function isSvgCodeBlock(block: CodeBlockElement) {
  const language = String(block.language ?? block.getAttribute('language') ?? '').trim().toLowerCase()
  return language === 'svg'
}

function isPreviewableSvg(svg: string) {
  const trimmed = svg.trim()
  return /^<svg[\s>]/i.test(trimmed) && /<\/svg>\s*$/i.test(trimmed) && !SVG_PREVIEW_UNSAFE_PATTERN.test(trimmed)
}

function createSvgPreviewUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

type SvgPreviewLightboxElement = HTMLDivElement & {
  quickforgeCleanup?: () => void
}

function closeSvgPreviewLightbox() {
  const existing = document.querySelector<SvgPreviewLightboxElement>('.quickforge-svg-code-lightbox')
  existing?.quickforgeCleanup?.()
  existing?.remove()
}

function showSvgPreviewLightbox(src: string) {
  closeSvgPreviewLightbox()

  const lightbox = document.createElement('div') as SvgPreviewLightboxElement
  lightbox.className = 'quickforge-svg-code-lightbox'
  lightbox.setAttribute('role', 'dialog')
  lightbox.setAttribute('aria-modal', 'true')
  lightbox.setAttribute('aria-label', 'SVG preview')

  const image = document.createElement('img')
  image.alt = 'SVG preview'
  image.src = src
  image.addEventListener('click', (event) => event.stopPropagation())
  lightbox.append(image)

  const close = () => closeSvgPreviewLightbox()
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }
  lightbox.quickforgeCleanup = () => document.removeEventListener('keydown', handleKeyDown)
  lightbox.addEventListener('click', close)
  document.addEventListener('keydown', handleKeyDown)
  document.body.append(lightbox)
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

function fingerprintText(text: string) {
  let hash = 0
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(31, hash) + text.charCodeAt(index) | 0
  }
  return `${text.length}:${hash}`
}

function cleanupMarkdownSvgCodeBlock(block: CodeBlockElement) {
  if (block.nextElementSibling instanceof HTMLElement && block.nextElementSibling.dataset.quickforgeSvgPreview === 'true') {
    block.nextElementSibling.remove()
  }
  block.querySelector<HTMLElement>('[data-quickforge-svg-preview="true"]')?.remove()
  block.classList.remove('quickforge-svg-code-block')
  block.querySelector<HTMLElement>('copy-button[data-quickforge-svg-original-copy="true"]')?.removeAttribute('hidden')
  block.querySelector<HTMLElement>('copy-button[data-quickforge-svg-original-copy="true"]')?.removeAttribute('data-quickforge-svg-original-copy')
  block.querySelector<HTMLElement>('[data-quickforge-svg-toolbar="true"]')?.remove()
  const codeContent = block.querySelector('pre')?.parentElement
  if (codeContent instanceof HTMLElement) codeContent.hidden = false
  delete block.dataset.quickforgeSvgPreviewSource
  delete block.dataset.quickforgeSvgMode
}

function setSvgCodeBlockMode(block: CodeBlockElement, mode: 'preview' | 'source') {
  const preview = block.querySelector<HTMLElement>('[data-quickforge-svg-preview="true"]')
  const titleBar = block.querySelector<HTMLElement>(':scope > div > div:first-child')
  const codeContent = block.querySelector('pre')?.parentElement

  block.dataset.quickforgeSvgMode = mode
  if (preview) preview.hidden = mode !== 'preview'
  if (titleBar) titleBar.classList.toggle('quickforge-svg-code-toolbar-floating', mode === 'preview')
  if (codeContent instanceof HTMLElement) codeContent.hidden = mode === 'preview'
}

function createSvgMenuItem(action: string, title: string, icon: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.quickforgeAction = action
  button.className = 'quickforge-svg-code-menu-item'
  button.title = title
  button.setAttribute('aria-label', title)
  button.setAttribute('role', 'menuitem')
  replaceSvg(button, icon)
  return button
}

export function closeSvgCodeBlockMenus(panel: ParentNode = document, except?: HTMLDetailsElement) {
  panel.querySelectorAll<HTMLDetailsElement>('.quickforge-svg-code-menu[open]').forEach((menu) => {
    if (menu !== except) menu.open = false
  })
}

let svgCodeMenuOutsideHandlerBound = false

function ensureSvgCodeMenuOutsideHandler() {
  if (svgCodeMenuOutsideHandlerBound) return
  svgCodeMenuOutsideHandlerBound = true
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Element | null
    if (target?.closest('.quickforge-svg-code-menu')) return
    closeSvgCodeBlockMenus(document)
  }, true)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSvgCodeBlockMenus(document)
  })
}

function ensureSvgCodeBlockToolbar(block: CodeBlockElement, svg: string) {
  ensureSvgCodeMenuOutsideHandler()

  const titleBar = block.querySelector<HTMLElement>(':scope > div > div:first-child')
  const copyButton = titleBar?.querySelector<HTMLElement>('copy-button')
  if (!titleBar || !copyButton) return

  let toolbar = titleBar.querySelector<HTMLElement>('[data-quickforge-svg-toolbar="true"]')
  if (!toolbar) {
    toolbar = document.createElement('div')
    toolbar.dataset.quickforgeSvgToolbar = 'true'
    toolbar.className = 'quickforge-svg-code-toolbar'

    const menu = document.createElement('details')
    menu.className = 'quickforge-svg-code-menu'

    const trigger = document.createElement('summary')
    trigger.className = 'quickforge-svg-code-menu-trigger'
    trigger.title = t('moreActions')
    trigger.setAttribute('aria-label', t('moreActions'))
    trigger.textContent = '⋯'

    const content = document.createElement('div')
    content.className = 'quickforge-svg-code-menu-content'
    content.setAttribute('role', 'menu')

    const previewButton = createSvgMenuItem('svg-preview-mode', t('svgPreviewMode'), '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>')
    const sourceButton = createSvgMenuItem('svg-source-mode', t('svgSourceMode'), '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>')
    const copySourceButton = createSvgMenuItem('copy-svg-code', t('copySvgSource'), copyIcon)
    const downloadButton = createSvgMenuItem('download-svg-code', t('downloadSvg'), '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>')
    content.append(previewButton, sourceButton, copySourceButton, downloadButton)

    copyButton.before(toolbar)
    copyButton.dataset.quickforgeSvgOriginalCopy = 'true'
    copyButton.setAttribute('hidden', '')
    menu.append(trigger, content)
    toolbar.append(menu)
  }

  const menu = toolbar.querySelector<HTMLDetailsElement>('.quickforge-svg-code-menu')
  const previewButton = toolbar.querySelector<HTMLButtonElement>('[data-quickforge-action="svg-preview-mode"]')
  const sourceButton = toolbar.querySelector<HTMLButtonElement>('[data-quickforge-action="svg-source-mode"]')
  const copySourceButton = toolbar.querySelector<HTMLButtonElement>('[data-quickforge-action="copy-svg-code"]')
  const downloadButton = toolbar.querySelector<HTMLButtonElement>('[data-quickforge-action="download-svg-code"]')
  const closeMenu = () => { if (menu) menu.open = false }

  if (menu && !menu.dataset.quickforgeSvgMenuBound) {
    menu.dataset.quickforgeSvgMenuBound = 'true'
    menu.addEventListener('toggle', () => {
      if (!menu.open) return
      closeSvgCodeBlockMenus(block.closest('markdown-block') ?? document, menu)
    })
  }

  if (previewButton) previewButton.onclick = () => {
    setSvgCodeBlockMode(block, 'preview')
    closeMenu()
  }
  if (sourceButton) sourceButton.onclick = () => {
    setSvgCodeBlockMode(block, 'source')
    closeMenu()
  }
  if (copySourceButton) copySourceButton.onclick = async () => {
    await copyTextToClipboard(svg)
    showCopiedFeedback(copySourceButton, t('copySvgSource'), copyIcon)
  }
  if (downloadButton) downloadButton.onclick = () => {
    downloadTextFile(`quickforge-svg-${Date.now()}.svg`, svg, 'image/svg+xml;charset=utf-8')
    closeMenu()
  }
}

export function decorateMarkdownSvgCodeBlocks(panel: HTMLElement, isStreaming: boolean) {
  panel.querySelectorAll<CodeBlockElement>('assistant-message markdown-block code-block').forEach((block) => {
    if (!isSvgCodeBlock(block)) {
      cleanupMarkdownSvgCodeBlock(block)
      return
    }
    if (isStreaming) return

    const svg = decodeCodeBlockText(block).trim()
    if (!svg || !isPreviewableSvg(svg)) {
      cleanupMarkdownSvgCodeBlock(block)
      return
    }

    const fingerprint = fingerprintText(svg)
    const existing = block.querySelector<HTMLElement>('[data-quickforge-svg-preview="true"]')
    if (existing && block.dataset.quickforgeSvgPreviewSource === fingerprint) {
      ensureSvgCodeBlockToolbar(block, svg)
      setSvgCodeBlockMode(block, block.dataset.quickforgeSvgMode === 'source' ? 'source' : 'preview')
      return
    }

    const titleBar = block.querySelector<HTMLElement>(':scope > div > div:first-child')
    if (!titleBar) return

    cleanupMarkdownSvgCodeBlock(block)

    const preview = document.createElement('div')
    block.classList.add('quickforge-svg-code-block')
    preview.dataset.quickforgeSvgPreview = 'true'
    preview.className = 'quickforge-svg-code-preview'
    preview.setAttribute('aria-label', 'SVG preview')

    const image = document.createElement('img')
    image.alt = 'SVG preview'
    image.src = createSvgPreviewUrl(svg)
    image.title = t('svgEnlargePreview')
    image.addEventListener('click', () => showSvgPreviewLightbox(image.src))
    preview.replaceChildren(image)

    titleBar.after(preview)
    ensureSvgCodeBlockToolbar(block, svg)
    block.dataset.quickforgeSvgPreviewSource = fingerprint
    setSvgCodeBlockMode(block, block.dataset.quickforgeSvgMode === 'source' ? 'source' : 'preview')
  })
}

export function decorateMarkdownCommandBlocks(panel: HTMLElement, isStreaming: boolean) {
  panel.querySelectorAll<CodeBlockElement>('assistant-message markdown-block code-block').forEach((block) => {
    const existing = block.querySelector<HTMLButtonElement>('[data-quickforge-action="execute-markdown-command"]')
    if (!isShellCodeBlock(block)) {
      existing?.remove()
      delete block.dataset.quickforgeCommand
      return
    }

    // For blocks we have already decorated, skip the base64 decode + regex
    // normalization when the decoded command has not changed (cheaply tracked
    // via a dataset fingerprint). During streaming this avoid re-decoding every
    // shell code-block in the panel on each rAF-batched decorate pass; the click
    // handler below always re-reads the latest command, so correctness is kept.
    let command: string | null
    if (existing && block.dataset.quickforgeCommand !== undefined) {
      if (existing.disabled === isStreaming) {
        // Content unchanged AND streaming state unchanged → nothing to do.
        return
      }
      command = block.dataset.quickforgeCommand
    } else {
      command = normalizeShellCommand(decodeCodeBlockText(block))
    }
    if (!command) {
      existing?.remove()
      delete block.dataset.quickforgeCommand
      return
    }
    block.dataset.quickforgeCommand = command

    const title = t('executeInTerminal')
    const button = existing ?? createIconActionButton('execute-markdown-command', title, runIcon, () => {
      const latestCommand = normalizeShellCommand(decodeCodeBlockText(block))
      if (!latestCommand) return
      window.dispatchEvent(new CustomEvent('quickforge:execute-markdown-command', {
        detail: {
          command: latestCommand,
          confirm: commandLineCount(latestCommand) > 1,
          dangerous: DANGEROUS_COMMAND_PATTERN.test(latestCommand),
        },
      }))
    })
    button.title = title
    button.setAttribute('aria-label', title)
    button.disabled = isStreaming
    button.className = 'pointer-events-auto inline-flex size-8 items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-500/10 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400 dark:hover:text-emerald-300'

    if (!existing) {
      const titleBar = block.querySelector<HTMLElement>(':scope > div > div:first-child')
      const copyButton = titleBar?.querySelector('copy-button')
      if (titleBar && copyButton) {
        const wrapper = document.createElement('div')
        wrapper.className = 'flex items-center gap-1'
        copyButton.before(wrapper)
        wrapper.appendChild(copyButton)
        wrapper.appendChild(button)
      }
    }
  })
}

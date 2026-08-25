/**
 * Slash 选中态 chip（design-mockups/slash-menu-expansion.html · 方案 A 已定稿）。
 *
 * 职责：
 * - 纯逻辑：用户文本中 `/skill <name>` / `/agent <name>` 前缀的解析、匹配校验、
 *   消息流首文本节点的「剥前缀 + 还原」计划，以及光标对齐补偿的 spacer 宽度计算；
 * - 共享 chip 元素工厂：输入框覆盖层与消息流装饰共用同一 chip 类
 *   （quickforge-slash-chip + -skill/-agent 变体，样式见 index.css）；
 * - 控制器工厂：选中态状态机 + 输入行内联 chip 覆盖层渲染。
 *
 * 覆盖层方案（方案 A）：textarea 原文保持 `/agent explore 任务…` 不变（服务端零
 * 改动、草稿/恢复/发送不受影响），激活时给 textarea 加 quickforge-slash-source-text
 * （文字透明、光标保留），在 .quickforge-composer-shell 内挂一层
 * quickforge-slash-overlay 镜像：chip + 定宽 spacer + 任务文本。spacer 宽度 =
 * max(0, 原前缀文本宽度 - chip 实际宽度)，使任务文本起始于原始前缀的真实宽度处，
 * 保证幽灵层换行/滚动与 textarea 一致；chip 宽于前缀的罕见情形 spacer 归 0，
 * 任务文本从 chip 尾部起排（视觉小瑕疵，接受）。
 *
 * 交互细节：
 * - IME：composition 期间覆盖层保持显示——chip 不消失，预编辑文本（拼音串）
 *   经 compositionupdate 镜像进幽灵层并以弱下划线提示输入中状态；浏览器将
 *   预编辑写入 textarea.value（透明不重绘），候选窗仍锚定真实光标；
 *   compositionend 后按最新文本走 update 校验；
 * - 光标进入前缀区域（selectionchange）→ 降级显示原文（隐藏覆盖层、卸透明 class，
 *   选中态保留），光标回到尾部自愈恢复；
 * - 点击 chip 本体（CSS pointer-events:auto + pointerdown 拦截）不穿透到前缀区：
 *   聚焦 textarea 并把光标移到文本末尾，chip 保持显示、不降级露出原文；
 * - Escape → clear()：保留文本退出选中态，并记住 dismissed 前缀——同前缀在文本
 *   变化前不再自动 engage（否则 Esc 无效）；
 * - removePrefix()：删除 cmd 前缀（含紧随一个空格）并退出，用于退格到 chip 右边界。
 *
 * 结构参考 input-clamp / tool-marquee：纯逻辑导出 + 控制器通过结构化类型注入 DOM
 * 能力（node 环境可单测，不依赖 jsdom）。
 */

import { slashIcons } from './slash-icons'
import { t } from '@/lib/i18n'
import type { MessageEditorElement } from './chat-utils'

export type SlashInvocationKind = 'skill' | 'agent'

export type SlashInvocation = {
  kind: SlashInvocationKind
  name: string
  /** 完整命令前缀（无尾随空格），如 "/agent explore"。 */
  cmd: string
}

const SLASH_INVOCATION_TEXT_CLASS = 'quickforge-slash-source-text'

// ---------------------------------------------------------------------------
// 纯逻辑（node 环境可直接单测）
// ---------------------------------------------------------------------------

const SLASH_INVOCATION_PATTERN = /^\/(skill|agent)[\s]+(\S+)(?=\s|$)/i

/**
 * 解析文本开头的 slash 调用前缀；name 后必须紧跟空格或行尾（避免打字中途闪切）。
 * cmd 保留用户实际输入的大小写，长度与原文前缀严格一致（幽灵层按 cmd.length 切片）。
 */
export function parseSlashInvocationPrefix(text: string): SlashInvocation | null {
  const match = SLASH_INVOCATION_PATTERN.exec(text)
  if (!match) return null
  return {
    kind: match[1].toLowerCase() as SlashInvocationKind,
    name: match[2],
    cmd: `/${match[1]} ${match[2]}`,
  }
}

/** 当前文本是否仍是该 cmd 的有效选中态：大小写不敏感前缀匹配 + 词边界（空格/行尾）。 */
export function slashInvocationPrefixMatches(text: string, cmd: string): boolean {
  if (!text.toLowerCase().startsWith(cmd.toLowerCase())) return false
  const next = text.charAt(cmd.length)
  return next === '' || /\s/.test(next)
}

/** 消息流首文本节点的剥前缀计划：prefix 为被剥掉的精确字符（含紧随一个空格），rest 为剩余正文。 */
export type SlashChipTextPlan = {
  invocation: SlashInvocation
  prefix: string
  rest: string
}

export function planSlashChipText(content: string): SlashChipTextPlan | null {
  const invocation = parseSlashInvocationPrefix(content)
  if (!invocation) return null
  const after = content.slice(invocation.cmd.length)
  const space = after.startsWith(' ') ? ' ' : ''
  return { invocation, prefix: content.slice(0, invocation.cmd.length) + space, rest: after.slice(space.length) }
}

/** 光标对齐补偿：spacer 宽度 = max(0, 前缀文本宽度 - chip 实际宽度)。 */
export function slashChipSpacerWidth(prefixWidth: number, chipWidth: number): number {
  const prefix = Number.isFinite(prefixWidth) ? prefixWidth : 0
  const chip = Number.isFinite(chipWidth) ? chipWidth : 0
  return Math.max(0, prefix - chip)
}

// ---------------------------------------------------------------------------
// 共享 chip 元素（输入框覆盖层 + 消息流装饰）
// ---------------------------------------------------------------------------

/** 创建 chip 元素：quickforge-slash-chip + kind 变体，title 为完整命令原文。 */
export function createSlashChipElement(invocation: SlashInvocation): HTMLElement {
  const chip = document.createElement('span')
  chip.className = `quickforge-slash-chip quickforge-slash-chip-${invocation.kind}`
  const icon = document.createElement('span')
  icon.className = 'quickforge-slash-chip-icon'
  icon.innerHTML = slashIcons[invocation.kind]
  const name = document.createElement('span')
  name.className = 'quickforge-slash-chip-name'
  name.textContent = invocation.name
  chip.append(icon, name)
  chip.title = invocation.cmd
  chip.setAttribute(
    'aria-label',
    `${t(invocation.kind === 'skill' ? 'slashGroupSkills' : 'slashGroupAgents')} · ${invocation.name}`,
  )
  return chip
}

// ---------------------------------------------------------------------------
// 控制器（浏览器路径；DOM 能力经 env 注入以便 node 单测）
// ---------------------------------------------------------------------------

export type SlashChipTextMetrics = {
  fontFamily: string
  fontSize: string
  fontWeight: string
  letterSpacing: string
  lineHeight: string
  tabSize: string
  paddingTop: string
  paddingRight: string
  paddingBottom: string
  paddingLeft: string
}

export type SlashChipEnv = {
  /** 读取 textarea 的字体/行高/缩进度量（幽灵层换行与 textarea 保持一致）。 */
  getFont(element: HTMLElement): SlashChipTextMetrics
  /** 按字体度量文本宽度（canvas.measureText）。 */
  measure(text: string, metrics: SlashChipTextMetrics): number
  /** chip 渲染后的实际宽度。 */
  measureElementWidth(element: HTMLElement): number
  /** 监听元素尺寸变化（字号设置/自动增高重同步），返回取消函数。 */
  observeResize(element: HTMLElement, callback: () => void): () => void
}

const EMPTY_METRICS: SlashChipTextMetrics = {
  fontFamily: '',
  fontSize: '',
  fontWeight: '',
  letterSpacing: '',
  lineHeight: '',
  tabSize: '',
  paddingTop: '',
  paddingRight: '',
  paddingBottom: '',
  paddingLeft: '',
}

let measureContext: CanvasRenderingContext2D | null | undefined

function defaultMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext !== undefined) return measureContext
  measureContext = null
  try {
    const canvas = document.createElement('canvas')
    measureContext = canvas.getContext?.('2d') ?? null
  } catch {
    measureContext = null
  }
  return measureContext
}

const defaultEnv: SlashChipEnv = {
  getFont(element) {
    const win = typeof window !== 'undefined' ? window : undefined
    if (!win?.getComputedStyle) return EMPTY_METRICS
    const style = win.getComputedStyle(element)
    return {
      fontFamily: style.fontFamily ?? '',
      fontSize: style.fontSize ?? '',
      fontWeight: style.fontWeight ?? '',
      letterSpacing: style.letterSpacing ?? '',
      lineHeight: style.lineHeight ?? '',
      tabSize: style.tabSize ?? '',
      paddingTop: style.paddingTop ?? '',
      paddingRight: style.paddingRight ?? '',
      paddingBottom: style.paddingBottom ?? '',
      paddingLeft: style.paddingLeft ?? '',
    }
  },
  measure(text, metrics) {
    const ctx = defaultMeasureContext()
    if (!ctx) return 0
    try {
      ctx.font = `${metrics.fontWeight} ${metrics.fontSize} ${metrics.fontFamily}`.trim()
      const withSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
      if (metrics.letterSpacing) withSpacing.letterSpacing = metrics.letterSpacing
      return ctx.measureText(text).width
    } catch {
      return 0
    }
  },
  measureElementWidth(element) {
    const rect = element.getBoundingClientRect?.()
    return element.offsetWidth ?? rect?.width ?? 0
  },
  observeResize(element, callback) {
    if (typeof ResizeObserver === 'undefined') return () => {}
    const observer = new ResizeObserver(() => callback())
    observer.observe(element)
    return () => observer.disconnect()
  },
}

export type SlashInvocationChip = {
  /** 进入选中态并挂覆盖层（显式选中 / 自动 engage 共用；重置 dismissed）。 */
  engage(invocation: SlashInvocation): void
  isActive(): boolean
  getInvocation(): SlashInvocation | null
  /** Escape 后同前缀不再自动 engage（显式 engage 会重置）。 */
  isDismissed(cmd: string): boolean
  /** 每次输入同步入口：前缀失配自毁（文本不动），匹配则同步幽灵文本与几何。 */
  update(text?: string): void
  /** 退出选中态：仅卸覆盖层与状态，不改文本；记住 dismissed 前缀。 */
  clear(): void
  /** 从 textarea 删除 cmd 前缀（含紧随一个空格），保留其余任务文本并聚焦。 */
  removePrefix(): void
  /** 彻底清理：覆盖层、事件监听、textarea class。 */
  cleanup(): void
}

export function createSlashInvocationChip(options: { panel: HTMLElement; env?: Partial<SlashChipEnv> }): SlashInvocationChip {
  const { panel } = options
  const env: SlashChipEnv = { ...defaultEnv, ...options.env }

  let invocation: SlashInvocation | null = null
  let dismissedCmd: string | null = null
  let composing = false
  let preeditText: string | null = null

  let editor: MessageEditorElement | null = null
  let textarea: HTMLTextAreaElement | null = null
  let shell: HTMLElement | null = null
  let overlay: HTMLElement | null = null
  let ghost: HTMLElement | null = null
  let chipEl: HTMLElement | null = null
  let spacer: HTMLElement | null = null
  let textNode: Text | null = null
  let preeditEl: HTMLElement | null = null
  let stopTextareaResizeObserve: (() => void) | null = null
  let stopShellResizeObserve: (() => void) | null = null

  const readText = () => {
    const currentEditor = panel.querySelector<MessageEditorElement>('message-editor')
    const currentTextarea = currentEditor?.querySelector<HTMLTextAreaElement>('textarea')
    return currentEditor?.value ?? currentTextarea?.value ?? ''
  }

  const resolveTargets = () => {
    editor = panel.querySelector<MessageEditorElement>('message-editor')
    textarea = editor?.querySelector<HTMLTextAreaElement>('textarea') ?? null
    shell = (editor?.closest('.quickforge-composer-shell') as HTMLElement | null) ?? null
    return Boolean(editor && textarea && shell)
  }

  const handleCompositionStart = (event?: { data?: string }) => {
    composing = true
    preeditText = event?.data ?? ''
    // 覆盖层保持显示：chip 不消失，预编辑进幽灵层（render 处理镜像与下划线）。
    if (invocation) render(readText())
  }

  const handleCompositionUpdate = (event?: { data?: string }) => {
    if (!composing) return
    preeditText = event?.data ?? ''
    if (invocation) render(readText())
  }

  const handleCompositionEnd = (event?: { data?: string }) => {
    composing = false
    const finalText = event?.data
    const text = readText()
    preeditText = null
    if (!invocation) return
    // 部分浏览器 end 事件先于最后一次 value 同步：finalText 未包含时手动拼接。
    if (finalText && !text.includes(finalText)) {
      render(`${text}${finalText}`)
      return
    }
    update(text)
  }

  const handleScroll = () => {
    if (!ghost || !textarea) return
    if (typeof textarea.scrollTop === 'number' && typeof ghost.scrollTop === 'number') ghost.scrollTop = textarea.scrollTop
  }

  const handleSelectionChange = () => {
    if (!invocation || composing || !textarea) return
    if (typeof textarea.isConnected === 'boolean' && !textarea.isConnected) return
    const start = textarea.selectionStart
    if (typeof start !== 'number') return
    // 光标进入前缀区：降级为原文显示（不销毁选中态）；文本仍匹配且光标回到
    // 尾部（继续打字/点击行尾）时自愈恢复。防御 selection 被外部程序重置的
    // 瞬时值，也避免用户误点前缀区导致 chip 直接消失。
    if (start < invocation.cmd.length) {
      if (overlay) overlay.style.display = 'none'
      textarea.classList.remove(SLASH_INVOCATION_TEXT_CLASS)
    } else {
      if (overlay) overlay.style.display = ''
      textarea.classList.add(SLASH_INVOCATION_TEXT_CLASS)
    }
  }

  const handleChipPointerDown = (event?: { preventDefault?: () => void }) => {
    // 点击 chip 不能穿透到 textarea 前缀区（会触发降级显示原文）。
    event?.preventDefault?.()
    if (!textarea) return
    const text = textarea.value ?? ''
    textarea.focus?.()
    textarea.selectionStart = text.length
    textarea.selectionEnd = text.length
  }

  const attachListeners = () => {
    if (!textarea) return
    textarea.addEventListener('compositionstart', handleCompositionStart)
    textarea.addEventListener('compositionupdate', handleCompositionUpdate)
    textarea.addEventListener('compositionend', handleCompositionEnd)
    textarea.addEventListener('scroll', handleScroll)
    globalThis.document?.addEventListener?.('selectionchange', handleSelectionChange)
    stopTextareaResizeObserve = env.observeResize(textarea, () => {
      syncGeometry()
      syncSpacer()
    })
    const currentShell = shell
    if (currentShell && currentShell !== textarea) {
      stopShellResizeObserve = env.observeResize(currentShell, () => {
        syncGeometry()
        syncSpacer()
      })
    }
  }

  const detachListeners = () => {
    textarea?.removeEventListener?.('compositionstart', handleCompositionStart)
    textarea?.removeEventListener?.('compositionupdate', handleCompositionUpdate)
    textarea?.removeEventListener?.('compositionend', handleCompositionEnd)
    textarea?.removeEventListener?.('scroll', handleScroll)
    globalThis.document?.removeEventListener?.('selectionchange', handleSelectionChange)
    stopTextareaResizeObserve?.()
    stopTextareaResizeObserve = null
    stopShellResizeObserve?.()
    stopShellResizeObserve = null
  }

  const teardown = () => {
    detachListeners()
    overlay?.remove()
    overlay = null
    ghost = null
    chipEl = null
    spacer = null
    textNode = null
    preeditEl = null
    textarea?.classList?.remove(SLASH_INVOCATION_TEXT_CLASS)
    invocation = null
    preeditText = null
  }

  const buildOverlay = () => {
    overlay = document.createElement('div')
    overlay.className = 'quickforge-slash-overlay'
    overlay.setAttribute('aria-hidden', 'true')
    ghost = document.createElement('div')
    ghost.className = 'quickforge-slash-ghost'
    overlay.append(ghost)
    shell?.append(overlay)
  }

  const renderChipContent = (next: SlashInvocation) => {
    if (!ghost) return
    chipEl?.remove()
    spacer?.remove()
    textNode?.remove()
    preeditEl?.remove()
    chipEl = createSlashChipElement(next)
    // 仅输入框覆盖层内的 chip 可点击；消息流 chip 纯展示，不挂监听。
    chipEl.addEventListener('pointerdown', handleChipPointerDown)
    spacer = document.createElement('span')
    spacer.className = 'quickforge-slash-spacer'
    textNode = document.createTextNode('')
    preeditEl = document.createElement('span')
    preeditEl.className = 'quickforge-slash-preedit'
    ghost.append(chipEl, spacer, textNode, preeditEl)
  }

  const syncGhostFont = () => {
    if (!ghost || !textarea) return
    const metrics = env.getFont(textarea)
    const style = ghost.style
    style.fontFamily = metrics.fontFamily
    style.fontSize = metrics.fontSize
    style.fontWeight = metrics.fontWeight
    style.letterSpacing = metrics.letterSpacing
    style.lineHeight = metrics.lineHeight
    style.tabSize = metrics.tabSize
    style.paddingTop = metrics.paddingTop
    style.paddingRight = metrics.paddingRight
    style.paddingBottom = metrics.paddingBottom
    style.paddingLeft = metrics.paddingLeft
  }

  const syncGeometry = () => {
    if (!overlay || !shell || !textarea) return
    if (typeof shell.getBoundingClientRect !== 'function' || typeof textarea.getBoundingClientRect !== 'function') return
    const shellRect = shell.getBoundingClientRect()
    const textareaRect = textarea.getBoundingClientRect()
    overlay.style.left = `${textareaRect.left - shellRect.left}px`
    overlay.style.top = `${textareaRect.top - shellRect.top}px`
    if (Number.isFinite(textarea.clientWidth)) overlay.style.width = `${textarea.clientWidth}px`
    if (Number.isFinite(textarea.clientHeight)) overlay.style.height = `${textarea.clientHeight}px`
  }

  const syncSpacer = () => {
    if (!invocation || !spacer || !chipEl || !textarea) return
    const metrics = env.getFont(textarea)
    const prefixWidth = env.measure(invocation.cmd, metrics)
    const chipWidth = env.measureElementWidth(chipEl)
    spacer.style.width = `${slashChipSpacerWidth(prefixWidth, chipWidth)}px`
  }

  const render = (text: string) => {
    if (!invocation) return
    syncGhostFont()
    let taskText = text.slice(invocation.cmd.length)
    let preedit = ''
    if (composing && preeditText !== null) {
      // 预编辑可能已写入 value（Chromium）或未写入（部分 WebKit），两种都按
      // 「已提交 + 预编辑」镜像渲染，避免预编辑被透明 class 吞掉。
      if (preeditText && taskText.endsWith(preeditText)) {
        taskText = taskText.slice(0, taskText.length - preeditText.length)
      }
      preedit = preeditText
    }
    if (textNode) textNode.textContent = taskText
    if (preeditEl) preeditEl.textContent = preedit
    syncGeometry()
    syncSpacer()
    handleScroll()
  }

  const engage = (next: SlashInvocation) => {
    detachListeners()
    if (!resolveTargets()) {
      teardown()
      return
    }
    const previous = invocation
    invocation = next
    dismissedCmd = null
    if (!overlay) buildOverlay()
    else if (overlay.parentElement !== shell) shell?.append(overlay)
    if (!chipEl || !previous || previous.cmd !== next.cmd || previous.kind !== next.kind) renderChipContent(next)
    attachListeners()
    textarea?.classList?.add(SLASH_INVOCATION_TEXT_CLASS)
    render(readText())
  }

  const update = (text?: string) => {
    if (!invocation) return
    const value = text ?? readText()
    if (composing) {
      // composition 期间持续镜像（含预编辑），chip 与幽灵文本保持可见。
      render(value)
      return
    }
    if (!slashInvocationPrefixMatches(value, invocation.cmd)) {
      teardown()
      return
    }
    // 自愈：外部（React/Lit 重渲染、装饰层重跑）可能移除覆盖层或重建 textarea。
    // 文本仍匹配时重建挂载而非放弃选中态，保证打字过程中 chip 不消失。
    if (!overlay || !overlay.isConnected || !textarea || (typeof textarea.isConnected === 'boolean' && !textarea.isConnected)) {
      detachListeners()
      if (!resolveTargets()) {
        teardown()
        return
      }
      overlay?.remove()
      overlay = null
      ghost = null
      chipEl = null
      spacer = null
      textNode = null
      buildOverlay()
      renderChipContent(invocation)
      attachListeners()
      textarea?.classList?.add(SLASH_INVOCATION_TEXT_CLASS)
    }
    render(value)
  }

  const clear = () => {
    if (!invocation) return
    dismissedCmd = invocation.cmd.toLowerCase()
    teardown()
  }

  const removePrefix = () => {
    if (!invocation || !editor || !textarea) return
    const text = textarea.value ?? ''
    if (!slashInvocationPrefixMatches(text, invocation.cmd)) {
      teardown()
      return
    }
    const end = invocation.cmd.length + (text.charAt(invocation.cmd.length) === ' ' ? 1 : 0)
    const remaining = text.slice(end)
    const editorElement = editor as MessageEditorElement & { requestUpdate?: () => void }
    editor.value = remaining
    editorElement.requestUpdate?.()
    editor.onInput?.(remaining)
    textarea.value = remaining
    if (typeof textarea.dispatchEvent === 'function' && typeof Event === 'function') {
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    }
    teardown()
    textarea.focus?.()
    textarea.selectionStart = 0
    textarea.selectionEnd = 0
  }

  return {
    engage,
    isActive: () => invocation !== null,
    getInvocation: () => invocation,
    isDismissed: (cmd: string) => dismissedCmd !== null && dismissedCmd === cmd.toLowerCase(),
    update,
    clear,
    removePrefix,
    cleanup: () => {
      dismissedCmd = null
      teardown()
    },
  }
}

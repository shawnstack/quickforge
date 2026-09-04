/**
 * 长输入内容定高收起的交互控制（设计稿 design-mockups/input-clamp-expand.html）。
 *
 * 两个使用方共用一套结构：
 * - 聊天用户消息气泡（message-actions 装饰 .user-message-container）；
 * - subagent 运行详情顶部任务说明块（local-tools renderSubagentRunBody）。
 *
 * 行为约定：
 * - 收起态容器 max-height 取「行高 × INPUT_CLAMP_LINES + 纵向 padding/border + 底部按钮安全区」（按元素
 *   实际 computed line-height 计算，随字号设置缩放）；安全区由流内占位节点提供，只在 overflowing
 *   内容中显示，展开态也不会让按钮覆盖末行，fits 内容不留额外空白；
 * - 内容不足「六行正文 + 原有 chrome」保持自然高度，渐隐遮罩、占位节点与按钮 display:none；
 * - 超出定高进入收起态：底部渐隐遮罩（渐隐到容器自身背景色，见 index.css
 *   --quickforge-input-clamp-bg）+ 框底居中「展开」pill 按钮，hover 才强化；
 * - 展开/收起为 max-height 过渡（INPUT_CLAMP_TRANSITION_MS，与 index.css 的
 *   .quickforge-input-clamp transition 保持同步），展开动画结束后置 none 以便内容继续
 *   变化；prefers-reduced-motion 直切终态；
 * - 状态用 data 属性表达（data-quickforge-clamped / expanded / fits），Lit 模板重渲染
 *   不会清除它们，注入的遮罩/按钮也与 Lit 模板 part 无关，可跨实时更新存活。
 *
 * 纯逻辑与控制器部分通过结构化类型注入 DOM 能力（node 环境可单测，同 tool-marquee）；
 * decorate、sync、toggle 系列函数是浏览器路径的 DOM 装饰入口。i18n 标签同样由调用方
 * 注入（本模块不 import i18n，避免其运行时依赖 pi-web-ui 阻断 node 环境单测）。
 */

export type InputClampLabels = {
  collapsed(): string
  expanded(): string
}

export const INPUT_CLAMP_LINES = 6
/** 展开/收起按钮占用的底部安全区；仅 overflowing 内容启用，fits 内容不留空白。 */
export const INPUT_CLAMP_CONTROL_SAFE_AREA_PX = 30
/** 过渡时长；与 index.css 中 .quickforge-input-clamp 的 transition 保持一致。 */
export const INPUT_CLAMP_TRANSITION_MS = 220
/** 展开过渡结束兜底（transitionend 不监听，用略长于过渡的定时器置 none）。 */
export const INPUT_CLAMP_SETTLE_TIMEOUT_MS = 320

/** 六行正文预算：行高 × 行数 + 原有纵向 padding/border。无法解析时返回 0（视为不收起）。 */
export function inputClampContentHeight(lineHeightPx: number, verticalChromePx: number, lines = INPUT_CLAMP_LINES): number {
  if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) return 0
  const safeLines = Math.max(1, Math.round(lines))
  const chrome = Number.isFinite(verticalChromePx) && verticalChromePx > 0 ? verticalChromePx : 0
  return Math.ceil(safeLines * lineHeightPx + chrome)
}

/** CSS 收起高度：六行正文预算 + 底部控制安全区。 */
export function inputClampHeight(
  lineHeightPx: number,
  verticalChromePx: number,
  lines = INPUT_CLAMP_LINES,
  controlSafeAreaPx = INPUT_CLAMP_CONTROL_SAFE_AREA_PX,
): number {
  const contentHeight = inputClampContentHeight(lineHeightPx, verticalChromePx, lines)
  if (contentHeight <= 0) return 0
  const controlSafeArea = Number.isFinite(controlSafeAreaPx) && controlSafeAreaPx > 0 ? controlSafeAreaPx : 0
  return Math.ceil(contentHeight + controlSafeArea)
}

export type InputClampPhase = 'fits' | 'collapsed' | 'expanded'

/** 由「内容自然高度、正文定高、当前展开态」推导展示阶段；正文定高无效（0）一律 fits。 */
export function inputClampPhase(naturalHeightPx: number, clampHeightPx: number, expanded: boolean): InputClampPhase {
  if (!Number.isFinite(clampHeightPx) || clampHeightPx <= 0) return 'fits'
  if (!Number.isFinite(naturalHeightPx) || naturalHeightPx <= clampHeightPx + 0.5) return 'fits'
  return expanded ? 'expanded' : 'collapsed'
}

/** 控制器需要的盒子能力；测试可传假对象。 */
export type InputClampBox = {
  readonly scrollHeight: number
  readonly offsetHeight: number
  readonly style: { maxHeight: string }
  setAttribute(name: string, value: string): void
}

export type InputClampEnv = {
  prefersReducedMotion(): boolean
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(token: unknown): void
}

export type InputClampControllerOptions = {
  box: InputClampBox
  env: InputClampEnv
  /** 正文定高（六行 + 原有纵向 chrome），用于判断 fits；每次同步时读取。 */
  getClampHeightPx: () => number
  /** CSS 收起高度（正文定高 + 控制安全区）；未传时与正文定高相同。 */
  getCollapsedHeightPx?: () => number
  /** 正文自然高度（不含控制安全区），用于 fits 判断。 */
  getNaturalHeightPx: () => number
  /** 实际布局自然高度（含已应用的控制安全区），用于展开/收起动画。 */
  getLayoutHeightPx?: () => number
  /** 状态应用后的回调：渲染层据此更新按钮文案 / aria。 */
  onStateApplied?: (expanded: boolean, phase: InputClampPhase) => void
}

/**
 * 单个收起盒子的状态机：管理 data 属性与内联 max-height 动画。
 * 展开路径：内联 natural px →（定时器）置 none；收起路径：内联 natural px →
 * 强制 reflow 后写入收起高度 px，避免依赖 CSS 变量切换时出现 none 跳变。
 */
export class InputClampController {
  private expanded = false
  private settleTimer: unknown
  private readonly options: InputClampControllerOptions

  constructor(options: InputClampControllerOptions) {
    this.options = options
  }

  isExpanded(): boolean {
    return this.expanded
  }

  /** 重新度量并应用当前状态（渲染后的同步入口；保持展开/收起状态不变）。 */
  sync(): void {
    this.clearSettleTimer()
    const phase = inputClampPhase(this.options.getNaturalHeightPx(), this.options.getClampHeightPx(), this.expanded)
    if (phase === 'fits') {
      this.options.box.setAttribute('data-quickforge-fits', 'true')
      this.options.box.setAttribute('data-quickforge-clamped', 'false')
      this.options.box.setAttribute('data-quickforge-expanded', 'false')
      this.options.box.style.maxHeight = ''
      this.options.onStateApplied?.(this.expanded, phase)
      return
    }
    this.options.box.setAttribute('data-quickforge-fits', 'false')
    if (this.expanded) {
      this.options.box.setAttribute('data-quickforge-clamped', 'false')
      this.options.box.setAttribute('data-quickforge-expanded', 'true')
      this.options.box.style.maxHeight = 'none'
    } else {
      this.options.box.setAttribute('data-quickforge-clamped', 'true')
      this.options.box.setAttribute('data-quickforge-expanded', 'false')
      this.options.box.style.maxHeight = ''
    }
    this.options.onStateApplied?.(this.expanded, phase)
  }

  setExpanded(expanded: boolean): void {
    if (expanded === this.expanded) {
      this.sync()
      return
    }
    this.expanded = expanded
    if (this.options.env.prefersReducedMotion()) {
      this.sync()
      return
    }
    this.clearSettleTimer()
    const natural = Math.ceil(this.options.getLayoutHeightPx?.() ?? this.options.getNaturalHeightPx())
    this.options.box.setAttribute('data-quickforge-fits', 'false')
    if (expanded) {
      this.options.box.setAttribute('data-quickforge-clamped', 'false')
      this.options.box.setAttribute('data-quickforge-expanded', 'true')
      this.options.box.style.maxHeight = `${natural}px`
      this.settleTimer = this.options.env.setTimeout(() => {
        this.settleTimer = undefined
        if (this.expanded) this.options.box.style.maxHeight = 'none'
      }, INPUT_CLAMP_SETTLE_TIMEOUT_MS)
    } else {
      const collapsed = Math.ceil(this.options.getCollapsedHeightPx?.() ?? this.options.getClampHeightPx())
      this.options.box.setAttribute('data-quickforge-clamped', 'true')
      this.options.box.setAttribute('data-quickforge-expanded', 'false')
      this.options.box.style.maxHeight = `${natural}px`
      void this.options.box.offsetHeight // 强制 reflow，让下一帧从当前高度过渡到 CSS 定高
      this.options.box.style.maxHeight = collapsed > 0 ? `${collapsed}px` : ''
    }
    this.options.onStateApplied?.(this.expanded, this.expanded ? 'expanded' : 'collapsed')
  }

  toggle(): void {
    this.setExpanded(!this.expanded)
  }

  /** 盒子卸载时清理待续定时器（展开过渡兜底），状态本身随 DOM 回收。 */
  dispose(): void {
    this.clearSettleTimer()
  }

  private clearSettleTimer(): void {
    if (this.settleTimer === undefined) return
    this.options.env.clearTimeout(this.settleTimer)
    this.settleTimer = undefined
  }
}

// ---------------------------------------------------------------------------
// 浏览器 DOM 装饰入口（聊天装饰与 subagent 详情共用）
// ---------------------------------------------------------------------------

/** 展开按钮的 chevron 图标（收起向下，展开态由 CSS 旋转 180°）。 */
export const INPUT_CLAMP_TOGGLE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'

const controllerCache = new WeakMap<HTMLElement, InputClampController>()
const labelsCache = new WeakMap<HTMLElement, InputClampLabels>()

function createDomEnv(): InputClampEnv {
  return {
    prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (token) => window.clearTimeout(token as number | undefined),
  }
}

function inputClampMeasurements(box: HTMLElement): { contentHeight: number; clampHeight: number } {
  const style = window.getComputedStyle(box)
  const lineHeight = parseFloat(style.lineHeight)
  const chrome = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
    + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  return {
    contentHeight: inputClampContentHeight(lineHeight, chrome),
    clampHeight: inputClampHeight(lineHeight, chrome),
  }
}

/** 读取 computed 样式计算六行正文 + chrome + 控制安全区，并写 CSS 变量；无法解析返回 0。 */
function applyClampHeightVar(box: HTMLElement): number {
  const { clampHeight } = inputClampMeasurements(box)
  if (clampHeight > 0) {
    box.style.setProperty('--quickforge-input-clamp-h', `${clampHeight}px`)
  } else {
    box.style.removeProperty('--quickforge-input-clamp-h')
  }
  return clampHeight
}

function safeAreaHeightPx(box: HTMLElement): number {
  return box.querySelector<HTMLElement>(':scope > .quickforge-input-clamp-safe-area')?.offsetHeight ?? 0
}

/** 正文自然高度：排除流内控制安全区，再补边框，与正文定高保持同一口径。 */
function naturalHeightPx(box: HTMLElement): number {
  const style = window.getComputedStyle(box)
  const borderY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  return box.scrollHeight - safeAreaHeightPx(box) + borderY
}

/** 实际布局自然高度：包含 overflowing 状态显示的流内控制安全区，供动画使用。 */
function layoutHeightPx(box: HTMLElement): number {
  const style = window.getComputedStyle(box)
  const borderY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  return box.scrollHeight + borderY
}

function ensureClampChildren(box: HTMLElement, labels: InputClampLabels): void {
  if (!box.querySelector(':scope > .quickforge-input-clamp-safe-area')) {
    const safeArea = document.createElement('div')
    safeArea.className = 'quickforge-input-clamp-safe-area'
    safeArea.setAttribute('aria-hidden', 'true')
    box.append(safeArea)
  }
  if (!box.querySelector(':scope > .quickforge-input-clamp-fade')) {
    const fade = document.createElement('div')
    fade.className = 'quickforge-input-clamp-fade'
    fade.setAttribute('aria-hidden', 'true')
    box.append(fade)
  }
  if (!box.querySelector(':scope > .quickforge-input-clamp-toggle')) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'quickforge-input-clamp-toggle'
    button.setAttribute('aria-expanded', 'false')
    button.innerHTML = `${INPUT_CLAMP_TOGGLE_ICON}<span class="quickforge-input-clamp-toggle-label">${labels.collapsed()}</span>`
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      toggleInputClampBox(box)
    })
    box.append(button)
  }
}

function renderToggleState(box: HTMLElement, expanded: boolean): void {
  const button = box.querySelector<HTMLElement>(':scope > .quickforge-input-clamp-toggle')
  if (!button) return
  button.setAttribute('aria-expanded', String(expanded))
  const label = button.querySelector<HTMLElement>(':scope > .quickforge-input-clamp-toggle-label')
  const labels = labelsCache.get(box)
  if (label && labels) label.textContent = expanded ? labels.expanded() : labels.collapsed()
}

function controllerFor(box: HTMLElement, labels: InputClampLabels): InputClampController {
  labelsCache.set(box, labels)
  let controller = controllerCache.get(box)
  if (!controller) {
    ensureClampChildren(box, labels)
    controller = new InputClampController({
      box,
      env: createDomEnv(),
      getClampHeightPx: () => inputClampMeasurements(box).contentHeight,
      getCollapsedHeightPx: () => applyClampHeightVar(box),
      getNaturalHeightPx: () => naturalHeightPx(box),
      getLayoutHeightPx: () => layoutHeightPx(box),
      onStateApplied: (expanded, phase) => {
        if (phase === 'collapsed') box.style.maxHeight = `${applyClampHeightVar(box)}px`
        renderToggleState(box, expanded)
      },
    })
    controllerCache.set(box, controller)
  }
  return controller
}

/** 同步一个收起盒子：度量 → 应用状态（幂等，可重复调用）。 */
export function syncInputClampBox(box: HTMLElement, labels: InputClampLabels): void {
  controllerFor(box, labels).sync()
}

/** 同步 root 下所有收起盒子（聊天重渲染 / subagent 详情 updated 后调用）。 */
export function syncInputClampBoxes(root: ParentNode, labels: InputClampLabels): void {
  root.querySelectorAll<HTMLElement>('[data-quickforge-input-clamp]').forEach((box) => syncInputClampBox(box, labels))
}

/** 切换展开/收起，返回切换后的展开态。 */
export function toggleInputClampBox(box: HTMLElement): boolean {
  const controller = controllerCache.get(box)
  if (!controller) return false
  controller.toggle()
  return controller.isExpanded()
}

/**
 * 装饰一条聊天用户消息：给 .user-message-container 挂收起结构并同步。
 * 仅用于纯文本用户消息（user-with-attachments 的附件区不参与收起）。
 */
export function decorateUserMessageInputClamp(messageElement: HTMLElement, labels: InputClampLabels): void {
  const container = messageElement.querySelector<HTMLElement>('.user-message-container')
  if (!container) return
  container.classList.add('quickforge-input-clamp')
  container.setAttribute('data-quickforge-input-clamp', 'true')
  syncInputClampBox(container, labels)
}

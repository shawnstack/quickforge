import type { MessageWithUsage } from '../chat-utils'
import { replaceSvg } from '../chat-utils'
import { t } from '@/lib/i18n'
import { translateErrorMessage } from '@/lib/error-messages'
import { errorDetailsChevronIcon, errorWarningIcon, retryIcon } from './icons'
import { turnErrorKeyOf, type TurnErrorTracker, type TurnErrorView } from './turn-error-state'

/**
 * 回合终态错误的一行式轻量错误行（design-mockups/conversation-error-retry.html）。
 *
 * 聊天面板把失败的回合渲染为红色错误块（`div.bg-destructive/10` +
 * `<strong>Error:</strong>` + 原始英文 errorMessage）。本装饰器不触碰该 React
 * 节点（子节点 / className 都保持 React 原状），只把它内联 `display:none` 隐藏，
 * 并在其旁插入一个**装饰层自建**的、与「已停止 / 重新连接中 / 模型重试中」同族的
 * 轻量行：
 *
 *     ⚠ 生成失败 · <译文或原文>  [重试] [详情]
 *
 * 所有权边界（修复 `removeChild` NotFoundError）：React 仍把红块及其子节点当作
 * 自己渲染的节点，装饰层一旦 `replaceChildren` / 改 className / 移除红块，React
 * 重渲染或卸载时就会对已不存在的子节点执行 `removeChild` 而崩溃。因此：红块只读、
 * 只隐藏；行 / 重试 / 详情 / 升级提示全部是装饰层自建节点。
 *
 * - 数据层 `errorMessage` 原文不动（持久化 / 去重 / trace 比较依赖原文）；
 * - 「重试」常显在错误旁（不依赖 hover），「详情」就地展开 mono 原文——仅在
 *   已知规则命中（译文 ≠ 原文）时渲染，未匹配错误行内即原文；
 * - 重试中呈现「⟳ 正在重试…」过渡（view.retrying），重试后仍失败追加
 *   琥珀升级提示行 + 内联「切换模型」（view.escalated）；
 * - 只有尾部终态错误挂动作；历史错误仅改写呈现（icon + 一句话，无按钮）。
 * 先例：`decorateAssistantStoppedText` 对 aborted 标签的同位样式改写。
 */

/** 失败回合合成的错误 assistant 消息（stopReason=error 且带 errorMessage）。 */
export function isErrorMessage(message: MessageWithUsage): boolean {
  if (message.role !== 'assistant') return false
  const { stopReason, errorMessage } = message as { stopReason?: unknown; errorMessage?: unknown }
  return stopReason === 'error' && typeof errorMessage === 'string' && errorMessage.length > 0
}

const ERROR_LINE_CLASS = 'quickforge-error-line'
const ERROR_RETRYING_CLASS = 'quickforge-error-retrying'
const ERROR_ESCALATE_CLASS = 'quickforge-error-escalate'
const ERROR_DETAILS_CLASS = 'quickforge-error-details'
const ERROR_DETAILS_OPEN_CLASS = 'quickforge-error-details-open'

type TurnErrorRowOptions = {
  message: MessageWithUsage
  /** 尾部终态错误：唯一挂载重试 / 详情 / 升级提示的位置 */
  terminal: boolean
  /** readOnly / side-chat / 流式期间禁用重试按钮 */
  disabled: boolean
  /** 重试循环状态（decorateMessages 每周期经 tracker.observe 计算一次） */
  view: TurnErrorView
  /** 重试计数状态机（记录点击以驱动 retrying / escalated 呈现） */
  tracker?: TurnErrorTracker
  /** 点击「重试」（已含发送失败重发 → 裁剪重生成的统一语义） */
  onRetry: (() => void) | null
  /** 升级提示里「切换模型」内联链接（anchor 用于锚定模型选择菜单） */
  onSwitchModel?: (anchor?: HTMLElement) => void
}

function createSwitchModelButton(onSwitchModel?: (anchor?: HTMLElement) => void): HTMLElement {
  const link = document.createElement('button')
  link.type = 'button'
  link.dataset.quickforgeAction = 'error-switch-model'
  link.className = 'quickforge-error-switch-model'
  link.title = t('errorSwitchModel')
  link.setAttribute('aria-label', t('errorSwitchModel'))
  link.textContent = t('errorSwitchModel')
  link.onclick = (event) => {
    event.stopPropagation()
    onSwitchModel?.(link)
  }
  return link
}

function createRetryButton(options: TurnErrorRowOptions): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.quickforgeAction = 'error-retry'
  button.className = 'quickforge-error-retry'
  button.title = t('retry')
  button.setAttribute('aria-label', t('retry'))
  replaceSvg(button, retryIcon)
  button.append(document.createTextNode(t('retry')))
  button.disabled = options.disabled
  button.onclick = (event) => {
    event.stopPropagation()
    if (button.disabled) return
    options.tracker?.noteRetryClicked(turnErrorKeyOf(options.message))
    // 立即切换到「正在重试…」呈现（后续 decorate 周期经 view 维持同一状态）。
    const host = button.closest<HTMLElement>('assistant-message, .qf-assistant-message')
    if (host) {
      decorateTurnErrorRow(host, {
        ...options,
        view: { retrying: true, escalated: false, retryCount: options.view.retryCount },
      })
    }
    options.onRetry?.()
  }
  return button
}

function createDetailsToggle(): HTMLElement {
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.dataset.quickforgeAction = 'error-details'
  toggle.className = 'quickforge-error-details-toggle'
  toggle.title = t('errorDetailsLabel')
  toggle.setAttribute('aria-label', t('errorDetailsLabel'))
  toggle.setAttribute('aria-expanded', 'false')
  replaceSvg(toggle, errorDetailsChevronIcon)
  toggle.append(document.createTextNode(t('errorDetailsLabel')))
  toggle.onclick = (event) => {
    event.stopPropagation()
    const host = toggle.closest<HTMLElement>('assistant-message, .qf-assistant-message')
    const details = host?.querySelector<HTMLElement>(`.${ERROR_DETAILS_CLASS}`)
    if (!details) return
    const open = details.classList.toggle(ERROR_DETAILS_OPEN_CLASS)
    toggle.setAttribute('aria-expanded', String(open))
  }
  return toggle
}

/** 行内容按呈现形态整体重建；签名不变则跳过（幂等，语言切换签名变化会重建）。 */
function rowPresentationSignature(options: TurnErrorRowOptions, display: string): string {
  const { terminal, disabled, view } = options
  return [
    view.retrying ? 'retrying' : 'error',
    display,
    String(terminal),
    String(disabled),
    String(view.escalated),
    String(view.retryCount),
    t('errorLinePrefix'),
  ].join('|')
}

function applyRowChildren(row: HTMLElement, options: TurnErrorRowOptions, display: string, detailsAvailable: boolean) {
  const { terminal, view, onRetry, tracker } = options

  row.className = view.retrying
    ? `${ERROR_LINE_CLASS} ${ERROR_RETRYING_CLASS}`
    : ERROR_LINE_CLASS
  row.replaceChildren()

  const icon = document.createElement('span')
  icon.className = 'quickforge-error-icon'
  replaceSvg(icon, view.retrying ? retryIcon : errorWarningIcon)
  row.append(icon)

  const text = document.createElement('span')
  text.className = 'quickforge-error-text'
  text.textContent = view.retrying
    ? t('errorRetryingLabel')
    : `${t('errorLinePrefix')} · ${display}`
  row.append(text)

  if (terminal && !view.retrying && onRetry) {
    row.append(createRetryButton({ ...options, tracker }))
  }

  if (terminal && !view.retrying && detailsAvailable) {
    row.append(createDetailsToggle())
  }
}

export function decorateTurnErrorRow(element: HTMLElement, options: TurnErrorRowOptions) {
  const { message, terminal, view } = options

  const existingRow = element.querySelector<HTMLElement>(`.${ERROR_LINE_CLASS}`)
  if (!isErrorMessage(message)) {
    // 消息不再是错误（React 移除了红块）：清掉装饰层自建的伴随元素与行。
    existingRow?.remove()
    element.querySelector(`.${ERROR_ESCALATE_CLASS}`)?.remove()
    element.querySelector(`.${ERROR_DETAILS_CLASS}`)?.remove()
    return
  }
  const raw = (message as { errorMessage?: unknown }).errorMessage
  if (typeof raw !== 'string' || !raw) return
  const translated = translateErrorMessage(raw)
  const display = translated || raw

  // React 渲染的红块归 React 所有：只读它、仅用内联样式隐藏，绝不改写其
  // 子节点 / className，也不从 React 容器里移除 / 替换它（否则 React 卸载或
  // 重渲染时 removeChild 会抛 NotFoundError）。
  const block = element.querySelector<HTMLElement>('.bg-destructive\\/10')
  if (block) block.style.display = 'none'

  // 行本体是装饰层自建节点（红块的兄弟节点）：首次 decorate 创建，之后复用。
  const row = existingRow ?? document.createElement('div')
  if (!existingRow) {
    row.className = ERROR_LINE_CLASS
    element.append(row)
  }

  const signature = rowPresentationSignature(options, display)
  if (row.dataset.quickforgeErrorSignature !== signature) {
    row.dataset.quickforgeErrorSignature = signature
    applyRowChildren(row, options, display, translated !== raw)
    // 行按新形态重建（新错误 / 升级态 / 语言切换）：详情折叠回默认收起。
    element.querySelector(`.${ERROR_DETAILS_CLASS}`)?.classList.remove(ERROR_DETAILS_OPEN_CLASS)
  }

  // 伴随元素挂在 assistant 渲染根（React 的 div.qf-assistant-message）末尾：
  // 行 → 升级提示 → 详情，均为装饰层自建节点，不动 React 自己的子节点。
  const host = row.parentElement ?? element
  const previousEscalate = element.querySelector<HTMLElement>(`.${ERROR_ESCALATE_CLASS}`)
  const previousDetails = element.querySelector<HTMLElement>(`.${ERROR_DETAILS_CLASS}`)
  const showEscalate = terminal && view.escalated && !view.retrying
  const showDetails = terminal && !view.retrying && translated !== raw

  if (showEscalate) {
    const escalateText = t('errorRetryEscalate', { count: String(view.retryCount) })
    const escalate = previousEscalate ?? document.createElement('div')
    escalate.className = ERROR_ESCALATE_CLASS
    if (escalate.dataset.quickforgeEscalateText !== escalateText) {
      escalate.dataset.quickforgeEscalateText = escalateText
      escalate.replaceChildren(
        document.createTextNode(escalateText),
        createSwitchModelButton(options.onSwitchModel),
      )
    }
    if (!previousEscalate) host.append(escalate)
  } else {
    previousEscalate?.remove()
  }

  if (showDetails) {
    const details = previousDetails ?? document.createElement('div')
    details.className = ERROR_DETAILS_CLASS
    const pre = details.querySelector('pre') ?? document.createElement('pre')
    if (pre.textContent !== raw) pre.textContent = raw
    if (!pre.parentElement) details.append(pre)
    if (!previousDetails) host.append(details)
  } else {
    previousDetails?.remove()
  }
}

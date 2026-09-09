import type { MessageWithUsage } from '../chat-utils'
import { replaceSvg } from '../chat-utils'
import { t } from '@/lib/i18n'
import { translateErrorMessage } from '@/lib/error-messages'
import { errorDetailsChevronIcon, errorWarningIcon, retryIcon } from './icons'
import { turnErrorKeyOf, type TurnErrorTracker, type TurnErrorView } from './turn-error-state'

/**
 * 回合终态错误的一行式轻量错误行（design-mockups/conversation-error-retry.html）。
 *
 * pi-web-ui 把失败的回合渲染为红色错误块（`div.bg-destructive/10` +
 * `<strong>Error:</strong>` + 原始英文 errorMessage）。本装饰器在同一位置把它
 * 原地改写为与「已停止 / 重新连接中 / 模型重试中」同族的轻量行：
 *
 *     ⚠ 生成失败 · <译文或原文>  [重试] [详情]
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

export type TurnErrorRowOptions = {
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
    const host = button.closest<HTMLElement>('assistant-message')
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
    const host = toggle.closest<HTMLElement>('assistant-message')
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

  if (!isErrorMessage(message)) {
    // 消息不再是错误（Lit 重渲染移除了红块）：清掉我们追加的伴随元素。
    element.querySelector(`.${ERROR_ESCALATE_CLASS}`)?.remove()
    element.querySelector(`.${ERROR_DETAILS_CLASS}`)?.remove()
    return
  }
  const raw = (message as { errorMessage?: unknown }).errorMessage
  if (typeof raw !== 'string' || !raw) return
  const translated = translateErrorMessage(raw)
  const display = translated || raw

  // Lit 渲染的红块优先（新渲染尚未改写）；已有改写行则复用。
  const block = element.querySelector<HTMLElement>('.bg-destructive\\/10')
  const existing = element.querySelector<HTMLElement>(`.${ERROR_LINE_CLASS}`)
  if (block && existing && block !== existing) existing.remove()
  const row = block ?? existing
  if (!row) return

  const signature = rowPresentationSignature(options, display)
  if (row.dataset.quickforgeErrorSignature !== signature) {
    row.dataset.quickforgeErrorSignature = signature
    applyRowChildren(row, options, display, translated !== raw)
    // 行按新形态重建（新错误 / 升级态 / 语言切换）：详情折叠回默认收起。
    element.querySelector(`.${ERROR_DETAILS_CLASS}`)?.classList.remove(ERROR_DETAILS_OPEN_CLASS)
  }

  // 伴随元素挂在红块父级（assistant 渲染根 div）末尾：行 → 升级提示 → 详情。
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

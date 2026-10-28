/**
 * 消息就地编辑器（取代回滚的二次确认弹窗）。
 *
 * 交互契约：
 * - 点用户消息上的回滚图标 → 气泡原地变为输入框，预填该条消息原文；
 * - 该行之后的消息就地变淡（`quickforge-message-doomed`）并插入一条虚线说明，
 *   把「将被移除」的代价前置呈现，因此不再需要确认弹窗；
 * - Enter / 「发送」= 提交（截断 + 以新内容重新提问），Shift+Enter 换行，
 *   Esc / 「取消」原样退出，不改动历史。
 *
 * 该模块只负责 DOM 与输入态，不直接调用 agent：提交交给 `onSubmit`，
 * 返回 true 表示上层已完成截断并开始发送，编辑器随即关闭。
 *
 * 状态挂在 DOM 上（host class / data 属性），不引入模块级单例副作用，
 * 便于装饰层在重建、流式开始、只读切换时统一 `closeInlineMessageEditor`。
 */
import { t } from '@/lib/i18n'

export const INLINE_EDITOR_HOST_CLASS = 'quickforge-inline-editor-host'
export const INLINE_EDITOR_CLASS = 'quickforge-inline-editor'
export const MESSAGE_DOOMED_CLASS = 'quickforge-message-doomed'
export const REMOVAL_DIVIDER_CLASS = 'quickforge-removal-divider'
export const EDITING_ATTR = 'quickforgeEditing'
export const EDITING_SELECTOR = '[data-quickforge-editing="true"]'

const ROW_SELECTOR = ':is(.qf-message, .qf-user-message, .qf-assistant-message)'
const CONTAINER_SELECTOR = '.user-message-container, .qf-user-message-bubble'

const INFO_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/></svg>'
const SEND_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>'

type EditorElements = {
  host: HTMLElement
  textarea: HTMLTextAreaElement
  cancel: HTMLButtonElement
  submit: HTMLButtonElement
  divider: HTMLElement | null
  followers: HTMLElement[]
  /** 解绑编辑器内部挂到 document 的监听（关闭时调用，避免泄漏）。 */
  dispose: () => void
}

const editors = new WeakMap<HTMLElement, EditorElements>()

export type InlineMessageEditorOptions = {
  row: HTMLElement
  initialText: string
  /** 提交：返回 true 表示已成功截断并开始发送，编辑器随后关闭。 */
  onSubmit: (text: string) => Promise<boolean>
}

function isRow(element: Element | null): element is HTMLElement {
  return Boolean(element && element.matches(ROW_SELECTOR))
}

function collectFollowers(row: HTMLElement): HTMLElement[] {
  const followers: HTMLElement[] = []
  let node: Element | null = row.nextElementSibling
  while (node) {
    if (isRow(node)) followers.push(node)
    node = node.nextElementSibling
  }
  return followers
}

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto'
  const contentHeight = textarea.scrollHeight
  // 尊重 CSS 的 min-height：内容只有一行时也保留默认书写高度，
  // 避免编辑区缩成一条细缝。
  const minHeight = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
    ? Number.parseFloat(window.getComputedStyle(textarea).minHeight) || 0
    : 0
  const next = Math.min(Math.max(contentHeight, minHeight), 15 * 16)
  textarea.style.height = next > 0 ? `${next}px` : ''
}

function editorElementsOf(row: HTMLElement): EditorElements | undefined {
  return editors.get(row)
}

/** 该行是否正处于就地编辑态。 */
export function isInlineMessageEditorOpen(row: HTMLElement): boolean {
  return editors.has(row)
}

/** 当前面板里是否有任意消息处于就地编辑态。 */
export function hasInlineMessageEditor(panel: HTMLElement): boolean {
  return Boolean(panel.querySelector(`.${INLINE_EDITOR_CLASS}`))
}

/**
 * 关闭（并还原）就地编辑器。
 *
 * 幂等：没有打开时是 no-op。关闭会清掉 doomed 预览与虚线说明，
 * 让「取消」不留下任何痕迹。
 */
export function closeInlineMessageEditor(row?: HTMLElement | null): void {
  if (!row) return
  const elements = editorElementsOf(row)
  if (!elements) return
  editors.delete(row)
  elements.dispose()

  const container = row.querySelector<HTMLElement>(CONTAINER_SELECTOR)
  container?.classList.remove(INLINE_EDITOR_HOST_CLASS)
  elements.host.remove()
  elements.divider?.remove()
  elements.followers.forEach((follower) => follower.classList.remove(MESSAGE_DOOMED_CLASS))
  delete row.dataset[EDITING_ATTR]
}

/** 关闭面板内所有就地编辑器（流式开始、只读切换、面板重建时调用）。 */
export function closeInlineMessageEditors(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLElement>(EDITING_SELECTOR).forEach((row) => {
    closeInlineMessageEditor(row)
  })
  // 兜底：DOM 上残留的编辑器节点（例如 React 重渲染后丢了 WeakMap 记录）。
  panel.querySelectorAll<HTMLElement>(`.${INLINE_EDITOR_CLASS}`).forEach((node) => {
    const row = node.closest<HTMLElement>(ROW_SELECTOR)
    if (row && editors.has(row)) closeInlineMessageEditor(row)
    else node.remove()
  })
}

export function openInlineMessageEditor(options: InlineMessageEditorOptions): void {
  const { row, initialText, onSubmit } = options
  if (editorElementsOf(row)) return
  const container = row.querySelector<HTMLElement>(CONTAINER_SELECTOR)
  if (!container) return

  const followers = collectFollowers(row)

  const host = document.createElement('div')
  host.className = INLINE_EDITOR_CLASS

  const textarea = document.createElement('textarea')
  textarea.className = `${INLINE_EDITOR_CLASS}-input`
  textarea.value = initialText
  textarea.rows = 1
  textarea.setAttribute('aria-label', t('editMessage'))
  host.append(textarea)

  const footer = document.createElement('div')
  footer.className = `${INLINE_EDITOR_CLASS}-footer`

  // 说明与快捷键收进 ⓘ 提示里：footer 只留图标与两个按钮，避免长文案
  // （「这条消息及之后 119 条会被移除…」）抢走视线。
  const tip = document.createElement('span')
  tip.className = `${INLINE_EDITOR_CLASS}-tip`

  const tipTrigger = document.createElement('button')
  tipTrigger.type = 'button'
  tipTrigger.className = `${INLINE_EDITOR_CLASS}-tip-trigger`
  tipTrigger.title = t('editMessageTipLabel')
  tipTrigger.setAttribute('aria-label', t('editMessageTipLabel'))
  tipTrigger.setAttribute('aria-expanded', 'false')
  tipTrigger.innerHTML = INFO_ICON

  const tipBody = document.createElement('span')
  tipBody.className = `${INLINE_EDITOR_CLASS}-tip-body`
  tipBody.setAttribute('role', 'tooltip')

  const tipWarning = document.createElement('span')
  tipWarning.className = `${INLINE_EDITOR_CLASS}-tip-warning`
  tipWarning.textContent = followers.length
    ? t('editMessageRemovesFollowing', { count: followers.length })
    : t('editMessageNoFollowers')

  const tipKeys = document.createElement('span')
  tipKeys.className = `${INLINE_EDITOR_CLASS}-tip-keys`
  tipKeys.textContent = t('editMessageKeyHint')

  tipBody.append(tipWarning, tipKeys)
  tip.append(tipTrigger, tipBody)

  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = `${INLINE_EDITOR_CLASS}-cancel`
  cancel.textContent = t('cancel')

  const submit = document.createElement('button')
  submit.type = 'button'
  submit.className = `${INLINE_EDITOR_CLASS}-submit`
  submit.innerHTML = `${t('editMessageSend')}${SEND_ICON}`

  footer.append(tip, cancel, submit)
  host.append(footer)

  let divider: HTMLElement | null = null
  if (followers.length) {
    divider = document.createElement('div')
    divider.className = REMOVAL_DIVIDER_CLASS
    divider.textContent = t('removalDividerLabel', { count: followers.length })
    followers[0].before(divider)
    followers.forEach((follower) => follower.classList.add(MESSAGE_DOOMED_CLASS))
  }

  container.classList.add(INLINE_EDITOR_HOST_CLASS)
  container.append(host)
  row.dataset[EDITING_ATTR] = 'true'

  const closeTip = () => {
    tip.dataset.open = 'false'
    tipTrigger.setAttribute('aria-expanded', 'false')
  }
  // 默认向上弹；靠近消息区顶部时翻到按钮下方，避免被滚动容器裁掉。
  const placeTip = () => {
    const triggerTop = tipTrigger.getBoundingClientRect().top
    const scroller = tip.closest<HTMLElement>('.qf-scroll-container')
    const boundaryTop = scroller ? scroller.getBoundingClientRect().top : 0
    tip.dataset.placement = triggerTop - boundaryTop < 150 ? 'below' : 'above'
  }
  const onDocumentPointerDown = (event: Event) => {
    if (!tip.contains(event.target as Node)) closeTip()
  }
  tipTrigger.addEventListener('click', (event) => {
    event.stopPropagation()
    placeTip()
    const open = tip.dataset.open !== 'true'
    tip.dataset.open = String(open)
    tipTrigger.setAttribute('aria-expanded', String(open))
  })
  tip.addEventListener('mouseenter', placeTip)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)

  editors.set(row, {
    host,
    textarea,
    cancel,
    submit,
    divider,
    followers,
    dispose: () => document.removeEventListener('pointerdown', onDocumentPointerDown, true),
  })

  let submitting = false

  const close = () => {
    if (submitting) return
    closeInlineMessageEditor(row)
  }

  const handleSubmit = async () => {
    if (submitting) return
    const text = textarea.value.trim()
    if (!text) {
      textarea.focus()
      return
    }
    submitting = true
    textarea.readOnly = true
    cancel.disabled = true
    submit.disabled = true
    submit.textContent = t('editMessageSending')
    let ok: boolean
    try {
      ok = await onSubmit(text)
    } catch {
      ok = false
    } finally {
      submitting = false
    }
    if (!ok) {
      textarea.readOnly = false
      cancel.disabled = false
      submit.disabled = false
      submit.innerHTML = `${t('editMessageSend')}${SEND_ICON}`
      textarea.focus()
      return
    }
    closeInlineMessageEditor(row)
  }

  textarea.addEventListener('input', () => resizeTextarea(textarea))
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void handleSubmit()
    }
  })
  cancel.addEventListener('click', (event) => {
    event.stopPropagation()
    close()
  })
  submit.addEventListener('click', (event) => {
    event.stopPropagation()
    void handleSubmit()
  })

  resizeTextarea(textarea)
  textarea.focus()
  // 光标落到末尾，避免整段被选中后误删。
  const end = textarea.value.length
  textarea.setSelectionRange(end, end)
}

/** 供测试与调试读取当前编辑器节点。 */
export function queryInlineMessageEditor(panel: HTMLElement): HTMLElement | null {
  return panel.querySelector<HTMLElement>(`.${INLINE_EDITOR_CLASS}`)
}

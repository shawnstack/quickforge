import { LitElement, html, type TemplateResult } from 'lit'
import { t } from '@/lib/i18n'

/**
 * 统一的问号说明浮层组件。
 *
 * 渲染一个弱化的 ? 图标，hover / focus / click 时展开说明文案。
 *
 * 实现要点：popover 通过 Portal 渲染到 document.body，用 position: fixed +
 * getBoundingClientRect() 视口坐标定位，因此不受任何祖先容器的 overflow 裁剪
 * 或 transform 包含块影响（尤其适用于模态对话框内的场景）。
 *
 * 用法（Lit）：
 *   html`<h3>${t('title')}<quickforge-info-tip .label=${t('description')}></quickforge-info-tip></h3>`
 * 用法（React）：
 *   <quickforge-info-tip label={t('description')} />
 */
class QuickforgeInfoTip extends LitElement {
  static properties = {
    label: { type: String },
  }

  declare label: string

  private _open = false
  private _popover: HTMLDivElement | null = null
  private _hoverTimer: ReturnType<typeof setTimeout> | undefined

  override createRenderRoot() {
    return this
  }

  private _clearHoverTimer() {
    if (this._hoverTimer) {
      clearTimeout(this._hoverTimer)
      this._hoverTimer = undefined
    }
  }

  private _openPopover() {
    this._clearHoverTimer()
    if (this._open) return
    this._open = true
    this._renderPopover()
    this._updateTriggerAria()
  }

  private _closePopover() {
    this._clearHoverTimer()
    if (!this._open) return
    this._open = false
    this._removePopover()
    this._updateTriggerAria()
  }

  private _togglePopover() {
    this._clearHoverTimer()
    if (this._open) this._closePopover()
    else this._openPopover()
  }

  private _updateTriggerAria() {
    const trigger = this.querySelector<HTMLButtonElement>('.quickforge-info-tip-trigger')
    trigger?.setAttribute('aria-expanded', this._open ? 'true' : 'false')
  }

  private _renderPopover() {
    this._removePopover()
    if (!this.label) return

    const trigger = this.querySelector<HTMLButtonElement>('.quickforge-info-tip-trigger')
    if (!trigger) return

    const popover = document.createElement('div')
    popover.className = 'quickforge-info-tip-popover'
    popover.setAttribute('role', 'tooltip')
    popover.textContent = this.label
    document.body.appendChild(popover)
    this._popover = popover
    this._positionPopover(trigger, popover)
  }

  private _positionPopover(trigger: HTMLElement, popover: HTMLElement) {
    const rect = trigger.getBoundingClientRect()
    const margin = 8
    const gap = 6

    // 先让 popover 处于自然状态以测量尺寸
    const { width: pw, height: ph } = popover.getBoundingClientRect()

    // 水平：默认左对齐 trigger，超出右边界则右移
    let left = rect.left
    if (left + pw > window.innerWidth - margin) {
      left = window.innerWidth - pw - margin
    }
    if (left < margin) left = margin

    // 垂直：默认在 trigger 下方，超出底部则上方展开
    let top = rect.bottom + gap
    if (top + ph > window.innerHeight - margin) {
      const above = rect.top - gap - ph
      top = above > margin ? above : rect.bottom + gap
    }

    popover.style.top = `${Math.round(top)}px`
    popover.style.left = `${Math.round(left)}px`
  }

  private _removePopover() {
    if (this._popover) {
      this._popover.remove()
      this._popover = null
    }
  }

  private _handleEnter = () => {
    this._clearHoverTimer()
    this._hoverTimer = setTimeout(() => this._openPopover(), 150)
  }

  private _handleLeave = () => {
    this._clearHoverTimer()
    this._hoverTimer = setTimeout(() => this._closePopover(), 120)
  }

  private _handleFocus = () => {
    this._clearHoverTimer()
    this._openPopover()
  }

  private _handleOutsidePointerDown = (event: PointerEvent) => {
    if (!this._open) return
    const target = event.target as Node | null
    if (target && (this.contains(target) || this._popover?.contains(target))) return
    this._closePopover()
  }

  private _handleKeyDown = (event: KeyboardEvent) => {
    if (!this._open || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    this._closePopover()
  }

  private _handleScrollOrResize = () => {
    if (!this._open) return
    const trigger = this.querySelector<HTMLButtonElement>('.quickforge-info-tip-trigger')
    if (trigger && this._popover) {
      this._positionPopover(trigger, this._popover)
    }
  }

  override connectedCallback() {
    super.connectedCallback()
    document.addEventListener('pointerdown', this._handleOutsidePointerDown, true)
    document.addEventListener('keydown', this._handleKeyDown, true)
    window.addEventListener('scroll', this._handleScrollOrResize, true)
    window.addEventListener('resize', this._handleScrollOrResize)
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('pointerdown', this._handleOutsidePointerDown, true)
    document.removeEventListener('keydown', this._handleKeyDown, true)
    window.removeEventListener('scroll', this._handleScrollOrResize, true)
    window.removeEventListener('resize', this._handleScrollOrResize)
    this._clearHoverTimer()
    this._removePopover()
  }

  override render(): TemplateResult {
    return html`
      <span class="quickforge-info-tip">
        <button
          type="button"
          class="quickforge-info-tip-trigger"
          aria-label=${t('help')}
          aria-expanded="false"
          @mouseenter=${this._handleEnter}
          @mouseleave=${this._handleLeave}
          @focus=${this._handleFocus}
          @blur=${this._handleLeave}
          @click=${this._togglePopover}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
        </button>
      </span>
    `
  }
}

const tagName = 'quickforge-info-tip'

if (!customElements.get(tagName)) {
  customElements.define(tagName, QuickforgeInfoTip)
}

export type { QuickforgeInfoTip }

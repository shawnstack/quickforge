import { LitElement, html, nothing, render, type TemplateResult } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'

export type QuickForgeSettingsSelectOption = {
  value: string
  label: string
  disabled?: boolean
}

let menuSequence = 0

/**
 * 统一的设置页自定义下拉框（quickforge-settings-select）。
 *
 * 用于替换设置"常规"页中的原生 <select>：终端 Shell、语言、默认运行时、
 * 默认模型、思考级别共用同一交互与视觉。
 *
 * 交互要求：
 * - 触发器为 button[role=combobox]（aria-expanded / aria-controls / aria-haspopup），
 *   aria-controls 指向 Portal 内的 listbox；
 * - 菜单以 Portal 渲染到 document.body，position: fixed + getBoundingClientRect()
 *   定位，不受设置容器 overflow 裁剪；下方空间不足时向上展开，菜单高度受限；
 *   搜索栏固定、选项列表内部滚动；
 * - 键盘：ArrowUp / ArrowDown、Home / End、Enter / Space 选择、Escape 关闭；
 *   菜单关闭时在触发按钮上按 ArrowDown/ArrowUp/Home/End 可打开并定位；
 * - 外部点击（pointerdown）关闭；Escape / 选择 / 外部点击后焦点保持在触发器；
 * - disabled 选项不可选中且在键盘导航中被跳过；
 * - 可选 searchable（默认关闭）：菜单顶部显示搜索输入，按 label 大小写不敏感
 *   过滤；键盘与鼠标只在过滤后可见且未禁用的选项间移动；查询变化后若当前
 *   focusedIndex 不可见则切到第一个可选结果；searchPlaceholder / noResultsLabel
 *   文本可配置，组件不硬编码文案。
 *
 * 用法（Lit）：
 *   html`<quickforge-settings-select
 *     .value=${value}
 *     .options=${options}
 *     .disabled=${false}
 *     searchable
 *     searchPlaceholder=${t('search')}
 *     noResultsLabel=${t('noMatchingOptions')}
 *     label=${t('defaultModel')}
 *     @change=${(event: CustomEvent<string>) => this.onChange(event.detail)}
 *   ></quickforge-settings-select>`
 */
class QuickForgeSettingsSelect extends LitElement {
  static properties = {
    value: { type: String },
    placeholder: { type: String },
    options: { type: Array },
    disabled: { type: Boolean },
    label: { type: String },
    searchable: { type: Boolean },
    searchPlaceholder: { type: String },
    noResultsLabel: { type: String },
  }

  value = ''
  placeholder = ''
  options: QuickForgeSettingsSelectOption[] = []
  disabled = false
  label = ''
  searchable = false
  searchPlaceholder = ''
  noResultsLabel = ''

  private triggerRef = createRef<HTMLButtonElement>()
  private searchRef = createRef<HTMLInputElement>()
  private _menu: HTMLDivElement | null = null
  private _menuId = `quickforge-settings-select-menu-${++menuSequence}`
  private _listboxId = `quickforge-settings-select-listbox-${++menuSequence}`
  private _open = false
  private _searchQuery = ''
  private focusedIndex = -1

  override createRenderRoot() {
    return this
  }

  override render() {
    const selected = this.options.find((option) => option.value === this.value)
    return html`
      <button
        ${ref(this.triggerRef)}
        type="button"
        class="quickforge-settings-select quickforge-settings-select-button quickforge-settings-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded=${this._open ? 'true' : 'false'}
        aria-controls=${this._listboxId}
        aria-activedescendant=${this._open ? this._focusedOptionId() : undefined}
        aria-label=${this.label}
        ?disabled=${this.disabled}
        @click=${this._toggle}
        @keydown=${this._handleTriggerKeyDown}
      >
        <span class="quickforge-settings-select-trigger-label">${selected ? selected.label : this.placeholder}</span>
        <span class="quickforge-settings-select-chevron" aria-hidden="true">▾</span>
      </button>
    `
  }

  override updated() {
    // 菜单打开期间父属性（options/value 等）变化时，刷新 Portal 菜单并保证 focusedIndex 合法
    this._refreshMenu()
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    this._close()
  }

  private _toggle = () => {
    if (this.disabled) return
    if (this._open) this._close(true)
    else this._openMenu()
  }

  /** 菜单关闭时在触发器上按方向键/Home/End 打开菜单并定位 */
  private _handleTriggerKeyDown = (event: KeyboardEvent) => {
    if (this.disabled || this._open) return
    let initialIndex: number | undefined
    switch (event.key) {
      case 'ArrowDown':
      case 'Home': {
        initialIndex = this._selectableIndexes()[0] ?? -1
        break
      }
      case 'ArrowUp':
      case 'End': {
        const indexes = this._selectableIndexes()
        initialIndex = indexes[indexes.length - 1] ?? -1
        break
      }
      default:
        return
    }
    event.preventDefault()
    this._openMenu(initialIndex)
  }

  private _openMenu(initialIndex?: number) {
    if (this.disabled || this._open) return
    const trigger = this.triggerRef.value
    if (!trigger) return

    const selectable = this._selectableIndexes()
    const current = this.options.findIndex((option) => option.value === this.value)
    this.focusedIndex = initialIndex !== undefined
      ? initialIndex
      : current >= 0 && !this.options[current].disabled
        ? current
        : (selectable[0] ?? -1)
    this._open = true

    this._attachMenu()
    document.addEventListener('pointerdown', this._handlePointerDown, true)
    document.addEventListener('keydown', this._handleKeyDown)
    window.addEventListener('scroll', this._reposition, true)
    window.addEventListener('resize', this._reposition)
    this.requestUpdate()

    if (this.searchable) {
      this.searchRef.value?.focus()
    }
    this._scrollFocusedIntoView()
  }

  private _close(restoreFocus = false) {
    if (!this._open) return
    this._open = false
    this.focusedIndex = -1
    this._searchQuery = ''
    this._removeMenu()
    document.removeEventListener('pointerdown', this._handlePointerDown, true)
    document.removeEventListener('keydown', this._handleKeyDown)
    window.removeEventListener('scroll', this._reposition, true)
    window.removeEventListener('resize', this._reposition)
    if (restoreFocus) this.triggerRef.value?.focus()
    this.requestUpdate()
  }

  private _select(value: string) {
    this._close(true)
    this.dispatchEvent(new CustomEvent('change', { detail: value, bubbles: true, composed: true }))
  }

  private _selectFocused() {
    const option = this.options[this.focusedIndex]
    if (option && !option.disabled) this._select(option.value)
  }

  private _isVisible(option: QuickForgeSettingsSelectOption) {
    if (!this.searchable) return true
    const query = this._searchQuery.trim().toLowerCase()
    if (!query) return true
    return option.label.toLowerCase().includes(query)
  }

  private _selectableIndexes() {
    return this.options
      .map((option, index) => (!option.disabled && this._isVisible(option) ? index : -1))
      .filter((index) => index >= 0)
  }

  private _moveFocus(delta: number) {
    const indexes = this._selectableIndexes()
    if (indexes.length === 0) return
    const position = indexes.indexOf(this.focusedIndex)
    const current = position >= 0 ? position : (delta > 0 ? -1 : 0)
    const next = Math.max(0, Math.min(indexes.length - 1, current + delta))
    this.focusedIndex = indexes[next]
    this._scrollFocusedIntoView()
  }

  private _attachMenu() {
    this._removeMenu()
    const trigger = this.triggerRef.value
    if (!trigger) return
    const menu = document.createElement('div')
    menu.className = 'quickforge-settings-select-menu'
    menu.id = this._menuId
    document.body.appendChild(menu)
    this._menu = menu
    this._renderMenuItems()
    this._reposition()
  }

  private _removeMenu() {
    if (this._menu) {
      this._menu.remove()
      this._menu = null
    }
  }

  private _renderMenuItems() {
    if (!this._menu) return
    render(this._menuTemplate(), this._menu)
  }

  private _rerenderMenuItems() {
    if (this._open && this._menu) this._renderMenuItems()
  }

  private _refreshMenu() {
    if (!this._open || !this._menu) return
    const selectable = this._selectableIndexes()
    if (!selectable.includes(this.focusedIndex)) {
      this.focusedIndex = selectable[0] ?? -1
    }
    this._renderMenuItems()
    this._reposition()
  }

  private _reposition = () => {
    const menu = this._menu
    const trigger = this.triggerRef.value
    if (!menu || !trigger) return

    const rect = trigger.getBoundingClientRect()
    const margin = 8
    const gap = 6
    const maxHeight = 300
    const menuHeight = Math.min(maxHeight, menu.offsetHeight || maxHeight)
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const showAbove = spaceBelow - gap < menuHeight && spaceAbove > spaceBelow
    const available = Math.max(0, (showAbove ? spaceAbove : spaceBelow) - gap - margin)

    menu.style.top = showAbove ? 'auto' : `${Math.round(rect.bottom + gap)}px`
    menu.style.bottom = showAbove ? `${Math.round(window.innerHeight - rect.top + gap)}px` : 'auto'
    menu.style.maxHeight = `${Math.max(120, Math.min(maxHeight, available))}px`
    menu.style.minWidth = `max(12rem, ${Math.round(rect.width)}px)`
    const menuWidth = menu.offsetWidth
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - menuWidth - margin))
    menu.style.left = `${Math.round(left)}px`
  }

  private _optionId(index: number) {
    return `${this._listboxId}-option-${index}`
  }

  private _focusedOptionId() {
    return this.focusedIndex >= 0 ? this._optionId(this.focusedIndex) : undefined
  }

  private _isSearchFocused() {
    return this.searchable && document.activeElement === this.searchRef.value
  }

  private _scrollFocusedIntoView() {
    const menu = this._menu
    if (!menu || this.focusedIndex < 0) return
    const listbox = menu.querySelector<HTMLElement>('.quickforge-settings-select-listbox')
    const option = menu.querySelector<HTMLElement>(`[id="${this._optionId(this.focusedIndex)}"]`)
    if (!listbox || !option) return
    const listboxRect = listbox.getBoundingClientRect()
    const optionRect = option.getBoundingClientRect()
    if (optionRect.top < listboxRect.top) {
      listbox.scrollTop -= listboxRect.top - optionRect.top
    } else if (optionRect.bottom > listboxRect.bottom) {
      listbox.scrollTop += optionRect.bottom - listboxRect.bottom
    }
  }

  private _menuTemplate(): TemplateResult {
    const activeId = this._focusedOptionId()
    const visibleCount = this.options.filter((option) => this._isVisible(option)).length
    return html`
      ${this.searchable ? html`
        <div class="quickforge-settings-select-search">
          <input
            ${ref(this.searchRef)}
            class="quickforge-settings-select-search-input"
            type="text"
            role="searchbox"
            placeholder=${this.searchPlaceholder}
            aria-label=${this.label}
            aria-controls=${this._listboxId}
            aria-activedescendant=${activeId}
            .value=${this._searchQuery}
            @input=${this._handleSearchInput}
          >
        </div>
      ` : ''}
      <div
        id=${this._listboxId}
        class="quickforge-settings-select-listbox"
        role="listbox"
        aria-label=${this.label}
      >
        ${this.options.map((option, index) => {
          if (!this._isVisible(option)) return nothing
          const selected = option.value === this.value
          const focused = this.focusedIndex === index
          return html`
            <div
              id=${this._optionId(index)}
              role="option"
              aria-selected=${selected ? 'true' : 'false'}
              aria-disabled=${option.disabled ? 'true' : 'false'}
              class="quickforge-settings-select-option${focused ? ' quickforge-settings-select-option-focused' : ''}${selected ? ' quickforge-settings-select-option-selected' : ''}${option.disabled ? ' quickforge-settings-select-option-disabled' : ''}"
              @mousemove=${() => {
                if (!option.disabled && this.focusedIndex !== index) {
                  this.focusedIndex = index
                  this._rerenderMenuItems()
                }
              }}
              @click=${() => {
                if (!option.disabled) this._select(option.value)
              }}
            >
              <span class="quickforge-settings-select-option-label">${option.label}</span>
              ${selected ? html`
                <svg class="quickforge-settings-select-option-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
              ` : ''}
            </div>
          `
        })}
      </div>
      ${this.searchable && visibleCount === 0 ? html`
        <div class="quickforge-settings-select-no-results" role="status">${this.noResultsLabel}</div>
      ` : ''}
    `
  }

  private _handleSearchInput = (event: Event) => {
    const input = event.target as HTMLInputElement
    this._searchQuery = input.value
    this._rerenderMenuItems()
    const selectable = this._selectableIndexes()
    if (!selectable.includes(this.focusedIndex)) {
      this.focusedIndex = selectable[0] ?? -1
    }
    this._reposition()
    this._scrollFocusedIntoView()
  }

  private _handlePointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null
    if (!target) return
    if (this.contains(target) || this._menu?.contains(target)) return
    this._close(true)
  }

  private _handleKeyDown = (event: KeyboardEvent) => {
    if (!this._open || event.isComposing) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        this._moveFocus(1)
        this._rerenderMenuItems()
        break
      case 'ArrowUp':
        event.preventDefault()
        this._moveFocus(-1)
        this._rerenderMenuItems()
        break
      case 'Home': {
        event.preventDefault()
        const indexes = this._selectableIndexes()
        this.focusedIndex = indexes[0] ?? -1
        this._rerenderMenuItems()
        this._scrollFocusedIntoView()
        break
      }
      case 'End': {
        event.preventDefault()
        const indexes = this._selectableIndexes()
        this.focusedIndex = indexes[indexes.length - 1] ?? -1
        this._rerenderMenuItems()
        this._scrollFocusedIntoView()
        break
      }
      case 'Enter':
        event.preventDefault()
        this._selectFocused()
        break
      case ' ':
        // 搜索输入中的空格用于输入文本，不触发选择
        if (this._isSearchFocused()) break
        event.preventDefault()
        this._selectFocused()
        break
      case 'Escape':
        event.preventDefault()
        this._close(true)
        break
      case 'Tab':
        // 关闭菜单并把焦点放回触发器，随后按浏览器正常 Tab 顺序继续
        this._close()
        this.triggerRef.value?.focus()
        break
    }
  }
}

const tagName = 'quickforge-settings-select'

if (!customElements.get(tagName)) {
  customElements.define(tagName, QuickForgeSettingsSelect)
}

export { QuickForgeSettingsSelect }

import { type Api, type Model, modelsAreEqual } from '@earendil-works/pi-ai'
import { agentAccessCheckIcon } from '@/components/chat/panel-decoration/icons'
import { t } from '@/lib/i18n'
import { modelDisplayLabel as modelLabel } from '@/lib/model-display-label'

type AnyModel = Model<Api>

type ModelSelectorOptions = {
  anchor?: HTMLElement | null
  /** 点击设置入口时打开自定义模型设置；仅需要该入口的场景传入 */
  onOpenModelSettings?: () => void
  /** 覆盖模型列表项的显示文案 */
  modelLabelOverride?: (model: AnyModel) => string
  /** 在模型列表顶部显示一个"无/继承"选项 */
  noneLabel?: string
  /** 点击 none 选项时回调 */
  onNoneSelect?: () => void
}

function createButton(className: string, text = '') {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = text
  return button
}

function createModelSettingsButton(onOpenModelSettings: () => void, anchor?: HTMLElement | null) {
  const button = createButton('quickforge-model-settings-link', t('modelSelectorCustomModelSettings'))
  button.setAttribute('aria-label', t('modelSelectorCustomModelSettingsAriaLabel'))
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    closeComposerModelMenu(anchor)
    onOpenModelSettings()
  })
  return button
}

type ComposerModelMenuElement = HTMLDivElement & {
  __quickforgeCleanup?: () => void
  __quickforgeOwnerAnchor?: HTMLElement
}

export type ModelSelectorHandle = {
  isOpen: () => boolean
  updateModels: (models: readonly AnyModel[]) => void
}

function ownedComposerModelMenus(anchor: HTMLElement) {
  return Array.from(document.querySelectorAll<ComposerModelMenuElement>('.quickforge-model-menu, .quickforge-model-sheet-backdrop'))
    .filter((menu) => menu.__quickforgeOwnerAnchor === anchor)
}

export function closeComposerModelMenu(anchor?: HTMLElement | null, scoped = false) {
  const menus = scoped
    ? anchor ? ownedComposerModelMenus(anchor) : []
    : Array.from(document.querySelectorAll<ComposerModelMenuElement>('.quickforge-model-menu, .quickforge-model-sheet-backdrop'))
  menus.forEach((menu) => {
    menu.__quickforgeCleanup?.()
    menu.remove()
  })
  anchor?.setAttribute('aria-expanded', 'false')
}

function getAnchor(anchor?: HTMLElement | null) {
  return anchor ?? document.querySelector<HTMLElement>('.quickforge-model-trigger')
}

function positionMainMenu(menu: HTMLElement, anchor?: HTMLElement | null) {
  const trigger = getAnchor(anchor)
  const width = Math.min(260, window.innerWidth - 24)
  menu.style.width = `${width}px`
  const measuredHeight = menu.offsetHeight || 360

  if (!trigger) {
    menu.style.left = `${Math.max(12, Math.round((window.innerWidth - width) / 2))}px`
    menu.style.top = `${Math.max(12, Math.round((window.innerHeight - measuredHeight) / 2))}px`
    return
  }

  const rect = trigger.getBoundingClientRect()
  const gap = 8
  const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
  const preferredTop = rect.top - measuredHeight - gap
  const fallbackTop = rect.bottom + gap
  const top = preferredTop >= 12
    ? preferredTop
    : Math.min(fallbackTop, window.innerHeight - measuredHeight - 12)
  menu.style.left = `${left}px`
  menu.style.top = `${Math.max(12, top)}px`
}

function createMenuItem(options: {
  label: string
  selected?: boolean
  disabled?: boolean
  onPointerDown?: (event: PointerEvent) => void
  onPointerEnter?: () => void
  onClick?: (event: MouseEvent) => void
}) {
  const item = createButton('quickforge-model-menu-item')
  item.setAttribute('role', 'menuitemradio')
  item.setAttribute('aria-checked', String(Boolean(options.selected)))
  if (options.disabled) item.disabled = true

  const label = document.createElement('span')
  label.className = 'quickforge-model-menu-item-label'
  label.textContent = options.label

  const checkSlot = document.createElement('span')
  checkSlot.className = 'quickforge-model-menu-item-check-slot'
  checkSlot.innerHTML = options.selected ? agentAccessCheckIcon : ''

  item.append(checkSlot, label)
  if (options.onPointerDown) item.onpointerdown = options.onPointerDown
  if (options.onPointerEnter) item.onpointerenter = options.onPointerEnter
  if (options.onClick) item.addEventListener('click', options.onClick)
  return item
}

function openMobileModelSelector(
  currentModel: AnyModel | null,
  initialModels: AnyModel[],
  onSelect: (model: AnyModel) => void,
  options: ModelSelectorOptions,
  anchor?: HTMLElement | null,
): ModelSelectorHandle {
  let models = initialModels
  let selectedModel = currentModel

  const backdrop = document.createElement('div') as ComposerModelMenuElement
  backdrop.className = 'quickforge-model-sheet-backdrop'
  if (anchor) backdrop.__quickforgeOwnerAnchor = anchor

  const sheet = document.createElement('div')
  sheet.className = 'quickforge-model-sheet'
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-label', t('selectCustomModel'))

  const dragZone = document.createElement('div')
  dragZone.className = 'quickforge-model-sheet-drag-zone'

  const handle = document.createElement('div')
  handle.className = 'quickforge-model-sheet-handle'
  dragZone.append(handle)

  const header = document.createElement('div')
  header.className = 'quickforge-model-sheet-header'

  const title = document.createElement('div')
  title.className = 'quickforge-model-sheet-title'
  title.textContent = t('selectCustomModel')

  const closeButton = createButton('quickforge-model-sheet-close', '×')
  closeButton.setAttribute('aria-label', t('close'))
  closeButton.title = t('close')
  closeButton.onpointerdown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    closeComposerModelMenu(anchor)
  }
  header.append(title, closeButton)

  const modelSectionLabel = document.createElement('div')
  modelSectionLabel.className = 'quickforge-model-sheet-section-label quickforge-model-sheet-model-label'
  modelSectionLabel.textContent = t('model')

  const modelList = document.createElement('div')
  modelList.className = 'quickforge-model-sheet-model-list'
  modelList.setAttribute('role', 'menu')
  modelList.setAttribute('aria-label', t('model'))

  const modelItems = new Map<HTMLButtonElement, AnyModel>()
  let lastScrollAt = 0

  const renderModelList = () => {
    modelItems.clear()
    modelList.replaceChildren()

    if (options.noneLabel) {
      const noneItem = createMenuItem({
        label: options.noneLabel,
        selected: selectedModel === null,
      })
      noneItem.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (Date.now() - lastScrollAt < 300) return
        options.onNoneSelect?.()
        closeComposerModelMenu(anchor)
      })
      modelList.append(noneItem)
    }

    const sortedModels = [...models].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)))
    for (const model of sortedModels) {
      const item = createMenuItem({
        label: options.modelLabelOverride ? options.modelLabelOverride(model) : modelLabel(model),
        selected: modelsAreEqual(selectedModel, model),
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (Date.now() - lastScrollAt < 300) return
          selectModel(model)
        },
      })
      modelItems.set(item, model)
      modelList.append(item)
    }
  }

  // 滚动期间忽略模型行点击，避免滚动误触选中模型
  modelList.addEventListener('scroll', () => {
    lastScrollAt = Date.now()
  })

  // 选中模型：立即生效，但保持抽屉打开，仅高亮当前项
  const selectModel = (model: AnyModel) => {
    selectedModel = model
    for (const [item, itemModel] of modelItems) {
      const selected = modelsAreEqual(itemModel, model)
      item.setAttribute('aria-checked', String(selected))
      const suffix = item.querySelector<HTMLElement>('.quickforge-model-menu-item-suffix')
      if (suffix) suffix.textContent = selected ? '✓' : ''
    }
    onSelect(model)
  }

  renderModelList()

  const settingsFooter = options.onOpenModelSettings ? document.createElement('div') : null
  if (settingsFooter && options.onOpenModelSettings) {
    settingsFooter.className = 'quickforge-model-settings-footer quickforge-model-sheet-footer'
    settingsFooter.append(createModelSettingsButton(options.onOpenModelSettings, anchor))
  }

  sheet.append(
    dragZone,
    header,
    modelSectionLabel,
    modelList,
    ...(settingsFooter ? [settingsFooter] : []),
  )
  sheet.addEventListener('pointerdown', (event) => event.stopPropagation())
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) closeComposerModelMenu(anchor)
  })

  // 向下拖拽关闭：跟随手指位移，超过阈值滑出关闭，否则回弹
  let dragStartY = 0
  let dragging = false
  let dragged = false
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  const onDragStart = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragStartY = event.clientY
    dragging = true
    dragged = false
    sheet.style.transition = 'none'
  }
  const onDragMove = (event: PointerEvent) => {
    if (!dragging) return
    const dy = event.clientY - dragStartY
    if (dy > 0) {
      dragged = true
      sheet.style.transform = `translateY(${dy}px)`
      backdrop.style.background = `rgb(15 23 42 / ${Math.max(0, 0.34 * (1 - dy / 480))})`
    }
  }
  const onDragEnd = () => {
    if (!dragging) return
    dragging = false
    sheet.style.transition = 'transform 0.24s ease'
    const dy = dragged ? (Number.parseFloat(sheet.style.transform.replace(/[^0-9.-]/g, '')) || 0) : 0
    if (dy >= 112) {
      sheet.style.transform = 'translateY(110%)'
      backdrop.style.background = 'rgb(15 23 42 / 0)'
      closeTimer = setTimeout(() => closeComposerModelMenu(anchor), 220)
    } else {
      sheet.style.transform = ''
      backdrop.style.background = ''
    }
  }
  dragZone.addEventListener('pointerdown', onDragStart)
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  window.addEventListener('pointercancel', onDragEnd)

  const dismiss = (event: Event) => {
    if (event.type === 'resize') {
      if (window.innerWidth > 768) closeComposerModelMenu(anchor)
      return
    }
    if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return
    event.preventDefault()
    closeComposerModelMenu(anchor)
  }
  backdrop.__quickforgeCleanup = () => {
    if (closeTimer) clearTimeout(closeTimer)
    document.removeEventListener('keydown', dismiss, true)
    window.removeEventListener('resize', dismiss, true)
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    window.removeEventListener('pointercancel', onDragEnd)
  }

  backdrop.append(sheet)
  document.body.append(backdrop)
  anchor?.setAttribute('aria-expanded', 'true')
  document.addEventListener('keydown', dismiss, true)
  window.addEventListener('resize', dismiss, true)

  return {
    isOpen: () => document.body.contains(backdrop),
    updateModels: (nextModels) => {
      if (!document.body.contains(backdrop)) return
      models = [...nextModels]
      renderModelList()
    },
  }
}

/**
 * 表单场景的模型选择底部弹层（移动端专用）：
 * - 不渲染思考等级区
 * - 可通过 noneLabel 在列表顶部提供"无/继承"选项，点击后回调 onSelect(null)
 * 桌面端继续使用原生 select，由调用方按断点切换。
 */
export function openModelSheet(
  currentModel: AnyModel | null,
  models: AnyModel[],
  onSelect: (model: AnyModel | null) => void,
  options: ModelSelectorOptions = {},
) {
  const anchor = getAnchor(options.anchor)
  if (document.querySelector('.quickforge-model-menu, .quickforge-model-sheet-backdrop')) {
    closeComposerModelMenu(anchor)
    return
  }
  openMobileModelSelector(
    currentModel,
    models,
    onSelect,
    {
      ...options,
      onNoneSelect: options.noneLabel ? () => onSelect(null) : undefined,
    },
    anchor,
  )
}

export function openCustomOnlyModelSelector(
  currentModel: AnyModel | null,
  initialModels: AnyModel[],
  onSelect: (model: AnyModel) => void,
  _onEditModel?: (model: AnyModel) => void,
  options: ModelSelectorOptions = {},
): ModelSelectorHandle | null {
  const anchor = getAnchor(options.anchor)
  if (document.querySelector('.quickforge-model-menu, .quickforge-model-sheet-backdrop')) {
    closeComposerModelMenu(anchor)
    return null
  }
  if (window.innerWidth <= 768) {
    return openMobileModelSelector(currentModel, initialModels, onSelect, options, anchor)
  }

  let models = initialModels
  let selectedModel = currentModel

  const menu = document.createElement('div') as ComposerModelMenuElement
  menu.className = 'quickforge-model-menu'
  if (anchor) menu.__quickforgeOwnerAnchor = anchor
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('selectCustomModel'))

  const renderMenu = () => {
    menu.replaceChildren()

    const header = document.createElement('div')
    header.className = 'quickforge-model-menu-header'
    header.textContent = t('model')
    menu.append(header)

    const sortedModels = [...models].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)))
    for (const model of sortedModels) {
      menu.append(createMenuItem({
        label: modelLabel(model),
        selected: modelsAreEqual(selectedModel, model),
        onPointerDown: (event) => {
          event.preventDefault()
          event.stopPropagation()
          selectedModel = model
          onSelect(model)
          closeComposerModelMenu(anchor)
        },
      }))
    }

    if (sortedModels.length === 0) {
      const note = document.createElement('div')
      note.className = 'quickforge-model-menu-note'
      note.textContent = t('noModelAdded')
      menu.append(note)
    }

    if (options.onOpenModelSettings) {
      const settingsFooter = document.createElement('div')
      settingsFooter.className = 'quickforge-model-settings-footer'
      settingsFooter.append(createModelSettingsButton(options.onOpenModelSettings, anchor))
      menu.append(settingsFooter)
    }
  }

  const close = () => closeComposerModelMenu(anchor)
  const dismiss = (event: Event) => {
    if (event.type === 'resize' || event.type === 'scroll') {
      positionMainMenu(menu, anchor)
      return
    }
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
    } else {
      const target = event.target as Node
      if (menu.contains(target) || anchor?.contains(target)) return
    }
    close()
  }

  menu.__quickforgeCleanup = () => {
    document.removeEventListener('pointerdown', dismiss, true)
    document.removeEventListener('keydown', dismiss, true)
    window.removeEventListener('resize', dismiss, true)
    window.removeEventListener('scroll', dismiss, true)
  }
  menu.addEventListener('pointerdown', (event) => event.stopPropagation())

  renderMenu()
  document.body.append(menu)
  positionMainMenu(menu, anchor)
  anchor?.setAttribute('aria-expanded', 'true')
  document.addEventListener('pointerdown', dismiss, true)
  document.addEventListener('keydown', dismiss, true)
  window.addEventListener('resize', dismiss, true)
  window.addEventListener('scroll', dismiss, true)

  return {
    isOpen: () => document.body.contains(menu),
    updateModels: (nextModels) => {
      if (!document.body.contains(menu)) return
      models = [...nextModels]
      renderMenu()
      positionMainMenu(menu, anchor)
    },
  }
}

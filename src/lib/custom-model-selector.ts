import { type Api, type Model, modelsAreEqual } from '@earendil-works/pi-ai'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import { t } from '@/lib/i18n'

type AnyModel = Model<Api>

type ModelSelectorOptions = {
  thinkingLevel?: ThinkingLevel
  onThinkingLevelSelect?: (level: ThinkingLevel) => void
  anchor?: HTMLElement | null
}

const THINKING_LEVELS: ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh']

function thinkingLevelLabel(level: ThinkingLevel) {
  switch (level) {
    case 'low': return t('thinkingLow')
    case 'medium': return t('thinkingMedium')
    case 'high': return t('thinkingHigh')
    case 'xhigh': return t('thinkingXHigh')
    default: return t('thinkingOff')
  }
}

function modelLabel(model: AnyModel) {
  return model.id
}

function createButton(className: string, text = '') {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = text
  return button
}

type ComposerModelMenuElement = HTMLDivElement & {
  __quickforgeCleanup?: () => void
}

function closeComposerModelMenu(anchor?: HTMLElement | null) {
  document.querySelectorAll<ComposerModelMenuElement>('.quickforge-model-menu, .quickforge-model-submenu, .quickforge-model-sheet-backdrop').forEach((menu) => {
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

function positionModelSubmenu(submenu: HTMLElement, menu: HTMLElement) {
  const width = Math.min(252, window.innerWidth - 24)
  submenu.style.width = `${width}px`
  const mainRect = menu.getBoundingClientRect()
  const measuredHeight = submenu.offsetHeight || 320
  const gap = 0
  const left = mainRect.left - width - gap >= 12
    ? mainRect.left - width - gap
    : Math.min(mainRect.right + gap, window.innerWidth - width - 12)
  const top = Math.max(12, Math.min(mainRect.top, window.innerHeight - measuredHeight - 12))
  submenu.style.left = `${left}px`
  submenu.style.top = `${top}px`
}

function createMenuItem(options: {
  label: string
  selected?: boolean
  chevron?: boolean
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

  const suffix = document.createElement('span')
  suffix.className = 'quickforge-model-menu-item-suffix'
  suffix.textContent = options.chevron ? '›' : options.selected ? '✓' : ''

  item.append(label, suffix)
  if (options.onPointerDown) item.onpointerdown = options.onPointerDown
  if (options.onPointerEnter) item.onpointerenter = options.onPointerEnter
  if (options.onClick) item.addEventListener('click', options.onClick)
  return item
}

function openMobileModelSelector(
  currentModel: AnyModel | null,
  models: AnyModel[],
  onSelect: (model: AnyModel) => void,
  options: ModelSelectorOptions,
  anchor?: HTMLElement | null,
) {
  let selectedThinkingLevel = options.thinkingLevel ?? 'off'
  let selectedModel = currentModel

  const backdrop = document.createElement('div') as ComposerModelMenuElement
  backdrop.className = 'quickforge-model-sheet-backdrop'

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

  const thinkingSection = document.createElement('div')
  thinkingSection.className = 'quickforge-model-sheet-section'

  const thinkingLabel = document.createElement('div')
  thinkingLabel.className = 'quickforge-model-sheet-section-label'
  thinkingLabel.textContent = t('reasoning')

  const renderThinkingSection = () => {
    thinkingSection.replaceChildren(thinkingLabel)
    if (selectedModel?.reasoning === true) {
      const thinkingOptions = document.createElement('div')
      thinkingOptions.className = 'quickforge-model-sheet-thinking-options'
      const buttons = new Map<ThinkingLevel, HTMLButtonElement>()

      for (const level of THINKING_LEVELS) {
        const button = createButton('quickforge-model-sheet-thinking-option', thinkingLevelLabel(level))
        buttons.set(level, button)
        button.onpointerdown = (event) => {
          event.preventDefault()
          event.stopPropagation()
          selectedThinkingLevel = level
          options.onThinkingLevelSelect?.(level)
          for (const [option, optionButton] of buttons) {
            const selected = option === selectedThinkingLevel
            optionButton.classList.toggle('is-selected', selected)
            optionButton.setAttribute('aria-pressed', String(selected))
          }
        }
        const selected = level === selectedThinkingLevel
        button.classList.toggle('is-selected', selected)
        button.setAttribute('aria-pressed', String(selected))
        thinkingOptions.append(button)
      }
      thinkingSection.append(thinkingOptions)
    } else {
      const note = document.createElement('div')
      note.className = 'quickforge-model-menu-note'
      note.textContent = t('thinkingNotSupported')
      thinkingSection.append(note)
    }
  }
  renderThinkingSection()

  const modelSectionLabel = document.createElement('div')
  modelSectionLabel.className = 'quickforge-model-sheet-section-label quickforge-model-sheet-model-label'
  modelSectionLabel.textContent = t('model')

  const modelList = document.createElement('div')
  modelList.className = 'quickforge-model-sheet-model-list'
  modelList.setAttribute('role', 'menu')
  modelList.setAttribute('aria-label', t('model'))

  // 滚动期间忽略模型行点击，避免滚动误触选中模型
  let lastScrollAt = 0
  modelList.addEventListener('scroll', () => {
    lastScrollAt = Date.now()
  })

  const modelItems = new Map<HTMLButtonElement, AnyModel>()

  // 选中模型：立即生效，但保持抽屉打开，仅高亮当前项
  const selectModel = (model: AnyModel) => {
    selectedModel = model
    if (!model.reasoning && selectedThinkingLevel !== 'off') {
      selectedThinkingLevel = 'off'
      options.onThinkingLevelSelect?.('off')
    }
    for (const [item, itemModel] of modelItems) {
      const selected = modelsAreEqual(itemModel, model)
      item.setAttribute('aria-checked', String(selected))
      const suffix = item.querySelector<HTMLElement>('.quickforge-model-menu-item-suffix')
      if (suffix) suffix.textContent = selected ? '✓' : ''
    }
    renderThinkingSection()
    onSelect(model)
  }

  const sortedModels = [...models].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)))
  for (const model of sortedModels) {
    const item = createMenuItem({
      label: modelLabel(model),
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

  sheet.append(dragZone, header, thinkingSection, modelSectionLabel, modelList)
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
}

export function openCustomOnlyModelSelector(
  currentModel: AnyModel | null,
  models: AnyModel[],
  onSelect: (model: AnyModel) => void,
  _onEditModel?: (model: AnyModel) => void,
  options: ModelSelectorOptions = {},
) {
  const anchor = getAnchor(options.anchor)
  if (document.querySelector('.quickforge-model-menu, .quickforge-model-sheet-backdrop')) {
    closeComposerModelMenu(anchor)
    return
  }
  if (window.innerWidth <= 768) {
    openMobileModelSelector(currentModel, models, onSelect, options, anchor)
    return
  }

  let selectedThinkingLevel = options.thinkingLevel ?? 'off'
  let selectedModel = currentModel
  let submenu: ComposerModelMenuElement | null = null

  const menu = document.createElement('div') as ComposerModelMenuElement
  menu.className = 'quickforge-model-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('selectCustomModel'))

  const renderModelSubmenu = () => {
    submenu?.remove()
    submenu = document.createElement('div') as ComposerModelMenuElement
    submenu.className = 'quickforge-model-submenu'
    submenu.setAttribute('role', 'menu')
    submenu.setAttribute('aria-label', t('model'))

    const header = document.createElement('div')
    header.className = 'quickforge-model-menu-header'
    header.textContent = t('model')
    submenu.append(header)

    const sortedModels = [...models].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)))
    for (const model of sortedModels) {
      submenu.append(createMenuItem({
        label: modelLabel(model),
        selected: modelsAreEqual(selectedModel, model),
        onPointerDown: (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!model.reasoning && selectedThinkingLevel !== 'off') {
            selectedThinkingLevel = 'off'
            options.onThinkingLevelSelect?.('off')
          }
          selectedModel = model
          onSelect(model)
          closeComposerModelMenu(anchor)
        },
      }))
    }

    submenu.addEventListener('pointerdown', (event) => event.stopPropagation())
    document.body.append(submenu)
    positionModelSubmenu(submenu, menu)
  }

  const renderMainMenu = () => {
    menu.replaceChildren()

    const header = document.createElement('div')
    header.className = 'quickforge-model-menu-header'
    header.textContent = t('reasoning')
    menu.append(header)

    const supportsThinking = selectedModel?.reasoning === true
    if (supportsThinking) {
      for (const level of THINKING_LEVELS) {
        menu.append(createMenuItem({
          label: thinkingLevelLabel(level),
          selected: selectedThinkingLevel === level,
          onPointerDown: (event) => {
            event.preventDefault()
            event.stopPropagation()
            selectedThinkingLevel = level
            options.onThinkingLevelSelect?.(level)
            renderMainMenu()
            positionMainMenu(menu, anchor)
          },
        }))
      }
    } else {
      const note = document.createElement('div')
      note.className = 'quickforge-model-menu-note'
      note.textContent = t('thinkingNotSupported')
      menu.append(note)
    }

    const separator = document.createElement('div')
    separator.className = 'quickforge-model-menu-separator'
    menu.append(separator)

    menu.append(createMenuItem({
      label: selectedModel ? modelLabel(selectedModel) : t('noModelAdded'),
      chevron: true,
      onPointerEnter: renderModelSubmenu,
      onPointerDown: (event) => {
        event.preventDefault()
        event.stopPropagation()
        renderModelSubmenu()
      },
    }))
  }

  const close = () => closeComposerModelMenu(anchor)
  const dismiss = (event: Event) => {
    if (event.type === 'resize' || event.type === 'scroll') {
      positionMainMenu(menu, anchor)
      if (submenu) positionModelSubmenu(submenu, menu)
      return
    }
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
    } else {
      const target = event.target as Node
      if (menu.contains(target) || submenu?.contains(target) || anchor?.contains(target)) return
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

  renderMainMenu()
  document.body.append(menu)
  positionMainMenu(menu, anchor)
  anchor?.setAttribute('aria-expanded', 'true')
  document.addEventListener('pointerdown', dismiss, true)
  document.addEventListener('keydown', dismiss, true)
  window.addEventListener('resize', dismiss, true)
  window.addEventListener('scroll', dismiss, true)
}

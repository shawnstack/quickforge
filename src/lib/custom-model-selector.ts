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
  document.querySelectorAll<ComposerModelMenuElement>('.quickforge-model-menu, .quickforge-model-submenu').forEach((menu) => {
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
  return item
}

export function openCustomOnlyModelSelector(
  currentModel: AnyModel | null,
  models: AnyModel[],
  onSelect: (model: AnyModel) => void,
  _onEditModel?: (model: AnyModel) => void,
  options: ModelSelectorOptions = {},
) {
  const anchor = getAnchor(options.anchor)
  if (document.querySelector('.quickforge-model-menu')) {
    closeComposerModelMenu(anchor)
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

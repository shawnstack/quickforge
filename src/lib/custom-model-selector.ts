import type { Api, Model } from '@earendil-works/pi-ai'
import { agentAccessCheckIcon } from '@/components/chat/panel-decoration/icons'
import { t } from '@/lib/i18n'
import { modelDisplayLabel as modelLabel } from '@/lib/model-display-label'
import {
  createThinkingSlider,
  type ThinkingSliderHandle,
  type ThinkingSliderLevel,
} from '@/lib/thinking-slider'
import { thinkingLevelLabel } from '@/lib/thinking-levels'

type AnyModel = Model<Api>

/**
 * Model identity check (same contract as pi-ai's `modelsAreEqual`).
 *
 * Kept local on purpose: importing that helper pulled the entire multi-provider
 * runtime into the browser entry chunk, while the menu only needs identity.
 */
function modelsAreEqual(a: AnyModel | null | undefined, b: AnyModel | null | undefined): boolean {
  return Boolean(a && b && a.id === b.id && a.provider === b.provider)
}

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
  /**
   * 思考等级：同时传入 level 与 onChange 时，弹层底部渲染滑杆。
   * 表单场景（openModelSheet / 非推理模型）不传，弹层就只显示模型列表。
   */
  thinkingLevel?: ThinkingSliderLevel
  onThinkingLevelChange?: (level: ThinkingSliderLevel) => void
  /** 滑杆是否禁用（写租约观察者、只读视图等）。 */
  thinkingDisabled?: boolean
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
  /** 外部（如快捷键）改变档位时同步滑杆位置，避免视觉与实际不一致。 */
  setThinkingLevel?: (level: ThinkingSliderLevel) => void
  /**
   * 弹层保持打开期间切换模型时同步滑杆可用性：切到非推理模型后档位不再
   * 生效，滑杆应转为禁用，避免用户拖出一个会被服务端忽略的等级。
   */
  setThinkingDisabled?: (disabled: boolean) => void
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
  // 336px：分组头 + 「模型名 + 能力标签 + 勾选」三列在 260px 下会频繁截断模型 id。
  const width = Math.min(336, window.innerWidth - 24)
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
  /** 模型名后缀的能力标签（如"视觉"），文本由调用方本地化 */
  capabilityLabel?: string
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
  const name = document.createElement('span')
  name.className = 'quickforge-model-menu-item-name'
  name.textContent = options.label
  label.append(name)
  if (options.capabilityLabel) {
    const capability = document.createElement('span')
    capability.className = 'quickforge-model-menu-item-capability'
    capability.textContent = options.capabilityLabel
    label.append(capability)
  }

  const checkSlot = document.createElement('span')
  checkSlot.className = 'quickforge-model-menu-item-check-slot'
  checkSlot.innerHTML = options.selected ? agentAccessCheckIcon : ''

  // 契约：`item.append(checkSlot, label)` —— 勾选槽仍在左侧、标签在右。
  // 右侧只放能力标签，不把勾选移到右边，避免破坏 app-css 中的
  // `grid-template-columns: 1rem minmax(0, 1fr)` 与既有断言。
  item.append(checkSlot, label)
  if (options.onPointerDown) item.onpointerdown = options.onPointerDown
  if (options.onPointerEnter) item.onpointerenter = options.onPointerEnter
  if (options.onClick) item.addEventListener('click', options.onClick)
  return item
}

/**
 * 模型按服务商分组：`Model.provider` 就是自定义提供商的名字（
 * `CustomProvider.name`），因此不需要额外数据源。
 *
 * 排序规则：自定义来源（`source: 'custom'`）优先，其余按服务商名升序；
 * 组内按展示文案升序。这样"我刚加的模型"总在最前面。
 */
type ModelGroup = {
  provider: string
  models: AnyModel[]
  custom: boolean
}

type ModelWithReference = AnyModel & {
  quickforgeModelRef?: { source?: string }
}

function groupModelsByProvider(models: readonly AnyModel[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>()
  for (const model of models) {
    const provider = model.provider || ''
    const existing = groups.get(provider)
    const isCustom = (model as ModelWithReference).quickforgeModelRef?.source === 'custom'
    if (existing) {
      existing.models.push(model)
      existing.custom = existing.custom || isCustom
    } else {
      groups.set(provider, { provider, models: [model], custom: isCustom })
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      models: [...group.models].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b))),
    }))
    .sort((a, b) => {
      if (a.custom !== b.custom) return a.custom ? -1 : 1
      return a.provider.localeCompare(b.provider)
    })
}

/** 视觉能力来自 `Model.input` 含 'image'，是仓库里唯一的能力信号。 */
function modelSupportsImages(model: AnyModel): boolean {
  const input = (model as AnyModel & { input?: string[] }).input
  return Array.isArray(input) && input.includes('image')
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
  // 点击守卫：用指针位移 + 最近滚动时间判定，替代原来的固定 300ms 时间窗。
  // 时间窗会把"滑完列表马上点"的点击直接丢掉，用户必须点第二次才生效。
  const SCROLL_SETTLE_MS = 150
  const TAP_SLOP_PX = 12
  let lastScrollAt = 0
  let pressPoint: { x: number; y: number; duringScroll: boolean } | null = null

  const isTapGesture = (event: MouseEvent) => {
    const press = pressPoint
    pressPoint = null
    if (!press) return true
    if (press.duringScroll) return false
    const x = Number.isFinite(event.clientX) ? event.clientX : press.x
    const y = Number.isFinite(event.clientY) ? event.clientY : press.y
    return Math.abs(x - press.x) <= TAP_SLOP_PX && Math.abs(y - press.y) <= TAP_SLOP_PX
  }

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
        if (!isTapGesture(event)) return
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
        capabilityLabel: modelSupportsImages(model) ? t('modelVisionCapability') : undefined,
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!isTapGesture(event)) return
          selectModel(model)
        },
      })
      modelItems.set(item, model)
      modelList.append(item)
    }
  }

  // 滚动期间忽略模型行点击，避免滚动误触选中模型：记录最近滚动时间 +
  // pointerdown 起点，点击时由 isTapGesture 判定是滑动还是点击。
  modelList.addEventListener('scroll', () => {
    lastScrollAt = Date.now()
  })
  modelList.addEventListener('pointerdown', (event) => {
    pressPoint = {
      x: event.clientX,
      y: event.clientY,
      duringScroll: Date.now() - lastScrollAt < SCROLL_SETTLE_MS,
    }
  })

  // 选中模型：立即生效，但保持抽屉打开，仅高亮当前项
  const selectModel = (model: AnyModel) => {
    selectedModel = model
    for (const [item, itemModel] of modelItems) {
      const selected = modelsAreEqual(itemModel, model)
      item.setAttribute('aria-checked', String(selected))
      // 勾选图标挂在左侧 check-slot 里（旧的 suffix 节点已废弃）。
      // 这里不重写图标，抽屉保持打开期间勾选就不会跟着移动。
      const checkSlot = item.querySelector<HTMLElement>('.quickforge-model-menu-item-check-slot')
      if (checkSlot) checkSlot.innerHTML = selected ? agentAccessCheckIcon : ''
    }
    onSelect(model)
  }

  renderModelList()

  // 顶部：自定义模型入口（与桌面菜单一致，放在最上面）
  const settingsTop = options.onOpenModelSettings ? document.createElement('div') : null
  if (settingsTop && options.onOpenModelSettings) {
    settingsTop.className = 'quickforge-model-menu-top quickforge-model-sheet-top'
    settingsTop.append(createModelSettingsButton(options.onOpenModelSettings, anchor))
  }

  // 思考等级滑杆：仅调用方给了 level + onChange 时渲染
  let thinkingSlider: ThinkingSliderHandle | null = null
  if (options.thinkingLevel && options.onThinkingLevelChange) {
    const onChange = options.onThinkingLevelChange
    thinkingSlider = createThinkingSlider({
      level: options.thinkingLevel,
      title: t('thinkingLevel'),
      labelFor: (level) => thinkingLevelLabel(level),
      disabled: options.thinkingDisabled,
      onChange: (level) => onChange(level),
    })
  }

  sheet.append(
    dragZone,
    header,
    ...(settingsTop ? [settingsTop] : []),
    modelSectionLabel,
    modelList,
    ...(thinkingSlider ? [thinkingSlider.element] : []),
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
    thinkingSlider?.destroy()
    thinkingSlider = null
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
    setThinkingLevel: (level) => {
      thinkingSlider?.setLevel(level)
    },
    setThinkingDisabled: (disabled) => {
      thinkingSlider?.setDisabled(disabled)
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

  let thinkingSlider: ThinkingSliderHandle | null = null

  const renderMenu = () => {
    thinkingSlider?.destroy()
    thinkingSlider = null
    menu.replaceChildren()

    // 顶部：自定义模型入口。放在最上面，模型列表单独滚动，入口不跟着滚。
    if (options.onOpenModelSettings) {
      const top = document.createElement('div')
      top.className = 'quickforge-model-menu-top'
      top.append(createModelSettingsButton(options.onOpenModelSettings, anchor))
      menu.append(top)
    }

    const scroll = document.createElement('div')
    scroll.className = 'quickforge-model-menu-scroll'
    scroll.setAttribute('role', 'group')
    menu.append(scroll)

    const groups = groupModelsByProvider(models)
    for (const group of groups) {
      const head = document.createElement('div')
      head.className = 'quickforge-model-menu-group'
      const badge = document.createElement('span')
      badge.className = 'quickforge-model-menu-group-badge'
      badge.setAttribute('aria-hidden', 'true')
      badge.textContent = (group.provider.trim()[0] ?? '?').toUpperCase()
      const name = document.createElement('span')
      name.className = 'quickforge-model-menu-group-name'
      name.textContent = group.provider || t('model')
      const count = document.createElement('span')
      count.className = 'quickforge-model-menu-group-count'
      count.textContent = t('modelsCount').replace('{count}', String(group.models.length))
      head.append(badge, name, count)
      scroll.append(head)

      for (const model of group.models) {
        scroll.append(createMenuItem({
          label: options.modelLabelOverride ? options.modelLabelOverride(model) : modelLabel(model),
          selected: modelsAreEqual(selectedModel, model),
          capabilityLabel: modelSupportsImages(model) ? t('modelVisionCapability') : undefined,
          onPointerDown: (event) => {
            event.preventDefault()
            event.stopPropagation()
            selectedModel = model
            onSelect(model)
            closeComposerModelMenu(anchor)
          },
        }))
      }
    }

    if (groups.length === 0) {
      const note = document.createElement('div')
      note.className = 'quickforge-model-menu-note'
      note.textContent = t('noModelAdded')
      scroll.append(note)
    }

    // 底部：思考等级滑杆。只有调用方给了 level + onChange 才渲染
    // （表单场景与非推理模型不渲染）。
    if (options.thinkingLevel && options.onThinkingLevelChange) {
      const onChange = options.onThinkingLevelChange
      thinkingSlider = createThinkingSlider({
        level: options.thinkingLevel,
        title: t('thinkingLevel'),
        labelFor: (level) => thinkingLevelLabel(level),
        disabled: options.thinkingDisabled,
        onChange: (level) => onChange(level),
      })
      menu.append(thinkingSlider.element)
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
    thinkingSlider?.destroy()
    thinkingSlider = null
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
    setThinkingLevel: (level) => {
      thinkingSlider?.setLevel(level)
    },
    setThinkingDisabled: (disabled) => {
      thinkingSlider?.setDisabled(disabled)
    },
  }
}

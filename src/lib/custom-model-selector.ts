import { type Api, type Model, modelsAreEqual } from '@earendil-works/pi-ai'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import { t } from '@/lib/i18n'

type AnyModel = Model<Api>

type CustomModelEntry = {
  provider: string
  id: string
  model: AnyModel
}

type ModelSelectorOptions = {
  thinkingLevel?: ThinkingLevel
  onThinkingLevelSelect?: (level: ThinkingLevel) => void
}

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh']

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
  return `${model.provider} / ${model.id}`
}

function createButton(className: string, text: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = text
  return button
}

const PENCIL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`

export function openCustomOnlyModelSelector(
  currentModel: AnyModel | null,
  models: AnyModel[],
  onSelect: (model: AnyModel) => void,
  onEditModel?: (model: AnyModel) => void,
  options: ModelSelectorOptions = {},
) {
  const entries: CustomModelEntry[] = models.map((model) => ({
    provider: model.provider,
    id: model.id,
    model,
  }))

  let selectedThinkingLevel = options.thinkingLevel ?? 'off'

  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'

  const dialog = document.createElement('div')
  dialog.className = 'flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-xl'

  const header = document.createElement('div')
  header.className = 'border-b border-border p-4'

  const titleRow = document.createElement('div')
  titleRow.className = 'mb-3 flex items-center justify-between gap-3'

  const title = document.createElement('div')
  title.className = 'text-sm font-semibold'
  title.textContent = t('selectCustomModel')

  const closeButton = createButton('rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-secondary', t('close'))
  closeButton.onclick = () => overlay.remove()

  titleRow.append(title, closeButton)

  const search = document.createElement('input')
  search.className = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
  search.placeholder = t('searchModels')

  header.append(titleRow, search)

  const config = document.createElement('div')
  config.className = 'mt-3 rounded-lg border border-border bg-muted/20 p-3'

  const currentConfigTitle = document.createElement('div')
  currentConfigTitle.className = 'text-xs font-medium text-muted-foreground'
  currentConfigTitle.textContent = t('currentConfiguration')

  const currentModelLine = document.createElement('div')
  currentModelLine.className = 'mt-1 truncate text-sm font-medium'
  currentModelLine.textContent = currentModel ? modelLabel(currentModel) : t('noModelAdded')

  const thinkingRow = document.createElement('div')
  thinkingRow.className = 'mt-3 flex flex-wrap items-center gap-1.5'

  const thinkingLabel = document.createElement('span')
  thinkingLabel.className = 'mr-1 text-xs text-muted-foreground'
  thinkingLabel.textContent = t('thinkingLevel')

  const renderThinkingControls = () => {
    thinkingRow.replaceChildren(thinkingLabel)
    const supportsThinking = currentModel?.reasoning === true

    if (!supportsThinking) {
      const note = document.createElement('span')
      note.className = 'text-xs text-muted-foreground'
      note.textContent = t('thinkingNotSupported')
      thinkingRow.append(note)
      return
    }

    for (const level of THINKING_LEVELS) {
      const button = createButton(
        `rounded-full border px-2.5 py-1 text-xs transition-colors ${selectedThinkingLevel === level ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`,
        thinkingLevelLabel(level),
      )
      button.onclick = () => {
        selectedThinkingLevel = level
        options.onThinkingLevelSelect?.(level)
        renderThinkingControls()
      }
      thinkingRow.append(button)
    }
  }

  config.append(currentConfigTitle, currentModelLine, thinkingRow)
  header.append(config)
  renderThinkingControls()

  const list = document.createElement('div')
  list.className = 'min-h-0 flex-1 overflow-y-auto'

  const renderList = () => {
    const query = search.value.trim().toLowerCase()
    list.replaceChildren()

    const filtered = entries
      .filter(({ model }) => {
        if (!query) return true
        return modelLabel(model).toLowerCase().includes(query)
      })
      .sort((a, b) => {
        const aCurrent = modelsAreEqual(currentModel, a.model)
        const bCurrent = modelsAreEqual(currentModel, b.model)
        if (aCurrent && !bCurrent) return -1
        if (!aCurrent && bCurrent) return 1
        return modelLabel(a.model).localeCompare(modelLabel(b.model))
      })

    if (filtered.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'p-8 text-center text-sm text-muted-foreground'
      empty.textContent = t('noMatchingCustomModels')
      list.append(empty)
      return
    }

    for (const { model } of filtered) {
      const item = createButton(
        'w-full border-b border-border px-4 py-3 text-left hover:bg-muted',
        '',
      )

      const top = document.createElement('div')
      top.className = 'flex items-center justify-between gap-2'

      const id = document.createElement('div')
      id.className = 'min-w-0 truncate text-sm font-medium'
      id.textContent = model.id

      const rightGroup = document.createElement('div')
      rightGroup.className = 'flex shrink-0 items-center gap-1.5'

      const provider = document.createElement('div')
      provider.className = 'rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground'
      provider.textContent = model.provider

      rightGroup.append(provider)

      if (onEditModel) {
        const editButton = document.createElement('button')
        editButton.type = 'button'
        editButton.className = 'shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground'
        editButton.innerHTML = PENCIL_ICON_SVG
        editButton.setAttribute('aria-label', t('editModel'))
        editButton.onclick = (event) => {
          event.stopPropagation()
          overlay.remove()
          onEditModel(model)
        }
        rightGroup.append(editButton)
      }

      top.append(id, rightGroup)

      const meta = document.createElement('div')
      meta.className = 'mt-1 text-xs text-muted-foreground'
      meta.textContent = `${model.api} · ${model.contextWindow}/${model.maxTokens}${model.reasoning ? ` · ${t('thinkingSupported')}` : ''}`

      if (modelsAreEqual(currentModel, model)) {
        const current = document.createElement('span')
        current.className = 'ml-2 text-green-500'
        current.textContent = '✓'
        id.append(current)
      }

      item.append(top, meta)
      item.onclick = () => {
        if (!model.reasoning && selectedThinkingLevel !== 'off') {
          selectedThinkingLevel = 'off'
          options.onThinkingLevelSelect?.('off')
        }
        onSelect(model)
        currentModelLine.textContent = modelLabel(model)
        overlay.remove()
      }
      list.append(item)
    }
  }

  search.oninput = renderList
  overlay.onclick = (event) => {
    if (event.target === overlay) overlay.remove()
  }
  dialog.onclick = (event) => event.stopPropagation()

  dialog.append(header, list)
  overlay.append(dialog)
  document.body.append(overlay)
  renderList()
  search.focus()
}

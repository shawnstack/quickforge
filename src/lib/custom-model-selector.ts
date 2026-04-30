import { type Api, type Model, modelsAreEqual } from '@mariozechner/pi-ai'
import { t } from '@/lib/i18n'

type AnyModel = Model<Api>

type CustomModelEntry = {
  provider: string
  id: string
  model: AnyModel
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
) {
  const entries: CustomModelEntry[] = models.map((model) => ({
    provider: model.provider,
    id: model.id,
    model,
  }))

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
      meta.textContent = `${model.api} · ${model.contextWindow}/${model.maxTokens}`

      if (modelsAreEqual(currentModel, model)) {
        const current = document.createElement('span')
        current.className = 'ml-2 text-green-500'
        current.textContent = '✓'
        id.append(current)
      }

      item.append(top, meta)
      item.onclick = () => {
        onSelect(model)
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

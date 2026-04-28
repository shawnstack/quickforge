import { type Api, type Model, modelsAreEqual } from '@mariozechner/pi-ai'

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

export function openCustomOnlyModelSelector(
  currentModel: AnyModel | null,
  models: AnyModel[],
  onSelect: (model: AnyModel) => void,
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
  title.textContent = '选择自定义模型'

  const closeButton = createButton('rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-secondary', '关闭')
  closeButton.onclick = () => overlay.remove()

  titleRow.append(title, closeButton)

  const search = document.createElement('input')
  search.className = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
  search.placeholder = '搜索模型...'

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
      empty.textContent = '没有匹配的自定义模型'
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

      const provider = document.createElement('div')
      provider.className = 'shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground'
      provider.textContent = model.provider

      top.append(id, provider)

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

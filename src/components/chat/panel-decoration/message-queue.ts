import { t } from '@/lib/i18n'
import {
  moveQueuedMessage,
  moveQueuedMessageToHead,
  enqueueQueuedMessage,
  replaceQueuedMessageText,
  type MessageQueueState,
  type QueuedMessage,
} from '@/lib/message-queue'

export type MessageQueuePanelState = MessageQueueState

const SUGGESTION_MENU_CLASSES = [
  'quickforge-command-suggestions',
  'quickforge-file-reference-suggestions',
  'quickforge-capability-suggestions',
]

const ICONS = {
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="0.8"/><circle cx="15" cy="6" r="0.8"/><circle cx="9" cy="12" r="0.8"/><circle cx="15" cy="12" r="0.8"/><circle cx="9" cy="18" r="0.8"/><circle cx="15" cy="18" r="0.8"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.17 6.83a2.12 2.12 0 0 0-3-3L4 18v3h3z"/><path d="m14 6 4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>',
}

// ===== Drag reorder (pointer mini-sortable) =====
const DRAG_THRESHOLD_PX = 6
const EDGE_SCROLL_ZONE_PX = 26
const EDGE_SCROLL_STEP_PX = 7

type RowDragSession = {
  /** Tears down listeners and the ghost; `onEnd` fires exactly once per session. */
  cancel: () => void
}

// Move/up must live on window capture — handle-scoped listeners lose the
// release once implicit pointer capture kicks in. All session state is owned
// by the calling controller; nothing is module-global.
function beginRowDragSession({
  rowEl,
  listEl,
  startEvent,
  onCommit,
  onEnd,
}: {
  rowEl: HTMLElement
  listEl: HTMLElement
  startEvent: PointerEvent
  onCommit: (toIndex: number) => void
  onEnd: (moved: boolean) => void
}): RowDragSession | null {
  if (rowEl.querySelector('.quickforge-msg-queue-edit-input')) return null

  const handle = rowEl.querySelector<HTMLElement>('.quickforge-msg-queue-handle')
  if (!handle) return null
  if (startEvent.button !== undefined && startEvent.button !== 0) return null
  startEvent.preventDefault()

  const startX = startEvent.clientX
  const startY = startEvent.clientY
  const rect = rowEl.getBoundingClientRect()
  let ghost: HTMLElement | null = null
  let moved = false
  let done = false
  let scrollRaf: number | null = null
  let lastClientY = startEvent.clientY

  function buildGhost() {
    rowEl.classList.add('quickforge-msg-queue-item--drag-placeholder')
    ghost = rowEl.cloneNode(true) as HTMLElement
    ghost.classList.remove('quickforge-msg-queue-item--drag-placeholder')
    ghost.classList.add('quickforge-msg-queue-drag-ghost')
    ghost.style.width = `${rect.width}px`
    ghost.style.left = `${rect.left}px`
    ghost.style.top = `${rect.top}px`
    document.body.appendChild(ghost)
    document.documentElement.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
  }

  function placeholderIndex() {
    return Array.prototype.indexOf.call(listEl.children, rowEl)
  }

  function movePlaceholder(clientY: number) {
    const siblings = Array.prototype.filter.call(listEl.children, (child: Element) => child !== rowEl) as Element[]
    let targetIndex = siblings.length
    for (let i = 0; i < siblings.length; i++) {
      const box = siblings[i].getBoundingClientRect()
      if (clientY < box.top + box.height / 2) {
        targetIndex = i
        break
      }
    }
    if (targetIndex === placeholderIndex()) return
    listEl.insertBefore(rowEl, siblings[targetIndex] ?? null)
  }

  function tick() {
    scrollRaf = null
    const listRect = listEl.getBoundingClientRect()
    if (lastClientY < listRect.top + EDGE_SCROLL_ZONE_PX) listEl.scrollTop -= EDGE_SCROLL_STEP_PX
    else if (lastClientY > listRect.bottom - EDGE_SCROLL_ZONE_PX) listEl.scrollTop += EDGE_SCROLL_STEP_PX
    movePlaceholder(lastClientY)
    if (ghost) ghost.style.top = `${rect.top + (lastClientY - startY)}px`
    if (moved && !done) scrollRaf = requestAnimationFrame(tick)
  }

  function cleanup() {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    if (scrollRaf !== null) {
      cancelAnimationFrame(scrollRaf)
      scrollRaf = null
    }
    if (ghost) {
      ghost.remove()
      ghost = null
    }
    rowEl.classList.remove('quickforge-msg-queue-item--drag-placeholder')
    document.documentElement.style.userSelect = ''
    document.body.style.cursor = ''
    done = true
    onEnd(moved)
  }

  function onMove(event: PointerEvent) {
    if (done) return
    lastClientY = event.clientY
    if (!moved) {
      if (Math.abs(event.clientY - startY) < DRAG_THRESHOLD_PX && Math.abs(event.clientX - startX) < DRAG_THRESHOLD_PX) return
      moved = true
      buildGhost()
    }
    ghost?.style.setProperty('top', `${rect.top + (event.clientY - startY)}px`)
    movePlaceholder(event.clientY)
    if (scrollRaf === null) scrollRaf = requestAnimationFrame(tick)
    event.preventDefault()
  }

  function onUp() {
    if (done || !moved) {
      cleanup()
      return
    }
    // Commit first: notify()'s render is parked while the session still owns
    // the list DOM, then cleanup→onEnd performs the single rebuild.
    onCommit(placeholderIndex())
    cleanup()
  }

  function onCancel() {
    if (done) return
    cleanup()
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  return { cancel: onCancel }
}

function isSuggestionMenu(element: Element | null): boolean {
  return Boolean(element && SUGGESTION_MENU_CLASSES.some((className) => element.classList.contains(className)))
}

function isQueueAnchorFollower(element: Element | null): boolean {
  return Boolean(
    element
    && (element.classList.contains('quickforge-todo-summary')
      || element.classList.contains('message-editor')
      || isSuggestionMenu(element)),
  )
}

export function createMessageQueuePanelController({
  panel,
  enabled,
  isStreaming,
  steeringEnabled,
  onChange,
  onComposerCleared,
  submitJump,
  resumeQueue,
}: {
  panel: HTMLElement
  enabled: boolean
  isStreaming: () => boolean
  steeringEnabled: () => boolean
  /** Called after every state mutation so the host persists and re-decorates. */
  onChange: () => void
  /** The controller cleared the composer textarea; the host syncs drafts/menus. */
  onComposerCleared: () => void
  /** Resolve = the item left the queue successfully (or was re-planned by the host). */
  submitJump: (item: QueuedMessage) => Promise<void>
  resumeQueue: () => void
}) {
  let root: HTMLElement | null = null
  let paused = false
  let items: QueuedMessage[] = []
  let editingId: string | null = null
  let jumpingId: string | null = null
  let boundTextarea: HTMLTextAreaElement | null = null
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null
  let dragSession: RowDragSession | null = null
  let renderDeferredByDrag = false
  let disposed = false

  const notify = () => {
    onChange()
    render()
  }

  // Hoisted so DOM closures below and the returned API share one implementation.
  function setPausedFlag(value: boolean) {
    if (paused === value) return
    paused = value
    notify()
  }

  function removeItemById(id: string) {
    items = items.filter((item) => item.id !== id)
    if (editingId === id) editingId = null
    if (items.length === 0) paused = false
    notify()
  }

  function editItemText(id: string, text: string) {
    const next = replaceQueuedMessageText(items, id, text)
    if (next) items = next
  }

  function enqueueTextValue(text: string): QueuedMessage | null {
    const next = enqueueQueuedMessage(items, text)
    if (!next) return null
    items = next
    notify()
    return items[items.length - 1] ?? null
  }

  const getEditor = () => panel.querySelector<HTMLElement>('message-editor')

  const ensureRoot = () => {
    const editor = getEditor()
    const composerShell = editor?.parentElement
    if (!root) {
      root = document.createElement('section')
      root.className = 'quickforge-msg-queue'
    }
    if (!composerShell) return false
    const suggestionMenu = Array.from(composerShell.children).find((element) => isSuggestionMenu(element))
    const insertionTarget = suggestionMenu ?? editor
    if (!insertionTarget) return false
    // Stable once settled: menu / editor / todo-summary sitting right after us
    // are all legal followers, otherwise both anchored controllers would flip
    // relative positions on every decorate pass.
    if (root.parentElement !== composerShell || !isQueueAnchorFollower(root.nextElementSibling)) {
      composerShell.insertBefore(root, insertionTarget)
    }
    return true
  }

  const bindTextarea = () => {
    const editor = getEditor()
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    if (!textarea || textarea === boundTextarea) return
    unbindTextarea()
    keydownHandler = (event: KeyboardEvent) => {
      if (!enabled) return
      if (event.isComposing || event.key === 'Process') return
      if (event.key !== 'Enter' || event.shiftKey) return
      if (!isStreaming()) return
      const value = textarea.value ?? ''
      if (!value.trim()) return
      event.preventDefault()
      event.stopPropagation()
      enqueueTextValue(value)
      textarea.value = ''
      const editorElement = getEditor()
      if (editorElement) {
        ;(editorElement as { value?: string }).value = ''
        ;(editorElement as { requestUpdate?: () => void }).requestUpdate?.()
      }
      onComposerCleared()
    }
    textarea.addEventListener('keydown', keydownHandler, true)
    boundTextarea = textarea
  }

  const unbindTextarea = () => {
    if (boundTextarea && keydownHandler) boundTextarea.removeEventListener('keydown', keydownHandler, true)
    boundTextarea = null
    keydownHandler = null
  }

  const render = () => {
    if (!enabled) return
    // Decorate passes (every agent delta while streaming) call render()
    // constantly. An in-flight drag owns the list DOM until it ends — park
    // the rebuild instead of tearing the gesture down; onEnd applies it.
    if (dragSession) {
      renderDeferredByDrag = true
      return
    }
    if (items.length === 0 && !paused) {
      root?.remove()
      root = null
      return
    }
    if (!ensureRoot() || !root) return
    bindTextarea()

    // The same rebuild cadence can hit while the user is editing a queued
    // item: capture the live input (same item only) so the rebuild carries
    // value/focus/caret across instead of resetting to the committed text.
    const liveInput = root.querySelector<HTMLInputElement>('.quickforge-msg-queue-edit-input')
    const liveEdit = liveInput && editingId !== null && liveInput.dataset.queueItemId === editingId
      ? {
          value: liveInput.value,
          focused: document.activeElement === liveInput,
          selectionStart: liveInput.selectionStart,
          selectionEnd: liveInput.selectionEnd,
        }
      : null

    root.replaceChildren()

    if (items.length > 0) {
      const head = document.createElement('div')
      head.className = 'quickforge-msg-queue-head'
      const count = document.createElement('b')
      count.textContent = t('messageQueueCount', { count: items.length })
      head.append(count)
      root.append(head)
    }

    if (paused) {
      const banner = document.createElement('div')
      banner.className = 'quickforge-msg-queue-paused'
      const icon = document.createElement('span')
      icon.className = 'quickforge-msg-queue-paused-icon'
      icon.innerHTML = ICONS.pause
      icon.setAttribute('aria-hidden', 'true')
      const label = document.createElement('span')
      label.textContent = t('messageQueuePaused', { count: items.length })
      const resume = document.createElement('button')
      resume.type = 'button'
      resume.className = 'quickforge-msg-queue-resume'
      resume.textContent = t('messageQueueResume')
      resume.addEventListener('click', () => {
        setPausedFlag(false)
        resumeQueue()
      })
      banner.append(icon, label, resume)
      root.append(banner)
    }

    if (items.length === 0) return
    const list = document.createElement('ul')
    list.className = 'quickforge-msg-queue-list'
    items.forEach((item, index) => {
      const row = document.createElement('li')
      row.className = 'quickforge-msg-queue-item'

      const dragHandle = document.createElement('span')
      dragHandle.className = 'quickforge-msg-queue-handle'
      dragHandle.title = t('messageQueueDragTitle')
      dragHandle.setAttribute('aria-hidden', 'true')
      dragHandle.innerHTML = ICONS.grip
      row.append(dragHandle)

      const order = document.createElement('span')
      order.className = 'quickforge-msg-queue-order'
      if (index === 0) {
        order.title = t('messageQueueNextUp')
        order.innerHTML = ICONS.up
      } else {
        order.textContent = String(index + 1)
        order.title = t('messageQueueItemAt', { index: index + 1 })
      }
      row.append(order)

      const actions = document.createElement('span')
      actions.className = 'quickforge-msg-queue-actions'

      if (editingId === item.id) {
        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'quickforge-msg-queue-edit-input'
        input.dataset.queueItemId = item.id
        input.value = liveEdit ? liveEdit.value : item.text
        input.setAttribute('aria-label', t('messageQueueEditTitle'))
        const save = document.createElement('button')
        save.type = 'button'
        save.className = 'quickforge-msg-queue-icon-btn'
        save.title = t('messageQueueEditSave')
        save.innerHTML = ICONS.check
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.className = 'quickforge-msg-queue-icon-btn'
        cancel.title = t('messageQueueEditCancel')
        cancel.innerHTML = ICONS.close
        const commit = () => {
          editItemText(item.id, input.value)
          editingId = null
          notify()
        }
        save.addEventListener('click', commit)
        cancel.addEventListener('click', () => {
          editingId = null
          render()
        })
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault()
            event.stopPropagation()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            editingId = null
            render()
          }
        })
        actions.append(save, cancel)
        row.append(input, actions)
        // Fresh edit rows take focus; preserved ones keep it only if the user
        // still had it (a click elsewhere must not be overridden).
        if (!liveEdit || liveEdit.focused) {
          window.requestAnimationFrame(() => {
            input.focus()
            if (liveEdit?.focused && liveEdit.selectionStart !== null) {
              input.setSelectionRange(liveEdit.selectionStart, liveEdit.selectionEnd)
            }
          })
        }
        list.append(row)
        return
      }

      const text = document.createElement('span')
      text.className = 'quickforge-msg-queue-text'
      text.textContent = item.text
      text.title = item.text
      row.append(text)

      const canJump = steeringEnabled() && isStreaming() && jumpingId !== item.id
      const jump = document.createElement('button')
      jump.type = 'button'
      jump.className = 'quickforge-msg-queue-jump-btn'
      jump.innerHTML = `${ICONS.up}<span>${t('messageQueueJumpNow')}</span>`
      jump.title = t('messageQueueJumpTitle')
      jump.disabled = !canJump
      jump.addEventListener('click', async () => {
        jumpingId = item.id
        render()
        try {
          await submitJump(item)
        } finally {
          if (jumpingId === item.id) jumpingId = null
          render()
        }
      })

      const edit = document.createElement('button')
      edit.type = 'button'
      edit.className = 'quickforge-msg-queue-icon-btn'
      edit.title = t('messageQueueEditTitle')
      edit.innerHTML = ICONS.pencil
      edit.addEventListener('click', () => {
        editingId = item.id
        render()
      })

      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'quickforge-msg-queue-icon-btn quickforge-msg-queue-icon-btn--danger'
      del.title = t('messageQueueDeleteTitle')
      del.innerHTML = ICONS.trash
      del.addEventListener('click', () => {
        removeItemById(item.id)
      })

      actions.append(jump, edit, del)
      row.append(actions)

      dragHandle.addEventListener('pointerdown', (pointerEvent) => {
        // One session per controller; ignore extra pointers mid-drag.
        if (dragSession) return
        dragSession = beginRowDragSession({
          rowEl: row,
          listEl: list,
          startEvent: pointerEvent,
          onCommit: (toIndex) => {
            items = moveQueuedMessage(items, item.id, toIndex)
            notify()
          },
          onEnd: (moved) => {
            dragSession = null
            if (disposed) return
            // Rebuild from the authoritative items: applies state changes that
            // arrived mid-drag, and restores the row order after a cancelled
            // gesture leaves the DOM shuffled.
            if (moved || renderDeferredByDrag) {
              renderDeferredByDrag = false
              render()
            }
          },
        })
      })

      list.append(row)
    })
    root.append(list)
  }

  const syncStreamingChrome = () => {
    if (!enabled) return
    const editor = getEditor()
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    if (!textarea) return
    // decorateEditor resets the placeholder to the default every pass, this
    // runs later within the same decorate() so the queued variant wins.
    if (isStreaming()) textarea.placeholder = t('messageQueuePlaceholder')
  }

  return {
    update() {
      if (!enabled) return
      bindTextarea()
      syncStreamingChrome()
      render()
    },
    getState(): MessageQueuePanelState {
      return { items: [...items], paused }
    },
    hydrate(state: MessageQueuePanelState) {
      if (!enabled) return
      items = [...state.items]
      paused = state.paused
      notify()
    },
    enqueueText(text: string): QueuedMessage | null {
      return enqueueTextValue(text)
    },
    removeItem(id: string) {
      removeItemById(id)
    },
    editItem(id: string, text: string) {
      editItemText(id, text)
    },
    moveItemToHead(id: string) {
      items = moveQueuedMessageToHead(items, id)
      notify()
    },
    setPaused(value: boolean) {
      setPausedFlag(value)
    },
    consumeHead(): QueuedMessage | null {
      if (paused || items.length === 0) return null
      const [head, ...rest] = items
      items = rest
      notify()
      return head ?? null
    },
    restoreHead(item: QueuedMessage) {
      items = [item, ...items.filter((candidate) => candidate.id !== item.id)]
      notify()
    },
    cleanup() {
      // Cancel the session first, but swallow its rebuild: the whole panel is
      // being torn down right after.
      disposed = true
      const session = dragSession
      dragSession = null
      renderDeferredByDrag = false
      session?.cancel()
      unbindTextarea()
      root?.remove()
      root = null
      items = []
      paused = false
      editingId = null
      jumpingId = null
    },
  }
}

export type MessageQueuePanelController = ReturnType<typeof createMessageQueuePanelController>

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_QUEUED_MESSAGES,
  MAX_QUEUED_MESSAGE_TEXT_LENGTH,
  clearStoredMessageQueueState,
  createQueuedMessage,
  enqueueQueuedMessage,
  loadStoredMessageQueueState,
  moveQueuedMessage,
  moveQueuedMessageToHead,
  normalizeStoredMessageQueueState,
  removeQueuedMessage,
  replaceQueuedMessageText,
  saveStoredMessageQueueState,
  type QueuedMessage,
} from '@/lib/message-queue'

const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const controllerSource = readFileSync(new URL('../../src/components/chat/panel-decoration/message-queue.ts', import.meta.url), 'utf8')
const todoSource = readFileSync(new URL('../../src/components/chat/panel-decoration/todo-write-summary.ts', import.meta.url), 'utf8')
const barrelSource = readFileSync(new URL('../../src/components/chat/panel-decoration.ts', import.meta.url), 'utf8')
const capabilitiesSource = readFileSync(new URL('../../src/lib/chat-harness-capabilities.ts', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('queued message pure operations', () => {
  it('trims text and rejects empty or oversized input', () => {
    expect(createQueuedMessage('  hi  ')).toMatchObject({ text: 'hi' })
    expect(createQueuedMessage('   ')).toBeNull()
    expect(createQueuedMessage('x'.repeat(MAX_QUEUED_MESSAGE_TEXT_LENGTH + 1))).toBeNull()
    const created = createQueuedMessage('a')
    expect(created).not.toBeNull()
    expect((created as { id: string }).id.length).toBeGreaterThan(0)
  })

  it('enforces the queue cap and FIFO order', () => {
    let items: QueuedMessage[] = []
    for (let i = 0; i < MAX_QUEUED_MESSAGES + 1; i++) {
      const next = enqueueQueuedMessage(items, `m${i}`)
      if (i < MAX_QUEUED_MESSAGES) items = next ?? []
      else expect(next).toBeNull()
    }
    expect(items).toHaveLength(MAX_QUEUED_MESSAGES)
    expect(items[0].text).toBe('m0')
  })

  it('removes and edits by id without touching siblings', () => {
    let items = enqueueQueuedMessage([], 'one') ?? []
    items = enqueueQueuedMessage(items, 'two') ?? []
    const idTwo = items[1].id
    items = replaceQueuedMessageText(items, idTwo, '  two! ') ?? items
    expect(items[1].text).toBe('two!')
    expect(replaceQueuedMessageText(items, 'missing', 'x')).toBeNull()
    expect(replaceQueuedMessageText(items, idTwo, '')).toBeNull()
    items = removeQueuedMessage(items, idTwo)
    expect(items.map((item) => item.text)).toEqual(['one'])
    expect(removeQueuedMessage(items, 'missing')).toHaveLength(1)
  })

  it('moves an item to the head preserving identity', () => {
    let items = enqueueQueuedMessage([], 'a') ?? []
    items = enqueueQueuedMessage(items, 'b') ?? []
    items = enqueueQueuedMessage(items, 'c') ?? []
    const moved = moveQueuedMessageToHead(items, items[2].id)
    expect(moved[0].text).toBe('c')
    expect(moved[0].id).toBe(items[2].id)
    expect(moveQueuedMessageToHead(items, 'missing').map((item) => item.text)).toEqual(['a', 'b', 'c'])
  })

  it('reorders by drag target index with clamping and identity', () => {
    let items = enqueueQueuedMessage([], 'a') ?? []
    items = enqueueQueuedMessage(items, 'b') ?? []
    items = enqueueQueuedMessage(items, 'c') ?? []

    // Move tail to head.
    let next = moveQueuedMessage(items, items[2].id, 0)
    expect(next.map((item) => item.text)).toEqual(['c', 'a', 'b'])
    expect(next[0].id).toBe(items[2].id)

    // Move head to tail.
    next = moveQueuedMessage(items, items[0].id, 2)
    expect(next.map((item) => item.text)).toEqual(['b', 'c', 'a'])

    // No-op same index / unknown id / clamped out-of-range indices.
    expect(moveQueuedMessage(items, items[1].id, 1)).toEqual(items)
    expect(moveQueuedMessage(items, 'missing', 0)).toEqual(items)
    expect(moveQueuedMessage(items, items[0].id, -5).map((item) => item.text)).toEqual(['a', 'b', 'c'])
    expect(moveQueuedMessage(items, items[2].id, 99).map((item) => item.text)).toEqual(['a', 'b', 'c'])
    // Fractional indices round: 1.6 → 2, so "b" moves to the tail.
    expect(moveQueuedMessage(items, items[1].id, 1.6).map((item) => item.text)).toEqual(['a', 'c', 'b'])
  })

  it('normalizes persisted state defensively', () => {
    expect(normalizeStoredMessageQueueState(null)).toEqual({ items: [], paused: false })
    expect(normalizeStoredMessageQueueState({ items: [
      { id: 'ok', text: ' kept ' },
      { id: '', text: 'no' },
      { id: 'bad-text' },
      { id: 'long', text: 'x'.repeat(MAX_QUEUED_MESSAGE_TEXT_LENGTH + 1) },
      'junk',
    ], paused: 'yes' })).toEqual({ items: [{ id: 'ok', text: 'kept' }], paused: false })
    expect(normalizeStoredMessageQueueState({ items: [], paused: true }).paused).toBe(true)
  })
})

describe('queued message persistence', () => {
  it('is a safe no-op without localStorage and round-trips with storage', () => {
    // No localStorage in the vitest node runtime: reads must be empty, writes silent.
    expect(loadStoredMessageQueueState('abc')).toEqual({ items: [], paused: false })
    expect(() => saveStoredMessageQueueState('abc', { items: [], paused: false })).not.toThrow()

    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
      removeItem: (key: string) => void backing.delete(key),
    })

    try {
      // Pending ids are never persisted nor loaded.
      expect(loadStoredMessageQueueState('pending-xyz')).toEqual({ items: [], paused: false })
      saveStoredMessageQueueState('pending-xyz', { items: [{ id: 'q1', text: 'x' }], paused: false })
      expect(backing.size).toBe(0)

      saveStoredMessageQueueState('s1', {
        items: [{ id: 'q1', text: 'hello' }, { id: 'q2', text: '' }],
        paused: true,
      })
      const state = loadStoredMessageQueueState('s1')
      expect(state.items).toEqual([{ id: 'q1', text: 'hello' }])
      expect(state.paused).toBe(true)

      // Clearing returns an empty state and drops the stored entry.
      clearStoredMessageQueueState('s1')
      expect(loadStoredMessageQueueState('s1')).toEqual({ items: [], paused: false })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('message queue source contracts', () => {
  it('wires the queue into the panel host lifecycle', () => {
    expect(hostSource).toContain('createMessageQueuePanelController({')
    expect(hostSource).toContain('loadStoredMessageQueueState(sessionId)')
    expect(hostSource).toContain("endedStatus === 'aborted' || endedStatus === 'error'")
    // Steering goes through ServerAgent.steer with a client timestamp so the
    // optimistic copy reconciles with the server echo by role+timestamp.
    expect(hostSource).toContain("await (agent as ServerAgent).steer({ role: 'user', content: item.text, timestamp: Date.now() })")
    expect(hostSource).not.toContain('steerSessionMessage')
    expect(hostSource).toContain('saveStoredMessageQueueState(sessionId, messageQueue.getState())')
    expect(hostSource).toContain('if (head) window.setTimeout(() => submitQueuedPrompt(head), 250)')
  })

  it('intercepts streaming Enter at capture phase and syncs the placeholder', () => {
    expect(controllerSource).toContain("textarea.addEventListener('keydown', keydownHandler, true)")
    expect(controllerSource).toContain("event.key === 'Process'")
    expect(controllerSource).toContain('enqueueTextValue(value)')
    expect(controllerSource).toContain("t('messageQueuePlaceholder')")
    expect(controllerSource).toContain('quickforge-msg-queue')
  })

  it('implements drag reorder with window-level pointer tracking', () => {
    expect(controllerSource).toContain('quickforge-msg-queue-handle')
    expect(controllerSource).toContain('dragSession = beginRowDragSession({')
    // Move/up must live on window capture — handle-scoped listeners miss the release.
    expect(controllerSource).toContain("window.addEventListener('pointermove', onMove, true)")
    expect(controllerSource).toContain("window.addEventListener('pointerup', onUp, true)")
    expect(controllerSource).toContain("window.addEventListener('pointercancel', onCancel, true)")
    expect(controllerSource).toContain('if (ghost) {')
    expect(controllerSource).toContain('items = moveQueuedMessage(items, item.id, toIndex)')
  })

  it('keeps an in-flight drag alive across streaming decorate passes', () => {
    // Decorate passes re-render the panel on every agent delta while the
    // queue is visible; the drag owns the DOM until it ends, so renders are
    // parked instead of cancelling the gesture (no module-global session).
    expect(controllerSource).not.toContain('let cancelActiveRowDrag')
    expect(controllerSource).toContain('renderDeferredByDrag = true')
    // Session end rebuilds from authoritative items — cancelled gestures must
    // not leave the rows shuffled, parked renders must not be dropped.
    expect(controllerSource).toContain('if (moved || renderDeferredByDrag) {')
    // Controller teardown still cancels the session without rebuilding.
    expect(controllerSource).toContain('session?.cancel()')
  })

  it('preserves the live edit input across decorate-pass rebuilds', () => {
    expect(controllerSource).toContain('dataset.queueItemId')
    expect(controllerSource).toContain('liveEdit ? liveEdit.value : item.text')
  })

  it('keeps the todo summary stable when the queue sits between it and the editor', () => {
    expect(todoSource).toContain("settledAfter?.classList.contains('quickforge-msg-queue')")
    expect(barrelSource).toContain("export { createMessageQueuePanelController } from './panel-decoration/message-queue'")
  })

  it('gates steering per harness capability and ships both languages', () => {
    expect(capabilitiesSource).toContain('messageSteering: boolean')
    expect(capabilitiesSource.indexOf('messageSteering: true'))
      .toBeLessThan(capabilitiesSource.indexOf('OPENCODE_P0_CHAT_HARNESS_CAPABILITIES'))
    expect(capabilitiesSource.match(/messageSteering: false/g)?.length).toBe(2)
    expect(i18nSource.match(/messageQueuePlaceholder:/g)?.length).toBe(2)
    expect(i18nSource.match(/messageQueueDragTitle:/g)?.length).toBe(2)
    expect(i18nSource).toContain("messageQueueJumpNow: 'Now'")
    expect(i18nSource).toContain("messageQueueJumpNow: '立即'")
    expect(cssSource).toContain('.quickforge-msg-queue {')
    expect(cssSource).toContain('.quickforge-msg-queue-icon-btn--danger:hover')
    expect(cssSource).toContain('.quickforge-msg-queue-handle {')
    expect(cssSource).toContain('.quickforge-msg-queue-drag-ghost {')
  })
})

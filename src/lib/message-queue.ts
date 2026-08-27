/**
 * Queued-composer-messages support.
 *
 * While the agent is streaming, Enter enqueues the composer text instead of
 * dropping it. The queue is owned client-side: on `agent_end` the head item is
 * submitted as a regular prompt; the optional「立即」action injects a queued
 * item into the running turn via ServerAgent.steer (optimistic display + the
 * server steering API).
 *
 * This module holds the pure queue operations and the localStorage
 * persistence (survives reloads mid-turn, same spirit as composer drafts).
 */

export const MAX_QUEUED_MESSAGES = 20
export const MAX_QUEUED_MESSAGE_TEXT_LENGTH = 2000
const MESSAGE_QUEUE_STORAGE_KEY = 'quickforge:message-queue:v1'
const MAX_STORED_MESSAGE_QUEUE_SESSIONS = 50

export type QueuedMessage = {
  id: string
  text: string
}

export type MessageQueueState = {
  items: QueuedMessage[]
  paused: boolean
}

let idCounter = 0

export function createQueuedMessage(text: string): QueuedMessage | null {
  const trimmed = String(text ?? '').trim()
  if (!trimmed || trimmed.length > MAX_QUEUED_MESSAGE_TEXT_LENGTH) return null
  idCounter += 1
  return { id: `mq-${Date.now().toString(36)}-${idCounter}`, text: trimmed }
}

/** Returns a new array; null when the queue is full or the text is invalid. */
export function enqueueQueuedMessage(items: readonly QueuedMessage[], text: string): QueuedMessage[] | null {
  const item = createQueuedMessage(text)
  if (!item) return null
  if (items.length >= MAX_QUEUED_MESSAGES) return null
  return [...items, item]
}

export function removeQueuedMessage(items: readonly QueuedMessage[], id: string): QueuedMessage[] {
  return items.filter((item) => item.id !== id)
}

export function replaceQueuedMessageText(items: readonly QueuedMessage[], id: string, text: string): QueuedMessage[] | null {
  const trimmed = String(text ?? '').trim()
  if (!trimmed || trimmed.length > MAX_QUEUED_MESSAGE_TEXT_LENGTH) return null
  let found = false
  const next = items.map((item) => {
    if (item.id !== id) return item
    found = true
    return { ...item, text: trimmed }
  })
  return found ? next : null
}

export function moveQueuedMessageToHead(items: readonly QueuedMessage[], id: string): QueuedMessage[] {
  const head = items.find((item) => item.id === id)
  if (!head) return [...items]
  return [head, ...removeQueuedMessage(items, id)]
}

/** Reorder by id to the target index; out-of-range indices clamp, unknown ids are a no-op. */
export function moveQueuedMessage(items: readonly QueuedMessage[], id: string, toIndex: number): QueuedMessage[] {
  const fromIndex = items.findIndex((item) => item.id === id)
  if (fromIndex < 0) return [...items]
  const target = Math.max(0, Math.min(items.length - 1, Math.round(toIndex)))
  if (target === fromIndex) return [...items]
  const withoutSource = removeQueuedMessage(items, id)
  const next = [...withoutSource]
  next.splice(target, 0, items[fromIndex])
  return next
}

function normalizeStoredItems(value: unknown): QueuedMessage[] {
  if (!Array.isArray(value)) return []
  const items: QueuedMessage[] = []
  for (const entry of value.slice(0, MAX_QUEUED_MESSAGES)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id) continue
    if (typeof record.text !== 'string') continue
    const text = record.text.trim()
    if (!text || text.length > MAX_QUEUED_MESSAGE_TEXT_LENGTH) continue
    items.push({ id: record.id, text })
  }
  return items
}

export function normalizeStoredMessageQueueState(value: unknown): MessageQueueState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { items: [], paused: false }
  const record = value as Record<string, unknown>
  return {
    items: normalizeStoredItems(record.items),
    paused: record.paused === true,
  }
}

function getLocalQueueStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function readStore(): Record<string, unknown> {
  const storage = getLocalQueueStorage()
  if (!storage) return {}
  let raw: string | null
  try {
    raw = storage.getItem(MESSAGE_QUEUE_STORAGE_KEY)
  } catch {
    return {}
  }
  try {
    const parsed = raw ? JSON.parse(raw) : undefined
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function pruneStore(store: Record<string, unknown>): Record<string, unknown> {
  const sessions = Object.entries(store)
    .filter(([, state]) => {
      const normalized = normalizeStoredMessageQueueState(state)
      return normalized.items.length > 0 || normalized.paused
    })
    .sort((a, b) => String((b[1] as Record<string, unknown>)?.updatedAt ?? '')
      .localeCompare(String((a[1] as Record<string, unknown>)?.updatedAt ?? '')))
  return Object.fromEntries(sessions.slice(0, MAX_STORED_MESSAGE_QUEUE_SESSIONS))
}

export function isRealQueueSessionId(sessionId: string | undefined): boolean {
  return Boolean(sessionId && !sessionId.startsWith('pending-'))
}

export function loadStoredMessageQueueState(sessionId: string | undefined): MessageQueueState {
  if (!isRealQueueSessionId(sessionId)) return { items: [], paused: false }
  const store = readStore()
  const stored = isRealQueueSessionId(sessionId) ? store[`session:${sessionId}`] : undefined
  return stored ? normalizeStoredMessageQueueState(stored) : { items: [], paused: false }
}

export function saveStoredMessageQueueState(sessionId: string, state: MessageQueueState): void {
  if (!isRealQueueSessionId(sessionId)) return
  const store = pruneStore(readStore())
  const hasContent = state.items.length > 0 || state.paused
  if (hasContent) {
    store[`session:${sessionId}`] = { ...state, updatedAt: new Date().toISOString() }
  } else {
    delete store[`session:${sessionId}`]
  }
  const storage = getLocalQueueStorage()
  if (!storage) return
  try {
    if (Object.keys(store).length === 0) storage.removeItem(MESSAGE_QUEUE_STORAGE_KEY)
    else storage.setItem(MESSAGE_QUEUE_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Persistence must never break chat usage (same policy as composer drafts).
  }
}

export function clearStoredMessageQueueState(sessionId: string): void {
  saveStoredMessageQueueState(sessionId, { items: [], paused: false })
}

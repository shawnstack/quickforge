// Client store for declarative plugin UI.
//
// One cold-load snapshot (`GET /api/plugins/ui`) plus per-action slot overrides
// (`POST /api/plugins/:name/ui`). Kept outside React so three different mount
// points share a single fetch and a single source of truth.
import { useSyncExternalStore } from 'react'
import { randomId } from './random-id'
import type {
  PluginUiActionResponse,
  PluginUiEvent,
  PluginUiNode,
  PluginUiSlotName,
  PluginUiSlotProps,
  PluginUiSnapshot,
  PluginUiToast,
  PluginUiToastLevel,
} from './plugin-ui-types'

const EMPTY_SNAPSHOT: PluginUiSnapshot = { slots: {}, plugins: [] }

let snapshot: PluginUiSnapshot = EMPTY_SNAPSHOT
let version = 0
let loaded = false
let loadPromise: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit() {
  version += 1
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // A broken subscriber must not block the others.
    }
  }
}

export function subscribePluginUi(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getVersion() {
  return version
}

/** Snapshot read for React via useSyncExternalStore. */
export function usePluginUiSnapshot(): PluginUiSnapshot {
  useSyncExternalStore(subscribePluginUi, getVersion, () => 0)
  return snapshot
}

export function getPluginUiSnapshot(): PluginUiSnapshot {
  return snapshot
}

export async function loadPluginUi(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      const response = await fetch('/api/plugins/ui', { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`Plugin UI unavailable (${response.status})`)
      const data = await response.json() as Partial<PluginUiSnapshot>
      snapshot = {
        slots: data?.slots && typeof data.slots === 'object' ? data.slots : {},
        plugins: Array.isArray(data?.plugins) ? data.plugins : [],
      }
      loaded = true
      emit()
    } catch {
      // Older servers (or a transient failure) simply contribute no plugin UI.
      loaded = true
    } finally {
      loadPromise = null
    }
  })()
  return loadPromise
}

/** Fire-and-forget cold load; safe to call from every mount point. */
export function ensurePluginUiLoaded(): void {
  if (loaded || loadPromise) return
  void loadPluginUi()
}

export async function refreshPluginUi(): Promise<void> {
  loaded = false
  await loadPluginUi()
}

function applySlotOverrides(plugin: string, slots: Partial<Record<PluginUiSlotName, PluginUiNode[]>>) {
  const nextSlots: PluginUiSnapshot['slots'] = { ...snapshot.slots }
  for (const [slotName, nodes] of Object.entries(slots) as Array<[PluginUiSlotName, PluginUiNode[]]>) {
    const current = nextSlots[slotName]
    const entries = Array.isArray(current) ? [...current] : []
    const index = entries.findIndex((entry) => entry.plugin === plugin)
    if (!Array.isArray(nodes) || nodes.length === 0) {
      if (index >= 0) entries.splice(index, 1)
    } else if (index >= 0) {
      entries[index] = { plugin, nodes }
    } else {
      entries.push({ plugin, nodes })
    }
    nextSlots[slotName] = entries
  }
  snapshot = { ...snapshot, slots: nextSlots }
  emit()
}

export async function dispatchPluginUiAction(
  plugin: string,
  slot: PluginUiSlotName,
  event: PluginUiEvent,
  props: PluginUiSlotProps = {},
): Promise<PluginUiActionResponse | null> {
  try {
    const response = await fetch(`/api/plugins/${encodeURIComponent(plugin)}/ui`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot, action: event.action, payload: event.payload || {}, props }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      pushPluginUiToast('error', typeof data?.error === 'string' ? data.error : `Plugin action failed (${response.status})`)
      return null
    }
    const result = data as PluginUiActionResponse
    if (result?.slots) applySlotOverrides(plugin, result.slots)
    if (result?.toast && typeof result.toast.message === 'string') {
      pushPluginUiToast(result.toast.level || 'info', result.toast.message)
    }
    return result
  } catch (error) {
    pushPluginUiToast('error', error instanceof Error ? error.message : 'Plugin action failed')
    return null
  }
}

// --- Toasts -----------------------------------------------------------------
// A tiny standalone store instead of threading plugin feedback through the
// app's task-toast system, which is tied to background task lifecycle.

let toasts: PluginUiToast[] = []
let toastVersion = 0
const toastListeners = new Set<() => void>()

function emitToasts() {
  toastVersion += 1
  for (const listener of toastListeners) {
    try {
      listener()
    } catch {
      // ignore
    }
  }
}

function getToastVersion() {
  return toastVersion
}

export function usePluginUiToasts(): PluginUiToast[] {
  useSyncExternalStore(
    (listener) => {
      toastListeners.add(listener)
      return () => {
        toastListeners.delete(listener)
      }
    },
    getToastVersion,
    () => 0,
  )
  return toasts
}

export function pushPluginUiToast(level: PluginUiToastLevel, message: string): void {
  const text = String(message || '').trim()
  if (!text) return
  const toast: PluginUiToast = { id: randomId(), level, message: text.slice(0, 300) }
  toasts = [...toasts.slice(-2), toast]
  emitToasts()
  // globalThis, not window: the same store runs in SSR/tests where `window`
  // does not exist, and a throw here would surface as a failed plugin action.
  globalThis.setTimeout(() => dismissPluginUiToast(toast.id), 5000)
}

export function dismissPluginUiToast(id: string): void {
  const next = toasts.filter((toast) => toast.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  emitToasts()
}

/** Drops every queued plugin toast (teardown / tests). */
export function clearPluginUiToasts(): void {
  if (toasts.length === 0) return
  toasts = []
  emitToasts()
}

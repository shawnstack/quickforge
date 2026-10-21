/**
 * Which session view is currently on screen.
 *
 * ## Why a module-level signal
 *
 * Session views are kept mounted while hidden so switching back reuses their
 * rendered subtree. A kept view's element is frozen, which means its **props
 * stop updating** — so it cannot learn "I am no longer the active view" the
 * normal React way.
 *
 * That matters for anything a session has to do at the moment it leaves the
 * screen. The concrete case is the composer draft: the panel used to flush it
 * from the unmount cleanup (`ChatPanelHost` cleanup), and a kept view never
 * unmounts. The draft is also persisted on a 400ms debounce while typing, so
 * without this signal the last keystrokes before a switch could be lost — a
 * real, user-visible regression.
 *
 * `ChatPanelHost` subscribes by its scope key, which works whether the component
 * is rendering or frozen, because the subscription lives in an effect rather
 * than in props.
 *
 * ## Scope
 *
 * This is deliberately tiny and unopinionated: it stores one current key and
 * fans out transitions. It does not own the pool, and it must not be used to
 * route data — only to deliver "you became active / inactive" transitions.
 */

type Listener = (active: boolean) => void

const listeners = new Map<string, Set<Listener>>()
let activeKey: string | null = null

function notify(key: string, active: boolean) {
  const set = listeners.get(key)
  if (!set) return
  for (const listener of [...set]) {
    try {
      listener(active)
    } catch {
      // A listener throwing must not stop the others: this runs inside a layout
      // effect during a session switch, and an exception here would abort the
      // switch itself.
    }
  }
}

/**
 * Mark a view as the one on screen, notifying the view that was replaced and the
 * one that was promoted.
 *
 * Repeated calls with the same key are no-ops, so it is safe to call from a
 * layout effect that runs on every render.
 */
export function setActiveSessionView(key: string | null) {
  const previous = activeKey
  if (previous === key) return
  activeKey = key
  if (previous) notify(previous, false)
  if (key) notify(key, true)
}

export function getActiveSessionView(): string | null {
  return activeKey
}

export function isSessionViewActive(key: string): boolean {
  return activeKey === key
}

/**
 * Subscribe to activation transitions for one view.
 *
 * Returns an unsubscribe function. `listener` is not called on subscribe: the
 * caller already knows its own state at mount, and calling back synchronously
 * inside a render-phase effect would surprise it.
 */
export function subscribeSessionViewActivity(key: string, listener: Listener): () => void {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(listener)
  return () => {
    const current = listeners.get(key)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) listeners.delete(key)
  }
}

/** Test hook: drop every subscriber and the current key. */
export function resetSessionViewActivity() {
  listeners.clear()
  activeKey = null
}

/**
 * Whether `element` lives inside a kept (hidden) session view.
 *
 * Kept views are hidden with `display: none` on their pool wrapper, which leaves
 * them without a layout box: `scrollHeight` reads 0 and any measurement taken
 * inside is meaningless. Callers that write layout state (scroll position,
 * decoration derived from bounding rects) use this to skip that work.
 *
 * A normal, visible element returns false, so the guarded code path is unchanged
 * for the view the user is actually looking at.
 */
export function isInsideHiddenView(element: Element | null): boolean {
  if (!element) return false
  const wrapper = element.closest<HTMLElement>('[data-quickforge-view-active="false"]')
  return wrapper !== null
}

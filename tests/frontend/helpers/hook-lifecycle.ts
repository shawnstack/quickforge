import type { DependencyList, Dispatch, SetStateAction } from 'react'

type Effect = () => void | (() => void)
type Slot = { value?: unknown; setter?: Dispatch<SetStateAction<unknown>>; deps?: DependencyList; cleanup?: () => void }
let active: HookLifecycle | undefined
const sameDeps = (a?: DependencyList, b?: DependencyList) => Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])))

/** Minimal synchronous renderer: stable hook identities, commit-time effects and lifecycle cleanup.
 * Call render after state updates, just as an explicit act/render boundary. No DOM dependency.
 */
export class HookLifecycle {
  private slots: Slot[] = []
  private cursor = 0
  private pending: Array<{ cleanup: () => void; setup: () => void }> = []

  slot() {
    const index = this.cursor++
    return this.slots[index] ?? (this.slots[index] = {})
  }

  effect(effect: Effect, deps?: DependencyList) {
    const slot = this.slot()
    if (sameDeps(slot.deps, deps)) return
    this.pending.push({
      cleanup: () => { slot.cleanup?.(); slot.cleanup = undefined },
      setup: () => {
        slot.deps = deps
        slot.cleanup = effect() || undefined
      },
    })
  }

  render<T>(render: () => T): T {
    this.cursor = 0
    // The dispatcher tracks the renderer instance only until render returns.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    active = this
    let value: T
    try { value = render() } finally { active = undefined }
    const pending = this.pending
    this.pending = []
    pending.forEach((commit) => commit.cleanup())
    pending.forEach((commit) => commit.setup())
    return value
  }

  unmount() {
    this.slots.forEach((slot) => slot.cleanup?.())
    this.slots = []
    this.pending = []
  }
}

function current() {
  if (!active) throw new Error('Hook called outside lifecycle render')
  return active
}

export const hookRuntime = {
  useState<T>(initial?: T | (() => T)) {
    const slot = current().slot()
    if (!slot.setter) {
      slot.value = typeof initial === 'function' ? (initial as () => T)() : initial
      slot.setter = (update) => { slot.value = typeof update === 'function' ? update(slot.value) : update }
    }
    return [slot.value as T, slot.setter as Dispatch<SetStateAction<T>>] as const
  },
  useRef<T>(initial: T) {
    const slot = current().slot()
    if (!slot.value) slot.value = { current: initial }
    return slot.value as { current: T }
  },
  useMemo<T>(factory: () => T, deps?: DependencyList) {
    const slot = current().slot()
    if (!sameDeps(slot.deps, deps)) {
      slot.value = factory()
      slot.deps = deps
    }
    return slot.value as T
  },
  useCallback<T>(callback: T, deps?: DependencyList): T {
    return hookRuntime.useMemo(() => callback, deps)
  },
  useEffect(effect: Effect, deps?: DependencyList) { current().effect(effect, deps) },
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

export async function flushPromises() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

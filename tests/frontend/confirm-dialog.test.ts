import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Node-environment regression tests for the shared message dialog.
 *
 * The dialog mounts through an imperative createRoot + portal, so these tests
 * fake the small DOM surface renderMessageDialog touches (createElement /
 * body.appendChild / activeElement) and capture the rendered element tree via
 * a mocked react-dom. Focus-trap and keyboard behaviour that need a real DOM
 * are covered by the browser review round instead.
 */

class FakeHTMLElement {
  tag: string
  removed = false
  focusCalls = 0
  isConnected = true

  constructor(tag: string) {
    this.tag = tag
  }

  remove(): void {
    this.removed = true
  }

  focus(): void {
    this.focusCalls++
  }
}

const renderedRoots: { container: FakeHTMLElement; element: unknown }[] = []
const unmountedContainers = new Set<FakeHTMLElement>()

vi.mock('react-dom/client', () => ({
  createRoot: (container: unknown) => ({
    render: (element: unknown) => {
      renderedRoots.push({ container: container as FakeHTMLElement, element })
    },
    unmount: () => {
      unmountedContainers.add(container as FakeHTMLElement)
    },
  }),
}))

vi.mock('react-dom', () => ({
  createPortal: (element: unknown) => element,
}))

let trigger: FakeHTMLElement | null
let createdElements: FakeHTMLElement[]

function fakeDocument() {
  return {
    createElement: (tag: string) => {
      const el = new FakeHTMLElement(tag)
      createdElements.push(el)
      return el
    },
    body: {
      appendChild: (el: FakeHTMLElement) => el,
    },
    get activeElement() {
      return trigger
    },
  }
}

/** Extract the MessageDialog props from the element rendered by the last root. */
function lastDialogProps(): { onCancel: () => void; actions: { onClick: () => void }[] } {
  const root = renderedRoots[renderedRoots.length - 1]
  const element = root.element as { props: { onCancel: () => void; actions: { onClick: () => void }[] } }
  return element.props
}

describe('message dialog mutex (no stacked dialogs)', () => {
  beforeEach(() => {
    renderedRoots.length = 0
    unmountedContainers.clear()
    createdElements = []
    trigger = new FakeHTMLElement('button')
    vi.stubGlobal('document', fakeDocument())
    vi.stubGlobal('HTMLElement', FakeHTMLElement)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders the first showConfirm and rejects the second while it is open', async () => {
    const { showConfirm } = await import('@/components/ui/confirm-dialog')

    const first = showConfirm({ description: 'first' })
    expect(renderedRoots).toHaveLength(1)

    // Second request while the first dialog is still open resolves as
    // cancelled immediately and must not create another modal layer.
    const second = await showConfirm({ description: 'second' })
    expect(second).toBe(false)
    expect(renderedRoots).toHaveLength(1)
    expect(createdElements).toHaveLength(1)

    // First dialog still works: its cancel resolves false and releases the mutex.
    lastDialogProps().onCancel()
    await expect(first).resolves.toBe(false)
  })

  it('allows a sequential dialog after the previous one resolved', async () => {
    const { showConfirm } = await import('@/components/ui/confirm-dialog')

    const first = showConfirm({ description: 'first', variant: 'destructive' })
    lastDialogProps().actions[1].onClick()
    await expect(first).resolves.toBe(true)

    const second = showConfirm({ description: 'second' })
    expect(renderedRoots).toHaveLength(2)
    lastDialogProps().onCancel()
    await expect(second).resolves.toBe(false)
  })

  it('rejects showAlert as cancelled while a confirm dialog is open', async () => {
    const { showConfirm, showAlert } = await import('@/components/ui/confirm-dialog')

    const confirmPromise = showConfirm({ description: 'open' })
    await expect(showAlert({ description: 'blocked' })).resolves.toBeUndefined()
    expect(renderedRoots).toHaveLength(1)

    lastDialogProps().onCancel()
    await expect(confirmPromise).resolves.toBe(false)
  })

  it('unmounts the dialog root when it resolves', async () => {
    const { showConfirm } = await import('@/components/ui/confirm-dialog')

    const promise = showConfirm({ description: 'cleanup' })
    const container = renderedRoots[0].container
    lastDialogProps().onCancel()
    await expect(promise).resolves.toBe(false)

    expect(unmountedContainers.has(container)).toBe(true)
  })

  it('restores focus to the trigger element after the dialog resolves', async () => {
    vi.useFakeTimers()
    const { showConfirm } = await import('@/components/ui/confirm-dialog')

    const promise = showConfirm({ description: 'focus' })
    lastDialogProps().onCancel()
    await expect(promise).resolves.toBe(false)

    // Cleanup (container removal + focus restore) runs on the next macrotask.
    expect(trigger?.focusCalls).toBe(0)
    vi.advanceTimersByTime(1)
    expect(trigger?.focusCalls).toBe(1)
    expect(createdElements[0]?.removed).toBe(true)
  })

  it('does not restore focus when the trigger is no longer connected', async () => {
    vi.useFakeTimers()
    const { showConfirm } = await import('@/components/ui/confirm-dialog')

    const promise = showConfirm({ description: 'detached' })
    trigger!.isConnected = false
    lastDialogProps().onCancel()
    await expect(promise).resolves.toBe(false)

    vi.advanceTimersByTime(1)
    expect(trigger?.focusCalls).toBe(0)
  })
})

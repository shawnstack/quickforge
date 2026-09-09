import { afterEach, expect, it, vi } from 'vitest'
import { createTaskLauncher } from '../../src/components/chat/task-launcher'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

function node(tag = 'div') {
  const children: ReturnType<typeof node>[] = []
  const result = {
    tag, children, className: '', id: '', textContent: '', innerHTML: '', hidden: false, disabled: false, tabIndex: 0,
    attrs: {} as Record<string, string>, parentElement: null as ReturnType<typeof node> | null,
    onclick: null as (() => void) | null,
    onkeydown: null as ((event: { key: string; preventDefault: () => void }) => void) | null,
    focus: vi.fn(),
    setAttribute(key: string, value: string) { this.attrs[key] = value },
    append(...items: ReturnType<typeof node>[]) { for (const item of items) { item.parentElement = this; children.push(item) } },
    prepend(item: ReturnType<typeof node>) { item.parentElement = this; children.unshift(item) },
    replaceChildren() { children.length = 0 },
    remove() {
      if (this.parentElement) {
        const index = this.parentElement.children.indexOf(this)
        if (index >= 0) this.parentElement.children.splice(index, 1)
      }
      this.parentElement = null
    },
    closest() { return null },
    querySelectorAll() { return children.filter((child) => child.tag === 'button') },
  }
  return result
}

afterEach(() => vi.unstubAllGlobals())

it('unmounts hidden cards, cancels pending fills and disconnects layout measurement', async () => {
  vi.stubGlobal('document', { createElement: node })
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect })
  const shell = node()
  let visible = false
  let resolve!: () => void
  const restore = vi.fn()
  const controller = createTaskLauncher({
    panel: { querySelector: () => ({ parentElement: shell }) } as unknown as HTMLElement,
    visible: () => visible, ready: () => true,
    read: () => ({ text: '', attachments: [] }), restore, interact: vi.fn(),
    capabilities: { refresh: () => new Promise<void>((done) => { resolve = done }) } as never,
    capabilitiesEnabled: true,
  })
  controller.sync()
  expect(shell.children).toHaveLength(0)
  visible = true
  controller.sync()
  const [tabs, grid] = shell.children[0].children
  tabs.children[1].onclick?.()
  grid.children[0].onclick?.()
  visible = false
  controller.sync()
  resolve()
  await Promise.resolve()
  expect(restore).not.toHaveBeenCalled()
  expect(shell.children).toHaveLength(0)
  expect(disconnect).toHaveBeenCalled()
  visible = true
  controller.sync()
  expect(shell.children).toHaveLength(1)
  controller.hide()
  controller.sync()
  expect(shell.children).toHaveLength(0)
  controller.dispose()
})

it('mounts once, exposes keyboard tabs and enables cards only after restoration', () => {
  vi.stubGlobal('document', { createElement: node })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const shell = node()
  let ready = false
  const panel = { querySelector: () => ({ parentElement: shell }) }
  const controller = createTaskLauncher({
    panel: panel as unknown as HTMLElement,
    read: () => ({ text: '', attachments: [] }), restore: vi.fn(), interact: vi.fn(),
    ready: () => ready,
    capabilities: {} as never,
    capabilitiesEnabled: false,
  })
  controller.sync()
  controller.sync()
  expect(shell.children).toHaveLength(1)
  const root = shell.children[0]
  const [tabs, grid] = root.children
  expect(tabs.attrs.role).toBe('tablist')
  expect(grid.attrs.role).toBe('tabpanel')
  expect(grid.children).toHaveLength(4)
  expect(grid.children.every((button) => button.disabled)).toBe(true)
  ready = true
  controller.sync()
  expect(grid.children.every((button) => !button.disabled)).toBe(true)
  const preventDefault = vi.fn()
  tabs.children[0].onkeydown?.({ key: 'ArrowRight', preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(tabs.children[1].attrs['aria-selected']).toBe('true')
  expect(tabs.children[1].tabIndex).toBe(0)
  expect(tabs.children[0].tabIndex).toBe(-1)
  expect(tabs.children[1].focus).toHaveBeenCalledOnce()
  expect(grid.children[0].children[1].textContent).toBe('taskWeekly')
  tabs.children[1].onkeydown?.({ key: 'Home', preventDefault })
  expect(grid.children[0].children[1].textContent).toBe('taskExplore')
  expect(grid.attrs['aria-labelledby']).toBe(tabs.children[0].id)
  controller.dispose()
  expect(root.parentElement).toBeNull()
})

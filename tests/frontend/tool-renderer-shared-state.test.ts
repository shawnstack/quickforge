import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

// Real component state/effects with only host nodes mocked (no DOM dependency):
// shared.tsx 的 useState/useRef/useEffect 走 HookLifecycle，宿主节点用最小
// 假对象提供（.qf-tool-message 桥接 / details.open），与
// settings-react-infrastructure.test.ts 同一套模式。
vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>()
  const { hookRuntime } = await import('./helpers/hook-lifecycle')
  return { ...original, ...hookRuntime }
})

import { Check, Copy } from 'lucide-react'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { renderCodeBlock, rememberToolDetailsOpen, ToolDetails, toolDetailsOpenMemory } from '../../src/lib/tool-renderers/shared'
import { flushPromises, HookLifecycle } from './helpers/hook-lifecycle'

type TestNode = ReactElement<Record<string, unknown> & { children?: unknown; ref?: { current: unknown } }>

function nodes(tree: unknown): TestNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const node = tree as TestNode
  return [node, ...nodes(node.props.children)]
}

beforeEach(() => {
  applyAppLanguageFromSnapshot('en')
  toolDetailsOpenMemory.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  toolDetailsOpenMemory.clear()
})

describe('renderCodeBlock copy feedback', () => {
  const code = 'const total = 42'

  function renderToolCodeBlock(lifecycle: HookLifecycle) {
    const element = renderCodeBlock(code, 'typescript') as ReactElement<{ code: string; language: string }>
    return lifecycle.render(() => (element.type as (props: { code: string; language: string }) => ReactElement)(element.props))
  }

  function copyButton(tree: TestNode) {
    const button = nodes(tree).find((node) => node.props['data-qf-action'] === 'copy-code')
    expect(button).toBeDefined()
    return button!
  }

  it('flashes the copied state (green check icon) for 2000ms after a successful copy', async () => {
    vi.useFakeTimers()
    const lifecycle = new HookLifecycle()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const idle = copyButton(renderToolCodeBlock(lifecycle))
    expect(idle.props.title).toBe('Copy')
    expect((idle.props.children as ReactElement).type).toBe(Copy)
    expect(String(idle.props.className)).not.toContain('text-emerald-600')

    idle.props.onClick()
    await flushPromises()

    const copied = copyButton(renderToolCodeBlock(lifecycle))
    expect(writeText).toHaveBeenCalledWith(code)
    expect(copied.props.title).toBe('Copied')
    expect((copied.props.children as ReactElement).type).toBe(Check)
    expect(String(copied.props.className)).toContain('text-emerald-600')

    // Feedback persists through 1999ms and resets at the 2000ms boundary
    // (legacy mini-lit copy-button timing).
    vi.advanceTimersByTime(1999)
    expect(copyButton(renderToolCodeBlock(lifecycle)).props.title).toBe('Copied')
    vi.advanceTimersByTime(1)
    const reset = copyButton(renderToolCodeBlock(lifecycle))
    expect(reset.props.title).toBe('Copy')
    expect((reset.props.children as ReactElement).type).toBe(Copy)
    expect(String(reset.props.className)).not.toContain('text-emerald-600')
  })

  it('keeps the idle state when the clipboard write fails', async () => {
    vi.useFakeTimers()
    const lifecycle = new HookLifecycle()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })

    copyButton(renderToolCodeBlock(lifecycle)).props.onClick()
    await flushPromises()

    const idle = copyButton(renderToolCodeBlock(lifecycle))
    expect(idle.props.title).toBe('Copy')
    expect((idle.props.children as ReactElement).type).toBe(Copy)
  })
})

describe('ToolDetails open-state memory', () => {
  /** Minimal .qf-tool-message host bridge + details node pair. */
  function mountToolDetails(initiallyOpen: boolean, host: unknown) {
    const lifecycle = new HookLifecycle()
    const details = { open: initiallyOpen, closest: () => host } as unknown as HTMLDetailsElement
    let tree!: TestNode
    const render = () => {
      lifecycle.render(() => {
        tree = ToolDetails({ initiallyOpen }) as unknown as TestNode
        ;(tree.props as { ref: { current: unknown } }).ref.current = details
        return tree
      })
      return tree
    }
    render()
    return {
      render,
      tree: () => tree,
      toggle(open: boolean) {
        details.open = open
        ;(tree.props as { onToggle: (event: { currentTarget: HTMLDetailsElement }) => void }).onToggle({ currentTarget: details })
      },
      unmount: () => lifecycle.unmount(),
    }
  }

  it('stays at initiallyOpen when nothing was toggled', () => {
    const box = mountToolDetails(false, { toolCall: { id: 'call-none' } })
    box.render()
    expect((box.tree().props as { open?: boolean }).open).toBe(false)
  })

  it('restores a remembered manual toggle across remounts (open and closed)', () => {
    const host = { toolCall: { id: 'call-1' } }
    const first = mountToolDetails(false, host)
    first.toggle(true)
    first.render()
    expect((first.tree().props as { open?: boolean }).open).toBe(true)
    expect(toolDetailsOpenMemory.get('call-1')).toBe(true)

    // remount（流式消息迁入历史列表 / 分页窗口重建）后初始值优先取记忆。
    first.unmount()
    const second = mountToolDetails(false, host)
    second.render()
    expect((second.tree().props as { open?: boolean }).open).toBe(true)

    // 手动收起 → 记忆为 closed，下一次 remount 同样恢复。
    second.toggle(false)
    second.render()
    second.unmount()
    const third = mountToolDetails(true, host)
    third.render()
    expect((third.tree().props as { open?: boolean }).open).toBe(false)
  })

  it('applies the memory once the host bridge key becomes available (next commit)', () => {
    // 子组件 effect 先于宿主桥接 effect：首个 commit 读不到 toolCall id，
    // 后续 render 恢复记忆（effect 无依赖、成功前重试）。
    rememberToolDetailsOpen('call-late', true)
    let host: unknown = {}
    const box = mountToolDetails(false, { get toolCall() { return (host as { toolCall?: { id?: string } }).toolCall } })
    box.render()
    expect((box.tree().props as { open?: boolean }).open).toBe(false)
    host = { toolCall: { id: 'call-late' } }
    box.render()
    // 状态在下一次 render 中生效。
    box.render()
    expect((box.tree().props as { open?: boolean }).open).toBe(true)
  })

  it('scopes the memory per toolCall id and skips unknown hosts', () => {
    const box = mountToolDetails(false, { toolCall: { id: 'call-a' } })
    box.toggle(true)
    box.render()
    box.unmount()

    const other = mountToolDetails(false, { toolCall: { id: 'call-b' } })
    other.render()
    expect((other.tree().props as { open?: boolean }).open).toBe(false)

    const bridgeless = mountToolDetails(false, {})
    bridgeless.toggle(true)
    bridgeless.render()
    expect(toolDetailsOpenMemory.has('call-b')).toBe(false)
    expect([...toolDetailsOpenMemory.keys()]).toEqual(['call-a'])
  })

  it('evicts the least recently used entry beyond 100 and refreshes on touch', () => {
    for (let index = 0; index < 100; index += 1) rememberToolDetailsOpen(`k${index}`, true)
    expect(toolDetailsOpenMemory.size).toBe(100)

    rememberToolDetailsOpen('k100', true)
    expect(toolDetailsOpenMemory.size).toBe(100)
    expect(toolDetailsOpenMemory.has('k0')).toBe(false)
    expect(toolDetailsOpenMemory.get('k100')).toBe(true)

    // touch k1 → 淘汰最旧的 k2 而不是 k1。
    rememberToolDetailsOpen('k1', false)
    rememberToolDetailsOpen('k101', true)
    expect(toolDetailsOpenMemory.size).toBe(100)
    expect(toolDetailsOpenMemory.has('k1')).toBe(true)
    expect(toolDetailsOpenMemory.get('k1')).toBe(false)
    expect(toolDetailsOpenMemory.has('k2')).toBe(false)

    // 空 key 不记录。
    rememberToolDetailsOpen('', true)
    expect(toolDetailsOpenMemory.size).toBe(100)
  })
})

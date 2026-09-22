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
import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'
import { renderCodeBlock, renderConsoleBlock, rememberToolDetailsOpen, ToolDetails, toolDetailsOpenMemory } from '../../src/lib/tool-renderers/shared'
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

  function buttonChildren(button: TestNode) {
    return (Array.isArray(button.props.children) ? button.props.children : [button.props.children]).filter(Boolean) as ReactElement[]
  }

  function feedbackText(button: TestNode) {
    return buttonChildren(button).find((child) => child.type === 'span')?.props.children as string | undefined
  }

  it('flashes the copied state (green check icon + visible Copied!) for 2000ms without switching the title', async () => {
    vi.useFakeTimers()
    const lifecycle = new HookLifecycle()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const idle = copyButton(renderToolCodeBlock(lifecycle))
    // 旧 `<copy-button>` 的 title 只在构造时取一次（`this.title=L('Copy')`），
    // `<code-block>` 模板传的 `L('Copy code')` 之后再没有被改写 → title 恒定。
    expect(idle.props.title).toBe('Copy code')
    expect(idle.props['aria-label']).toBe('Copy code')
    expect(buttonChildren(idle).map((child) => child.type)).toEqual([Copy])
    expect(feedbackText(idle)).toBeUndefined()
    expect(String(idle.props.className)).not.toContain('text-emerald-600')

    idle.props.onClick()
    await flushPromises()

    const copied = copyButton(renderToolCodeBlock(lifecycle))
    expect(writeText).toHaveBeenCalledWith(code)
    // 反馈靠「图标换对勾 + 追加可见 `Copied!`」（旧 `.showText=${!0}`）承载，title 不动。
    expect(copied.props.title).toBe('Copy code')
    expect(buttonChildren(copied).map((child) => child.type)).toEqual([Check, 'span'])
    expect(feedbackText(copied)).toBe(t('copiedBang'))
    expect(feedbackText(copied)).toBe('Copied!')
    expect(String(copied.props.className)).toContain('text-emerald-600')

    // Feedback persists through 1999ms and resets at the 2000ms boundary
    // (legacy mini-lit copy-button timing).
    vi.advanceTimersByTime(1999)
    expect(feedbackText(copyButton(renderToolCodeBlock(lifecycle)))).toBe('Copied!')
    vi.advanceTimersByTime(1)
    const reset = copyButton(renderToolCodeBlock(lifecycle))
    expect(reset.props.title).toBe('Copy code')
    expect(buttonChildren(reset).map((child) => child.type)).toEqual([Copy])
    expect(feedbackText(reset)).toBeUndefined()
    expect(String(reset.props.className)).not.toContain('text-emerald-600')
  })

  it('uses the baseline zh values for the tool-card copy texts', async () => {
    vi.useFakeTimers()
    const lifecycle = new HookLifecycle()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    applyAppLanguageFromSnapshot('zh')

    const idle = copyButton(renderToolCodeBlock(lifecycle))
    expect(idle.props.title).toBe('复制代码')

    idle.props.onClick()
    await flushPromises()

    expect(feedbackText(copyButton(renderToolCodeBlock(lifecycle)))).toBe('已复制！')
  })

  it('keeps the idle state when the clipboard write fails', async () => {
    vi.useFakeTimers()
    const lifecycle = new HookLifecycle()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })

    copyButton(renderToolCodeBlock(lifecycle)).props.onClick()
    await flushPromises()

    const idle = copyButton(renderToolCodeBlock(lifecycle))
    expect(idle.props.title).toBe('Copy code')
    expect(buttonChildren(idle).map((child) => child.type)).toEqual([Copy])
    expect(feedbackText(idle)).toBeUndefined()
  })
})

describe('renderConsoleBlock copy feedback', () => {
  const output = 'one\ntwo'

  /** frame 树里唯一带文本子节点的 span：旧 `<console-block>` 标题栏左侧的 `L('console')` 标签。 */
  function headerLabel() {
    const frame = renderConsoleBlock(output, 'default') as TestNode
    const label = nodes(frame).find((node) => node.type === 'span' && typeof node.props.children === 'string')
    expect(label).toBeDefined()
    return label!.props.children
  }

  /** 取出 frame 树里的内部函数组件（ConsoleCopyButton），按既有模式交给 HookLifecycle 渲染。 */
  function renderConsoleCopyButton(lifecycle: HookLifecycle) {
    const frame = renderConsoleBlock(output, 'default') as TestNode
    const component = nodes(frame).find((node) => typeof node.type === 'function')
    expect(component).toBeDefined()
    return lifecycle.render(() => (component!.type as (props: { content: string }) => ReactElement)(component!.props))
  }

  function copyButton(tree: TestNode) {
    const button = nodes(tree).find((node) => node.props['data-qf-action'] === 'copy-console-output')
    expect(button).toBeDefined()
    return button!
  }

  function buttonChildren(button: TestNode) {
    return (Array.isArray(button.props.children) ? button.props.children : [button.props.children]).filter(Boolean) as ReactElement[]
  }

  function feedbackText(button: TestNode) {
    return buttonChildren(button).find((child) => child.type === 'span')?.props.children as string | undefined
  }

  it('renders the legacy console copy entry (icon-only, constant Copy output title, visible Copied!)', async () => {
    vi.useFakeTimers()
    const lifecycle = new HookLifecycle()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    // 旧 `<console-block>` 标题栏：左 `L('console')` 标签、右 `title="Copy output"` 复制按钮。
    expect(headerLabel()).toBe(t('consoleBlockLabel'))
    expect(t('consoleBlockLabel')).toBe('console')

    const idle = copyButton(renderConsoleCopyButton(lifecycle))
    expect(idle.props['data-qf-action']).toBe('copy-console-output')
    expect(idle.props.title).toBe(t('copyOutput'))
    expect(idle.props.title).toBe('Copy output')
    expect(idle.props['aria-label']).toBe('Copy output')
    expect(buttonChildren(idle).map((child) => child.type)).toEqual([Copy])
    expect(feedbackText(idle)).toBeUndefined()

    idle.props.onClick()
    await flushPromises()

    const copied = copyButton(renderConsoleCopyButton(lifecycle))
    expect(writeText).toHaveBeenCalledWith(output)
    // 旧实现只换图标 + 追加可见文本，title 不随 copied 切换。
    expect(copied.props.title).toBe('Copy output')
    expect(buttonChildren(copied).map((child) => child.type)).toEqual([Check, 'span'])
    expect(feedbackText(copied)).toBe(t('copiedBang'))
    expect(feedbackText(copied)).toBe('Copied!')
  })

  it('flashes the copied state for 1500ms after a successful copy', async () => {
    vi.useFakeTimers()
    const lifecycle = new HookLifecycle()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })

    copyButton(renderConsoleCopyButton(lifecycle)).props.onClick()
    await flushPromises()

    // copied 状态的 effect 在下一次 render 提交（与既有 2000ms 用例同一模式）。
    expect(feedbackText(copyButton(renderConsoleCopyButton(lifecycle)))).toBe('Copied!')

    // 旧 `<console-block>.copy()` 的 `setTimeout(...,1500)`（≠ 代码块 copy-button 的 2000ms）。
    vi.advanceTimersByTime(1499)
    expect(feedbackText(copyButton(renderConsoleCopyButton(lifecycle)))).toBe('Copied!')
    vi.advanceTimersByTime(1)
    const reset = copyButton(renderConsoleCopyButton(lifecycle))
    expect(feedbackText(reset)).toBeUndefined()
    expect(buttonChildren(reset).map((child) => child.type)).toEqual([Copy])
    // 复位只影响图标与文本，title 恒为 Copy output。
    expect(reset.props.title).toBe('Copy output')
  })

  it('uses the baseline zh values for the console label and copy texts', async () => {
    vi.useFakeTimers()
    const lifecycle = new HookLifecycle()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    applyAppLanguageFromSnapshot('zh')

    expect(headerLabel()).toBe('控制台')

    const idle = copyButton(renderConsoleCopyButton(lifecycle))
    expect(idle.props.title).toBe('复制输出')
    idle.props.onClick()
    await flushPromises()
    expect(feedbackText(copyButton(renderConsoleCopyButton(lifecycle)))).toBe('已复制！')
  })
})

describe('renderConsoleBlock auto-scroll', () => {
  const output = 'line 1'

  /**
   * 取 frame 树里的 ConsoleScrollArea（旧 `<console-block>.updated()` 里
   * `.console-scroll` 钩子的等价物）交给 HookLifecycle 渲染，并模拟 React DOM
   * 在 commit 前把宿主节点写进 ref.current 的那一步。
   */
  function mountScrollArea(lifecycle: HookLifecycle) {
    const frame = renderConsoleBlock(output, 'default') as TestNode
    const area = nodes(frame).find((node) => typeof node.type === 'function' && (node.type as { name?: string }).name === 'ConsoleScrollArea')
    expect(area).toBeDefined()

    const renderArea = (content: string) =>
      lifecycle.render(() => (area!.type as (props: { content: string }) => ReactElement)({ ...area!.props, content }))
    const pre = nodes(renderArea(output)).find((node) => node.type === 'pre')
    expect(pre).toBeDefined()

    const host = { scrollTop: 0, scrollHeight: 0 }
    ;(pre!.props as { ref: { current: unknown } }).ref.current = host
    return { host, pre: pre!, renderArea }
  }

  it('pins the legacy console scroll container to the bottom on every update', () => {
    const { host, pre, renderArea } = mountScrollArea(new HookLifecycle())

    // 滚动容器仍是旧的单容器形态（overflow-auto + max-h-*）。
    expect(String(pre.props.className)).toContain('overflow-auto')

    // 挂载后的首次 commit 即置底（旧 `updated()` 的首个渲染后回调）。
    host.scrollHeight = 480
    host.scrollTop = 0
    renderArea(output)
    expect(host.scrollTop).toBe(480)

    // 输出增长后再次置底：`scrollTop = scrollHeight`。
    host.scrollHeight = 960
    host.scrollTop = 120
    renderArea(`${output}\nline 2`)
    expect(host.scrollTop).toBe(960)
  })

  it('does not distinguish a manual scroll-up (legacy updated() always re-pins)', () => {
    const { host, renderArea } = mountScrollArea(new HookLifecycle())

    host.scrollHeight = 960
    host.scrollTop = 0 // 用户手动上滑到顶部
    renderArea(output) // 无内容变化的普通重渲染
    expect(host.scrollTop).toBe(960)
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

  it('manual toggle memory wins over the default collapsed state (initiallyOpen=false)', () => {
    // 工具卡细节固定默认收起（initiallyOpen=false）；用户手动展开的
    // 记忆（toolDetailsOpenMemory）仍优先于默认收起。
    rememberToolDetailsOpen('call-default-open', true)
    const box = mountToolDetails(false, { toolCall: { id: 'call-default-open' } })
    box.render()
    expect((box.tree().props as { open?: boolean }).open).toBe(true)
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

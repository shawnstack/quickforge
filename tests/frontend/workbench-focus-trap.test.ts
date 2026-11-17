// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 屏保两个工作台视图的键盘焦点收口（#6 a11y）：
 *
 * - QF-08（WorkbenchAnalog，默认视图）与塔台（WorkbenchTower）的根 dialog 都是 aria-modal，
 *   Tab 必须在视图内循环（useDialogFocusTrap，复用仓库唯一实现，不写第三套陷阱）；
 * - 抽屉是「假模态」：开着时同屏的根列表仍可交互，所以语义改成 role=region（去 aria-modal），
 *   两个陷阱互斥——抽屉开着时根陷阱让位，Tab 只在抽屉里循环；
 * - QF-08 的抽屉关态只靠 CSS opacity 隐藏、仍留在 DOM 里，透明面板的可聚焦元素必须被 inert
 *   挡住（aria-hidden 子树含可聚焦元素属 axe 违规）；
 * - 第 4 例钉住一个时序：开抽屉会让根陷阱的 restoreFocus cleanup 跑一次 setTimeout(0) 的
 *   焦点还原，和组件里 requestAnimationFrame 的「落点给关闭按钮」抢同一个焦点——rAF 后写
 *   必须胜出，谁赢了断言谁。
 *
 * harness 照抄 dialog-focus-trap-mobile-sidebar / git-graph：createRoot + IS_REACT_ACT_ENVIRONMENT
 * + offsetParent 属性替身（jsdom 不布局，不打替身钩子会把所有控件判成不可见）。
 */

const dataMocks = vi.hoisted(() => ({
  fetchBots: vi.fn(),
  fetchBotMemory: vi.fn(async () => ({ botId: 'bot-1', content: '' })),
  fetchScheduledTasks: vi.fn(async () => []),
  fetchTodayStats: vi.fn(async () => ({ sessions: 0, tokens: 0, taskRuns: 0, taskSuccess: 0 })),
  fetchTodayCompletions: vi.fn(async () => []),
  fetchOverallRunStats: vi.fn(async () => null),
}))

const uiStub = vi.hoisted(() => ({
  state: {
    requestOpenSession: () => {},
    workbenchScreensaverMode: 'off',
    workbenchScreensaver: { mode: 'off' },
  },
}))

vi.mock('@/lib/i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/i18n')>(),
  t: (key: string) => key,
}))
vi.mock('@/stores/ui-store', () => ({ useUIStore: (selector: (state: typeof uiStub.state) => unknown) => selector(uiStub.state) }))
vi.mock('@/components/bots/bots-data', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/bots/bots-data')>(),
  fetchBots: dataMocks.fetchBots,
  fetchBotMemory: dataMocks.fetchBotMemory,
}))
vi.mock('@/components/scheduled-tasks/scheduled-tasks-data', () => ({ fetchScheduledTasks: dataMocks.fetchScheduledTasks }))
vi.mock('@/lib/workbench-today-stats', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/workbench-today-stats')>(),
  fetchTodayStats: dataMocks.fetchTodayStats,
}))
vi.mock('@/components/workbench/workbench-analog-data', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/workbench/workbench-analog-data')>(),
  fetchTodayCompletions: dataMocks.fetchTodayCompletions,
  fetchOverallRunStats: dataMocks.fetchOverallRunStats,
}))

import type { BotSummary } from '../../src/components/bots/bots-data'
import { WorkbenchTower } from '../../src/components/workbench/Workbench'
import { WorkbenchAnalog } from '../../src/components/workbench/WorkbenchAnalog'
import { DIALOG_FOCUSABLE_SELECTOR } from '../../src/hooks/useDialogFocusTrap'

const BASE = new Date(2026, 10, 15, 9, 0, 0).getTime()

function makeBot(): BotSummary {
  return {
    id: 'bot-1',
    name: 'BOT-ONE',
    workspacePath: 'D:/workspace',
    memoryFile: 'MEMORY.md',
    projectId: 'quickforge',
    sessionId: 'sess-1',
    thinkingLevel: 'medium',
    accessMode: 'default',
    heartbeat: {
      enabled: true,
      alwaysWake: false,
      intervalMinutes: 60,
      nextRunAt: new Date(BASE + 3_600_000).toISOString(),
      lastWakeAt: null,
      lastSessionId: null,
      lastIdleReason: null,
      lastError: null,
    },
    mascot: { body: 'mint', eye: 'dot', animated: false, showOnComposer: false },
    createdAt: new Date(BASE).toISOString(),
    updatedAt: new Date(BASE).toISOString(),
  }
}

/** jsdom 不布局：`offsetParent` 恒为 null，陷阱会把里面所有控件判成不可见，这里给个替身。 */
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

function must<T extends Element>(el: T | null): T {
  if (!el) throw new Error('element not found')
  return el
}

function pressTab(shiftKey = false): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  act(() => {
    document.dispatchEvent(event)
  })
  return event.defaultPrevented
}

/** 与钩子同口径收集可聚焦元素（disabled 控件不参与循环）。 */
function focusablesOf(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
}

/** 真等一小段：0ms 的 kickoff/焦点还原与 ~16ms 的 rAF 落点都会在窗口内落地。 */
async function flush(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

let container: HTMLDivElement
let outside: HTMLButtonElement
let root: Root
let unmounted = false

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.ownerDocument?.body ?? null
    },
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessions: [] }), { status: 200 })))
  dataMocks.fetchBots.mockReset()
  dataMocks.fetchBots.mockResolvedValue([])
  dataMocks.fetchBotMemory.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  outside = document.createElement('button')
  outside.type = 'button'
  document.body.appendChild(outside)
  root = createRoot(container)
  unmounted = false
})

afterEach(() => {
  if (!unmounted) act(() => root.unmount())
  container.remove()
  outside.remove()
  vi.unstubAllGlobals()
  if (realOffsetParent) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent)
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetParent
  }
})

/** 挂载并等首轮取数落地（kickoff 是 0ms timeout，数据 mock 全部立刻 resolve）。 */
async function mountLoaded(element: ReactElement): Promise<void> {
  act(() => {
    root.render(element)
  })
  await flush(15)
}

function analogRoot(): HTMLElement {
  return must(document.querySelector('.qf-wba'))
}

function analogDrawer(): HTMLElement {
  return must(document.querySelector('aside.qf-wba__drawer'))
}

function openAnalogDrawer(): void {
  const row = must(document.querySelector('button.qf-wba__p-row'))
  act(() => {
    row.click()
  })
}

describe('QF-08 拟物工作台：焦点陷阱与抽屉语义', () => {
  it('根 dialog 末位 Tab 回首位；根仍是唯一真模态（role=dialog aria-modal）', async () => {
    await mountLoaded(createElement(WorkbenchAnalog, { onClose: () => {} }))
    const dialog = analogRoot()
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    const focusables = focusablesOf(dialog)
    expect(focusables.length).toBeGreaterThan(1)
    act(() => focusables[focusables.length - 1].focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(focusables[0])
  })

  it('焦点已被挪到根 dialog 外时，下一次 Tab 拉回根首位', async () => {
    await mountLoaded(createElement(WorkbenchAnalog, { onClose: () => {} }))
    const first = focusablesOf(analogRoot())[0]
    act(() => outside.focus())
    expect(document.activeElement).toBe(outside)

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(first)
  })

  it('关态抽屉 inert + region 语义，Tab 不被拉进 aria-hidden 的抽屉', async () => {
    await mountLoaded(createElement(WorkbenchAnalog, { onClose: () => {} }))
    const aside = analogDrawer()
    // 关态透明面板仍在 Tab 序列可达范围内，必须 inert；假模态语义（dialog/aria-modal）已去除
    expect(aside.hasAttribute('inert')).toBe(true)
    expect(aside.getAttribute('role')).toBe('region')
    expect(aside.getAttribute('aria-modal')).toBe(null)

    // 抽屉陷阱必须没开：焦点在根首位按 Tab 走默认前进，不会被劫持进关着的抽屉
    const first = focusablesOf(analogRoot())[0]
    act(() => first.focus())
    expect(pressTab()).toBe(false)
    expect(aside.contains(document.activeElement)).toBe(false)
  })

  it('开抽屉后焦点落在抽屉关闭按钮：根陷阱的还原 setTimeout 不得盖过 rAF 落点', async () => {
    dataMocks.fetchBots.mockResolvedValue([makeBot()])
    // 打开前先把焦点放在外部按钮：根陷阱还原与组件 rAF 落点抢的就是它
    act(() => outside.focus())
    await mountLoaded(createElement(WorkbenchAnalog, { onClose: () => {} }))
    openAnalogDrawer()
    await flush(40)

    const aside = analogDrawer()
    expect(aside.hasAttribute('inert')).toBe(false)
    const closeBtn = must(aside.querySelector('.qf-wba__drawer__top button'))
    expect(document.activeElement).toBe(closeBtn)
    expect(document.activeElement).not.toBe(outside)
  })

  it('抽屉开着时 Tab 在抽屉内循环、不回根列表（两陷阱互斥）', async () => {
    dataMocks.fetchBots.mockResolvedValue([makeBot()])
    await mountLoaded(createElement(WorkbenchAnalog, { onClose: () => {} }))
    openAnalogDrawer()
    await flush(40)

    const aside = analogDrawer()
    const drawerFocusables = focusablesOf(aside)
    expect(drawerFocusables.length).toBeGreaterThan(1)
    const rootFirst = focusablesOf(analogRoot())[0]
    act(() => drawerFocusables[drawerFocusables.length - 1].focus())

    expect(pressTab()).toBe(true)
    // 落点是抽屉首位（关闭按钮），不是根列表首位。红的情况（实测）：抽屉陷阱 enabled 写成
    // 恒 false（只留根陷阱，Tab 不被拦、pressTab 返回 false）或两行 enabled 互换（落点变成
    // 根列表首位）；「两陷阱都开着」不红——根 handler 此时是 no-op、行为等价，测不出。
    expect(document.activeElement).toBe(drawerFocusables[0])
    expect(document.activeElement).not.toBe(rootFirst)
  })

  it('关闭工作台（卸载）后焦点回到打开前的元素', async () => {
    act(() => outside.focus())
    await mountLoaded(createElement(WorkbenchAnalog, { onClose: () => {} }))
    // 必须先把焦点挪进工作台内部：不挪的话卸载前后 activeElement 一直是 outside，
    // 删掉 restoreFocus 断言照样绿——「谁拿着焦点」和「要还给谁」得是两个元素。
    const first = focusablesOf(analogRoot())[0]
    act(() => first.focus())
    expect(document.activeElement).toBe(first)
    expect(document.activeElement).not.toBe(outside)

    act(() => root.unmount())
    unmounted = true
    await flush(10)
    expect(document.activeElement).toBe(outside)
  })
})

describe('塔台工作台（屏保渲染器）：根 dialog 焦点陷阱', () => {
  it('根 dialog 末位 Tab 回首位', async () => {
    await mountLoaded(createElement(WorkbenchTower, { onClose: () => {} }))
    const dialog = must(document.querySelector('.qf-wb'))
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    const focusables = focusablesOf(dialog)
    expect(focusables.length).toBeGreaterThan(1)
    act(() => focusables[focusables.length - 1].focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(focusables[0])
  })

  it('焦点已被挪到根 dialog 外时，下一次 Tab 拉回根首位', async () => {
    await mountLoaded(createElement(WorkbenchTower, { onClose: () => {} }))
    const dialog = must(document.querySelector('.qf-wb'))
    const first = focusablesOf(dialog)[0]
    act(() => outside.focus())

    expect(pressTab()).toBe(true)
    expect(document.activeElement).toBe(first)
  })
})

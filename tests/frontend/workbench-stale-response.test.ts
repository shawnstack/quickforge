import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HookLifecycle, deferred, flushPromises } from './helpers/hook-lifecycle'

// 工作台的两条并发来源：20s 轮询 / 刷新按钮让取数 effect 重跑。两轮请求同时在飞时，
// 先发的旧响应可能后到，把新数据整块盖回旧快照（同族：AGENTS.md Definition of Done 第 5 条）。
// 本文件只做一件事：主动构造「先发后到」的时序，断言旧响应一个 state 都不许写。

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  ...(await import('./helpers/hook-lifecycle')).hookRuntime,
}))

const dataMocks = vi.hoisted(() => ({
  fetchBots: vi.fn(),
  fetchScheduledTasks: vi.fn(async () => []),
  fetchTodayStats: vi.fn(async () => ({ sessions: 1, tokens: 0, taskRuns: 0, taskSuccess: 0 })),
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
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
vi.mock('@/components/bots/bots-data', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/bots/bots-data')>(),
  fetchBots: dataMocks.fetchBots,
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
import { fmtClock, fmtHm } from '../../src/components/workbench/workbench-format'

type Node = ReactElement<Record<string, unknown>>

function collect(tree: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(tree)) {
    for (const item of tree) collect(item, out)
    return out
  }
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return out
  const node = tree as Node
  out.push(node)
  collect(node.props.children, out)
  return out
}

function textOf(tree: unknown): string {
  const parts: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === 'string' || typeof value === 'number') { parts.push(String(value)); return }
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!value || typeof value !== 'object' || !('props' in value)) return
    walk((value as Node).props.children)
  }
  walk(tree)
  return parts.join(' ')
}

function hasClass(node: Node, className: string): boolean {
  const value = node.props.className
  return typeof value === 'string' && value.split(/\s+/).includes(className)
}

function nodesWithClass(tree: unknown, className: string): Node[] {
  return collect(tree).filter((node) => hasClass(node, className))
}

/** 工作台的「更新于」只挂在 LIVE 徽标与刷新按钮的 title 上，二者都直接由 lastLoadedAt 派生。 */
function workbenchLiveTitle(tree: unknown): string | undefined {
  const live = nodesWithClass(tree, 'qf-wb__live')[0]
  const title = live?.props.title
  return typeof title === 'string' ? title : undefined
}

function workbenchRefreshButton(tree: unknown): Node {
  const button = collect(tree).find((node) => node.props['aria-label'] === 'wbRefresh')
  if (!button) throw new Error('workbench refresh button not found')
  return button
}

/** 模拟工作台的刷新按钮：拿到当次渲染里的 onClick 并触发。 */
function clickRefresh(button: Node) {
  const onClick = button.props.onClick
  if (typeof onClick !== 'function') throw new Error('refresh button has no onClick')
  ;(onClick as () => void)()
}

function analogRefreshButton(tree: unknown): Node {
  const button = collect(tree).find(
    (node) => hasClass(node, 'qf-wba__metalbtn') && textOf(node).includes('wbRefresh'),
  )
  if (!button) throw new Error('analog refresh button not found')
  return button
}

function analogRefreshTitle(tree: unknown): string | undefined {
  const title = analogRefreshButton(tree).props.title
  return typeof title === 'string' ? title : undefined
}

type WindowEnv = {
  runTimeouts: () => void
  runIntervals: () => void
  setTimeout: (handler: () => void) => number
  clearTimeout: (handle: number) => void
  setInterval: (handler: () => void) => number
  clearInterval: (handle: number) => void
  addEventListener: () => void
  removeEventListener: () => void
}

// 组件用 window.setTimeout 起首跳、window.setInterval 轮询并走秒表；node 环境里没有 window。
function createWindowEnv(): WindowEnv {
  const timeouts = new Map<number, () => void>()
  const intervals = new Map<number, () => void>()
  let nextHandle = 1
  return {
    runTimeouts() {
      const pending = [...timeouts.values()]
      timeouts.clear()
      for (const handler of pending) handler()
    },
    runIntervals() {
      for (const handler of [...intervals.values()]) handler()
    },
    setTimeout(handler) {
      const handle = nextHandle
      nextHandle += 1
      timeouts.set(handle, handler)
      return handle
    },
    clearTimeout(handle) { timeouts.delete(handle) },
    setInterval(handler) {
      const handle = nextHandle
      nextHandle += 1
      intervals.set(handle, handler)
      return handle
    },
    clearInterval(handle) { intervals.delete(handle) },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

const BASE = new Date(2026, 10, 15, 9, 0, 0).getTime()
const NEW_LOADED_AT = BASE + 60_000
// 旧响应最后落地：比新数据晚 10 分钟（分钟粒度也分得开），旧写法会把「更新于」写成这个时间。
const STALE_LOADED_AT = BASE + 600_000

function bot(name: string): BotSummary {
  return {
    id: 'bot-1',
    name,
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

let lifecycle = new HookLifecycle()
let env: WindowEnv
let clock = BASE
let pendingBots: Array<ReturnType<typeof deferred<BotSummary[]>>> = []

beforeEach(() => {
  lifecycle = new HookLifecycle()
  env = createWindowEnv()
  clock = BASE
  pendingBots = []
  dataMocks.fetchBots.mockReset()
  dataMocks.fetchBots.mockImplementation(() => {
    const pending = deferred<BotSummary[]>()
    pendingBots.push(pending)
    return pending.promise
  })
  vi.stubGlobal('window', env)
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, activeElement: null })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  // 抽屉关着时组件仍会跑一次焦点归还 effect，里面 `prev instanceof HTMLElement` 需要这个构造器存在。
  vi.stubGlobal('HTMLElement', class HTMLElementStub {})
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  lifecycle.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderTower() {
  return lifecycle.render(() => WorkbenchTower({ onClose: () => {} }))
}

function renderAnalog() {
  return lifecycle.render(() => WorkbenchAnalog({ onClose: () => {} }))
}

describe('工作台：晚到的旧响应不许覆盖新数据', () => {
  it('刷新触发的第二轮先落地后，先发的那轮（旧快照）一个 state 都不许写', async () => {
    // 第 1 轮：首跳 kickoff
    const first = renderTower()
    env.runTimeouts()

    // 用户点刷新：refreshing=true、refreshTick+1 → 取数 effect 重跑 → 立刻再发一轮
    clickRefresh(workbenchRefreshButton(first))
    renderTower()
    env.runTimeouts()

    // 时序前提：两轮请求同时在飞（不是「单次 load 成功」）
    expect(pendingBots.length).toBe(2)

    // 新数据先到
    clock = NEW_LOADED_AT
    pendingBots[1].resolve([bot('NEW-BOT')])
    await flushPromises()
    const afterNew = renderTower()
    expect(textOf(afterNew)).toContain('NEW-BOT')
    expect(workbenchLiveTitle(afterNew)).toBe(`wbUpdatedAt ${fmtClock(NEW_LOADED_AT)}`)

    // 第三轮起飞（refreshing 重新为 true），此时旧响应才到
    clickRefresh(workbenchRefreshButton(afterNew))
    const refreshingTree = renderTower()
    env.runTimeouts()
    expect(workbenchRefreshButton(refreshingTree).props.className).toContain('is-spin')

    clock = STALE_LOADED_AT
    pendingBots[0].resolve([bot('OLD-BOT')])
    await flushPromises()
    const afterStale = renderTower()

    // 旧快照没有盖回列表
    expect(textOf(afterStale)).toContain('NEW-BOT')
    expect(textOf(afterStale)).not.toContain('OLD-BOT')
    // lastLoadedAt 仍指向新数据那轮（旧响应若写，会变成晚 10 分钟的时间）
    expect(workbenchLiveTitle(afterStale)).toBe(`wbUpdatedAt ${fmtClock(NEW_LOADED_AT)}`)
    // 旧响应的 finally 也没把正在进行的第三轮刷新提前结束
    expect(workbenchRefreshButton(afterStale).props.className).toContain('is-spin')
  })
})

describe('工作台模拟面板：轮询自重叠时，晚到的旧响应不许覆盖新数据', () => {
  it('轮询第 2 跳先落地后，第 1 跳（旧快照）一个 state 都不许写', async () => {
    // 没有刷新按钮参与：两轮都来自 20s 轮询（上一跳还在飞就叫重叠加）
    renderAnalog()
    env.runIntervals()
    env.runIntervals()
    expect(pendingBots.length).toBe(2)

    clock = NEW_LOADED_AT
    pendingBots[1].resolve([bot('NEW-BOT')])
    await flushPromises()
    const afterNew = renderAnalog()
    expect(textOf(afterNew)).toContain('NEW-BOT')
    expect(analogRefreshTitle(afterNew)).toBe(`wbUpdatedAt ${fmtHm(NEW_LOADED_AT)}`)

    // 再点一次刷新让 refreshing=true，此时第 1 跳的旧响应才到
    clickRefresh(analogRefreshButton(afterNew))
    const refreshingTree = renderAnalog()
    env.runTimeouts()
    expect(hasClass(analogRefreshButton(refreshingTree), 'qf-wba__is-spin')).toBe(true)

    clock = STALE_LOADED_AT
    pendingBots[0].resolve([bot('OLD-BOT')])
    await flushPromises()
    const afterStale = renderAnalog()

    expect(textOf(afterStale)).toContain('NEW-BOT')
    expect(textOf(afterStale)).not.toContain('OLD-BOT')
    expect(analogRefreshTitle(afterStale)).toBe(`wbUpdatedAt ${fmtHm(NEW_LOADED_AT)}`)
    expect(hasClass(analogRefreshButton(afterStale), 'qf-wba__is-spin')).toBe(true)
  })
})

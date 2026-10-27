import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  normalizePersistedPanelTabs,
  serializePanelTabs,
  type WorkspacePanelTab,
} from '../../src/components/workspace/workspace-inspector-tabs'
import { PANEL_TAB_ITEMS } from '../../src/components/workspace/workspace-panel-tabs'
import { BackgroundTasksTabContent } from '../../src/components/workspace/BackgroundTasksTabContent'
import { appTranslations } from '../../src/lib/i18n'
import type { BackgroundTaskView } from '../../src/lib/background-tasks-model'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const inspectorTabsSource = read('src/components/workspace/workspace-inspector-tabs.ts')
const panelTabsSource = read('src/components/workspace/workspace-panel-tabs.ts')
const workspaceTypesSource = read('src/components/workspace/workspace-types.ts')
const useInspectorTabsSource = read('src/components/workspace/useInspectorTabs.ts')
const workspaceInspectorSource = read('src/components/workspace/WorkspaceInspector.tsx')
const appSource = read('src/App.tsx')
const indicatorSource = read('src/components/chat/panel-decoration/subagent-running-indicator.ts')
const stylesIndexSource = read('src/styles/index.css')
const backgroundTasksCss = read('src/styles/workspace/background-tasks.css')

const BACKGROUND_TASKS_PREFIX = '.quickforge-background-tasks'

/**
 * 提取 CSS 顶层选择器（忽略注释、@media / @keyframes 等 at-rule 前导）。
 * 只在花括号深度为 0 时记录选择器，块内规则不会被当成顶层选择器。
 */
/** 截取 `start` 标记到 `end` 标记之间的源码片段，任一端缺失即失败（断言要稳定可读）。 */
function sourceSlice(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function topLevelSelectors(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors: string[] = []
  let depth = 0
  let prelude = ''
  for (const char of withoutComments) {
    if (char === '{') {
      if (depth === 0) {
        const head = prelude.trim()
        if (head.length > 0 && !head.startsWith('@')) {
          selectors.push(...head.split(',').map((part) => part.trim()).filter((part) => part.length > 0))
        }
      }
      prelude = ''
      depth += 1
      continue
    }
    if (char === '}') {
      prelude = ''
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0) prelude += char
  }
  return selectors
}

function task(overrides: Partial<BackgroundTaskView> & Pick<BackgroundTaskView, 'taskId' | 'command' | 'status'>): BackgroundTaskView {
  return { toolCallId: `call-${overrides.taskId}`, ...overrides }
}

const runningTask = task({
  taskId: 'task-running',
  command: 'npm run dev',
  description: 'Dev server',
  status: 'running',
  startedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
})

const completedTask = task({
  taskId: 'task-completed',
  command: 'npm run build',
  description: 'Build',
  status: 'completed',
  startedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
  finishedAt: Date.UTC(2026, 0, 1, 0, 0, 30),
  durationMs: 30_000,
  exitCode: 0,
})

const renderTab = (tasks: BackgroundTaskView[]) =>
  renderToStaticMarkup(createElement(BackgroundTasksTabContent, { tasks }))

describe('background tasks tab registration', () => {
  it('declares background-tasks as a primary tab kind while keeping it out of the persisted whitelist', () => {
    // WorkspacePanelPrimaryTabKind 联合类型
    expect(inspectorTabsSource).toContain(
      "export type WorkspacePanelPrimaryTabKind = 'files' | 'review' | 'terminal' | 'background-tasks' | 'browser' | 'side-chat'",
    )
    // serializePanelTabs 排除持久化
    expect(inspectorTabsSource).toContain("tab.kind === 'background-tasks'")
    // isWorkspacePanelTabKind 是持久化白名单，不含 background-tasks
    const whitelist = sourceSlice(inspectorTabsSource, 'function isWorkspacePanelTabKind', 'function isDocumentFormat')
    expect(whitelist).not.toContain('background-tasks')
    expect(inspectorTabsSource).not.toContain("value === 'background-tasks'")
  })

  it('serializes and normalizes a background-tasks tab away', () => {
    const tabs: WorkspacePanelTab[] = [
      { id: 'files-1', kind: 'files' },
      { id: 'background-tasks-2', kind: 'background-tasks' },
    ]
    expect(serializePanelTabs(tabs, 'background-tasks-2').tabs).toEqual([{ id: 'files-1', kind: 'files' }])
    expect(serializePanelTabs(tabs, 'background-tasks-2').activePanelTabId).toBe('files-1')
    expect(normalizePersistedPanelTabs([{ id: 'background-tasks-1', kind: 'background-tasks' }])).toEqual([])
  })

  it('registers the panel tab meta with its title and description keys', () => {
    expect(panelTabsSource).toContain("kind: 'background-tasks'")
    expect(panelTabsSource).toContain('backgroundTaskPanelTitle')
    expect(panelTabsSource).toContain('backgroundTaskPanelDesc')
    expect(PANEL_TAB_ITEMS.map((item) => item.kind)).toContain('background-tasks')
  })

  it('exposes background-tasks through the workspace view and open-request types', () => {
    expect(workspaceTypesSource).toMatch(/export type WorkspacePanelView =[^\n]*'background-tasks'/)
    expect(workspaceTypesSource).toContain("kind: 'files' | 'terminal' | 'side-chat' | 'background-tasks'")
  })

  it('reuses a single panel tab instance for background-tasks', () => {
    expect(useInspectorTabsSource).toContain("kind === 'review' || kind === 'side-chat' || kind === 'background-tasks'")
    expect(useInspectorTabsSource).toContain('panelTabs.find((tab) => tab.kind === kind)')
  })

  it('renders the tab content inside the inspector and skips the no-project landing', () => {
    expect(workspaceInspectorSource).toContain("activePanelTab.kind === 'background-tasks'")
    expect(workspaceInspectorSource).toContain('<BackgroundTasksTabContent')
    expect(workspaceInspectorSource).toContain("activePanelTab?.kind !== 'background-tasks'")
  })

  it('wires the App data source, stop and log handlers into the inspector', () => {
    expect(appSource).toContain('buildBackgroundTasks(')
    expect(appSource).toContain('backgroundTasks={backgroundTasks}')
    expect(appSource).toContain('onOpenBackgroundTaskLog')
    expect(appSource).toContain('onStopBackgroundTask')
    expect(appSource).toContain("kind: 'background-tasks'")
  })

  it('opens the panel from the composer command icon through a window event', () => {
    // 入口只有一处：Composer 左下角的命令图标。它拿不到 requestWorkspaceInspector，
    // 因此发窗口事件，由 App 决定往哪个 project / runtime scope 打开。
    expect(appSource).toContain('OPEN_BACKGROUND_TASKS_EVENT')
    expect(appSource).toContain('normalizeOpenBackgroundTasksRequest')
    expect(appSource).toContain("kind: 'background-tasks'")
    expect(indicatorSource).toContain('dispatchOpenBackgroundTasks({ sessionId })')
    // 浮层菜单已被面板取代，不应再有第二套操作路径。
    expect(indicatorSource).not.toContain('openBackgroundCommandMenu')
  })
})

describe('background tasks stylesheet registration', () => {
  it('imports the module once from the global stylesheet', () => {
    expect(stylesIndexSource).toContain('@import "./workspace/background-tasks.css";')
    expect(stylesIndexSource.match(/background-tasks\.css/g)).toHaveLength(1)
  })

  it('declares the active item, running dot and reduced-motion rules', () => {
    expect(backgroundTasksCss).toContain('.quickforge-background-tasks-item.is-active')
    expect(backgroundTasksCss).toContain('.quickforge-background-tasks-dot.is-running')
    expect(backgroundTasksCss).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('keeps every top-level selector inside the background-tasks namespace', () => {
    const selectors = topLevelSelectors(backgroundTasksCss)
    expect(selectors.length).toBeGreaterThan(40)
    expect(selectors).toContain('.quickforge-background-tasks')
    for (const selector of selectors) {
      expect(selector.startsWith(BACKGROUND_TASKS_PREFIX)).toBe(true)
      expect(selector).not.toMatch(/^\.quickforge-(?:sidebar|chat|terminal|message|subagent|inspector|goal|workflow)[\w-]/)
    }
  })

  it('does not leak other module selectors into the file', () => {
    expect(backgroundTasksCss).not.toMatch(/^\.quickforge-(?:sidebar|chat|terminal|message|subagent|inspector|goal|workflow)/m)
    // 模块顺序统一由 src/styles/index.css 声明，子模块不得自行 @import。
    expect(backgroundTasksCss).not.toMatch(/^\s*@import/m)
  })

  it('keeps the panel horizontally aligned on a single 0.875rem baseline', () => {
    // 根元素在 flex row 宿主里必须自己撑宽，否则宽度会塌陷到内容宽度。
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks \{[^}]*flex: 1;/)
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks \{[^}]*min-width: 0;/)
    // 与 workflow-detail 同级面板同轴：直接子级横向 padding 统一 0.875rem。
    for (const block of [
      '.quickforge-background-tasks-header',
      '.quickforge-background-tasks-toolbar',
      '.quickforge-background-tasks-detail-header',
    ]) {
      const pattern = new RegExp(`${block.replaceAll('.', '\\.')} \\{[^}]*padding: [^;]*0\\.875rem`)
      expect(backgroundTasksCss).toMatch(pattern)
    }
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks-meta \{[^}]*padding: [^;]*0\.875rem/)
    // 列表留 0.5rem 内缩、列表项再留 0.375rem，合计与 header / toolbar / detail 对齐。
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks-list \{[^}]*padding: 0\.25rem 0\.5rem;/)
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks-item \{[^}]*padding: 0\.375rem;/)
    // 输出区外框用 margin 与基准线对齐，框内三级统一横向 0.5rem。
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks-output \{[^}]*margin: 0 0\.875rem 0\.75rem;/)
    for (const block of [
      '.quickforge-background-tasks-output-bar',
      '.quickforge-background-tasks-output-scroll',
      '.quickforge-background-tasks-output-footer',
    ]) {
      const pattern = new RegExp(`${block.replaceAll('.', '\\.')} \\{[^}]*padding: [^;]*0\\.5rem`)
      expect(backgroundTasksCss).toMatch(pattern)
    }
    // 搜索图标绝对定位在框内，输入框靠 padding-left 让文本回到基准线。
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks-search-icon \{[^}]*position: absolute;/)
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks-search \{[^}]*padding: 0 0\.5rem 0 1\.625rem;/)
  })

  it('keeps the segmented control and search box the same height', () => {
    // 工具栏内两个控件同高，避免顶对齐但底部差 1px。
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks-filter \{[^}]*height: 1\.375rem;/)
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks-filters \{[^}]*padding: 0\.125rem;/)
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks-search \{[^}]*height: 1\.625rem;/)
  })

  it('does not stack the row actions on top of the meta text', () => {
    // 操作区绝对定位覆盖元信息那一格，必须同一时刻把元信息淡出。
    expect(backgroundTasksCss).toMatch(
      /\.quickforge-background-tasks-item:hover \.quickforge-background-tasks-item-meta/,
    )
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks-item-actions \{[^}]*opacity: 0;/)
    // 操作区与元信息同格竞争，选中态只常显元信息，不常显操作区。
    expect(backgroundTasksCss).not.toMatch(/\.quickforge-background-tasks-item\.is-active \.quickforge-background-tasks-item-meta/)
    expect(backgroundTasksCss).not.toMatch(/\.quickforge-background-tasks-item\.is-active \.quickforge-background-tasks-item-actions/)
    // 第三列必须给操作区留出最小宽度，否则会溢出压住正文列。
    expect(backgroundTasksCss).toMatch(/grid-template-columns: auto minmax\(0, 1fr\) minmax\(3\.5rem, auto\);/)
    // 元信息与操作区共用第三列同一格，靠透明度交换，不做绝对定位覆盖。
    expect(backgroundTasksCss).toMatch(/\.quickforge-background-tasks-item-meta,\s*\.quickforge-background-tasks-item-actions \{[^}]*grid-column: 3;/)
    expect(backgroundTasksCss).not.toMatch(/\.quickforge-background-tasks-item-actions \{[^}]*position: absolute;/)
  })

  it('only uses four font sizes so the hierarchy stays readable', () => {
    const sizes = new Set(
      [...backgroundTasksCss.matchAll(/font-size: ([^;]+);/g)].map((match) => match[1].trim()),
    )
    expect([...sizes].sort()).toEqual(['0.6875rem', '0.75rem', '0.8125rem', '0.875rem'])
  })
})

describe('background tasks i18n contract', () => {
  const dictionaries: Record<'en' | 'zh', Record<string, string>> = {
    en: appTranslations.en,
    zh: appTranslations.zh,
  }

  const requiredKeys = [
    'backgroundTaskPanelTitle',
    'backgroundTaskEmpty',
    'backgroundTaskStopAll',
    'backgroundTaskFollow',
    'backgroundTaskLogHint',
    'backgroundTaskStatusRunning',
    'backgroundTaskStatusCompleted',
    'backgroundTaskStatusFailed',
    'backgroundTaskStatusTimedOut',
    'backgroundTaskStatusAborted',
  ] as const

  it('defines every required key with non-empty copy in both languages', () => {
    for (const key of requiredKeys) {
      expect(dictionaries.en[key]?.trim().length ?? 0).toBeGreaterThan(0)
      expect(dictionaries.zh[key]?.trim().length ?? 0).toBeGreaterThan(0)
    }
  })

  it('keeps the en and zh backgroundTask key sets aligned', () => {
    const enKeys = Object.keys(dictionaries.en).filter((key) => key.startsWith('backgroundTask'))
    const zhKeys = Object.keys(dictionaries.zh).filter((key) => key.startsWith('backgroundTask'))
    expect(enKeys.length).toBeGreaterThanOrEqual(requiredKeys.length)
    expect(zhKeys).toEqual(enKeys)
  })
})

describe('background tasks tab rendering', () => {
  it('renders the empty state when there are no tasks', () => {
    const markup = renderTab([])
    expect(markup).toContain('quickforge-background-tasks-empty')
    expect(markup).toContain('quickforge-background-tasks')
    expect(markup).not.toContain('quickforge-background-tasks-filters')
    expect(markup).not.toContain('quickforge-background-tasks-item')
  })

  it('renders header, filters, task rows and status dots for running and completed tasks', () => {
    const markup = renderTab([runningTask, completedTask])
    expect(markup).toContain('quickforge-background-tasks-header')
    expect(markup).toContain('quickforge-background-tasks-filters')
    expect(markup).toContain('quickforge-background-tasks-item')
    expect(markup).toContain('is-running')
    expect(markup).toContain('is-completed')
    expect(markup.match(/quickforge-background-tasks-item"/g)?.length).toBe(1)
    expect(markup).toContain('quickforge-background-tasks-item is-active')
  })

  it('renders both command strings and the selected detail panel', () => {
    const markup = renderTab([runningTask, completedTask])
    expect(markup).toContain('npm run dev')
    expect(markup).toContain('npm run build')
    // 默认选中第一条 running 任务 → 详情区展示运行中任务的停止按钮
    expect(markup).toContain('quickforge-background-tasks-detail')
    expect(markup).toContain('quickforge-background-tasks-stop')
    expect(markup).toContain('quickforge-background-tasks-follow')
    expect(markup).toContain('quickforge-background-tasks-output')
  })

  it('never renders the selected-only detail panel without tasks', () => {
    const markup = renderTab([])
    expect(markup).not.toContain('quickforge-background-tasks-detail')
    expect(markup).not.toContain('quickforge-background-tasks-output')
  })
})

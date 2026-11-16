import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HookLifecycle } from './helpers/hook-lifecycle'

// ChatSidebar 直连两个 zustand store 且渲染期调用 dnd-kit 的 hooks；在 node 里
// 用 hook-lifecycle 的同步渲染模型挂载，store / dnd-kit / 子组件全部 mock 掉，
// 只让 ChatSidebar 自己的删除调度逻辑真实执行。
const sidebarStores = vi.hoisted(() => {
  const noop = () => {}
  return {
    uiState: {
      sidebarOpen: true,
      projectsCollapsed: false,
      pinnedCollapsed: false,
      conversationsCollapsed: false,
      toggleProjectsCollapsed: noop,
      togglePinnedCollapsed: noop,
      toggleConversationsCollapsed: noop,
      setSidebarOpen: noop,
      setMobileSidebarOpen: noop,
    },
    orderingState: {
      // timeline 视图让会话行直接渲染在 section 里（不经过 SortableProjectItem 的 render-prop）
      sidebarSectionOrder: ['projects', 'tasks'],
      handleSidebarSectionReorder: noop,
      sidebarSessionViewMode: 'timeline',
      sidebarSessionSortMode: 'updatedAt',
      setSidebarSessionViewMode: noop,
      setSidebarSessionSortMode: noop,
    },
  }
})

vi.mock('react', async (original) => (await import('./helpers/hook-lifecycle')).reactMockWithRuntime(await original<typeof import('react')>()))
vi.mock('lucide-react', () => ({
  ChevronRight: () => null,
  ChevronsDownUp: () => null,
  ChevronsUpDown: () => null,
  Ellipsis: () => null,
  Folder: () => null,
  FolderOpen: () => null,
  Loader2: () => null,
  MessageSquarePlus: () => null,
  Plus: () => null,
  SlidersHorizontal: () => null,
}))
vi.mock('@dnd-kit/core', () => ({
  DndContext: () => null,
  closestCenter: () => null,
  KeyboardSensor: () => ({}),
  PointerSensor: () => ({}),
  MeasuringStrategy: { Always: 'Always', WhileDragging: 'WhileDragging' },
  useSensor: () => ({}),
  useSensors: () => [],
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: () => null,
  sortableKeyboardCoordinates: () => undefined,
  verticalListSortingStrategy: {},
}))
vi.mock('@/components/ui/button', () => ({ Button: () => null }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/stores/ui-store', () => ({ useUIStore: (selector: (state: unknown) => unknown) => selector(sidebarStores.uiState) }))
vi.mock('@/stores/sidebar-ordering-store', () => ({ useSidebarOrderingStore: (selector: (state: unknown) => unknown) => selector(sidebarStores.orderingState) }))
vi.mock('../../src/components/sidebar/chat-sidebar/useSidebarResize', () => ({
  useSidebarResize: () => ({
    asideRef: { current: null },
    sidebarWidth: 304,
    isResizing: false,
    startResizing: () => {},
    resizeSidebar: () => {},
    stopResizing: () => {},
    resetSidebarWidth: () => {},
  }),
}))
vi.mock('../../src/components/sidebar/chat-sidebar/useSidebarSessionDisplay', () => ({
  useSidebarSessionDisplay: () => ({
    timelineVisibleCount: 10,
    globalVisibleCount: 10,
    projectVisibleCounts: {},
    showMoreTimelineSessions: () => {},
    showMoreGlobalSessions: () => {},
    showMoreProjectSessions: () => {},
    collapseTimelineSessions: () => {},
    toggleProjectExpanded: () => {},
    toggleAllProjectsExpanded: () => {},
    toggleProjectsCollapsed: () => {},
    toggleConversationsCollapsed: () => {},
  }),
}))
vi.mock('../../src/components/sidebar/chat-sidebar/SessionDisplayControls', () => ({ LoadMoreSentinel: () => null, SessionDisplayControls: () => null }))
vi.mock('../../src/components/sidebar/chat-sidebar/SortableSidebarItems', () => ({ SortableProjectItem: () => null, SortableSidebarSection: () => null }))
vi.mock('../../src/components/sidebar/chat-sidebar/SidebarSessionRow', () => ({ SidebarSessionRow: () => null }))
vi.mock('../../src/components/sidebar/chat-sidebar/SessionHoverTip', () => ({ SessionHoverTip: () => null }))
vi.mock('../../src/components/sidebar/chat-sidebar/ViewSortMenu', () => ({ ViewSortMenu: () => null }))
vi.mock('../../src/components/sidebar/chat-sidebar/ProjectMenu', () => ({ ProjectMenu: () => null }))
vi.mock('../../src/components/sidebar/chat-sidebar/SidebarSearchDialog', () => ({ SidebarSearchDialog: () => null }))
vi.mock('../../src/components/sidebar/chat-sidebar/SidebarHeaderNav', () => ({ SidebarHeaderNav: () => null }))
vi.mock('../../src/components/sidebar/chat-sidebar/SidebarFooter', () => ({ SidebarFooter: () => null }))
vi.mock('../../src/components/bots/BotSidebarList', () => ({ BotSidebarList: () => null }))

import { ChatSidebar } from '../../src/components/sidebar/ChatSidebar'

const ChatSidebarInner = (ChatSidebar as unknown as { type: (props: Record<string, unknown>) => unknown }).type

type TreeElement = { type: unknown; props: Record<string, unknown> }

/** 深度收集元素。Sortable* 的 children 是 render-prop，喂一份上下文才会产出真实子树。 */
function flatten(node: unknown): TreeElement[] {
  if (Array.isArray(node)) return node.flatMap(flatten)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as TreeElement
  let children = element.props.children
  if (typeof children === 'function') {
    children = (children as (context: Record<string, unknown>) => unknown)({
      listeners: {},
      attributes: {},
      setActivatorNodeRef: () => {},
      isDragging: false,
    })
  }
  return [element, ...flatten(children)]
}

type FakeEvent = { stopPropagation: () => void; currentTarget: { blur: () => void } }
type SessionRowHandle = {
  session: { id: string }
  confirmingDelete: boolean
  deleting: boolean
  onRequestDelete: (event: FakeEvent, sessionId: string) => void
  onConfirmDelete: (event: FakeEvent, sessionId: string) => void
}

function rowFor(tree: unknown, sessionId: string): SessionRowHandle {
  const row = flatten(tree).find((node) => {
    const props = node.props as Partial<SessionRowHandle>
    return props.session?.id === sessionId && typeof props.onConfirmDelete === 'function'
  })
  if (!row) throw new Error(`session row ${sessionId} not rendered`)
  return row.props as unknown as SessionRowHandle
}

const fakeEvent: FakeEvent = { stopPropagation: () => {}, currentTarget: { blur: () => {} } }
const nowIso = () => new Date().toISOString()
const sessionOf = (id: string) => ({ id, title: `Session ${id}`, projectId: 'project-1', createdAt: nowIso(), lastModified: nowIso() })

function baseProps() {
  const noop = () => {}
  return {
    projects: [{ id: 'project-1', name: 'Project One', path: '/tmp/one', lastOpenedAt: nowIso() }],
    expandedProjectIds: new Set<string>(),
    activeProject: { id: 'project-1', name: 'Project One', path: '/tmp/one', lastOpenedAt: nowIso() },
    globalSessions: [],
    pinnedSessions: [],
    pinnedHasMore: false,
    pinnedLoading: false,
    sessionsForProject: () => [],
    projectTimelineSessions: [sessionOf('session-1'), sessionOf('session-2')],
    projectTimelineHasMore: false,
    projectTimelineLoading: false,
    projectTimelineAppending: false,
    globalHasMore: false,
    globalAppending: false,
    onLoadMoreGlobal: async () => true,
    onLoadMorePinned: noop,
    projectHasMore: () => false,
    projectLoading: () => false,
    projectAppending: () => false,
    projectLoaded: () => true,
    onLoadMoreProject: async () => true,
    onLoadMoreProjectTimeline: async () => true,
    sessionTaskStatus: () => 'idle',
    completedSessionIds: new Set<string>(),
    selectingProject: false,
    onToggleProjectExpanded: noop,
    onToggleAllProjectsExpanded: noop,
    onReorderProjects: noop,
    onStartNewProjectChat: noop,
    onOpenGlobalSkills: noop,
    onOpenMcp: noop,
    onOpenAgents: noop,
    onOpenScheduledTasks: noop,
    onOpenProjectSkills: noop,
    onDeleteProject: vi.fn(),
    onLoadSession: vi.fn(),
    onTogglePinSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onStartNewDefaultChat: vi.fn(),
    onStartNewGlobalChat: vi.fn(),
    onOpenSettings: vi.fn(),
  }
}

let lifecycle: HookLifecycle
const renderSidebar = (props: ReturnType<typeof baseProps>) => lifecycle.render(() => ChatSidebarInner(props))

beforeEach(() => {
  lifecycle = new HookLifecycle()
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
})
afterEach(() => {
  lifecycle.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ChatSidebar session delete dispatch', () => {
  it('sends the delete request synchronously at confirm time, not after the fade animation', () => {
    const props = baseProps()
    const tree = renderSidebar(props)
    rowFor(tree, 'session-1').onRequestDelete(fakeEvent, 'session-1')
    expect(rowFor(renderSidebar(props), 'session-1').confirmingDelete).toBe(true)
    rowFor(renderSidebar(props), 'session-1').onConfirmDelete(fakeEvent, 'session-1')
    // 缺陷形态：请求被塞进 140ms 动画定时器里，此刻一个请求都还没发出
    expect(props.onDeleteSession).toHaveBeenCalledTimes(1)
    expect(props.onDeleteSession).toHaveBeenCalledWith('session-1')
    // 定时器仍负责动画状态收尾：140ms 后确认态复位，删除态保持到父级移除该行
    vi.advanceTimersByTime(140)
    const settled = rowFor(renderSidebar(props), 'session-1')
    expect(settled.confirmingDelete).toBe(false)
    expect(settled.deleting).toBe(true)
    expect(props.onDeleteSession).toHaveBeenCalledTimes(1)
  })

  it('keeps both delete requests when two sessions are confirmed back to back', () => {
    const props = baseProps()
    renderSidebar(props)
    rowFor(renderSidebar(props), 'session-1').onConfirmDelete(fakeEvent, 'session-1')
    rowFor(renderSidebar(props), 'session-2').onConfirmDelete(fakeEvent, 'session-2')
    // 缺陷形态：第二个确认 clearTimeout 掉第一个动画定时器，第一个请求永远发不出
    expect(props.onDeleteSession.mock.calls).toEqual([['session-1'], ['session-2']])
    vi.advanceTimersByTime(140)
    expect(props.onDeleteSession).toHaveBeenCalledTimes(2)
  })
})

// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ChatSidebar } from '../../src/components/sidebar/ChatSidebar'
import type { ProjectInfo } from '../../src/lib/types'

/**
 * 键盘可达性回归：Projects 区头 SlidersHorizontal 弹出的「视图/排序」菜单
 * （role="menu"）打开后，按 Esc 必须收起。断言只看 DOM —— 触发按钮的
 * aria-expanded 与 role="menu" 节点存在性，不碰组件内部 state；Esc 监听
 * 由 ChatSidebar 的开合 effect 挂在 window 上（与 click/blur/resize 同源）。
 */
describe('ChatSidebar view/sort menu Escape', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const noop = () => {}
  const project: ProjectInfo = {
    id: 'p1',
    name: 'P1',
    path: '/tmp/p1',
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
  }

  function mountSidebar() {
    act(() => {
      root.render(createElement(ChatSidebar, {
        projects: [project],
        expandedProjectIds: new Set<string>(),
        globalSessions: [],
        pinnedSessions: [],
        pinnedHasMore: false,
        pinnedLoading: false,
        sessionsForProject: () => [],
        projectTimelineSessions: [],
        projectTimelineHasMore: false,
        projectTimelineLoading: false,
        projectTimelineAppending: false,
        globalHasMore: false,
        globalAppending: false,
        onLoadMoreGlobal: () => Promise.resolve(false),
        onLoadMorePinned: noop,
        projectHasMore: () => false,
        projectLoading: () => false,
        projectAppending: () => false,
        projectLoaded: () => false,
        onLoadMoreProject: () => Promise.resolve(false),
        onLoadMoreProjectTimeline: () => Promise.resolve(false),
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
        onDeleteProject: noop,
        onLoadSession: noop,
        onTogglePinSession: noop,
        onDeleteSession: noop,
        onStartNewDefaultChat: noop,
        onStartNewGlobalChat: noop,
        onOpenSettings: noop,
      }))
    })
  }

  it('closes the opened role="menu" on window Escape (aria-expanded back to false)', () => {
    mountSidebar()

    // aria-haspopup="menu" 在整个侧栏模块内唯一（视图/排序触发按钮）。
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
    expect(trigger).not.toBeNull()
    expect(trigger!.getAttribute('aria-expanded')).toBe('false')

    // 打开：触发按钮自带 stopPropagation，window 上的 click 关闭监听不会立即生效。
    act(() => trigger!.click())
    expect(trigger!.getAttribute('aria-expanded')).toBe('true')
    // ViewSortMenu 经 createPortal 渲染到 document.body，不在容器内。
    expect(document.querySelector('[role="menu"]')).not.toBeNull()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(trigger!.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })
})

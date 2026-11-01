import { beforeEach, describe, expect, it } from 'vitest'
import type { QuickForgeSessionMetadata } from '../../src/lib/types'
import type { SessionPage } from '../../src/lib/session-list-updates'
import { useSessionsStore } from '../../src/stores/sessions-store'

const emptyPage = (): SessionPage => ({ items: [], total: 0, loading: false })

function session(id: string): QuickForgeSessionMetadata {
  return {
    id,
    title: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-02T00:00:00.000Z',
    messageCount: 1,
  }
}

function resetStore() {
  useSessionsStore.setState({
    pinnedPage: emptyPage(),
    globalPage: emptyPage(),
    projectPages: {},
    projectTimelinePage: emptyPage(),
  })
}

describe('sessionsStore', () => {
  beforeEach(resetStore)

  it('初始为四路空分页', () => {
    const state = useSessionsStore.getState()
    expect(state.pinnedPage).toEqual({ items: [], total: 0, loading: false })
    expect(state.globalPage).toEqual({ items: [], total: 0, loading: false })
    expect(state.projectPages).toEqual({})
    expect(state.projectTimelinePage).toEqual({ items: [], total: 0, loading: false })
  })

  it('setGlobalPage 支持直接值与基于前值的 updater，set 后 getState 同步可见', () => {
    const { setGlobalPage } = useSessionsStore.getState()

    setGlobalPage({ items: [session('a')], total: 1, loading: false })
    expect(useSessionsStore.getState().globalPage.items.map((item) => item.id)).toEqual(['a'])

    setGlobalPage((prev) => ({ ...prev, loading: true, appending: true }))
    expect(useSessionsStore.getState().globalPage).toEqual({
      items: [session('a')],
      total: 1,
      loading: true,
      appending: true,
    })
  })

  it('setProjectPages 按 projectId 合并更新且不改动其它 key 的引用', () => {
    const { setProjectPages } = useSessionsStore.getState()
    const projectA: SessionPage = { items: [session('a1')], total: 1, loading: false }
    setProjectPages({ 'project-a': projectA })

    setProjectPages((prev) => ({
      ...prev,
      'project-b': { items: [session('b1')], total: 1, loading: true },
    }))

    const { projectPages } = useSessionsStore.getState()
    expect(Object.keys(projectPages).sort()).toEqual(['project-a', 'project-b'])
    expect(projectPages['project-a']).toBe(projectA)
    expect(projectPages['project-b'].loading).toBe(true)
  })

  it('setProjectPages 接受直接值（如整表清空 {}）', () => {
    const { setProjectPages } = useSessionsStore.getState()
    setProjectPages({ 'project-a': { items: [], total: 0, loading: true } })
    expect(useSessionsStore.getState().projectPages['project-a']).toBeDefined()

    setProjectPages({})
    expect(useSessionsStore.getState().projectPages).toEqual({})
  })

  it('四路分页各自独立更新、互不影响', () => {
    const state = useSessionsStore.getState()
    state.setPinnedPage({ items: [session('pinned')], total: 1, loading: false })
    state.setProjectTimelinePage({ items: [session('timeline')], total: 1, loading: false })

    const next = useSessionsStore.getState()
    expect(next.globalPage.items).toEqual([])
    expect(next.projectPages).toEqual({})
    expect(next.pinnedPage.items.map((item) => item.id)).toEqual(['pinned'])
    expect(next.projectTimelinePage.items.map((item) => item.id)).toEqual(['timeline'])
  })

  it('updater 返回原引用时切片引用保持不变（等同 React setState bail-out）', () => {
    const { setProjectPages } = useSessionsStore.getState()
    setProjectPages({ 'project-a': { items: [session('a1')], total: 1, loading: false } })
    const before = useSessionsStore.getState().projectPages

    setProjectPages((prev) => prev)

    expect(useSessionsStore.getState().projectPages).toBe(before)
  })

  it('action 引用恒定，可在任何 set 之后继续复用', () => {
    const { setPinnedPage, setGlobalPage, setProjectPages, setProjectTimelinePage } = useSessionsStore.getState()
    setGlobalPage({ items: [session('x')], total: 1, loading: false })

    const next = useSessionsStore.getState()
    expect(next.setPinnedPage).toBe(setPinnedPage)
    expect(next.setGlobalPage).toBe(setGlobalPage)
    expect(next.setProjectPages).toBe(setProjectPages)
    expect(next.setProjectTimelinePage).toBe(setProjectTimelinePage)
  })
})

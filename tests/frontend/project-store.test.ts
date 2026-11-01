import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EXPANDED_PROJECT_IDS_STORAGE_KEY } from '../../src/lib/project-expanded-ids'
import { useProjectStore } from '../../src/stores/project-store'

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, String(value))
    },
  }
}

const project = { id: 'p1', name: 'demo', path: '/tmp/demo', lastOpenedAt: '' }

describe('projectStore', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock())
    useProjectStore.setState({
      activeProject: undefined,
      projects: [],
      defaultWorkspace: undefined,
      expandedProjectIds: new Set(),
      selectingProject: false,
      projectPickerOpen: false,
    })
  })

  it('setExpandedProjectIds 更新状态并直写 localStorage', () => {
    useProjectStore.getState().setExpandedProjectIds(new Set(['p1', 'p2']))

    expect(useProjectStore.getState().expandedProjectIds).toEqual(new Set(['p1', 'p2']))
    expect(globalThis.localStorage.getItem(EXPANDED_PROJECT_IDS_STORAGE_KEY)).toBe('["p1","p2"]')
  })

  it('setExpandedProjectIds 支持函数式更新并持久化', () => {
    useProjectStore.getState().setExpandedProjectIds(new Set(['p1']))
    useProjectStore.getState().setExpandedProjectIds((current) => new Set([...current, 'p2']))

    expect(useProjectStore.getState().expandedProjectIds).toEqual(new Set(['p1', 'p2']))
    expect(globalThis.localStorage.getItem(EXPANDED_PROJECT_IDS_STORAGE_KEY)).toBe('["p1","p2"]')
  })

  it('store 创建时从 localStorage 恢复 expandedProjectIds', async () => {
    globalThis.localStorage.setItem(EXPANDED_PROJECT_IDS_STORAGE_KEY, '["saved-1","saved-2"]')
    vi.resetModules()
    const { useProjectStore: freshStore } = await import('../../src/stores/project-store')

    expect(freshStore.getState().expandedProjectIds).toEqual(new Set(['saved-1', 'saved-2']))
  })

  it('初始加载不落盘（无变化不写 localStorage，替代旧 useEffect 回写）', async () => {
    vi.resetModules()
    const { useProjectStore: freshStore } = await import('../../src/stores/project-store')

    expect(freshStore.getState().expandedProjectIds).toEqual(new Set())
    expect(globalThis.localStorage.getItem(EXPANDED_PROJECT_IDS_STORAGE_KEY)).toBeNull()
  })

  it('setActiveProject / setProjects 支持直赋与函数式更新', () => {
    useProjectStore.getState().setActiveProject(project)
    useProjectStore.getState().setProjects([project])

    expect(useProjectStore.getState().activeProject).toBe(project)
    expect(useProjectStore.getState().projects).toEqual([project])

    useProjectStore.getState().setActiveProject((current) => (current ? { ...current, id: 'p0' } : current))
    useProjectStore.getState().setProjects((current) => [...current, { ...project, id: 'p2' }])

    expect(useProjectStore.getState().activeProject?.id).toBe('p0')
    expect(useProjectStore.getState().projects.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('setDefaultWorkspace / setSelectingProject / setProjectPickerOpen 基本状态语义', () => {
    const workspace = { id: 'default', name: 'workspace', path: '~/.quickforge/workspace', lastOpenedAt: '' }
    useProjectStore.getState().setDefaultWorkspace(workspace)
    useProjectStore.getState().setSelectingProject(true)
    useProjectStore.getState().setProjectPickerOpen(true)

    expect(useProjectStore.getState().defaultWorkspace).toBe(workspace)
    expect(useProjectStore.getState().selectingProject).toBe(true)
    expect(useProjectStore.getState().projectPickerOpen).toBe(true)
  })

  it('action 引用恒定（等价旧 useCallback 固定依赖）', () => {
    const { setExpandedProjectIds, setActiveProject } = useProjectStore.getState()
    setExpandedProjectIds(new Set(['x']))
    setActiveProject(project)

    expect(useProjectStore.getState().setExpandedProjectIds).toBe(setExpandedProjectIds)
    expect(useProjectStore.getState().setActiveProject).toBe(setActiveProject)
  })
})

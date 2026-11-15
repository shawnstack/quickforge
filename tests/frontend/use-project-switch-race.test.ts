import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectInfo } from '../../src/lib/types'

const harness = vi.hoisted(() => {
  const state = {
    activeProject: undefined as ProjectInfo | undefined,
    projects: [] as ProjectInfo[],
    defaultWorkspace: undefined as unknown,
    expandedProjectIds: new Set<string>(),
    selectingProject: false,
    projectPickerOpen: false,
  }
  type Functional<T> = T | ((current: T) => T)
  const resolve = <T,>(value: Functional<T>, current: T): T => (
    typeof value === 'function' ? (value as (current: T) => T)(current) : value
  )
  const setters = {
    setActiveProject: (value: Functional<ProjectInfo | undefined>) => {
      state.activeProject = resolve(value, state.activeProject)
    },
    setProjects: (value: Functional<ProjectInfo[]>) => {
      state.projects = resolve(value, state.projects)
    },
    setDefaultWorkspace: (value: Functional<unknown>) => {
      state.defaultWorkspace = resolve(value, state.defaultWorkspace)
    },
    setExpandedProjectIds: (value: Functional<Set<string>>) => {
      state.expandedProjectIds = resolve(value, state.expandedProjectIds)
    },
    setSelectingProject: (value: Functional<boolean>) => {
      state.selectingProject = resolve(value, state.selectingProject)
    },
    setProjectPickerOpen: (value: Functional<boolean>) => {
      state.projectPickerOpen = resolve(value, state.projectPickerOpen)
    },
  }
  return { state, setters, reset: () => {
    state.activeProject = undefined
    state.projects = []
    state.defaultWorkspace = undefined
    state.expandedProjectIds = new Set<string>()
    state.selectingProject = false
    state.projectPickerOpen = false
  } }
})

vi.mock('../../src/stores/project-store', () => ({
  useProjectStore: (selector: (value: unknown) => unknown) => selector({ ...harness.state, ...harness.setters }),
}))

// 这个 hook 只用到 useCallback / useRef；直接调用它比搭一套渲染环境更接近真实调用点。
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (initial: unknown) => ({ current: initial }),
}))

import { useProject } from '../../src/hooks/useProject'

function project(id: string): ProjectInfo {
  return { id, name: id, path: `D:/work/${id}`, lastOpenedAt: '2026-01-01T00:00:00Z' }
}

function response(payload: unknown) {
  return { ok: true, json: async () => payload }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  harness.reset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

describe('useProject switch ordering', () => {
  it('keeps the last clicked project when the earlier switch response arrives late', async () => {
    const earlier = deferred<unknown>()
    const later = deferred<unknown>()
    let call = 0
    fetchMock.mockImplementation(() => {
      call += 1
      return call === 1 ? earlier.promise : later.promise
    })

    const api = useProject()
    const firstSwitch = api.switchActiveProject('alpha')
    const secondSwitch = api.switchActiveProject('beta')
    expect(call).toBe(2)

    later.resolve(response({ project: project('beta'), projects: [project('beta')] }))
    await flush()
    earlier.resolve(response({ project: project('alpha'), projects: [project('alpha')] }))
    await flush()
    const [firstProject, secondProject] = await Promise.all([firstSwitch, secondSwitch])

    expect(harness.state.activeProject?.id).toBe('beta')
    expect(harness.state.projects.map((entry) => entry.id)).toEqual(['beta'])
    expect(harness.state.expandedProjectIds).toEqual(new Set(['beta']))
    // 返回值是「这条会话自己的 project」，不是「当前项目」，晚到的调用也照样拿到自己的。
    expect(firstProject.id).toBe('alpha')
    expect(secondProject.id).toBe('beta')
  })
})

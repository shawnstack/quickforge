import { beforeEach, describe, expect, it } from 'vitest'
import { useGitStore } from '../../src/stores/git-store'
import type { GitStatusResponse } from '../../src/components/workspace/workspace-types'

const INITIAL_GIT = {
  titleGitStatus: undefined,
  branchMenuOpen: false,
  gitToolsExpanded: false,
  gitCommitDialogOpen: false,
  gitGraphOpen: false,
}

function statusFixture(branch: string): GitStatusResponse {
  return { isGitRepository: true, branch, files: [] }
}

describe('gitStore', () => {
  beforeEach(() => {
    useGitStore.setState(INITIAL_GIT)
  })

  it('初始状态：无标题 git 状态，各开合均为 false', () => {
    const state = useGitStore.getState()
    expect(state.titleGitStatus).toBeUndefined()
    expect(state.branchMenuOpen).toBe(false)
    expect(state.gitToolsExpanded).toBe(false)
    expect(state.gitCommitDialogOpen).toBe(false)
    expect(state.gitGraphOpen).toBe(false)
  })

  it('各开合状态 setter 兼容 useState 的直接值与函数式更新', () => {
    const store = useGitStore.getState()
    store.setBranchMenuOpen(true)
    store.setGitToolsExpanded(true)
    store.setGitCommitDialogOpen(true)
    store.setGitGraphOpen(true)
    expect(useGitStore.getState().branchMenuOpen).toBe(true)
    expect(useGitStore.getState().gitToolsExpanded).toBe(true)
    expect(useGitStore.getState().gitCommitDialogOpen).toBe(true)
    expect(useGitStore.getState().gitGraphOpen).toBe(true)

    useGitStore.getState().setBranchMenuOpen((v) => !v)
    expect(useGitStore.getState().branchMenuOpen).toBe(false)
    useGitStore.getState().setGitToolsExpanded(false)
    useGitStore.getState().setGitCommitDialogOpen((v) => !v)
    useGitStore.getState().setGitGraphOpen(false)
    expect(useGitStore.getState().gitToolsExpanded).toBe(false)
    expect(useGitStore.getState().gitCommitDialogOpen).toBe(false)
    expect(useGitStore.getState().gitGraphOpen).toBe(false)
  })

  it('titleGitStatus set 语义：直接赋值、函数式更新基于前值、可清除为 undefined', () => {
    const first = statusFixture('main')
    useGitStore.getState().setTitleGitStatus(first)
    expect(useGitStore.getState().titleGitStatus).toBe(first)

    // 函数式更新基于当前值派生（useAppGit 的 checkout / dialog 完成回调走直接赋值，
    // 失败 / 无项目路径走 undefined 清除，均兼容）。
    useGitStore.getState().setTitleGitStatus((current) => (current ? { ...current, branch: 'dev' } : current))
    expect(useGitStore.getState().titleGitStatus).toMatchObject({ branch: 'dev' })

    useGitStore.getState().setTitleGitStatus(undefined)
    expect(useGitStore.getState().titleGitStatus).toBeUndefined()

    // 函数式更新返回相同引用时保持引用不变（Object.is 语义，不触发多余订阅）。
    const second = statusFixture('feature')
    useGitStore.getState().setTitleGitStatus(second)
    useGitStore.getState().setTitleGitStatus((current) => current)
    expect(useGitStore.getState().titleGitStatus).toBe(second)
  })

  it('action 引用恒定，hook 兼容层依赖数组的稳定性不受影响', () => {
    const { setTitleGitStatus, setBranchMenuOpen, setGitToolsExpanded, setGitCommitDialogOpen, setGitGraphOpen } = useGitStore.getState()
    setTitleGitStatus(statusFixture('main'))
    setBranchMenuOpen(true)
    const next = useGitStore.getState()
    expect(next.setTitleGitStatus).toBe(setTitleGitStatus)
    expect(next.setBranchMenuOpen).toBe(setBranchMenuOpen)
    expect(next.setGitToolsExpanded).toBe(setGitToolsExpanded)
    expect(next.setGitCommitDialogOpen).toBe(setGitCommitDialogOpen)
    expect(next.setGitGraphOpen).toBe(setGitGraphOpen)
  })

  it('状态变更通知订阅者，退订后不再通知', () => {
    const seen: boolean[] = []
    const unsubscribe = useGitStore.subscribe((state) => { seen.push(state.branchMenuOpen) })
    useGitStore.getState().setBranchMenuOpen(true)
    useGitStore.getState().setBranchMenuOpen(false)
    unsubscribe()
    useGitStore.getState().setBranchMenuOpen(true)
    expect(seen).toEqual([true, false])
  })
})

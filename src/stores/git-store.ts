import { create } from 'zustand'
import type { Dispatch, SetStateAction } from 'react'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'

interface GitStore {
  titleGitStatus: GitStatusResponse | undefined
  branchMenuOpen: boolean
  gitToolsExpanded: boolean
  gitCommitDialogOpen: boolean
  gitGraphOpen: boolean

  setTitleGitStatus: Dispatch<SetStateAction<GitStatusResponse | undefined>>
  setBranchMenuOpen: Dispatch<SetStateAction<boolean>>
  setGitToolsExpanded: Dispatch<SetStateAction<boolean>>
  setGitCommitDialogOpen: Dispatch<SetStateAction<boolean>>
  setGitGraphOpen: Dispatch<SetStateAction<boolean>>
}

/** App 级 Git 域 UI 状态单一数据源（标题栏 git 状态、分支菜单、git 工具区、
 *  提交对话框、提交图）。
 *
 *  setter 与 useState 的 Dispatch<SetStateAction<T>> 签名兼容（支持函数式
 *  更新），action 引用恒定；React 侧经 `useAppGitState()` 兼容层订阅消费，
 *  非 React 代码直接 `useGitStore.getState().xxx`。
 *
 *  注意：titleGitStatus 的 fetch、SSE 工具结束 400ms debounce 与请求守卫
 *  （titleGitRequestIdRef / titleGitAbortRef）是有副作用的 ref 逻辑，
 *  不属于响应式 store 状态，仍留在 useAppGit hook 中以 useRef 管理
 *  （ref 不能进 store；fetch/abort 链与 App.tsx 的项目切换中止 effect 依赖它）。
 */
export const useGitStore = create<GitStore>((set) => ({
  titleGitStatus: undefined,
  branchMenuOpen: false,
  gitToolsExpanded: false,
  gitCommitDialogOpen: false,
  gitGraphOpen: false,

  setTitleGitStatus: (value) =>
    set((s) => ({ titleGitStatus: typeof value === 'function' ? value(s.titleGitStatus) : value })),
  setBranchMenuOpen: (value) =>
    set((s) => ({ branchMenuOpen: typeof value === 'function' ? value(s.branchMenuOpen) : value })),
  setGitToolsExpanded: (value) =>
    set((s) => ({ gitToolsExpanded: typeof value === 'function' ? value(s.gitToolsExpanded) : value })),
  setGitCommitDialogOpen: (value) =>
    set((s) => ({ gitCommitDialogOpen: typeof value === 'function' ? value(s.gitCommitDialogOpen) : value })),
  setGitGraphOpen: (value) =>
    set((s) => ({ gitGraphOpen: typeof value === 'function' ? value(s.gitGraphOpen) : value })),
}))

import { create } from 'zustand'
import type { Dispatch, SetStateAction } from 'react'

export type UpdateCheckStatus = 'idle' | 'checking' | 'done' | 'error'

export type UpdateCheckResult = {
  status: UpdateCheckStatus
  currentVersion?: string
  latestVersion?: string
  /** true when a newer version exists and has not been dismissed by the user. */
  updateAvailable: boolean
}

export const INITIAL_UPDATE_CHECK_RESULT: UpdateCheckResult = {
  status: 'idle',
  updateAvailable: false,
}

interface UpdateCheckStore {
  result: UpdateCheckResult
  setResult: Dispatch<SetStateAction<UpdateCheckResult>>
}

/** 启动更新检查结果的 App 级单一数据源。
 *
 *  setter 与 useState 的 Dispatch<SetStateAction<T>> 签名兼容（支持函数式更新），
 *  action 引用恒定；fetch / localStorage 持久化等副作用逻辑仍留在
 *  `useUpdateCheck` 兼容层内，经 selector 消费本 store。
 */
export const useUpdateCheckStore = create<UpdateCheckStore>((set) => ({
  result: INITIAL_UPDATE_CHECK_RESULT,
  setResult: (value) =>
    set((state) => ({ result: typeof value === 'function' ? value(state.result) : value })),
}))

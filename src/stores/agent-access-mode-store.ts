import { create } from 'zustand'
import type { Dispatch, SetStateAction } from 'react'
import type { AgentAccessMode } from '@/lib/types'

interface AgentAccessModeStore {
  agentAccessMode: AgentAccessMode
  setAgentAccessMode: Dispatch<SetStateAction<AgentAccessMode>>
}

/** Agent 访问模式（default / full-access）的 App 级单一数据源。
 *
 *  setter 与 useState 的 Dispatch<SetStateAction<T>> 签名兼容（支持函数式更新），
 *  action 引用恒定；storage 初始化逻辑仍留在 `useAgentAccessMode` 兼容层内，
 *  经 selector 消费本 store。
 */
export const useAgentAccessModeStore = create<AgentAccessModeStore>((set) => ({
  agentAccessMode: 'default',

  setAgentAccessMode: (value) =>
    set((state) => ({ agentAccessMode: typeof value === 'function' ? value(state.agentAccessMode) : value })),
}))

import { useCallback } from 'react'
import type { AppStorage } from '@/storage'
import { loadAgentAccessMode } from '@/lib/pi-chat'
import { useAgentAccessModeStore } from '@/stores/agent-access-mode-store'

/** Agent 访问模式状态已迁入 useAgentAccessModeStore（zustand）。
 *  本 hook 保留为兼容层：返回结构与旧实现一致，App.tsx 接线不变；
 *  setAgentAccessMode / initialize 引用恒定（等价于旧 useCallback([])），
 *  storage 初始化逻辑仍在此处。
 */
export function useAgentAccessMode() {
  const agentAccessMode = useAgentAccessModeStore((s) => s.agentAccessMode)
  const setAgentAccessMode = useAgentAccessModeStore((s) => s.setAgentAccessMode)

  const initialize = useCallback(async (storage: AppStorage) => {
    const saved = await loadAgentAccessMode(storage)
    setAgentAccessMode(saved)
    return saved
  }, [setAgentAccessMode])

  return { agentAccessMode, setAgentAccessMode, initialize }
}

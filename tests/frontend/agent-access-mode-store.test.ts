import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentAccessModeStore } from '../../src/stores/agent-access-mode-store'

describe('agentAccessModeStore', () => {
  beforeEach(() => {
    useAgentAccessModeStore.setState({ agentAccessMode: 'default' })
  })

  it('初始值为 default', () => {
    expect(useAgentAccessModeStore.getState().agentAccessMode).toBe('default')
  })

  it('setAgentAccessMode 兼容直接赋值与函数式更新', () => {
    useAgentAccessModeStore.getState().setAgentAccessMode('full-access')
    expect(useAgentAccessModeStore.getState().agentAccessMode).toBe('full-access')

    useAgentAccessModeStore.getState().setAgentAccessMode((mode) => (mode === 'full-access' ? 'default' : 'full-access'))
    expect(useAgentAccessModeStore.getState().agentAccessMode).toBe('default')
  })

  it('action 引用恒定，非 React 代码可经 getState() 直接调用', () => {
    const { setAgentAccessMode } = useAgentAccessModeStore.getState()
    setAgentAccessMode('full-access')

    expect(useAgentAccessModeStore.getState().agentAccessMode).toBe('full-access')
    expect(useAgentAccessModeStore.getState().setAgentAccessMode).toBe(setAgentAccessMode)
  })
})

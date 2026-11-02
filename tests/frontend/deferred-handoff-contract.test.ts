import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Deferred 会话 → 真实会话的交接契约。
 *
 * 回归的是「在任务旁新建对话，输入文字后立刻跳回初始化欢迎页」：
 * 真实 agent 建成后如果不带用户刚发的那条消息就先 attach，界面会出现一帧
 * 「0 条消息的空会话」，被空态规则判成全新空对话（自动落项目），把正在
 * 进行的会话顶掉、消息也没发出去。
 */
const deferredSource = readFileSync(new URL('../../src/lib/deferred-session-agent.ts', import.meta.url), 'utf8')
const agentManagerSource = readFileSync(new URL('../../src/hooks/useAgentManager.ts', import.meta.url), 'utf8')
const serverAgentSource = readFileSync(new URL('../../src/lib/server-agent.ts', import.meta.url), 'utf8')

describe('deferred session handoff', () => {
  it('hands the optimistic messages to createAgent', () => {
    const ensureRealAgent = deferredSource.slice(deferredSource.indexOf('private async ensureRealAgent()'))

    expect(ensureRealAgent).toContain('handoffMessages: this.state.messages')
  })

  it('asks the real agent to reuse the handed-off message instead of appending it twice', () => {
    expect(deferredSource).toContain('realAgent.prompt(message, { messageAlreadyInState: true })')
  })

  it('loads the handed-off messages into the real agent before it is attached to the view', () => {
    const applyIndex = agentManagerSource.indexOf(
      'nextAgent.state.messages = [...nextAgent.state.messages, ...options.handoffMessages]',
    )

    expect(applyIndex).toBeGreaterThan(agentManagerSource.indexOf('await ServerAgent.create('))
    // 必须先装消息再 attach：反过来真实 agent 会以 0 条消息上屏一帧。
    expect(applyIndex).toBeLessThan(agentManagerSource.indexOf('attachTaskToView(task', applyIndex))
  })

  it('keeps the reuse path in ServerAgent.prompt', () => {
    const promptStart = serverAgentSource.indexOf('async prompt(')
    const promptSource = serverAgentSource.slice(promptStart, serverAgentSource.indexOf('this.startStateWatchdog()', promptStart))

    expect(promptSource).toContain('messageAlreadyInState')
    expect(promptSource).toContain('reusesExistingMessage')
    // 复用分支不能走乐观追加，否则同一句话出现两条。
    expect(promptSource.indexOf('reusesExistingMessage')).toBeLessThan(promptSource.indexOf('this.state.messages = [...this.state.messages, agentMessage]'))
  })
})

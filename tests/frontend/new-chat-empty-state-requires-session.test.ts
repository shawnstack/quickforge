import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 契约：新对话空态（欢迎页 / 快捷任务 / 项目选择器）只在「真的没有会话」时成立。
 *
 * 回滚会把已有会话截断成空消息，但会话本身还在。空态如果只看
 * `messages.length === 0`，回滚后就会被当成新对话页，并触发
 * 「空态自动切到项目会话」的副作用——表现就是「任务会话回滚第一条后，
 * 弹回新发起对话页面」，而项目会话因为 scope 不同看起来「没事」。
 */
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

describe('new chat empty state', () => {
  it('requires the absence of a session, not just an empty message list', () => {
    const start = appSource.indexOf('const showNewChatEmptyState =')
    expect(start).toBeGreaterThan(-1)

    const declaration = appSource.slice(start, start + 600)

    expect(declaration).toContain('(agentManager.agent?.state.messages.length ?? 0) === 0')
    expect(declaration).toContain('!agentManager.currentSessionId')
  })
})

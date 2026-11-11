import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BOT_CHAT_CAPABILITIES, QUICKFORGE_CHAT_CAPABILITIES } from '../../src/lib/chat-capabilities'

/**
 * bot 的会话是它的长期记忆：fork 会复制出一份带着同样记忆和心跳指令的分身，
 * 回滚 / 重试会把历史剪短、让压缩指针悬空。这里锁住三处落点：
 *
 * - 能力矩阵：`BOT_CHAT_CAPABILITIES`（压缩必须留着）；
 * - 注入：`App.tsx` 在 bot 语境把它交给 `ChatPanelHost`，并同步给历史动作；
 * - 防御层：`useChatActions` 在真干活之前再判一次能力位。
 */
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const chatActionsSource = readFileSync(new URL('../../src/hooks/useChatActions.ts', import.meta.url), 'utf8')

describe('BOT_CHAT_CAPABILITIES', () => {
  it('关掉 fork / 回滚 / 重试，保留压缩', () => {
    expect(BOT_CHAT_CAPABILITIES.forkFromMessage).toBe(false)
    expect(BOT_CHAT_CAPABILITIES.rollback).toBe(false)
    expect(BOT_CHAT_CAPABILITIES.retry).toBe(false)
    expect(BOT_CHAT_CAPABILITIES.compaction).toBe(true)
  })

  it('不是只读页面：没被关掉的能力位与主会话一致', () => {
    for (const key of Object.keys(QUICKFORGE_CHAT_CAPABILITIES) as Array<keyof typeof QUICKFORGE_CHAT_CAPABILITIES>) {
      if (key === 'forkFromMessage' || key === 'rollback' || key === 'retry') continue
      expect(BOT_CHAT_CAPABILITIES[key]).toBe(QUICKFORGE_CHAT_CAPABILITIES[key])
    }
  })
})

describe('App 把 bot 档注入到对话面板', () => {
  it('bot 语境（bot 模式或会话落在 bot 项目）用 BOT_CHAT_CAPABILITIES', () => {
    expect(appSource).toContain(
      'const chatCapabilities = botMode || isBotProject(agentManager.currentToolProject)',
    )
    expect(appSource).toContain('? BOT_CHAT_CAPABILITIES')
    expect(appSource).toContain(': QUICKFORGE_CHAT_CAPABILITIES')
  })

  it('ChatPanelHost 与历史动作拿的是同一份表', () => {
    expect(appSource).toContain('capabilities={chatCapabilities}')
    expect(appSource).toContain('capabilities: chatCapabilities,')
  })
})

describe('useChatActions 的前置断言', () => {
  it.each([
    ['forkFromMessage', 'capabilities.forkFromMessage'],
    ['performRollback', 'capabilities.rollback'],
    ['retryFromMessage', 'capabilities.retry'],
  ])('%s 在能力位为 false 时直接返回', (_action, capability) => {
    expect(chatActionsSource).toContain(`if (!${capability}) {`)
  })
})

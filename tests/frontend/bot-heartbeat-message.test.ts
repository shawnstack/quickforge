import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'

import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { BotHeartbeatMessage } from '../../src/components/chat/surface/BotHeartbeatMessage'
import { MessageList } from '../../src/components/chat/surface/MessageList'
import type { AgentMessage } from '../../src/components/chat/surface/ChatTypes'
import {
  botHeartbeatTextOf,
  isBotHeartbeatMessage,
} from '../../src/components/chat/surface/bot-heartbeat-message'

/**
 * 心跳唤醒那一行。
 *
 * 守卫的是「谁在说」这件事：心跳走普通 prompt 通道，落库后 role 是 user，
 * 一旦判定漏了，它就变成一条用户从没打过的用户消息。
 */

beforeEach(() => applyAppLanguageFromSnapshot('en'))

const HEARTBEAT_TEXT = '[心跳] 你自己醒了一次，这不是用户在跟你说话。'

function markedHeartbeat() {
  return {
    role: 'user' as const,
    content: HEARTBEAT_TEXT,
    timestamp: '2026-11-11T08:00:00.000Z',
    details: { quickforgeBotHeartbeat: { version: 1 } },
  }
}

describe('isBotHeartbeatMessage', () => {
  it('recognises the details marker the server writes', () => {
    expect(isBotHeartbeatMessage(markedHeartbeat())).toBe(true)
  })

  it('recognises rows written before the marker existed', () => {
    expect(isBotHeartbeatMessage({ role: 'user', content: HEARTBEAT_TEXT, timestamp: 1 })).toBe(true)
  })

  it('leaves ordinary user text alone', () => {
    expect(isBotHeartbeatMessage({ role: 'user', content: '帮我看下这个', timestamp: 1 })).toBe(false)
    expect(isBotHeartbeatMessage({ role: 'user', content: '为什么这里会有 [心跳] 这个词？', timestamp: 1 })).toBe(false)
  })

  it('never mistakes an assistant row for a heartbeat', () => {
    expect(isBotHeartbeatMessage({ role: 'assistant', content: HEARTBEAT_TEXT, timestamp: 1 })).toBe(false)
  })
})

describe('BotHeartbeatMessage', () => {
  it('renders a labelled row instead of a user bubble', () => {
    const html = renderToStaticMarkup(
      createElement(BotHeartbeatMessage, { message: markedHeartbeat() as unknown as AgentMessage }),
    )
    expect(html).toContain('data-quickforge-bot-heartbeat="true"')
    expect(html).toContain('woke on its own')
    // 用户气泡是「这是你说的话」的视觉承诺，心跳不能借用它。
    expect(html).not.toContain('user-message-container')
    // 指令原文默认收起，否则一小时一次的正文会把流淹掉。
    expect(html).not.toContain('这不是用户在跟你说话')
  })

  it('keeps the raw instruction available for the expanded body', () => {
    expect(botHeartbeatTextOf(markedHeartbeat())).toBe(HEARTBEAT_TEXT)
  })
})

describe('MessageList dispatch', () => {
  it('splits a heartbeat row from a real user row in the same list', () => {
    const messages = [
      markedHeartbeat(),
      { role: 'user', content: '帮我看下 work 项目', timestamp: '2026-11-11T08:05:00.000Z' },
    ] as unknown as AgentMessage[]
    const html = renderToStaticMarkup(createElement(MessageList, { messages }))

    expect(html).toContain('data-quickforge-bot-heartbeat="true"')
    // 真正的用户消息仍然走气泡。
    expect(html).toContain('user-message-container')
    // 两行都要带 `.qf-user-message` 宿主：MessageList 用它们给行写 data-message-index，
    // 少一个宿主后面所有行的序号都会错位（装饰层、回滚都按这个索引说话）。
    expect(html.match(/class="qf-user-message/g) ?? []).toHaveLength(2)
    // 心跳指令原文不上屏。
    expect(html).not.toContain('这不是用户在跟你说话')
  })
})

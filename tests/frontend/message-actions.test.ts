import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { assistantActionDisplayIndexes } from '../../src/components/chat/panel-decoration/message-action-visibility'
import { parseSlashInvocationPrefix, planSlashChipText } from '../../src/components/chat/slash-invocation-chip'

// The real i18n module pulls in pi-web-ui which requires a browser DOM;
// slash-invocation-chip only needs t() for the chip aria-label.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

describe('assistant message actions', () => {
  it('only shows actions on the final assistant message of each completed turn', () => {
    const indexes = assistantActionDisplayIndexes([
      { role: 'user' },
      { role: 'assistant' },
      { role: 'assistant' },
      { role: 'user-with-attachments' },
      { role: 'assistant' },
    ], false)

    expect([...indexes]).toEqual([2, 4])
  })

  it('hides actions for every assistant message in the active streaming turn', () => {
    const indexes = assistantActionDisplayIndexes([
      { role: 'user' },
      { role: 'assistant' },
      { role: 'user' },
      { role: 'assistant' },
      { role: 'assistant' },
    ], true)

    expect([...indexes]).toEqual([1])
  })

  it('shows the final assistant actions after streaming completes', () => {
    const messages = [
      { role: 'user' },
      { role: 'assistant' },
      { role: 'assistant' },
    ]

    expect([...assistantActionDisplayIndexes(messages, true)]).toEqual([])
    expect([...assistantActionDisplayIndexes(messages, false)]).toEqual([2])
  })

  it('does not create assistant action targets before an assistant response exists', () => {
    expect([...assistantActionDisplayIndexes([], false)]).toEqual([])
    expect([...assistantActionDisplayIndexes([{ role: 'user' }], true)]).toEqual([])
  })

  it('does not apply content visibility to message hosts containing rollback popovers', () => {
    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

    expect(css).not.toMatch(
      /message-list\s+(?:user-message|assistant-message)[^{}]*\{[^{}]*content-visibility\s*:/s,
    )
  })
})

describe('user message file reference decoration', () => {
  it('reads only details.contextReferences and keeps copy text on the original message', () => {
    const source = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
    expect(source).toContain('contextReferencesFromMessage')
    expect(source).toContain("(details as Record<string, unknown>).contextReferences")
    expect(source).toMatch(/decorateUserFileReferences\(element,\s*entry\.message\)/)
    expect(source).not.toMatch(/metadata\s*\.\s*contextReferences/)
    expect(source).toMatch(/const text = draftTextFromUserMessage\(entry\.message/)
  })
})

describe('user message slash invocation chip decoration', () => {
  // 消息流 DOM 断言依赖浏览器渲染（markdown-block light DOM + 文本节点），现有
  // harness 为纯逻辑 + 源码断言；此处沿用：前缀解析/剥前缀计划已提为纯函数单测，
  // 装饰器本身做最小源码断言（幂等还原按 chip 自带前缀，复制走原文不受影响）。

  it('parses message prefixes for the chip decoration', () => {
    expect(parseSlashInvocationPrefix('/agent explore ship the release')).toEqual({
      kind: 'agent',
      name: 'explore',
      cmd: '/agent explore',
    })
    expect(parseSlashInvocationPrefix('/skill patch-release run the checks')).toEqual({
      kind: 'skill',
      name: 'patch-release',
      cmd: '/skill patch-release',
    })
    expect(parseSlashInvocationPrefix('帮我把发布流程梳理一遍')).toBeNull()
    expect(parseSlashInvocationPrefix('/init the project')).toBeNull()
  })

  it('plans the first text node strip (prefix includes exactly one trailing space)', () => {
    expect(planSlashChipText('/agent explore ship it')).toEqual({
      invocation: { kind: 'agent', name: 'explore', cmd: '/agent explore' },
      prefix: '/agent explore ',
      rest: 'ship it',
    })
    expect(planSlashChipText('/agent explore')).toEqual({
      invocation: { kind: 'agent', name: 'explore', cmd: '/agent explore' },
      prefix: '/agent explore',
      rest: '',
    })
    expect(planSlashChipText('plain task')).toBeNull()
  })

  it('decorates user messages via decorateUserSlashInvocationChip with per-chip restore', () => {
    const source = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')

    // 只在 user 分支调用（与 decorateUserMessageInputClamp 相邻）。
    expect(source).toContain('decorateUserMessageInputClamp(element, inputClampLabels)')
    expect(source).toMatch(/decorateUserSlashInvocationChip\(element,\s*entry\.message/)
    // 幂等还原：chip 自带被剥掉的前缀（data 属性），重装饰先还原再应用。
    expect(source).toContain("'data-quickforge-slash-chip-el'")
    expect(source).toContain('quickforgeSlashChipPrefix')
    expect(source).toContain('findFirstContentTextNode')
    // 复制行为不动：copy 仍走 draftTextFromUserMessage 原文。
    expect(source).toMatch(/const text = draftTextFromUserMessage\(entry\.message/)
  })

  it('ships the shared slash chip styles for the overlay and the message flow', () => {
    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

    for (const selector of [
      '.quickforge-slash-overlay',
      '.quickforge-slash-ghost',
      '.quickforge-slash-source-text',
      '.quickforge-slash-spacer',
      '.quickforge-slash-chip',
      '.quickforge-slash-chip-skill',
      '.quickforge-slash-chip-agent',
      'html.dark .quickforge-slash-chip-skill',
      'html.dark .quickforge-slash-chip-agent',
      '.quickforge-slash-chip-in-message',
    ]) {
      expect(css).toContain(`${selector} {`)
    }
    // 覆盖层不拦截指针，激活时原文透明但光标可见。
    expect(css).toMatch(/\.quickforge-slash-overlay \{[^}]*pointer-events: none/s)
    expect(css).toMatch(/\.quickforge-slash-source-text \{[^}]*color: transparent[^}]*caret-color: var\(--foreground\)/s)
  })
})

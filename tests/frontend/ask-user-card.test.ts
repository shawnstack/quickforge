import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })

import { buildAskAnswerText, buildAskDisplaySignature, isAskAnswered } from '../../src/components/chat/panel-decoration/ask-user-card'

describe('isAskAnswered', () => {
  it('requires choices or non-empty custom text', () => {
    expect(isAskAnswered(undefined)).toBe(false)
    expect(isAskAnswered({})).toBe(false)
    expect(isAskAnswered({ choices: [] })).toBe(false)
    expect(isAskAnswered({ custom: '   ' })).toBe(false)
    expect(isAskAnswered({ choices: ['a'] })).toBe(true)
    expect(isAskAnswered({ custom: '我的想法' })).toBe(true)
  })
})

describe('buildAskAnswerText', () => {
  it('joins choices with middle dots and appends the custom supplement', () => {
    expect(buildAskAnswerText({ choices: ['npm', 'Desktop'] })).toBe('npm · Desktop')
    expect(buildAskAnswerText({ choices: ['npm'], custom: '桌面先不发' })).toBe('npm　补充：桌面先不发')
    expect(buildAskAnswerText({ custom: '自定义' })).toBe('自定义')
    expect(buildAskAnswerText(undefined)).toBe('')
    expect(buildAskAnswerText({})).toBe('')
  })
})

describe('buildAskDisplaySignature', () => {
  it('keys on ask identity, question count, and disabled state', () => {
    const ask = { askId: 'a1', questions: [{ question: 'q1' }, { question: 'q2' }] } as never
    expect(buildAskDisplaySignature(ask, false)).not.toBe(buildAskDisplaySignature(ask, true))
    expect(buildAskDisplaySignature(ask, false)).not.toBe(buildAskDisplaySignature({ ...ask, askId: 'a2' } as never, false))
  })
})

describe('ask-user card wiring', () => {
  const css = readFileSync('src/index.css', 'utf8')
  const host = readFileSync('src/components/chat/ChatPanelHost.tsx', 'utf8')
  const serverAgent = readFileSync('src/lib/server-agent.ts', 'utf8')
  const i18n = readFileSync('src/lib/i18n.ts', 'utf8')

  it('styles every card building block', () => {
    for (const selector of [
      '.quickforge-ask-card',
      '.quickforge-ask-dot',
      '.quickforge-ask-step--current',
      '.quickforge-ask-option--picked',
      '.quickforge-ask-check',
      '.quickforge-ask-custom-input',
      '.quickforge-ask-review-row',
      '.quickforge-ask-actions',
      '.quickforge-ask-body--enter',
    ]) {
      expect(css).toContain(selector)
    }
  })

  it('ChatPanelHost injects and removes the card plus SSE event handling', () => {
    expect(host).toContain('injectAskUserCard')
    expect(host).toContain('removeAskUserCard')
    expect(host).toContain("'ask_user_required'")
    expect(host).toContain("'ask_user_answered'")
    expect(host).toContain('onAnswerAsk')
    // Regression: the propsRef sync effect must keep onAnswerAsk — dropping it
    // disabled the card ("当前视图无法作答") after the first render.
    const effectBlock = host.slice(host.indexOf('propsRef.current = {', host.indexOf('Keep ref in sync')))
    expect(effectBlock.slice(0, 900)).toContain('onAnswerAsk')
  })

  it('local-tools registers an ask_user renderer that follows tool display settings', () => {
    const localTools = readFileSync('src/lib/local-tools.ts', 'utf8')
    expect(localTools).toContain("registerToolRenderer('ask_user'")
    expect(localTools).toContain('class AskUserToolRenderer')
    // The renderer must gate input/details on the tool display mode like the
    // other built-in renderers.
    const rendererBlock = localTools.slice(localTools.indexOf('class AskUserToolRenderer'), localTools.indexOf('class OpenCodeToolRenderer'))
    expect(rendererBlock).toContain("toolDisplaySettings.toolDisplayMode === 'detailed'")
  })

  it('server-agent registers the events, state field, and answer API', () => {
    expect(serverAgent).toContain("'ask_user_required', 'ask_user_answered'")
    expect(serverAgent).toContain('pendingAsk')
    expect(serverAgent).toContain('/answer-ask')
  })

  it('i18n carries every ask key in both locales', () => {
    for (const key of ['askUserTitle', 'askUserProgress', 'askUserSubmit', 'askUserSkip', 'askUserNext', 'askUserBack', 'askUserCustomToggle', 'askUserCustomPlaceholder', 'askUserFailed', 'askUserUnanswered']) {
      expect(i18n.match(new RegExp(`${key}:`, 'g'))?.length).toBeGreaterThanOrEqual(2)
    }
  })
})

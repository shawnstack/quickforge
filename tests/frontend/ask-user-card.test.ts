import { readFileSync } from 'node:fs'
import ts from 'typescript'
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

describe('askUserReviewRowsFromDetails', () => {
  // local-tools.ts registers renderers at import time and pulls the heavy
  // pi-web-ui tree; lift the transpiled pure function instead (same approach
  // as local-tools-lit-reactivity.test.ts).
  const localToolsSource = readFileSync('src/lib/local-tools.ts', 'utf8')

  function extractTranspiledFunction(name: string): string {
    const output = ts.transpileModule(localToolsSource, {
      fileName: 'local-tools.ts',
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
      },
    }).outputText
    const sourceFile = ts.createSourceFile('local-tools.js', output, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS)
    const fn = sourceFile.statements.find(
      (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
    )
    if (!fn) throw new Error(`Transpiled ${name} not found`)
    return output.slice(fn.getStart(sourceFile), fn.end).replace(/^export\s+/, '')
  }

  type AskUserReviewRowsLike = {
    questions: Array<{ question: string }>
    answers: Array<{ choices?: string[]; custom?: string } | undefined>
    skipped: boolean
    skipReason?: string
  } | null

  const askUserReviewRowsFromDetails = new Function(
    `${extractTranspiledFunction('askUserReviewRowsFromDetails')}\nreturn askUserReviewRowsFromDetails`,
  )() as (details: unknown) => AskUserReviewRowsLike

  it('extracts normalized questions with answers aligned to question length', () => {
    const rows = askUserReviewRowsFromDetails({
      questions: [{ question: 'Q1' }, { question: 'Q2' }, { question: 'Q3' }],
      answers: [{ choices: ['A'], custom: 'note' }, {}],
    })
    expect(rows?.questions).toEqual([{ question: 'Q1' }, { question: 'Q2' }, { question: 'Q3' }])
    expect(rows?.answers).toEqual([
      { choices: ['A'], custom: 'note' },
      { choices: undefined, custom: undefined },
      undefined,
    ])
    expect(rows?.skipped).toBe(false)
    expect(rows?.skipReason).toBeUndefined()
  })

  it('keeps skip state and reason', () => {
    const rows = askUserReviewRowsFromDetails({
      questions: [{ question: 'Q1' }],
      answers: [],
      skipped: true,
      skipReason: 'timeout',
    })
    expect(rows?.skipped).toBe(true)
    expect(rows?.skipReason).toBe('timeout')
  })

  it('filters non-string choices and drops non-string custom text', () => {
    const rows = askUserReviewRowsFromDetails({
      questions: [{ question: 'Q1' }],
      answers: [{ choices: ['ok', 7, null], custom: 42 }],
    })
    expect(rows?.answers[0]).toEqual({ choices: ['ok'], custom: undefined })
  })

  it('returns null for malformed details shapes', () => {
    expect(askUserReviewRowsFromDetails(undefined)).toBeNull()
    expect(askUserReviewRowsFromDetails(null)).toBeNull()
    expect(askUserReviewRowsFromDetails('nope')).toBeNull()
    expect(askUserReviewRowsFromDetails([])).toBeNull()
    expect(askUserReviewRowsFromDetails({ answers: [{ choices: ['A'] }] })).toBeNull()
    expect(askUserReviewRowsFromDetails({ questions: [], answers: [] })).toBeNull()
    expect(askUserReviewRowsFromDetails({ questions: [{ question: 'Q1' }] })).toBeNull()
    expect(askUserReviewRowsFromDetails({ questions: [{ question: 1 }], answers: [] })).toBeNull()
  })
})

describe('ask-user card wiring', () => {
  const css = readFileSync('src/index.css', 'utf8')
  const host = readFileSync('src/components/chat/ChatPanelHost.tsx', 'utf8')
  const serverAgent = readFileSync('src/lib/server-agent.ts', 'utf8')
  const i18n = readFileSync('src/lib/i18n.ts', 'utf8')
  const card = readFileSync('src/components/chat/panel-decoration/ask-user-card.ts', 'utf8')
  const localTools = readFileSync('src/lib/local-tools.ts', 'utf8')

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
    expect(localTools).toContain("registerToolRenderer('ask_user'")
    expect(localTools).toContain('class AskUserToolRenderer')
    // The renderer must gate input/details on the tool display mode like the
    // other built-in renderers.
    const rendererBlock = localTools.slice(localTools.indexOf('class AskUserToolRenderer'), localTools.indexOf('class OpenCodeToolRenderer'))
    expect(rendererBlock).toContain("toolDisplaySettings.toolDisplayMode === 'detailed'")
  })

  it('history tool messages reuse the review receipt layout for resolved asks', () => {
    // The renderer reads the structured answers persisted in toolResult.details
    // and renders read-only review rows (same receipt styles as the submit
    // step, minus the edit button) for answered and skipped calls.
    expect(localTools).toContain("import { buildAskAnswerText } from '@/components/chat/panel-decoration/ask-user-card'")
    expect(localTools).toContain('const review = askUserReviewRowsFromDetails(result?.details)')
    expect(localTools).toContain('const reviewActive = review !== null && !detailed')
    // Non-detailed resolved asks drop both the raw question list and the
    // output text block; detailed mode keeps the raw view.
    expect(localTools).toContain("const output = reviewActive ? '' : resultText(result)")
    expect(localTools).toContain('questions.length && !detailed && review === null')
    const rendererBlock = localTools.slice(localTools.indexOf('class AskUserToolRenderer'), localTools.indexOf('class OpenCodeToolRenderer'))
    expect(rendererBlock).toContain('class="quickforge-ask-review"')
    expect(rendererBlock).toContain('class="quickforge-ask-review-row"')
    expect(rendererBlock).toContain('class="quickforge-ask-review-content"')
    expect(rendererBlock).toContain('class="quickforge-ask-review-question"')
    expect(rendererBlock).toContain('class="quickforge-ask-review-answer"')
    expect(rendererBlock).toContain("buildAskAnswerText(review.answers[index]) || t('askUserUnanswered')")
    expect(rendererBlock).toContain('askUserSkipReasonText(review.skipReason)')
    // History rows are read-only — the card's edit button must not appear.
    expect(rendererBlock).not.toContain('quickforge-ask-review-edit')
  })

  it('maps ask_user skip reasons to dedicated i18n copy', () => {
    expect(localTools).toContain('const ASK_USER_SKIP_REASON_KEYS')
    expect(localTools).toContain("timeout: 'askUserSkipReasonTimeout'")
    expect(localTools).toContain("aborted: 'askUserSkipReasonAborted'")
    expect(localTools).toContain("'no-questions': 'askUserSkipReasonNoQuestions'")
    expect(localTools).toContain("'askUserSkipReasonUser'")
  })

  it('server-agent registers the events, state field, and answer API', () => {
    expect(serverAgent).toContain("'ask_user_required', 'ask_user_answered'")
    expect(serverAgent).toContain('pendingAsk')
    expect(serverAgent).toContain('/answer-ask')
  })

  it('renders an explicit Next for multi-select or free-form questions', () => {
    // Single-select questions with a custom input need a forward path after
    // typing free-form text; picking an option still auto-advances. The Next
    // button lives in the bottom actions row, one row with Back.
    expect(card).toContain('actions.append(backBtn, nextBtn, submitBtn, skipBtn, note)')
    expect(card).toContain("nextBtn.style.display = (!isReview && (question.multiSelect === true || question.allowCustom !== false)) ? '' : 'none'")
    const nextBlock = card.slice(card.indexOf("nextBtn.addEventListener('click'"), card.indexOf("backBtn.addEventListener('click'"))
    expect(nextBlock).toContain('isAskAnswered(answers[step])')
    expect(nextBlock).toContain("t('askUserNeedAnswer')")
    // The body template no longer carries an inline Next button, and its
    // standalone CSS class is gone too.
    expect(card).not.toContain('quickforge-ask-next')
    expect(css).not.toContain('.quickforge-ask-next')
  })

  it('free-form textarea confirms with Enter and keeps Shift+Enter newline', () => {
    const customBlock = card.slice(card.indexOf("customInput?.addEventListener('keydown'"), card.indexOf('// Skipping discards every answer'))
    expect(customBlock).toContain("e.key === 'Enter' && !e.shiftKey")
    expect(customBlock).toContain('e.preventDefault()')
    expect(customBlock).toContain('isAskAnswered(answers[step])')
    expect(customBlock).toContain('advance()')
  })

  it('skip requires a second click and disarms on other interactions', () => {
    const skipBlock = card.slice(card.indexOf("skipBtn.addEventListener('click'"), card.indexOf('if (disabled)'))
    expect(skipBlock).toContain('if (!skipArmed)')
    expect(skipBlock).toContain("t('askUserSkipConfirm')")
    expect(skipBlock).toContain('window.setTimeout(disarmSkip, 5000)')
    expect(card).toContain('const disarmSkip = () => {')
    // Back / submit / auto-advance must reset the armed state.
    const backBlock = card.slice(card.indexOf("backBtn.addEventListener('click'"), card.indexOf('const setSubmitting'))
    expect(backBlock).toContain('disarmSkip()')
    const submitBlock = card.slice(card.indexOf("submitBtn.addEventListener('click'"), card.indexOf("skipBtn.addEventListener('click'"))
    expect(submitBlock).toContain('disarmSkip()')
    const advanceBlock = card.slice(card.indexOf('const advance = () =>'), card.indexOf('const showMessage'))
    expect(advanceBlock).toContain('disarmSkip()')
  })

  it('free-form input is a supplement that keeps picked choices', () => {
    // Opening the note box must not reset the question —「选项 + 补充」can mix.
    expect(card).not.toContain('answers[step].choices = []')
    expect(card).not.toContain("classList.remove('quickforge-ask-option--picked')")
  })

  it('review rows offer an edit button that jumps straight to the question', () => {
    expect(card).toContain('class="quickforge-ask-review-edit" data-review-index="${index}"')
    expect(css).toContain('.quickforge-ask-review-edit')
    const editBlock = card.slice(card.indexOf("querySelectorAll<HTMLButtonElement>('.quickforge-ask-review-edit')"), card.indexOf("body.classList.remove('quickforge-ask-body--enter')") + 1)
    expect(editBlock).toContain('disarmSkip()')
    expect(editBlock).toContain('step = index')
    expect(editBlock).toContain('renderStep()')
  })

  it('i18n carries every ask key in both locales', () => {
    for (const key of ['askUserTitle', 'askUserProgress', 'askUserSubmit', 'askUserSkip', 'askUserSkipConfirm', 'askUserNext', 'askUserBack', 'askUserCustomToggle', 'askUserCustomPlaceholder', 'askUserEdit', 'askUserFailed', 'askUserUnanswered', 'askUserSkipReasonTimeout', 'askUserSkipReasonAborted', 'askUserSkipReasonNoQuestions', 'askUserSkipReasonUser']) {
      expect(i18n.match(new RegExp(`${key}:`, 'g'))?.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('skip reason copy exists in both locales for the history review rows', () => {
    expect(i18n).toContain("askUserSkipReasonTimeout: 'Timed out waiting for answers'")
    expect(i18n).toContain("askUserSkipReasonTimeout: '等待回答超时'")
    expect(i18n).toContain("askUserSkipReasonAborted: 'Run stopped before answering'")
    expect(i18n).toContain("askUserSkipReasonAborted: '运行被停止，未作答'")
    expect(i18n).toContain("askUserSkipReasonNoQuestions: 'Invalid question list'")
    expect(i18n).toContain("askUserSkipReasonNoQuestions: '问题列表无效'")
    expect(i18n).toContain("askUserSkipReasonUser: 'User skipped the questions'")
    expect(i18n).toContain("askUserSkipReasonUser: '用户跳过了提问'")
  })

  it('skip copy states skipping all questions with a confirm step', () => {
    expect(i18n).toContain("askUserSkip: 'Skip all questions'")
    expect(i18n).toContain("askUserSkip: '跳过全部提问'")
    expect(i18n).toContain("askUserSkipConfirm: 'Click again to skip all questions'")
    expect(i18n).toContain("askUserSkipConfirm: '再次点击确认跳过'")
  })

  it('custom input copy reads as an optional note and review rows expose edit', () => {
    expect(i18n).toContain("askUserCustomToggle: 'Add a note (optional)'")
    expect(i18n).toContain("askUserCustomToggle: '补充说明（可选）'")
    expect(i18n).toContain("askUserCustomPlaceholder: 'Type a note or extra context…'")
    expect(i18n).toContain("askUserCustomPlaceholder: '输入补充说明或额外要求…'")
    expect(i18n).toContain("askUserEdit: 'Edit'")
    expect(i18n).toContain("askUserEdit: '修改'")
  })
})

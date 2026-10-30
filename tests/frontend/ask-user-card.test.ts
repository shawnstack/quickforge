import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { appCss } from '../helpers/app-css'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })

import { buildAskDisplaySignature, isAskAnswered, splitAskAnswer } from '../../src/components/chat/panel-decoration/ask-user-card'

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

describe('splitAskAnswer', () => {
  it('splits choices from the free-form note and drops empty values', () => {
    expect(splitAskAnswer(undefined)).toEqual({ choices: [], custom: '' })
    // 空串/纯空白选项不算选中项
    expect(splitAskAnswer({ choices: ['a', '', '  ', 'b'] })).toEqual({ choices: ['a', 'b'], custom: '' })
    // 补充文本两端空白在回执里没有意义
    expect(splitAskAnswer({ custom: '  我的想法  ' })).toEqual({ choices: [], custom: '我的想法' })
    // 两者共存时都保留，交给渲染层分段呈现
    expect(splitAskAnswer({ choices: ['a'], custom: 'x' })).toEqual({ choices: ['a'], custom: 'x' })
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
  // T4：askUserReviewRowsFromDetails 已随 AskUserToolRenderer 迁至
  // tool-renderers/ask-user-tool-renderer.tsx（React）。该模块树经 shared.tsx
  // 间接拉入 i18n 与 React 渲染器，无法在 node 测试直接 import，继续沿用 transpile
  // 提取纯函数的做法。
  const askUserRendererSource = readFileSync('src/lib/tool-renderers/ask-user-tool-renderer.tsx', 'utf8')

  function extractTranspiledFunction(name: string): string {
    const output = ts.transpileModule(askUserRendererSource, {
      fileName: 'ask-user-tool-renderer.tsx',
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
        jsx: ts.JsxEmit.React,
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
    remark?: string
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
    expect(askUserReviewRowsFromDetails({ questions: [{ question: 1 }], answers: [] })).toBeNull()
  })

  it('tolerates a missing or null answers list on the skip path', () => {
    // 服务端跳过/超时写的是 answers: null；不能因此把整条回执判成畸形。
    for (const answers of [undefined, null]) {
      const rows = askUserReviewRowsFromDetails({
        questions: [{ question: 'Q1' }],
        answers,
        skipped: true,
        skipReason: 'timeout',
        remark: '超时前我写了这句',
      })
      expect(rows?.questions).toEqual([{ question: 'Q1' }])
      expect(rows?.answers).toEqual([undefined])
      expect(rows?.skipped).toBe(true)
      expect(rows?.remark).toBe('超时前我写了这句')
    }
  })
})

describe('ask-user card wiring', () => {
  const css = appCss
  // The card injection/removal wiring moved to `panel-wiring/approval-cards.ts`;
  // read both so the host-level and subsystem-level contracts stay pinned.
  const host = [
    readFileSync('src/components/chat/ChatPanelHost.tsx', 'utf8'),
    readFileSync('src/components/chat/panel-wiring/approval-cards.ts', 'utf8'),
  ].join('\n')
  const serverAgent = readFileSync('src/lib/server-agent.ts', 'utf8')
  const sseClient = readFileSync('src/lib/global-agent-sse-client.ts', 'utf8')
  const i18n = readFileSync('src/lib/i18n.ts', 'utf8')
  const card = readFileSync('src/components/chat/panel-decoration/ask-user-card.ts', 'utf8')
  const localTools = readFileSync('src/lib/local-tools.ts', 'utf8')
  // T4：AskUserToolRenderer 实现已迁至 tool-renderers/ask-user-tool-renderer.tsx（React）。
  const askUserRenderer = readFileSync('src/lib/tool-renderers/ask-user-tool-renderer.tsx', 'utf8')

  it('styles every card building block', () => {
    for (const selector of [
      '.quickforge-ask-card',
      '.quickforge-ask-dot',
      '.quickforge-ask-step--current',
      '.quickforge-ask-option--picked',
      '.quickforge-ask-check',
      '.quickforge-ask-custom-input',
      '.quickforge-ask-review-row',
      '.quickforge-ask-answer-choice',
      '.quickforge-ask-answer-extra',
      '.quickforge-ask-answer-empty',
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
    expect(askUserRenderer).toContain('class AskUserToolRenderer')
    // The renderer must gate input/details on the tool display mode like the
    // other built-in renderers (shared.tsx 的 toolDisplayDetailed() 内部即
    // toolDisplayMode === 'detailed' 判定)。
    const rendererBlock = askUserRenderer.slice(askUserRenderer.indexOf('class AskUserToolRenderer'))
    expect(rendererBlock).toContain('const detailed = toolDisplayDetailed()')
  })

  it('history tool messages reuse the review receipt layout for resolved asks', () => {
    // The renderer reads the structured answers persisted in toolResult.details
    // and renders read-only review rows (same receipt styles as the submit
    // step, minus the edit button) for answered and skipped calls.
    expect(askUserRenderer).toContain("import { splitAskAnswer } from '@/components/chat/panel-decoration/ask-user-card'")
    expect(askUserRenderer).toContain('const review = askUserReviewRowsFromDetails(result?.details)')
    expect(askUserRenderer).toContain('const reviewActive = review !== null && !detailed')
    // Non-detailed resolved asks drop both the raw question list and the
    // output text block; detailed mode keeps the raw view.
    expect(askUserRenderer).toContain("const output = reviewActive ? '' : resultText(result)")
    expect(askUserRenderer).toContain('questions.length && !detailed && review === null')
    const rendererBlock = askUserRenderer.slice(askUserRenderer.indexOf('class AskUserToolRenderer'))
    expect(rendererBlock).toContain('className="quickforge-ask-review"')
    // 行 class 现在按跳过态动态拼接
    expect(rendererBlock).toContain('quickforge-ask-review-row${review?.skipped ? \' quickforge-ask-review-row--skipped\' : \'\'}')
    expect(rendererBlock).toContain('className="quickforge-ask-review-content"')
    expect(rendererBlock).toContain('className="quickforge-ask-review-question"')
    expect(rendererBlock).toContain('className="quickforge-ask-review-answer"')
    // 答案分段渲染：选项成 chip、补充文本独立成块、没选选项时明说
    expect(rendererBlock).toContain('className="quickforge-ask-answer-choice"')
    expect(rendererBlock).toContain('className="quickforge-ask-answer-chip"')
    expect(rendererBlock).toContain('className="quickforge-ask-answer-extra"')
    expect(rendererBlock).toContain("t('askUserNoChoiceLabel')")
    expect(rendererBlock).toContain("t('askUserExtraLabel')")
    expect(rendererBlock).toContain('askUserSkipReasonText(review.skipReason)')
    // History rows are read-only — the card's edit button must not appear.
    expect(rendererBlock).not.toContain('quickforge-ask-review-edit')
  })

  it('maps ask_user skip reasons to dedicated i18n copy', () => {
    expect(askUserRenderer).toContain('const ASK_USER_SKIP_REASON_KEYS')
    expect(askUserRenderer).toContain("timeout: 'askUserSkipReasonTimeout'")
    expect(askUserRenderer).toContain("aborted: 'askUserSkipReasonAborted'")
    expect(askUserRenderer).toContain("'no-questions': 'askUserSkipReasonNoQuestions'")
    expect(askUserRenderer).toContain("'askUserSkipReasonUser'")
  })

  it('server-agent registers the events, state field, and answer API', () => {
    expect(sseClient).toContain("'ask_user_required', 'ask_user_answered'")
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

  it('Enter during IME composition must not advance the wizard', () => {
    const customBlock = card.slice(card.indexOf("customInput?.addEventListener('keydown'"), card.indexOf('// Skipping discards every answer'))
    // 中文/日文输入法用 Enter 提交候选词，那一次 Enter 不能当成确认
    expect(customBlock).toContain('e.isComposing')
    expect(customBlock).toContain('keyCode === 229')
    expect(customBlock.indexOf('e.isComposing')).toBeLessThan(customBlock.indexOf("e.key === 'Enter'"))
  })

  it('the custom note box remembers what was typed', () => {
    // 已经写过的补充说明要看得出来：toggle 带「已填写」徽标，输入框预展开并回填
    expect(card).toContain('quickforge-ask-custom-toggle--filled')
    expect(card).toContain('quickforge-ask-custom-filled')
    expect(card).toContain("t('askUserFilledHint')")
    // 有内容时补充框预展开，并在渲染后回填已输入的文本
    expect(card).toContain("customFilled ? '' : ' hidden'")
    expect(card).toContain('customInput.value = answers[step].custom ??')
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
    for (const key of ['askUserTitle', 'askUserProgress', 'askUserSubmit', 'askUserSkip', 'askUserSkipConfirm', 'askUserNext', 'askUserBack', 'askUserCustomToggle', 'askUserCustomPlaceholder', 'askUserEdit', 'askUserFailed', 'askUserUnanswered', 'askUserComposerPlaceholder', 'askUserSkipReasonTimeout', 'askUserSkipReasonAborted', 'askUserSkipReasonNoQuestions', 'askUserSkipReasonUser', 'askUserExtraLabel', 'askUserNoChoiceLabel', 'askUserFilledHint']) {
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

  it('review step carries a card-level extra-note row', () => {
    // The remark is one more receipt line (dashed rail) that edits a card-level
    // note — not a question, so it never touches `answers`.
    expect(card).toContain('quickforge-ask-review-row--remark')
    expect(card).toContain('quickforge-ask-remark-field')
    expect(card).toContain('quickforge-ask-remark-input')
    expect(card).toContain('quickforge-ask-remark-optional')
    expect(card).toContain("t('askUserRemarkPlaceholder')")
    expect(card).toContain("t('askUserRemarkOptional')")
    expect(card).toContain('let remark = \'\'')
    expect(card).toContain('const trimmedRemark = remark.trim()')
    expect(card).toContain('deps.onSubmit(answers.map((answer) => ({ ...answer })), trimmedRemark || undefined)')
    // A multi-line note keeps Enter as a newline.
    const remarkBlock = card.slice(card.indexOf("querySelector<HTMLTextAreaElement>('.quickforge-ask-remark-input')"), card.indexOf("querySelectorAll<HTMLButtonElement>('.quickforge-ask-review-edit')"))
    expect(remarkBlock).not.toContain("e.key === 'Enter'")
    // Styles + narrow-screen adaptation.
    for (const selector of ['.quickforge-ask-remark-field', '.quickforge-ask-remark-input', '.quickforge-ask-remark-optional', '.quickforge-ask-review-row--remark']) {
      expect(css).toContain(selector)
    }
    expect(css).toContain('.quickforge-ask-remark-optional { display: none; }')
  })

  it('the remark travels to the server and is persisted for history', () => {
    expect(host).toContain('propsRef.current.onAnswerAsk?.(capturedAskId, answers, false, remark)')
    expect(serverAgent).toContain('remark: payload.remark')
    expect(askUserRenderer).toContain("remark: typeof record.remark === 'string'")
    expect(askUserRenderer).toContain('const reviewRemark = review && reviewActive ? review.remark : undefined')
    expect(askUserRenderer).toContain("{t('askUserRemarkLabel')}")
    for (const key of ['askUserRemarkLabel', 'askUserRemarkPlaceholder', 'askUserRemarkOptional']) {
      expect(i18n.match(new RegExp(`${key}:`, 'g'))?.length).toBeGreaterThanOrEqual(2)
    }
  })
})

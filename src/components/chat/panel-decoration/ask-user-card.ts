import { t } from '@/lib/i18n'
import type { ServerAgentAskAnswer, ServerAgentPendingAsk } from '@/lib/server-agent'
import { escapeHtml } from './html'

/**
 * Ask-user card — the interactive counterpart of the approval card. Injected
 * at the message-list bottom while an `ask_user` tool call is pending; the
 * tool's execute blocks server-side until the card submits (or skips).
 *
 * Wizard interaction (per approved mockup):
 * single-select questions advance automatically on pick, multi-select and
 * free-form inputs require an explicit "next" step, and the final step is a
 * review summary that submits every answer together.
 */

export type AskUserCardDeps = {
  panel: HTMLElement
  disabled?: boolean
  disabledReason?: string
  /**
   * `remark` is the card-level free-form note typed on the review step. It is
   * kept outside `answers` because it is not tied to any single question.
   */
  onSubmit: (answers: ServerAgentAskAnswer[], remark?: string) => Promise<void> | void
  onSkip: () => Promise<void> | void
}

const ASK_CARD_SELECTOR = '.quickforge-ask-card'

/** Whether a question has an answer the user could submit. */
export function isAskAnswered(answer: ServerAgentAskAnswer | undefined): boolean {
  if (!answer) return false
  if (Array.isArray(answer.choices) && answer.choices.length > 0) return true
  return typeof answer.custom === 'string' && answer.custom.trim().length > 0
}

/** Structured answer segments for the receipt: choices and free-form note stay separate. */
export type AskAnswerSegments = {
  choices: string[]
  custom: string
}

export function splitAskAnswer(answer: ServerAgentAskAnswer | undefined): AskAnswerSegments {
  const choices = Array.isArray(answer?.choices)
    ? answer.choices.filter((choice) => typeof choice === 'string' && choice.trim().length > 0)
    : []
  const custom = typeof answer?.custom === 'string' ? answer.custom.trim() : ''
  return { choices, custom }
}

/**
 * Receipt markup for one answered question. Choices and the free-form note are
 * rendered as separate segments; only a fully empty answer falls back to the
 * "not answered" wording.
 */
function renderReviewAnswer(answer: ServerAgentAskAnswer | undefined): string {
  const { choices, custom } = splitAskAnswer(answer)
  if (!choices.length && !custom) {
    return `<span class="quickforge-ask-review-answer">${escapeHtml(t('askUserUnanswered'))}</span>`
  }
  const choiceHtml = choices.length
    ? `<div class="quickforge-ask-answer-choice">${choices.map((choice) => `<span class="quickforge-ask-answer-chip">${escapeHtml(choice)}</span>`).join('')}</div>`
    : `<span class="quickforge-ask-answer-empty">${escapeHtml(t('askUserNoChoiceLabel'))}</span>`
  const extraHtml = custom
    ? `<div class="quickforge-ask-answer-extra"><span class="quickforge-ask-answer-extra-label">${escapeHtml(t('askUserExtraLabel'))}</span><span class="quickforge-ask-answer-extra-text">${escapeHtml(custom)}</span></div>`
    : ''
  return `${choiceHtml}${extraHtml}`
}

export function buildAskDisplaySignature(ask: ServerAgentPendingAsk, disabled: boolean): string {
  return JSON.stringify({ askId: ask.askId, count: ask.questions.length, disabled })
}

/**
 * Live composer-text entry points, keyed by the injected card element.
 *
 * While an ask is pending the composer is the natural place to type the
 * answer, but the wizard state (`answers` / `step` / `remark`) lives in this
 * closure. The host therefore hands the typed text back to the card instead of
 * steering it into the agent's message queue — see `submitAskTextToPendingAsk`.
 * Keyed by element (not by module global) so a rebuilt card never answers with
 * the previous card's state.
 */
const cardTextHandlers = new WeakMap<HTMLElement, (text: string) => boolean>()

export function injectAskUserCard(deps: AskUserCardDeps, ask: ServerAgentPendingAsk) {
  const { panel } = deps
  const disabled = deps.disabled === true
  const signature = buildAskDisplaySignature(ask, disabled)

  // The wizard mutates its own DOM between decoration passes; only rebuild
  // when the ask identity (or disabled state) actually changed.
  const existing = panel.querySelector<HTMLElement>(`${ASK_CARD_SELECTOR}[data-ask-id="${CSS.escape(ask.askId)}"]`)
  if (existing?.dataset.displaySignature === signature) return

  removeAskUserCard(panel)

  const questions = ask.questions
  const answers: ServerAgentAskAnswer[] = questions.map(() => ({}))
  let step = 0 // 0..questions.length-1 = question steps, questions.length = review step
  // Card-level free-form note for the review step, submitted alongside the
  // answers. It lives on the card (not on a question) because it qualifies the
  // whole submission rather than answering anything.
  let remark = ''

  const card = document.createElement('section')
  card.className = 'quickforge-ask-card'
  card.dataset.askId = ask.askId
  card.dataset.displaySignature = signature

  const head = document.createElement('div')
  head.className = 'quickforge-ask-head'
  head.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <span class="quickforge-ask-who">${escapeHtml(t('askUserTitle'))}</span>
    <span class="quickforge-ask-waiting"><span class="quickforge-ask-dot"></span><span class="quickforge-ask-progress"></span></span>
  `

  const dots = document.createElement('div')
  dots.className = 'quickforge-ask-dots'
  dots.innerHTML = questions.map(() => '<span class="quickforge-ask-step"></span>').join('')

  const body = document.createElement('div')
  body.className = 'quickforge-ask-body'

  const message = document.createElement('div')
  message.className = 'quickforge-ask-message'
  message.hidden = true

  const actions = document.createElement('div')
  actions.className = 'quickforge-ask-actions'
  const backBtn = document.createElement('button')
  backBtn.type = 'button'
  backBtn.className = 'quickforge-ask-button quickforge-ask-button--ghost'
  backBtn.textContent = t('askUserBack')
  const nextBtn = document.createElement('button')
  nextBtn.type = 'button'
  nextBtn.className = 'quickforge-ask-button quickforge-ask-button--ghost'
  nextBtn.textContent = t('askUserNext')
  const submitBtn = document.createElement('button')
  submitBtn.type = 'button'
  submitBtn.className = 'quickforge-ask-button quickforge-ask-button--primary'
  submitBtn.textContent = t('askUserSubmit')
  const skipBtn = document.createElement('button')
  skipBtn.type = 'button'
  skipBtn.className = 'quickforge-ask-button quickforge-ask-button--ghost'
  skipBtn.textContent = t('askUserSkip')
  const note = document.createElement('span')
  note.className = 'quickforge-ask-note'
  actions.append(backBtn, nextBtn, submitBtn, skipBtn, note)
  card.append(head, dots, body, message, actions)

  const renderStep = () => {
    const isReview = step >= questions.length
    const question = questions[step]
    ;(head.querySelector('.quickforge-ask-progress') as HTMLElement).textContent = isReview
      ? t('askUserReviewTitle')
      : t('askUserProgress', { current: String(step + 1), total: String(questions.length) })
    Array.from(dots.children).forEach((dot, index) => {
      dot.className = 'quickforge-ask-step'
        + (index < step || (isReview && index <= questions.length - 1) ? ' quickforge-ask-step--done' : '')
        + (index === step ? ' quickforge-ask-step--current' : '')
    })
    backBtn.style.visibility = step > 0 && !isReview ? 'visible' : (isReview ? 'visible' : 'hidden')
    nextBtn.style.display = (!isReview && (question.multiSelect === true || question.allowCustom !== false)) ? '' : 'none'
    submitBtn.style.display = isReview ? '' : 'none'
    skipBtn.style.display = isReview ? 'none' : ''

    if (isReview) {
      note.textContent = ''
      body.innerHTML = `
        <div class="quickforge-ask-review">
          ${questions.map((q, index) => `
            <div class="quickforge-ask-review-row${isAskAnswered(answers[index]) ? '' : ' quickforge-ask-review-row--skipped'}">
              <div class="quickforge-ask-review-content">
                <span class="quickforge-ask-review-question">${escapeHtml(`${index + 1}. ${q.question}`)}</span>
                ${renderReviewAnswer(answers[index])}
              </div>
              <button type="button" class="quickforge-ask-review-edit" data-review-index="${index}">${escapeHtml(t('askUserEdit'))}</button>
            </div>
          `).join('')}
          <div class="quickforge-ask-review-row quickforge-ask-review-row--remark">
            <div class="quickforge-ask-review-content">
              <label class="quickforge-ask-remark-field">
                <svg class="quickforge-ask-remark-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                <textarea class="quickforge-ask-remark-input" rows="1" placeholder="${escapeHtml(t('askUserRemarkPlaceholder'))}"></textarea>
                <span class="quickforge-ask-remark-optional">${escapeHtml(t('askUserRemarkOptional'))}</span>
              </label>
            </div>
          </div>
        </div>
      `
      // The remark row looks like one more receipt line, but it edits the
      // card-level note instead of jumping back to a question.
      const remarkInput = body.querySelector<HTMLTextAreaElement>('.quickforge-ask-remark-input')
      if (remarkInput) {
        remarkInput.value = remark
        remarkInput.disabled = disabled
        const grow = () => {
          remarkInput.style.height = 'auto'
          remarkInput.style.height = `${Math.min(remarkInput.scrollHeight, 112)}px`
        }
        remarkInput.addEventListener('input', () => {
          remark = remarkInput.value
          grow()
        })
        // A multi-line note is normal here, so Enter stays a newline (unlike
        // the per-question supplement box, which advances on Enter) — there is
        // deliberately no keydown handler.
        if (remark) grow()
      }
      // The review summary re-enters any question directly — same renderStep
      // path as the back button, no extra animation state.
      body.querySelectorAll<HTMLButtonElement>('.quickforge-ask-review-edit').forEach((editBtn) => {
        editBtn.addEventListener('click', () => {
          const index = Number(editBtn.dataset.reviewIndex)
          if (index < 0 || index >= questions.length) return
          message.hidden = true
          disarmSkip()
          step = index
          renderStep()
        })
      })
      body.classList.remove('quickforge-ask-body--enter')
      return
    }

    const multi = question.multiSelect === true
    const allowCustom = question.allowCustom !== false
    // A note that was already typed is kept visible: the toggle carries a
    // "filled in" hint and the box opens pre-expanded.
    const customFilled = typeof answers[step].custom === 'string' && (answers[step].custom ?? '').trim().length > 0
    note.textContent = multi ? t('askUserMultiHint') : t('askUserAutoAdvanceHint')
    body.innerHTML = `
      <div class="quickforge-ask-question">
        ${escapeHtml(`${step + 1}. ${question.question}`)}
        <span class="quickforge-ask-chip">${escapeHtml(multi ? t('askUserMultiChip') : t('askUserSingleChip'))}</span>
      </div>
      <div class="quickforge-ask-options">
        ${(question.options ?? []).map((option, index) => `
          <button type="button" class="quickforge-ask-option${answers[step].choices?.includes(option.label) ? ' quickforge-ask-option--picked' : ''}" data-option-index="${index}">
            <span class="quickforge-ask-check"></span>
            <span class="quickforge-ask-option-body">
              <span class="quickforge-ask-option-label">${escapeHtml(option.label)}</span>
              ${option.description ? `<span class="quickforge-ask-option-desc">${escapeHtml(option.description)}</span>` : ''}
            </span>
            ${multi ? '' : '<span class="quickforge-ask-option-arrow" aria-hidden="true">→</span>'}
          </button>
        `).join('')}
      </div>
      ${allowCustom ? `<button type="button" class="quickforge-ask-custom-toggle${customFilled ? ' quickforge-ask-custom-toggle--filled' : ''}">${escapeHtml(t('askUserCustomToggle'))}${customFilled ? `<span class="quickforge-ask-custom-filled">${escapeHtml(t('askUserFilledHint'))}</span>` : ''}</button>
      <div class="quickforge-ask-custom"${customFilled ? '' : ' hidden'}>
        <textarea class="quickforge-ask-custom-input" rows="3" placeholder="${escapeHtml(t('askUserCustomPlaceholder'))}"></textarea>
      </div>` : ''}
    `

    body.querySelectorAll<HTMLButtonElement>('.quickforge-ask-option').forEach((optionBtn) => {
      optionBtn.disabled = disabled
      optionBtn.addEventListener('click', () => {
        const index = Number(optionBtn.dataset.optionIndex)
        const label = question.options?.[index]?.label
        if (typeof label !== 'string') return
        const answer = answers[step]
        answer.choices = answer.choices ?? []
        if (multi) {
          const at = answer.choices.indexOf(label)
          if (at >= 0) answer.choices.splice(at, 1)
          else answer.choices.push(label)
        } else {
          answer.choices = [label]
          advance()
          return
        }
        optionBtn.classList.toggle('quickforge-ask-option--picked', answer.choices.includes(label))
      })
    })

    const customToggle = body.querySelector<HTMLButtonElement>('.quickforge-ask-custom-toggle')
    const customBox = body.querySelector<HTMLElement>('.quickforge-ask-custom')
    const customInput = body.querySelector<HTMLTextAreaElement>('.quickforge-ask-custom-input')
    // Back-fill after render, not only on toggle: a pre-expanded box must show
    // the note it was expanded for.
    if (customInput && customBox && !customBox.hidden) {
      customInput.value = answers[step].custom ?? ''
      customInput.disabled = disabled
    }
    customToggle?.addEventListener('click', () => {
      if (!customBox || !customInput) return
      const open = customBox.hidden
      customBox.hidden = !open
      if (open) {
        customInput.value = customInput.value || answers[step].custom || ''
        customInput.disabled = disabled
        customInput.focus()
      }
    })
    customInput?.addEventListener('input', () => {
      answers[step].custom = customInput.value
    })
    customInput?.addEventListener('keydown', (e) => {
      // Enter confirms and advances like the bottom-row Next button; Shift+Enter
      // keeps the default newline. IME composition (Chinese/Japanese input) also
      // emits Enter to commit the candidate — that must not advance the wizard,
      // otherwise the just-typed character is dropped.
      if (e.isComposing || (e as KeyboardEvent).keyCode === 229) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!isAskAnswered(answers[step])) {
          showMessage(t('askUserNeedAnswer'))
          return
        }
        advance()
      }
    })
  }

  // Skipping discards every answer, so it needs a two-step confirm: the first
  // click only arms the button (confirm label), reverting after 5s; any other
  // wizard interaction disarms it.
  let skipArmed = false
  let skipArmTimer: number | undefined
  const disarmSkip = () => {
    if (skipArmTimer !== undefined) window.clearTimeout(skipArmTimer)
    skipArmTimer = undefined
    skipArmed = false
    skipBtn.textContent = t('askUserSkip')
  }

  let advancing = false
  const advance = () => {
    if (advancing) return false
    disarmSkip()
    advancing = true
    body.classList.add('quickforge-ask-body--leaving')
    window.setTimeout(() => {
      advancing = false
      step = Math.min(step + 1, questions.length)
      body.classList.remove('quickforge-ask-body--leaving')
      renderStep()
      body.classList.add('quickforge-ask-body--enter')
      window.setTimeout(() => body.classList.remove('quickforge-ask-body--enter'), 220)
    }, 150)
    return true
  }

  const showMessage = (text: string) => {
    message.textContent = text
    message.hidden = false
  }

  /**
   * Consume composer text as if it had been typed into the card.
   *
   * Question step → the text becomes the free-form answer (advancing exactly
   * like the card's own Enter handler), or an exact option label when the
   * question only allows the given options. Review step → the text becomes the
   * card-level remark. Returns false when the text cannot be applied, so the
   * host falls back to its normal streaming behaviour instead of dropping it.
   */
  const applyComposerText = (text: string): boolean => {
    const value = text.trim()
    if (!value || disabled) return false
    if (step >= questions.length) {
      remark = remark.trim() ? `${remark.trim()}\n${value}` : value
      renderStep()
      body.querySelector<HTMLTextAreaElement>('.quickforge-ask-remark-input')?.focus()
      return true
    }
    const question = questions[step]
    if (question.allowCustom !== false) {
      answers[step].custom = value
      message.hidden = true
      return advance()
    }
    const label = (question.options ?? []).find((option) => option.label.trim().toLowerCase() === value.toLowerCase())?.label
    if (typeof label !== 'string') return false
    const answer = answers[step]
    answer.choices = answer.choices ?? []
    if (question.multiSelect === true) {
      if (!answer.choices.includes(label)) answer.choices.push(label)
      message.hidden = true
      renderStep()
      return true
    }
    answer.choices = [label]
    message.hidden = true
    return advance()
  }

  // Bound once at injection — the closure reads the current step/answers; the
  // button lives in the bottom actions row, one row with Back.
  nextBtn.addEventListener('click', () => {
    if (!isAskAnswered(answers[step])) {
      showMessage(t('askUserNeedAnswer'))
      return
    }
    advance()
  })

  backBtn.addEventListener('click', () => {
    message.hidden = true
    disarmSkip()
    step = Math.max(0, step - 1)
    renderStep()
  })

  const setSubmitting = (submitting: boolean) => {
    submitBtn.disabled = submitting || disabled
    skipBtn.disabled = submitting || disabled
    nextBtn.disabled = submitting || disabled
    backBtn.disabled = submitting
    const remarkInput = body.querySelector<HTMLTextAreaElement>('.quickforge-ask-remark-input')
    if (remarkInput) remarkInput.disabled = submitting || disabled
    if (submitting) submitBtn.textContent = t('askUserSubmitting')
    else submitBtn.textContent = t('askUserSubmit')
  }

  submitBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    event.preventDefault()
    message.hidden = true
    disarmSkip()
    setSubmitting(true)
    const trimmedRemark = remark.trim()
    void Promise.resolve(deps.onSubmit(answers.map((answer) => ({ ...answer })), trimmedRemark || undefined))
      .catch(() => {
        showMessage(t('askUserFailed'))
        setSubmitting(false)
      })
  })

  skipBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    event.preventDefault()
    message.hidden = true
    if (!skipArmed) {
      skipArmed = true
      skipBtn.textContent = t('askUserSkipConfirm')
      skipArmTimer = window.setTimeout(disarmSkip, 5000)
      return
    }
    disarmSkip()
    setSubmitting(true)
    void Promise.resolve(deps.onSkip()).catch(() => {
      showMessage(t('askUserFailed'))
      setSubmitting(false)
    })
  })

  if (disabled) {
    skipBtn.disabled = true
    if (deps.disabledReason) showMessage(deps.disabledReason)
    else if (!deps.disabledReason) showMessage(t('askUserUnavailable'))
  }
  setSubmitting(false)
  renderStep()

  const messageList = panel.querySelector('.qf-message-list')
  if (messageList) messageList.append(card)
  else panel.querySelector('.qf-chat-panel')?.append(card)
  cardTextHandlers.set(card, applyComposerText)
  card.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

/**
 * Route composer text into the mounted ask card instead of the agent's steering
 * queue. Returns false when there is no card (or it cannot take the text), so
 * the caller keeps its normal behaviour.
 */
export function submitAskTextToPendingAsk(panel: HTMLElement, text: string): boolean {
  const card = panel.querySelector<HTMLElement>(ASK_CARD_SELECTOR)
  const handler = card ? cardTextHandlers.get(card) : undefined
  return handler ? handler(text) : false
}

export function removeAskUserCard(panel: HTMLElement) {
  panel.querySelectorAll(ASK_CARD_SELECTOR).forEach((element) => element.remove())
}

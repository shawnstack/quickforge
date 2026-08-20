import { t } from '@/lib/i18n'
import type { ServerAgentAskAnswer, ServerAgentPendingAsk } from '@/lib/server-agent'
import { escapeHtml } from './html'

/**
 * Ask-user card — the interactive counterpart of the approval card. Injected
 * at the message-list bottom while an `ask_user` tool call is pending; the
 * tool's execute blocks server-side until the card submits (or skips).
 *
 * Wizard interaction (per approved mockup design-mockups/ask-user-tool.html):
 * single-select questions advance automatically on pick, multi-select and
 * free-form inputs require an explicit "next" step, and the final step is a
 * review summary that submits every answer together.
 */

export type AskUserCardDeps = {
  panel: HTMLElement
  disabled?: boolean
  disabledReason?: string
  onSubmit: (answers: ServerAgentAskAnswer[]) => Promise<void> | void
  onSkip: () => Promise<void> | void
}

const ASK_CARD_SELECTOR = '.quickforge-ask-card'

/** Whether a question has an answer the user could submit. */
export function isAskAnswered(answer: ServerAgentAskAnswer | undefined): boolean {
  if (!answer) return false
  if (Array.isArray(answer.choices) && answer.choices.length > 0) return true
  return typeof answer.custom === 'string' && answer.custom.trim().length > 0
}

/** One-line answer text per question, used by the review step and tests. */
export function buildAskAnswerText(answer: ServerAgentAskAnswer | undefined): string {
  const choiceText = Array.isArray(answer?.choices) && answer.choices.length ? answer.choices.join(' · ') : ''
  const customText = typeof answer?.custom === 'string' && answer.custom.trim() ? answer.custom.trim() : ''
  return [choiceText, customText].filter(Boolean).join('　补充：')
}

export function buildAskDisplaySignature(ask: ServerAgentPendingAsk, disabled: boolean): string {
  return JSON.stringify({ askId: ask.askId, count: ask.questions.length, disabled })
}

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
            <div class="quickforge-ask-review-row">
              <div class="quickforge-ask-review-content">
                <span class="quickforge-ask-review-question">${escapeHtml(`${index + 1}. ${q.question}`)}</span>
                <span class="quickforge-ask-review-answer">${escapeHtml(buildAskAnswerText(answers[index]) || t('askUserUnanswered'))}</span>
              </div>
              <button type="button" class="quickforge-ask-review-edit" data-review-index="${index}">${escapeHtml(t('askUserEdit'))}</button>
            </div>
          `).join('')}
        </div>
      `
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
      ${allowCustom ? `<button type="button" class="quickforge-ask-custom-toggle">${escapeHtml(t('askUserCustomToggle'))}</button>
      <div class="quickforge-ask-custom" hidden>
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
    // Enter confirms and advances like the bottom-row Next button; Shift+Enter
    // keeps the default newline.
    customInput?.addEventListener('keydown', (e) => {
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
    if (advancing) return
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
  }

  const showMessage = (text: string) => {
    message.textContent = text
    message.hidden = false
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
    if (submitting) submitBtn.textContent = t('askUserSubmitting')
    else submitBtn.textContent = t('askUserSubmit')
  }

  submitBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    event.preventDefault()
    message.hidden = true
    disarmSkip()
    setSubmitting(true)
    void Promise.resolve(deps.onSubmit(answers.map((answer) => ({ ...answer }))))
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

  const messageList = panel.querySelector('message-list')
  if (messageList) messageList.append(card)
  else panel.querySelector('agent-interface')?.append(card)
  card.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

export function removeAskUserCard(panel: HTMLElement) {
  panel.querySelectorAll(ASK_CARD_SELECTOR).forEach((element) => element.remove())
}

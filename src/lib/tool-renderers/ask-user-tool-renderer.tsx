import { t, type AppTextKey } from '@/lib/i18n'
import { buildAskAnswerText } from '@/components/chat/panel-decoration/ask-user-card'
import { extractQuickForgeTiming } from '@/lib/tool-execution-events'
import {
  isRecord,
  ToolDetails,
  renderCodeBlock,
  renderStatus,
  renderToolChevron,
  renderToolIcon,
  resultText,
  stringifyValue,
  toolDisplayDetailed,
  toolStatus,
  type ToolResultLike,
} from './shared'

/**
 * ask_user 渲染器（T4 由 原 html`` 模板迁为 React，class 链保持不变）。
 *
 * 已完成的 ask_user 在 toolResult.details 持久化了结构化答案，展开历史回放
 * 只读回执布局（所见即所交）；detailed 模式始终保留原始 input/output 视图。
 */
function askUserQuestionsFromParams(params: Record<string, unknown> | undefined): string[] {
  const fromList = Array.isArray(params?.questions)
    ? params.questions.filter((q): q is Record<string, unknown> => isRecord(q) && typeof q.question === 'string' && Boolean((q.question as string).trim()))
    : []
  if (fromList.length) return fromList.map((q) => String(q.question))
  return typeof params?.question === 'string' && params.question.trim() ? [params.question] : []
}

export type AskUserReviewRows = {
  questions: { question: string }[]
  answers: ({ choices?: string[]; custom?: string } | undefined)[]
  skipped: boolean
  skipReason?: string
}

/**
 * Structured ask_user answer data from the persisted toolResult.details
 * ({askId, questions, answers, skipped, skipReason?}); null when the shape is
 * missing or malformed (pending call, legacy message).
 */
export function askUserReviewRowsFromDetails(details: unknown): AskUserReviewRows | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const record = details as Record<string, unknown>
  const rawQuestions = record.questions
  const rawAnswers = record.answers
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) return null
  if (!Array.isArray(rawAnswers)) return null
  const questions: Array<{ question: string }> = []
  for (const question of rawQuestions) {
    if (!question || typeof question !== 'object' || Array.isArray(question)) return null
    const text = (question as Record<string, unknown>).question
    if (typeof text !== 'string' || !text) return null
    questions.push({ question: text })
  }
  // Answers align with questions: trailing unanswered slots stay undefined.
  const answers = questions.map((_, index) => {
    const answer = rawAnswers[index]
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return undefined
    const entry = answer as Record<string, unknown>
    return {
      choices: Array.isArray(entry.choices)
        ? entry.choices.filter((choice): choice is string => typeof choice === 'string')
        : undefined,
      custom: typeof entry.custom === 'string' ? entry.custom : undefined,
    }
  })
  return {
    questions,
    answers,
    skipped: record.skipped === true,
    skipReason: typeof record.skipReason === 'string' && record.skipReason ? record.skipReason : undefined,
  }
}

const ASK_USER_SKIP_REASON_KEYS: Record<string, AppTextKey> = {
  timeout: 'askUserSkipReasonTimeout',
  aborted: 'askUserSkipReasonAborted',
  'no-questions': 'askUserSkipReasonNoQuestions',
}

function askUserSkipReasonText(skipReason: string | undefined): string {
  return t(skipReason && ASK_USER_SKIP_REASON_KEYS[skipReason] ? ASK_USER_SKIP_REASON_KEYS[skipReason] : 'askUserSkipReasonUser')
}

export class AskUserToolRenderer {
  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const status = toolStatus(result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const questions = askUserQuestionsFromParams(params)
    const detailed = toolDisplayDetailed()
    const input = detailed ? stringifyValue(params) : ''
    // A resolved ask_user persists its answers in details — the expanded
    // history then reuses the read-only review receipt layout (what you saw
    // is what was submitted) instead of the raw question list + output text.
    // Detailed mode always keeps the raw input/output view.
    const review = askUserReviewRowsFromDetails(result?.details)
    const reviewActive = review !== null && !detailed
    const output = reviewActive ? '' : resultText(result)
    const reviewRows = review && reviewActive
      ? review.questions.map((question, index) => ({
        question: `${index + 1}. ${question.question}`,
        answer: review.skipped ? t('askUserUnanswered') : buildAskAnswerText(review.answers[index]) || t('askUserUnanswered'),
      }))
      : []
    const reviewSkipNote = review && reviewActive && review.skipped ? askUserSkipReasonText(review.skipReason) : ''
    const summary = questions.length
      ? `${t('askUserSummaryCount', { count: String(questions.length) })}${questions[0] ? ` · ${questions[0]}` : ''}`
      : ''

    return {
      isCustom: true,
      content: (
        <div className="quickforge-local-tool-shell">
          <ToolDetails
            className="group/tool quickforge-local-tool"
            initiallyOpen={detailed}
          >
            <summary className="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
              {renderToolIcon('ask_user')}
              <span className="quickforge-tool-title min-w-0">
                <span className="quickforge-tool-label">{t('askUserTitle')}{summary ? <span className="quickforge-tool-summary-detail text-muted-foreground"> · {summary}</span> : null}</span>
                {renderToolChevron()}
                {renderStatus(status, timing)}
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              {reviewRows.length ? (
                <div className="quickforge-ask-review">
                  {reviewSkipNote ? <div className="quickforge-ask-review-answer">{reviewSkipNote}</div> : null}
                  {reviewRows.map((row, index) => (
                    <div className="quickforge-ask-review-row" key={index}>
                      <div className="quickforge-ask-review-content">
                        <span className="quickforge-ask-review-question">{row.question}</span>
                        <span className="quickforge-ask-review-answer">{row.answer}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {questions.length && !detailed && review === null ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div><div className="quickforge-ask-tool-questions">{questions.map((question, index) => <div key={index}>{question}</div>)}</div></div> : null}
              {input ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div>{renderCodeBlock(input, 'json')}</div> : null}
              {output ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('output')}</div>{renderCodeBlock(output, 'text')}</div> : null}
            </div>
          </ToolDetails>
        </div>
      ),
    }
  }
}

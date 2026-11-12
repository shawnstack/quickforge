import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { t, type AppTextKey } from '@/lib/i18n'

const SERVER_ERROR_TRANSLATIONS: Partial<Record<string, AppTextKey>> = {
  GENERATION_ALREADY_RUNNING: 'generationAlreadyRunning',
  GENERATION_STILL_RUNNING_BEFORE_ROLLBACK: 'generationStillRunning',
}

export type ServerErrorPayload = {
  error?: string
  code?: string
}

export function serverErrorMessage(payload: ServerErrorPayload | null, fallback: string): string {
  const translationKey = payload?.code ? SERVER_ERROR_TRANSLATIONS[payload.code] : undefined
  return translationKey ? t(translationKey) : payload?.error || fallback
}

export function assistantErrorMessage(errorMessage: string, model: Model<Api>): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    api: model?.api ?? 'openai-completions',
    provider: model?.provider ?? 'unknown',
    model: model?.id ?? 'unknown',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
  }
}

export function appendAssistantErrorMessageOnce(
  messages: AgentMessage[],
  errorMessage: string,
  model: Model<Api>,
  failedPrompt?: AgentMessage,
): AgentMessage[] {
  const lastMessage = messages.at(-1)
  if (lastMessage?.role === 'assistant'
    && lastMessage.stopReason === 'error'
    && lastMessage.errorMessage === errorMessage) {
    return messages
  }
  const error = assistantErrorMessage(errorMessage, model)
  if (failedPrompt) {
    // 仅客户端可见：该错误由 prompt HTTP 失败合成，服务端从未收到这条消息，
    // retryFailedPrompt 依赖它原样重发（「继续」语义对它没有意义）。
    (error as unknown as Record<string, unknown>).quickforgeFailedPrompt = failedPrompt
  }
  return [...messages, error]
}

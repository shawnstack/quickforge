/**
 * 已知上游代码异常文案的展示层国际化。
 *
 * 错误正文由 pi-ai / pi-agent-core / QuickForge 服务端与客户端以英文抛出并写入
 * 消息数据（assistant `errorMessage`）。数据层必须保持原文：持久化、客户端
 * `appendAssistantErrorMessageOnce` 去重与 subagent trace 去重（错误原因与 trace
 * 终态错误文本精确相等比较）都依赖原始字符串。本模块只在展示层（聊天错误红块、
 * subagent 错误原因卡）把「已知且稳定」的异常串映射为本地化文案；未匹配的
 * 动态正文（provider 返回的错误、模型生成内容等）原样显示。
 */
import { t } from '@/lib/i18n'

type KnownErrorRule = {
  pattern: RegExp
  translate: (match: RegExpMatchArray) => string
}

const KNOWN_ERROR_RULES: KnownErrorRule[] = [
  // pi-ai 各 provider 在 signal abort 时抛出（用户停止生成与超时中止的竞态路径）
  { pattern: /^request was aborted\.?$/i, translate: () => t('errorRequestAborted') },
  // server/ai-http-logger.mjs 流超时（idle 覆盖首事件与后续事件停滞两档）
  { pattern: /^ai stream idle timeout after (\d+)ms\.?$/i, translate: (match) => t('errorAiStreamIdleTimeout', { ms: match[1] }) },
  { pattern: /^ai stream total timeout after (\d+)ms\.?$/i, translate: (match) => t('errorAiStreamTotalTimeout', { ms: match[1] }) },
  // pi-ai 流异常结束
  { pattern: /^anthropic stream ended before message_stop\.?$/i, translate: () => t('errorAnthropicStreamEnded') },
  { pattern: /^stream ended without finish_reason\.?$/i, translate: () => t('errorStreamNoFinishReason') },
  // Node undici 网络失败的最小错误串
  { pattern: /^fetch failed\.?$/i, translate: () => t('errorFetchFailed') },
  // src/lib/server-agent.ts prompt HTTP 失败的兜底文案
  { pattern: /^failed to send prompt: http (\d+)\.?$/i, translate: (match) => t('errorSendPromptHttp', { status: match[1] }) },
]

export function translateErrorMessage(message: string | undefined | null): string {
  if (typeof message !== 'string') return ''
  const trimmed = message.trim()
  if (!trimmed) return message
  for (const rule of KNOWN_ERROR_RULES) {
    const match = trimmed.match(rule.pattern)
    if (match) return rule.translate(match)
  }
  return message
}

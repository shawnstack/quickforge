import { streamSimpleWithAiHttpLogging } from './ai-http-logger.mjs'
import { AI_SCHEDULED_TASK_PARSE_TOTAL_TIMEOUT_MS, DEFAULT_AI_MAX_RETRIES } from './ai-provider-options.mjs'
import { readStore } from './storage.mjs'
import { logger } from './utils/logger.mjs'
import { resolveModelBinding } from './model-catalog.mjs'
import { isValidCronExpression, nextCronRun } from './utils/scheduled-tasks.mjs'

// 定时任务自然语言解析（从 routes/scheduled-tasks.mjs 拆出，god-module-decomposition ①）：
// POST /api/scheduled-tasks/parse 的模型调用在这里——把中文自然语言定时任务交给
// LLM 转成 cron 任务草稿 JSON；解析失败/信息不足时返回 needMoreInfo 追问，
// 不编造 cron 表达式。AI 总预算由 AI_SCHEDULED_TASK_PARSE_TOTAL_TIMEOUT_MS 控制。

function normalizeAiJson(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

function extractTitle(instruction) {
  return instruction
    .replace(/^(请|帮我|给我|麻烦)?/, '')
    .replace(/(每天|每日|明天|今天|每周[一二三四五六日天]?|每月\d{1,2}[号日]?|每隔\d+\s*(分钟|小时)).*?(提醒我|帮我|执行|运行|生成|检查)?/, '')
    .trim()
    .slice(0, 32) || 'AI 定时任务'
}

async function getApiKey(provider) {
  try {
    const keys = await readStore('provider-keys')
    return keys?.[provider] || undefined
  } catch {
    return undefined
  }
}

export async function parseScheduledTaskInstructionWithAi(instruction, modelInput, thinkingLevel = 'off', context = {}) {
  const text = String(instruction || '').trim()
  if (!text) return { needMoreInfo: true, question: '请输入要创建的定时任务。' }
  if (!modelInput) return { needMoreInfo: true, question: '请先选择用于解析任务的大模型。' }
  const { model } = await resolveModelBinding(
    modelInput?.modelRef || modelInput?.model ? modelInput : { model: modelInput },
    { context, legacySnapshot: modelInput?.model || modelInput },
  )

  const now = new Date()
  const systemPrompt = `你是定时任务解析器。把用户的中文自然语言定时任务解析为 JSON。
只输出 JSON，不要 Markdown，不要解释。
字段：
- title: 简短任务名称
- instruction: 到时间后真正交给 AI 执行的指令，去掉时间规则，保留要做什么
- cronExpression: 5 位 cron，格式为 "分钟 小时 日 月 周"，周日用 0。不支持秒。
- scheduleRule: 给用户看的中文执行规则
- question: 如果时间或任务不明确，写一句追问
规则：
- 如果信息明确，question 为空字符串。
- 如果信息不明确，不要编造 cronExpression。
- 当前时间：${now.toISOString()}，本地时区：${Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'}。
示例输出：{"title":"生成日报","instruction":"生成销售日报","cronExpression":"0 9 * * *","scheduleRule":"每天 09:00","question":""}`

  try {
    const stream = streamSimpleWithAiHttpLogging(
      model,
      {
        systemPrompt,
        messages: [{ role: 'user', content: text, timestamp: Date.now() }],
        tools: [],
      },
      {
        apiKey: await getApiKey(model.provider),
        maxTokens: 600,
        temperature: 0,
        reasoning: thinkingLevel === 'off' ? undefined : thinkingLevel,
        maxRetries: DEFAULT_AI_MAX_RETRIES,
        maxRetryDelayMs: 60000,
        totalTimeoutMs: AI_SCHEDULED_TASK_PARSE_TOTAL_TIMEOUT_MS,
      },
    )
    const message = await stream.result()
    const content = Array.isArray(message.content)
      ? message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n')
      : ''
    const parsed = normalizeAiJson(content)
    if (!parsed) return { needMoreInfo: true, question: 'AI 没有返回有效 JSON，请重试或换一个模型。' }
    if (parsed.question) return { needMoreInfo: true, question: String(parsed.question) }
    if (!isValidCronExpression(parsed.cronExpression)) {
      return { needMoreInfo: true, question: 'AI 未能生成有效的 cron 表达式，请补充更明确的执行时间。' }
    }
    const nextRun = nextCronRun(String(parsed.cronExpression).trim())
    if (!nextRun) return { needMoreInfo: true, question: '无法计算下一次执行时间，请换一个时间规则。' }
    return {
      needMoreInfo: false,
      task: {
        title: String(parsed.title || extractTitle(text)).slice(0, 80),
        instruction: String(parsed.instruction || text).trim(),
        scheduleType: 'cron',
        scheduleRule: String(parsed.scheduleRule || parsed.cronExpression).trim(),
        cronExpression: String(parsed.cronExpression).trim(),
        nextRunAt: nextRun.toISOString(),
      },
    }
  } catch (error) {
    logger.warn('AI scheduled task parsing failed:', error?.message || error)
    return { needMoreInfo: true, question: `AI 解析失败：${error?.message || '请检查模型配置和 API Key 后重试。'}` }
  }
}

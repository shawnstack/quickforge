import { streamSimple } from '@mariozechner/pi-ai'
import { projectContextFromId, readInstructionsFile } from './project-config.mjs'
import { dataDir } from './storage.mjs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const BASE_SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer clearly and pragmatically. If the user asks for code, prefer concise working examples. When YOLO mode is enabled, you may use the local workspace tools to inspect files, edit files, and run commands in the current project.'

export async function buildSystemPrompt(projectId) {
  const parts = [BASE_SYSTEM_PROMPT]

  const globalInstructions = await readInstructionsFile(path.join(dataDir, 'AGENTS.md'))
  if (globalInstructions) {
    parts.push(`\n<user_instructions>\n${globalInstructions}\n</user_instructions>`)
  }

  if (projectId) {
    try {
      const { workspaceRoot } = await projectContextFromId(projectId)
      const projectInstructions = await readInstructionsFile(path.join(workspaceRoot, 'AGENTS.md'))
      if (projectInstructions) {
        parts.push(`\n<project_instructions>\n${projectInstructions}\n</project_instructions>`)
      }
    } catch {
      // project not found — skip
    }
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Simple title generation (from first user message)
// ---------------------------------------------------------------------------

export function generateTitle(messages) {
  const firstUser = messages.find(
    (m) => m.role === 'user' || m.role === 'user-with-attachments',
  )
  if (!firstUser) return 'New chat'
  const content = firstUser.content
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ')
    : ''
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'New chat'
  return normalized.length > 46 ? `${normalized.slice(0, 43)}...` : normalized
}

// ---------------------------------------------------------------------------
// AI title generation
// ---------------------------------------------------------------------------

function normalizeAiTitle(value) {
  return value
    .trim()
    .replace(/^[[\s"'""''`]+|[\]`\s"'""''.。,！!？?，,:：;；]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

export async function generateAiTitle(messages, model, thinkingLevel, getApiKey) {
  const firstUser = messages.find((m) => m.role === 'user' || m.role === 'user-with-attachments')
  if (!firstUser) return null

  const userText = typeof firstUser.content === 'string'
    ? firstUser.content
    : Array.isArray(firstUser.content)
      ? firstUser.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ')
      : ''

  if (!userText.trim()) return null

  const firstAssistant = messages.find((m) => m.role === 'assistant')
  let assistantReply = ''
  if (firstAssistant) {
    const content = firstAssistant.content
    if (typeof content === 'string') {
      assistantReply = content.slice(0, 2000)
    } else if (Array.isArray(content)) {
      assistantReply = content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(' ')
        .slice(0, 2000)
    }
  }

  const conversationText = assistantReply
    ? `User: ${userText.trim()}\n\nAssistant: ${assistantReply}`
    : `User: ${userText.trim()}`

  try {
    const apiKey = getApiKey ? await getApiKey(model.provider) : undefined
    const stream = streamSimple(
      model,
      {
        systemPrompt: '你是对话标题生成器。请用和用户相同的语言，根据对话主题生成 3 到 5 个词的短标题。只输出标题，不要解释，不要标点。',
        messages: [{ role: 'user', content: conversationText, timestamp: Date.now() }],
        tools: [],
      },
      {
        apiKey,
        maxTokens: 160,
        temperature: 0.2,
        reasoning: thinkingLevel === 'off' ? 'minimal' : 'low',
        maxRetryDelayMs: 60000,
      },
    )
    const titleMessage = await stream.result()
    const titleText = Array.isArray(titleMessage.content)
      ? titleMessage.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ').trim()
      : ''
    if (!titleText) return null
    const title = normalizeAiTitle(titleText)
    return title || null
  } catch (error) {
    console.warn('Failed to generate AI title:', error.message || error)
    return null
  }
}

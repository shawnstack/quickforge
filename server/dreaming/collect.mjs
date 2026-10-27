import { getSqliteStorage } from '../sqlite/database.mjs'
import { extractCompactSummaryText, isCompactSummaryMessage } from '../conversation-compaction.mjs'

// Budget is generous because the transcript only carries user turns and the
// assistant's final answers: nothing is spent on tool calls or tool output.
export const MAX_SESSION_CHARS = 30_000
export const MAX_TOTAL_CHARS = 100_000
export const MAX_SESSIONS_PER_RUN = 40
const MAX_MESSAGES_PER_SESSION = 300
export const SESSION_PREVIEW_CHARS = 1200
const USER_CHARS = 1500
// Letters needed before the detected language is trusted at all.
const MIN_LANGUAGE_SAMPLES = 12
const ASSISTANT_CHARS = 3000

function storage() {
  return getSqliteStorage()
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (typeof part === 'string' ? part : part?.type === 'text' ? String(part.text ?? '') : ''))
    .join('')
}

function clip(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 5)} ...`
}

function hasToolCall(message) {
  if (!Array.isArray(message?.content)) return false
  return message.content.some((part) => part?.type === 'toolCall' || part?.type === 'tool_call')
}

/**
 * A "final answer" is the assistant message that ends a turn: it carries text
 * and no tool call. Assistant messages that request a tool are intermediate
 * reasoning about *how* the work happened — the Dreaming prompt does not need
 * them, and dropping them removes tool payloads without any clipping heuristics.
 */
export function isFinalAnswer(message) {
  if (message?.role !== 'assistant') return false
  // Same-terminal-state rule used elsewhere: an aborted or failed message is not
  // a considered answer and must not be consolidated as one.
  if (message.stopReason === 'toolUse' || message.stopReason === 'error' || message.stopReason === 'aborted') return false
  if (hasToolCall(message)) return false
  return textOf(message.content).trim().length > 0
}

/**
 * Compact trajectory projection: user turns + assistant final answers only.
 *
 * Compaction summaries are stored as `user` role messages; they are re-emitted
 * as a dedicated `history` line with the summary body unwrapped, so the worker
 * can still reason about work that happened before the compaction boundary.
 */
export function projectMessages(messages, { sessionId, title, projectId, updatedAt }) {
  const lines = []
  lines.push(`[session:${sessionId} | 项目:${projectId || 'global'} | ${new Date(updatedAt).toISOString().slice(0, 10)}${title ? ` | ${clip(title, 80)}` : ''}]`)

  for (const message of messages) {
    if (message?.role === 'user') {
      if (isCompactSummaryMessage(message)) {
        const summary = clip(extractCompactSummaryText(message), ASSISTANT_CHARS)
        if (summary) lines.push(`history(compacted): ${summary}`)
        continue
      }
      const text = clip(textOf(message.content), USER_CHARS)
      if (text) lines.push(`user: ${text}`)
      continue
    }
    if (isFinalAnswer(message)) {
      lines.push(`assistant: ${clip(textOf(message.content), ASSISTANT_CHARS)}`)
    }
  }

  const joined = lines.join('\n')
  return joined.length <= MAX_SESSION_CHARS ? joined : `${joined.slice(0, MAX_SESSION_CHARS)}\n…(truncated)`
}

function selectSessions(handle, { from, to, limit }) {
  return handle.prepare(`SELECT scope, project_id, session_id, title, updated_at, updated_at_ms, message_count
    FROM sessions
    WHERE updated_at_ms >= ? AND updated_at_ms <= ? AND message_count > 0
    ORDER BY updated_at_ms DESC
    LIMIT ?`).all(from, to, limit)
}

function readTail(handle, row, limit) {
  return handle.prepare(`SELECT seq, message_json FROM session_messages
    WHERE scope = ? AND project_id = ? AND session_id = ?
    ORDER BY seq DESC LIMIT ?`)
    .all(row.scope, row.project_id, row.session_id, limit)
    .reverse()
    .map((messageRow) => ({ seq: Number(messageRow.seq), message: JSON.parse(messageRow.message_json) }))
}

/**
 * Collect the day's sessions into one bounded prompt transcript.
 *
 * Budget is enforced here, not by the model: sessions are taken newest-first and
 * dropped once the total budget is spent, so a burst of huge sessions degrades
 * into "fewer sessions processed" instead of an unbounded request.
 */
export function collectTranscript({ from, to, maxSessions = MAX_SESSIONS_PER_RUN, maxTotalChars = MAX_TOTAL_CHARS, handle = null } = {}) {
  const db = handle || storage()
  const rows = selectSessions(db, { from, to, limit: maxSessions })
  const blocks = []
  const sessions = []
  const userTexts = []
  let spent = 0

  for (const row of rows) {
    const tail = readTail(db, row, MAX_MESSAGES_PER_SESSION)
    if (tail.length === 0) continue
    for (const entry of tail) {
      if (entry.message?.role === 'user' && !isCompactSummaryMessage(entry.message)) {
        userTexts.push(textOf(entry.message.content))
      }
    }
    const block = projectMessages(
      tail.map((entry) => entry.message),
      {
        sessionId: row.session_id,
        title: row.title,
        projectId: row.project_id,
        updatedAt: Number(row.updated_at_ms),
      },
    )
    if (spent + block.length > maxTotalChars && blocks.length > 0) break
    blocks.push(block)
    sessions.push({
      sessionId: row.session_id,
      projectId: row.project_id,
      title: row.title,
      updatedAt: Number(row.updated_at_ms),
      messageCount: Number(row.message_count),
      chars: block.length,
      // Bounded copy of the exact text sent to the model. The window can fall out
      // of retention, so the run page cannot re-derive it later.
      preview: block.length <= SESSION_PREVIEW_CHARS ? block : `${block.slice(0, SESSION_PREVIEW_CHARS)}\n…(preview truncated)`,
    })
    spent += block.length
  }

  return {
    transcript: blocks.join('\n\n'),
    sessionCount: blocks.length,
    totalSessions: rows.length,
    chars: spent,
    sessions,
    // `null` means "could not tell" (pure code, emoji only); the prompt then
    // keeps the language unconstrained instead of guessing wrong.
    contentLanguage: detectContentLanguage(userTexts),
  }
}

/**
 * Dominant language of what the user actually wrote.
 *
 * The model used to decide this itself from a one-line hint at the end of the
 * system prompt, and consistently answered in English when the transcript mixed
 * Chinese questions with English code/identifiers. Detecting it deterministically
 * from the user turns and passing an explicit directive is both cheaper and
 * reliably obeyed.
 *
 * Only user-role text is sampled: assistant prose and code comments skew English
 * in this codebase even when the user writes Chinese.
 */
export function detectContentLanguage(userTexts) {
  let cjk = 0
  let latin = 0
  for (const text of userTexts) {
    const value = String(text ?? '')
    cjk += (value.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length
    latin += (value.match(/[A-Za-z]/g) ?? []).length
  }
  // Below this there is not enough signal to speak for the user ("ok", "1+1").
  if (cjk + latin < MIN_LANGUAGE_SAMPLES) return null
  // A CJK glyph carries roughly as much information as ~4 latin characters, so
  // compare weighted counts instead of raw character counts.
  const cjkWeight = cjk
  const latinWeight = latin / 4
  if (cjkWeight >= latinWeight * 1.2) return 'zh'
  if (latinWeight >= cjkWeight * 1.2) return 'en'
  return null
}

export function summarizeMemory(memory) {
  return `- ${memory.id} [${memory.kind}/${memory.scope}] ${clip(memory.content, 200)} (conf ${memory.confidence.toFixed(2)}, str ${memory.strength.toFixed(1)})`
}

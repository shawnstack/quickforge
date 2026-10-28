import { readDreamingNotes } from '../global-memory.mjs'
import { noteIdOf, parseNoteLines } from './notes.mjs'

/**
 * Recall is a filter over the notes block, not a search engine.
 *
 * The block is at most a few dozen bullets and it is already injected into every
 * system prompt, so `recall_experience` exists only to let the model point at it
 * explicitly ("what do I know about X") without scrolling the whole document.
 * There is no index to keep consistent, no scoring, and no state to update.
 */

export const RECALL_DEFAULT_LIMIT = 8
export const RECALL_MAX_LIMIT = 30

export const NOTE_KINDS = Object.freeze(['fact', 'preference', 'experience', 'pitfall', 'decision'])

const KIND_PREFIX = /^\[(fact|preference|experience|pitfall|decision)\]\s*/i

export function noteKindOf(line) {
  const match = KIND_PREFIX.exec(String(line ?? '').trim())
  return match ? match[1].toLowerCase() : null
}

export function noteTextOf(line) {
  return String(line ?? '').trim().replace(KIND_PREFIX, '').trim()
}

/**
 * Substring matching, deliberately: the notes are short natural-language
 * sentences in whatever language the user writes, and a synonym-free filter
 * matches what a reader would search for. Multi-word queries require every token
 * so "rollback commit" still finds "回滚 commit" but not every line with either.
 */
export function matchNoteLines(lines, { query = '', kind = null, limit = RECALL_DEFAULT_LIMIT } = {}) {
  const source = Array.isArray(lines) ? lines : []
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || RECALL_DEFAULT_LIMIT, RECALL_MAX_LIMIT))
  const normalizedQuery = String(query ?? '').trim().toLowerCase()
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  const matched = source.filter((line) => {
    if (kind && noteKindOf(line) !== kind) return false
    if (!normalizedQuery) return true
    const haystack = line.toLowerCase()
    if (haystack.includes(normalizedQuery)) return true
    return tokens.length > 1 && tokens.every((token) => haystack.includes(token))
  })
  return matched.slice(0, normalizedLimit)
}

/** Current bullets from DREAMING.md. A missing or unreadable file means "no notes". */
export async function readAutoNotes(options = {}) {
  try {
    return parseNoteLines(await readDreamingNotes(options))
  } catch {
    return []
  }
}

export async function recallExperienceNotes({ query = '', kind = null, limit = RECALL_DEFAULT_LIMIT, notes = null, ...options } = {}) {
  const lines = Array.isArray(notes) ? notes : await readAutoNotes(options)
  return matchNoteLines(lines, { query, kind, limit })
}

export function formatRecalledNote(line) {
  const kind = noteKindOf(line)
  const text = noteTextOf(line)
  return kind ? `- [${kind}] ${text}` : `- ${text}`
}

export { noteIdOf }

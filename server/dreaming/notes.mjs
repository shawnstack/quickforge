import { containsSensitiveMemory } from '../global-memory.mjs'

/**
 * The whole memory layer is a bullet list inside MEMORY.md.
 *
 * One model call reads the current bullets plus new transcripts and replies with
 * a new bullet list; this module is the only code between the model and the file.
 * It exists to keep the block machine-safe (never longer than the injection
 * budget, never able to break the surrounding manual section) - not to judge what
 * the model decided to remember.
 */

export const NOTE_SECTION_TITLE = '## 记忆笔记（Dreaming 维护，请勿手工编辑本文件）'
export const MAX_NOTE_LINES = 60
export const MAX_NOTE_LINE_CHARS = 300
/** The auto block sits inside a 16KB MEMORY.md; 3800 leaves room for the manual part. */
export const MAX_NOTE_BYTES = 3800

const BULLET_PATTERN = /^\s*[-*•]\s+(.*)$/
const FENCE_PATTERN = /^\s*```/

/**
 * Read the bullets back out of any markdown. Used for both the current auto
 * section and the model reply, so the snapshot sent to the model and the file
 * diff are parsed by exactly the same rules.
 */
export function parseNoteLines(markdown) {
  const lines = []
  let inFence = false
  for (const rawLine of String(markdown ?? '').split('\n')) {
    if (FENCE_PATTERN.test(rawLine)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = BULLET_PATTERN.exec(rawLine)
    if (!match) continue
    const text = match[1].replace(/\s+/g, ' ').trim()
    if (text) lines.push(text)
  }
  return lines
}

/**
 * Turn a model reply into the bullet list that will be written back.
 *
 * Ordering is the model's (it decides what matters most); this only enforces the
 * budget and drops entries that would leak credentials when the user asked for
 * sensitive content to be filtered.
 */
export function normalizeNoteLines(reply, { allowSensitive = true } = {}) {
  const seen = new Set()
  const lines = []
  const dropped = []
  for (const line of parseNoteLines(reply)) {
    const text = line.slice(0, MAX_NOTE_LINE_CHARS).trim()
    if (!text) continue
    if (!allowSensitive && containsSensitiveMemory(text)) {
      dropped.push({ reason: 'sensitive', content: text.slice(0, 200) })
      continue
    }
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(text)
  }
  const kept = lines.slice(0, MAX_NOTE_LINES)
  const overflow = lines.slice(MAX_NOTE_LINES)
  for (const content of overflow) dropped.push({ reason: 'over_limit', content: content.slice(0, 200) })
  return { lines: kept, dropped }
}

/**
 * Stable id for a note: notes have no identity of their own, so the id is derived
 * from the text. Used for storage keys (recall stats, delete target) and as a
 * React key. Collisions would require two identical notes, which normalization
 * already prevents.
 */
export function noteIdOf(line) {
  let hash = 0
  const text = String(line ?? '')
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0
  }
  return `note_${(hash >>> 0).toString(36)}`
}

/**
 * Render the auto section, trimming from the tail until it fits the byte budget.
 * The composition is all-or-nothing: an empty list means "remove the section",
 * never "leave a stale one".
 */
export function composeAutoSection(lines) {
  const source = Array.isArray(lines) ? lines : []
  if (source.length === 0) return ''
  const kept = []
  let bytes = Buffer.byteLength(`${NOTE_SECTION_TITLE}\n\n`, 'utf8')
  for (const line of source) {
    const cost = Buffer.byteLength(`- ${line}\n`, 'utf8')
    if (bytes + cost > MAX_NOTE_BYTES) break
    kept.push(line)
    bytes += cost
  }
  if (kept.length === 0) return ''
  return [NOTE_SECTION_TITLE, '', ...kept.map((line) => `- ${line}`)].join('\n')
}

/**
 * What changed between two runs, stored on `dreaming_runs.operations_json` so the
 * run detail page can show "这些是它新记住/忘掉的" without a per-entry table.
 */
export function diffNoteLines(before, after) {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  return {
    added: after.filter((line) => !beforeSet.has(line)),
    removed: before.filter((line) => !afterSet.has(line)),
  }
}

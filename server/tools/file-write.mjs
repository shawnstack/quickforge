/**
 * write_file and edit_file tools: workspace text writes.
 *
 * Both run under the session file lock, journal a backup before writing
 * (failure blocks the write), emit a pre-write partial update for streaming
 * ±line counts, and return the text diff in details.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveWorkspacePath, toWorkspaceRelative, assertSafeWorkspacePath, getToolWorkspaceRoot } from '../utils/workspace.mjs'
import { createTextDiff } from '../utils/text-diff.mjs'
import { backupFileBeforeWrite, recordFileAfterWrite } from '../session-file-backups.mjs'
import { withSessionFileLock } from '../session-file-lock.mjs'

// --- write_file ---
async function readTextForWrite(file) {
  const bytes = await fs.readFile(file)
  const text = bytes.toString('utf8')
  if (bytes.includes(0) || !Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Only UTF-8 text files can be written with file tools')
  return text
}

export function toolWriteFile(params, context, runtime = {}) {
  return withSessionFileLock(() => writeFileLocked(params, context, runtime))
}

async function writeFileLocked(params, context, runtime) {
  const file = resolveWorkspacePath(params?.path, context)
  await assertSafeWorkspacePath(file, context, { forWrite: true })

  const content = String(params?.content ?? '')
  const relativePath = toWorkspaceRelative(file, context)
  let oldText = ''
  let existed = true
  try {
    oldText = await readTextForWrite(file)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    existed = false
  }
  const diff = createTextDiff(oldText, content, relativePath, { oldExists: existed })

  // 写盘前先发一次 partial update，让前端在 running 阶段就能滚动显示 ±行数。
  runtime.onUpdate?.({
    content: [{ type: 'text', text: `${existed ? 'Writing' : 'Creating'} ${relativePath} (+${diff.addedLines} -${diff.removedLines})` }],
    details: { running: true, path: relativePath, project: context?.project, diff: { addedLines: diff.addedLines, removedLines: diff.removedLines } },
  })

  // Journal persistence is mandatory: failure blocks this tool write.
  // turnId groups this write under the current runPrompt turn for per-turn
  // rollback; unattributed writes (no active run) stay invisible to turn lookups.
  await backupFileBeforeWrite(context?.sessionId, file, existed ? oldText : null, {
    relativePath, workspaceRoot: getToolWorkspaceRoot(context), afterContent: content,
    turnId: context?.turnId ?? null, toolCallId: runtime?.toolCallId ?? null,
  })

  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, 'utf8')
  await recordFileAfterWrite(context?.sessionId, file)

  return {
    content: `${existed ? 'Wrote' : 'Created'} ${relativePath} (+${diff.addedLines} -${diff.removedLines})`,
    details: { path: relativePath, project: context?.project, bytes: Buffer.byteLength(content, 'utf8'), created: !existed, diff, turnId: context?.turnId ?? null },
  }
}

// --- edit_file ---
function countOccurrences(text, needle) {
  if (!needle) return 0
  let count = 0
  let index = 0
  while ((index = text.indexOf(needle, index)) !== -1) {
    count++
    index += needle.length
  }
  return count
}

function detectLineEnding(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function normalizeLineEndings(text) {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

function convertToLineEnding(text, ending) {
  const normalized = normalizeLineEndings(text)
  return ending === '\r\n' ? normalized.replaceAll('\n', '\r\n') : normalized
}

export function toolEditFile(params, context, runtime = {}) {
  return withSessionFileLock(() => editFileLocked(params, context, runtime))
}

async function editFileLocked(params, context, runtime) {
  const file = resolveWorkspacePath(params?.path, context)
  await assertSafeWorkspacePath(file, context)

  const rawOldText = String(params?.oldText ?? '')
  const rawNewText = String(params?.newText ?? '')
  const text = await readTextForWrite(file)
  const lineEnding = detectLineEnding(text)
  const oldText = convertToLineEnding(rawOldText, lineEnding)
  const newText = convertToLineEnding(rawNewText, lineEnding)
  const count = countOccurrences(text, oldText)

  if (count !== 1) {
    const rawCount = oldText === rawOldText ? count : countOccurrences(text, rawOldText)
    const suffix = rawCount !== count ? ` after normalizing line endings; raw match count was ${rawCount}` : ''
    const error = new Error(`oldText must match exactly once; found ${count} matches${suffix}`)
    error.statusCode = 400
    throw error
  }

  const nextText = text.replace(oldText, newText)
  const relativePath = toWorkspaceRelative(file, context)
  const diff = createTextDiff(text, nextText, relativePath)

  // 写盘前先发一次 partial update，让前端在 running 阶段就能滚动显示 ±行数。
  runtime.onUpdate?.({
    content: [{ type: 'text', text: `Editing ${relativePath} (+${diff.addedLines} -${diff.removedLines})` }],
    details: { running: true, path: relativePath, project: context?.project, diff: { addedLines: diff.addedLines, removedLines: diff.removedLines } },
  })

  await backupFileBeforeWrite(context?.sessionId, file, text, {
    relativePath, workspaceRoot: getToolWorkspaceRoot(context), afterContent: nextText,
    turnId: context?.turnId ?? null, toolCallId: runtime?.toolCallId ?? null,
  })

  await fs.writeFile(file, nextText, 'utf8')
  await recordFileAfterWrite(context?.sessionId, file)

  return {
    content: `Edited ${relativePath} (+${diff.addedLines} -${diff.removedLines})`,
    details: { path: relativePath, project: context?.project, replaced: count, diff, turnId: context?.turnId ?? null },
  }
}

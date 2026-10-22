import { promises as fs } from 'node:fs'
import path from 'node:path'
import { logsDir } from '../storage.mjs'

/**
 * 命令日志是命令工具唯一写到工作区之外的产物：`<dataDir>/logs/commands/*.log`。
 *
 * 这里集中维护「哪条绝对路径算命令日志」这一条判定，`read_file` 工具与
 * `/api/agents/:sessionId/command-log` 路由都必须复用它。不要在调用方另写
 * `startsWith` —— 那正是历史上出现越界读取的形态。
 */
export function isCommandLogPath(candidate) {
  if (typeof candidate !== 'string' || candidate === '') return false
  const root = path.resolve(logsDir, 'commands')
  const resolved = path.resolve(candidate)
  const relative = path.relative(root, resolved)
  return (
    relative !== ''
    && !relative.startsWith('..')
    && !path.isAbsolute(relative)
    && resolved.toLowerCase().endsWith('.log')
  )
}

const DEFAULT_LIMIT = 2000
const MAX_LIMIT = 20000

function clampLimit(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)))
}

/**
 * 读取命令日志，返回与 `/api/workspace/file` 同构的只读响应，便于直接复用 Reader
 * 面板（`ReaderTab.file`）。日志是纯文本，language 固定 `plaintext`。
 *
 * 默认只取尾部 `limit` 行：命令日志可能非常长，而查看入口的诉求是"看完整输出"，
 * 尾部窗口既覆盖了最终结果，也避免一次把几十 MB 塞进渲染进程。
 */
export async function readCommandLog(candidate, options = {}) {
  if (!isCommandLogPath(candidate)) {
    const error = new Error('Invalid command log path')
    error.statusCode = 400
    throw error
  }

  const resolved = path.resolve(candidate)
  const limit = clampLimit(options.limit)
  const offset = Math.max(1, Math.trunc(Number(options.offset)) || 1)

  const [stat, text] = await Promise.all([
    fs.stat(resolved),
    fs.readFile(resolved, 'utf8'),
  ])

  const lines = text.split(/\r?\n/)
  const selected = lines.slice(offset - 1, offset - 1 + limit)
  const truncated = offset - 1 + selected.length < lines.length

  return {
    path: resolved,
    content: selected.join('\n'),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    language: 'plaintext',
    readonly: true,
    totalLines: lines.length,
    truncated,
  }
}

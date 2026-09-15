import { promises as fs } from 'node:fs'
import path from 'node:path'
import { toWorkspaceRelative, resolveWorkspacePath, createWorkspacePathValidator } from '../utils/workspace.mjs'
import { spawn } from 'node:child_process'
import { resolveRipgrepExecutable } from '../utils/ripgrep.mjs'
import { killProcessTree } from './workspace-request-control.mjs'

const MAX_TREE_NODES = 50000

const DEFAULT_CHILDREN_LIMIT = 200

const MAX_CHILDREN_LIMIT = 500

const DEFAULT_SEARCH_LIMIT = 100

const MAX_SEARCH_LIMIT = 200

const DEFAULT_MENTION_SEARCH_LIMIT = 20

const MAX_MENTION_SEARCH_LIMIT = 50

const MAX_SEARCH_VISITED_ENTRIES = 50000

const SKIP_DIRS = new Set(['.git', 'node_modules'])

// rg 文件名搜索的护栏：60s 超时（大仓库/网络盘上 rg 可能长期不返回）+ 输出行数上限
// （防极端仓库 stdout 无界，超限即 kill 子进程并按截断结算）
const WORKSPACE_SEARCH_TIMEOUT_MS = 60_000

const WORKSPACE_SEARCH_MAX_OUTPUT_LINES = 200_000

function workspaceSearchAbortError() {
  // 客户端断开/调用方取消时按标准 AbortError 结算（非超时，不带 504）
  return Object.assign(new Error('workspace search aborted'), { code: 'ABORT_ERR', name: 'AbortError' })
}

export async function buildTreeForDirectory(dir, context, counter, validateWorkspacePath) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const nodes = []
  const sortedEntries = entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })

  for (const entry of sortedEntries) {
    if (counter.count >= MAX_TREE_NODES) break
    const fullPath = path.join(dir, entry.name)
    const relativePath = toWorkspaceRelative(fullPath, context)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      try {
        await validateWorkspacePath(fullPath, { allowSensitive: true })
        counter.count += 1
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children: await buildTreeForDirectory(fullPath, context, counter, validateWorkspacePath),
        })
      } catch {
        // Skip directories that cannot be safely resolved.
      }
    } else if (entry.isFile()) {
      try {
        await validateWorkspacePath(fullPath, { allowSensitive: true })
        counter.count += 1
        nodes.push({ name: entry.name, path: relativePath, type: 'file' })
      } catch {
        // Skip files that cannot be safely resolved.
      }
    }
  }
  return nodes
}

function parseBoundedLimit(rawValue, defaultValue, maxValue) {
  if (rawValue === null || rawValue === '') return defaultValue
  const value = Number(rawValue)
  if (!Number.isInteger(value) || value < 1) {
    const error = new Error('limit must be a positive integer')
    error.statusCode = 400
    throw error
  }
  return Math.min(value, maxValue)
}

function encodeWorkspaceCursor(offset) {
  return Buffer.from(String(offset), 'utf8').toString('base64url')
}

function decodeWorkspaceCursor(rawCursor) {
  if (!rawCursor) return 0
  let decoded
  try {
    decoded = Buffer.from(rawCursor, 'base64url').toString('utf8')
  } catch {
    const error = new Error('cursor is invalid')
    error.statusCode = 400
    throw error
  }
  if (!/^\d+$/.test(decoded)) {
    const error = new Error('cursor is invalid')
    error.statusCode = 400
    throw error
  }
  const value = Number(decoded)
  if (!Number.isSafeInteger(value) || value < 0) {
    const error = new Error('cursor is invalid')
    error.statusCode = 400
    throw error
  }
  return value
}

export function compareWorkspaceEntries(left, right) {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    || left.name.localeCompare(right.name, undefined, { sensitivity: 'variant' })
    || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}

async function workspaceEntryFromDirent(dir, entry, context, validateWorkspacePath) {
  if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) return null
  const fullPath = path.join(dir, entry.name)
  const relativePath = toWorkspaceRelative(fullPath, context)
  if (entry.isDirectory()) return { name: entry.name, path: relativePath, type: 'directory' }
  if (entry.isFile()) return { name: entry.name, path: relativePath, type: 'file' }
  if (!entry.isSymbolicLink()) return null

  try {
    await validateWorkspacePath(fullPath, { allowSensitive: true })
    const stat = await fs.stat(fullPath)
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) return null
      return { name: entry.name, path: relativePath, type: 'directory' }
    }
    if (stat.isFile()) return { name: entry.name, path: relativePath, type: 'file' }
  } catch {
    // External, broken, or inaccessible symbolic links are omitted.
  }
  return null
}

async function readWorkspaceDirectory(context, relativePath) {
  const requestedPath = relativePath?.trim() || '.'
  const directory = resolveWorkspacePath(requestedPath, context)
  const validateWorkspacePath = await createWorkspacePathValidator(context)
  await validateWorkspacePath(directory, { allowSensitive: true })
  const stat = await fs.stat(directory)
  if (!stat.isDirectory()) {
    const error = new Error('Path is not a directory')
    error.statusCode = 400
    throw error
  }
  return { directory, requestedPath: toWorkspaceRelative(directory, context), validateWorkspacePath }
}

export async function listWorkspaceChildren(context, relativePath = '.', options = {}) {
  const limit = parseBoundedLimit(options.limit ?? null, DEFAULT_CHILDREN_LIMIT, MAX_CHILDREN_LIMIT)
  const offset = decodeWorkspaceCursor(options.cursor || '')
  const { directory, requestedPath, validateWorkspacePath } = await readWorkspaceDirectory(context, relativePath)
  const dirents = await fs.readdir(directory, { withFileTypes: true })
  const entries = []
  for (const dirent of dirents) {
    const entry = await workspaceEntryFromDirent(directory, dirent, context, validateWorkspacePath)
    if (entry) entries.push(entry)
  }
  entries.sort(compareWorkspaceEntries)
  if (offset > entries.length) {
    const error = new Error('cursor is out of range')
    error.statusCode = 400
    throw error
  }
  const page = entries.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  return {
    root: context.project.name,
    path: requestedPath,
    entries: page,
    nextCursor: nextOffset < entries.length ? encodeWorkspaceCursor(nextOffset) : null,
    truncated: nextOffset < entries.length,
  }
}

export async function readValidatedWorkspaceSearchDirectory(directory, validateWorkspacePath, visitedDirectories, io = {}) {
  const realpath = io.realpath || fs.realpath
  const readdir = io.readdir || fs.readdir
  await validateWorkspacePath(directory, { allowSensitive: io.allowSensitive !== false })
  const directoryReal = await realpath(directory)
  const directoryKey = process.platform === 'win32' ? directoryReal.toLocaleLowerCase() : directoryReal
  if (visitedDirectories.has(directoryKey)) return null
  visitedDirectories.add(directoryKey)
  const dirents = await readdir(directory, { withFileTypes: true })
  return { directoryReal, dirents }
}

// rg 文件名搜索：`rg --files` 拿全量候选清单，Node 侧做与 BFS 一致的路径子串匹配。
// `--hidden --no-ignore` 对齐 BFS 不跳隐藏文件、不尊重 .gitignore 的行为；
// 两个 glob 排除对齐 SKIP_DIRS（.git/node_modules，任意层级）。
// 返回 null 表示 rg 不可用/失败，由调用方回退 BFS；被我们主动 kill（超时/abort/行数护栏）不算失败。
function searchWorkspaceWithRipgrep(executable, context, normalizedQuery, options = {}) {
  const signal = options.signal
  if (signal?.aborted) throw workspaceSearchAbortError()

  return new Promise((resolve, reject) => {
    const child = spawn(executable.command, [
      '--files',
      '--hidden',
      '--no-ignore',
      '--glob', '!node_modules/**',
      '--glob', '!.git/**',
    ], {
      cwd: context.workspaceRoot,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const results = []
    const parentDirectories = new Set()
    let stdoutBuffer = ''
    let lineCount = 0
    let truncated = false
    let killedByUs = false
    let settled = false

    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }

    const onAbort = () => {
      killedByUs = true
      killProcessTree(child)
      finish(() => reject(workspaceSearchAbortError()))
    }

    const timeout = setTimeout(() => {
      killedByUs = true
      killProcessTree(child)
      finish(() => {
        const error = new Error(`workspace search timed out after ${WORKSPACE_SEARCH_TIMEOUT_MS}ms`)
        error.statusCode = 504
        reject(error)
      })
    }, WORKSPACE_SEARCH_TIMEOUT_MS)
    timeout.unref?.()

    signal?.addEventListener('abort', onAbort)

    const consumeLine = (line) => {
      lineCount += 1
      if (lineCount > WORKSPACE_SEARCH_MAX_OUTPUT_LINES) {
        truncated = true
        killedByUs = true
        killProcessTree(child)
        finish(() => resolve({ results, truncated }))
        return
      }
      // rg 在 Windows 输出 `\` 分隔的相对路径，归一化为与 BFS（toWorkspaceRelative）一致的 `/` 风格
      const relativePath = line.replace(/\\/g, '/')
      if (relativePath.toLocaleLowerCase().includes(normalizedQuery)) {
        results.push({ name: relativePath.split('/').pop(), path: relativePath, type: 'file' })
      }
      // 父目录路径全集去重累积，扫描结束后统一推导 directory 条目（与 BFS 目录条目语义对齐）
      let separatorIndex = relativePath.lastIndexOf('/')
      while (separatorIndex > 0) {
        parentDirectories.add(relativePath.slice(0, separatorIndex))
        separatorIndex = relativePath.lastIndexOf('/', separatorIndex - 1)
      }
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (settled) return
      stdoutBuffer += chunk
      let newlineIndex = stdoutBuffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '')
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        if (line) consumeLine(line)
        if (settled) return
        newlineIndex = stdoutBuffer.indexOf('\n')
      }
    })
    // 排空 stderr，避免管道写满反向阻塞 rg
    child.stderr.on('data', () => {})

    child.once('error', () => {
      // spawn 失败（如 ENOENT）：返回 null 由上层回退 BFS
      finish(() => resolve(null))
    })

    child.once('close', (code) => {
      if (settled) return
      // rg 退出码 1 = --files 未列出任何文件（no matches 语义），输出为空时按空结果结算而非失败
      if (!killedByUs && code !== 0 && (code !== 1 || lineCount > 0)) {
        finish(() => resolve(null))
        return
      }
      if (stdoutBuffer) {
        const line = stdoutBuffer.replace(/\r$/, '')
        stdoutBuffer = ''
        if (line) consumeLine(line)
      }
      finish(() => {
        for (const directoryPath of parentDirectories) {
          if (directoryPath.toLocaleLowerCase().includes(normalizedQuery)) {
            results.push({ name: directoryPath.split('/').pop(), path: directoryPath, type: 'directory' })
          }
        }
        resolve({ results, truncated })
      })
    })
  })
}

export async function searchWorkspace(context, rawQuery, options = {}) {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : ''
  if (query.length < 2) {
    const error = new Error('query must contain at least 2 characters')
    error.statusCode = 400
    throw error
  }
  const limit = parseBoundedLimit(options.limit ?? null, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT)
  const validateWorkspacePath = await createWorkspacePathValidator(context)
  await validateWorkspacePath(context.workspaceRoot, { allowSensitive: true })
  const normalizedQuery = query.toLocaleLowerCase()

  // 优先 ripgrep（全量 --files 清单 + Node 侧子串匹配，保真 BFS 行为）；rg 不可用/失败时回退 BFS
  const executable = await resolveRipgrepExecutable()
  if (executable) {
    const ripgrepResult = await searchWorkspaceWithRipgrep(executable, context, normalizedQuery, options)
    if (ripgrepResult) {
      ripgrepResult.results.sort(compareWorkspaceEntries)
      return {
        root: context.project.name,
        query,
        entries: ripgrepResult.results.slice(0, limit),
        truncated: ripgrepResult.truncated || ripgrepResult.results.length > limit,
      }
    }
  }

  const results = []
  const pending = [context.workspaceRoot]
  const visitedDirectories = new Set()
  let visited = 0
  let traversalTruncated = false
  let hasAdditionalMatch = false

  while (pending.length > 0 && !traversalTruncated && !hasAdditionalMatch) {
    if (options.signal?.aborted) throw workspaceSearchAbortError()
    const directory = pending.pop()
    let validated
    try {
      validated = await readValidatedWorkspaceSearchDirectory(directory, validateWorkspacePath, visitedDirectories)
    } catch {
      continue
    }
    if (!validated) continue
    const { dirents } = validated
    dirents.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
      || left.name.localeCompare(right.name, undefined, { sensitivity: 'variant' })
      || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    const childDirectories = []
    for (const dirent of dirents) {
      if (visited >= MAX_SEARCH_VISITED_ENTRIES) {
        traversalTruncated = true
        break
      }
      visited += 1
      const entry = await workspaceEntryFromDirent(directory, dirent, context, validateWorkspacePath)
      if (!entry) continue
      if (entry.path.toLocaleLowerCase().includes(normalizedQuery) || entry.name.toLocaleLowerCase().includes(normalizedQuery)) {
        results.push(entry)
        if (results.length > limit) {
          hasAdditionalMatch = true
          break
        }
      }
      if (entry.type === 'directory') childDirectories.push(path.join(directory, dirent.name))
    }
    for (let index = childDirectories.length - 1; index >= 0; index -= 1) pending.push(childDirectories[index])
  }

  results.sort(compareWorkspaceEntries)
  return {
    root: context.project.name,
    query,
    entries: results.slice(0, limit),
    truncated: traversalTruncated || hasAdditionalMatch,
  }}

function mentionSearchRank(entry, normalizedQuery) {
  const name = entry.name.toLocaleLowerCase()
  const relativePath = entry.path.toLocaleLowerCase()
  if (name === normalizedQuery) return 0
  if (name.startsWith(normalizedQuery)) return 1
  if (name.includes(normalizedQuery)) return 2
  return relativePath.startsWith(normalizedQuery) ? 3 : 4
}

function compareMentionSearchEntries(left, right, normalizedQuery) {
  return mentionSearchRank(left, normalizedQuery) - mentionSearchRank(right, normalizedQuery)
    || left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
    || left.path.localeCompare(right.path, undefined, { sensitivity: 'variant' })
    || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}

async function mentionSearchEntryFromDirent(directory, dirent, context, validateWorkspacePath) {
  if (dirent.isDirectory() && SKIP_DIRS.has(dirent.name)) return null
  const fullPath = path.join(directory, dirent.name)
  const relativePath = toWorkspaceRelative(fullPath, context)
  try {
    await validateWorkspacePath(fullPath)
    const stat = await fs.stat(fullPath)
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(dirent.name)) return null
      if (dirent.isSymbolicLink()) {
        const workspaceReal = await fs.realpath(context.workspaceRoot)
        const targetPaths = [
          [workspaceReal, await fs.realpath(fullPath)],
          [context.workspaceRoot, path.resolve(directory, await fs.readlink(fullPath))],
        ]
        if (targetPaths.some(([root, target]) => path.relative(root, target).split(path.sep).some((part) => SKIP_DIRS.has(part)))) return null
      }
      return { name: dirent.name, path: relativePath, type: 'directory', fullPath }
    }
    if (stat.isFile()) return { name: dirent.name, path: relativePath, type: 'file' }
  } catch {
    // Sensitive, external, broken, or inaccessible entries are omitted.
  }
  return null
}

async function readMentionWorkspaceDirectory(context, relativePath) {
  const requestedPath = relativePath?.trim() || '.'
  const directory = resolveWorkspacePath(requestedPath, context)
  const validateWorkspacePath = await createWorkspacePathValidator(context)
  await validateWorkspacePath(directory)
  const stat = await fs.stat(directory)
  if (!stat.isDirectory()) {
    const error = new Error('Path is not a directory')
    error.statusCode = 400
    throw error
  }
  return { directory, requestedPath: toWorkspaceRelative(directory, context), validateWorkspacePath }
}

export async function listWorkspaceMentionChildren(context, relativePath = '.') {
  const { directory, requestedPath, validateWorkspacePath } = await readMentionWorkspaceDirectory(context, relativePath)
  const dirents = await fs.readdir(directory, { withFileTypes: true })
  const entries = []
  for (const dirent of dirents) {
    const entry = await mentionSearchEntryFromDirent(directory, dirent, context, validateWorkspacePath)
    if (!entry) continue
    entries.push({ name: entry.name, path: entry.path, type: entry.type })
  }
  entries.sort(compareWorkspaceEntries)
  return {
    root: context.project.name,
    path: requestedPath,
    entries,
  }
}

export async function searchWorkspaceMentions(context, rawQuery, options = {}) {
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : ''
  if (query.length < 2) {
    const error = new Error('query must contain at least 2 characters')
    error.statusCode = 400
    throw error
  }
  const limit = parseBoundedLimit(options.limit ?? null, DEFAULT_MENTION_SEARCH_LIMIT, MAX_MENTION_SEARCH_LIMIT)
  const validateWorkspacePath = await createWorkspacePathValidator(context)
  await validateWorkspacePath(context.workspaceRoot)
  const normalizedQuery = query.toLocaleLowerCase()
  const results = []
  const pending = [context.workspaceRoot]
  const visitedDirectories = new Set()
  let visited = 0
  let traversalTruncated = false

  while (pending.length > 0 && !traversalTruncated) {
    const directory = pending.pop()
    let validated
    try {
      validated = await readValidatedWorkspaceSearchDirectory(directory, validateWorkspacePath, visitedDirectories, { allowSensitive: false })
    } catch {
      continue
    }
    if (!validated) continue
    const { dirents } = validated
    dirents.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
      || left.name.localeCompare(right.name, undefined, { sensitivity: 'variant' })
      || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    const childDirectories = []
    for (const dirent of dirents) {
      if (visited >= MAX_SEARCH_VISITED_ENTRIES) {
        traversalTruncated = true
        break
      }
      visited += 1
      const entry = await mentionSearchEntryFromDirent(directory, dirent, context, validateWorkspacePath)
      if (!entry) continue
      if (entry.type === 'directory') {
        childDirectories.push(entry.fullPath)
      } else if (entry.path.toLocaleLowerCase().includes(normalizedQuery) || entry.name.toLocaleLowerCase().includes(normalizedQuery)) {
        results.push(entry)
      }
    }
    for (let index = childDirectories.length - 1; index >= 0; index -= 1) pending.push(childDirectories[index])
  }

  results.sort((left, right) => compareMentionSearchEntries(left, right, normalizedQuery))
  return {
    root: context.project.name,
    query,
    entries: results.slice(0, limit),
    truncated: traversalTruncated || results.length > limit,
  }
}

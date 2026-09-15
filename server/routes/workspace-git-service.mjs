import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import {
  createWorkspacePathValidator,
  resolveWorkspacePath,
  assertSafeWorkspacePath,
  toWorkspaceRelative,
} from '../utils/workspace.mjs'
import { readStore } from '../storage.mjs'
import { streamSimpleWithAiHttpLogging } from '../ai-http-logger.mjs'
import { DEFAULT_AI_MAX_RETRIES, AI_GIT_COMMIT_MESSAGE_TOTAL_TIMEOUT_MS } from '../ai-provider-options.mjs'
import { logger } from '../utils/logger.mjs'
import { killProcessTree } from './workspace-request-control.mjs'

const DEFAULT_GIT_TIMEOUT_MS = 2 * 60 * 1000

const MAX_GIT_LINE_COUNT_FILES = 100

const MAX_GIT_LINE_COUNT_FILE_BYTES = 1024 * 1024

const MAX_GIT_LINE_COUNT_TOTAL_BYTES = 10 * 1024 * 1024

const GIT_LINE_COUNT_CONCURRENCY = 6

function gitAbortError() {
  // 客户端断开/调用方取消时按标准 AbortError 结算（非超时，不带 504）
  return Object.assign(new Error('git request aborted'), { code: 'ABORT_ERR', name: 'AbortError' })
}

export function git(args, cwd, options = {}) {
  const signal = options.signal
  if (signal?.aborted) return Promise.reject(gitAbortError())
  return new Promise((resolve, reject) => {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : DEFAULT_GIT_TIMEOUT_MS
    const child = spawn('git', args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
      },
    })
    const stdout = []
    const stderr = []
    let settled = false
    const onAbort = () => {
      killProcessTree(child)
      finish(() => reject(gitAbortError()))
    }
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const timeout = setTimeout(() => {
      killProcessTree(child)
      finish(() => {
        const error = new Error(`git ${args.join(' ')} timed out after ${timeoutMs}ms`)
        error.statusCode = 504
        error.code = 'GIT_TIMEOUT'
        reject(error)
      })
    }, timeoutMs)
    timeout.unref?.()
    signal?.addEventListener('abort', onAbort)

    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', (error) => finish(() => reject(error)))
    child.once('close', (code) => finish(() => {
      const out = Buffer.concat(stdout)
      const err = Buffer.concat(stderr).toString('utf8').trim()
      if (code === 0 || options.allowFailure) {
        resolve({ code, stdout: out, stderr: err })
      } else {
        const error = new Error(err || `git ${args.join(' ')} failed`)
        error.statusCode = 400
        reject(error)
      }
    }))
  })
}

export async function isGitRepository(workspaceRoot, signal) {
  const result = await git(['rev-parse', '--is-inside-work-tree'], workspaceRoot, { allowFailure: true, signal })
  return result.code === 0 && result.stdout.toString('utf8').trim() === 'true'
}

function classifyStatus(x, y) {
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflicted'
  if (x === '?' && y === '?') return 'untracked'
  if (x === 'R' || y === 'R') return 'renamed'
  if (x === 'A' || y === 'A') return 'added'
  if (x === 'D' || y === 'D') return 'deleted'
  return 'modified'
}

// `git status --porcelain=v1 --branch -z` 的第一条记录是 `## ...` 头记录（不是文件条目）
function parseGitStatusHead(buffer) {
  const header = (buffer.toString('utf8').split('\0')[0] ?? '').trim()
  if (!header.startsWith('## ')) return undefined
  const rest = header.slice(3).trim()
  if (rest === 'HEAD (no branch)') return { branch: undefined, detached: true }
  if (rest.startsWith('No commits yet on ')) {
    const branch = rest.slice('No commits yet on '.length).trim()
    return { branch: branch || undefined, detached: false }
  }
  // 有 upstream 时形如 `dev...origin/dev [ahead 3]`；分支名不允许含 `..`，按 `...` 取前段
  const branch = rest.split('...')[0].trim()
  return { branch: branch || undefined, detached: false }
}

function parseGitStatus(buffer) {
  const entries = buffer.toString('utf8').split('\0').filter(Boolean)
  const files = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry.startsWith('## ')) continue // --branch 头记录，跳过以免被当成文件条目
    const x = entry[0] || ' '
    const y = entry[1] || ' '
    const status = classifyStatus(x, y)
    const file = {
      path: entry.slice(3).replace(/\\/g, '/'),
      status,
      staged: x !== ' ' && x !== '?',
      unstaged: y !== ' ' && y !== '?',
      conflict: status === 'conflicted',
      x,
      y,
    }
    if (status === 'renamed') {
      const oldPath = entries[index + 1]
      if (oldPath) {
        file.oldPath = oldPath.replace(/\\/g, '/')
        index += 1
      }
    }
    files.push(file)
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: 'base' }))
}

async function currentGitHead(workspaceRoot, signal) {
  const result = await git(['branch', '--show-current'], workspaceRoot, { allowFailure: true, signal })
  const branch = result.stdout.toString('utf8').trim()
  if (branch) return { branch, detached: false }
  const head = await git(['rev-parse', '--short', 'HEAD'], workspaceRoot, { allowFailure: true, signal })
  const commit = head.stdout.toString('utf8').trim()
  return { branch: commit ? `HEAD ${commit}` : undefined, detached: Boolean(commit) }
}

async function currentGitBranch(workspaceRoot, signal) {
  return (await currentGitHead(workspaceRoot, signal)).branch
}

export async function assertValidBranchName(workspaceRoot, branch) {
  const value = typeof branch === 'string' ? branch.trim() : ''
  if (!value || value.length > 240 || /[\0\r\n]/.test(value)) {
    const error = new Error('Invalid branch name')
    error.statusCode = 400
    throw error
  }
  const result = await git(['check-ref-format', '--branch', value], workspaceRoot, { allowFailure: true })
  if (result.code !== 0) {
    const error = new Error('Invalid branch name')
    error.statusCode = 400
    throw error
  }
  return value
}

function branchSortKey(branch, current) {
  return [branch.name === current ? '0' : '1', branch.remote ? '1' : '0', branch.name.toLowerCase()].join(':')
}

export async function listGitBranches(context, options = {}) {
  const signal = options.signal
  if (!(await isGitRepository(context.workspaceRoot, signal))) return { isGitRepository: false, branches: [] }
  const current = await currentGitBranch(context.workspaceRoot, signal)
  const result = await git([
    'for-each-ref',
    '--format=%(refname)%1f%(refname:short)%1f%(objectname:short)%1f%(committerdate:iso8601-strict)%1f%(upstream:short)',
    'refs/heads',
    'refs/remotes',
  ], context.workspaceRoot, { signal })
  const branches = result.stdout.toString('utf8').split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [refname = '', name = '', commit = '', lastCommitAt = '', upstream = ''] = line.split('\x1f')
      const remote = refname.startsWith('refs/remotes/')
      return {
        name,
        current: name === current,
        remote,
        upstream: upstream || undefined,
        commit: commit || undefined,
        lastCommitAt: lastCommitAt || undefined,
      }
    })
    .filter((branch) => branch.name && !branch.name.endsWith('/HEAD'))
    .sort((left, right) => branchSortKey(left, current).localeCompare(branchSortKey(right, current)))
  return { isGitRepository: true, current, branches }
}

function parseGitDecorations(raw) {
  if (!raw) return []
  return raw.split(', ')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry === 'HEAD') return { name: 'HEAD', type: 'head' }
      if (entry.startsWith('HEAD -> ')) return { name: entry.slice('HEAD -> '.length), type: 'branch' }
      if (entry.startsWith('tag: ')) return { name: entry.slice('tag: '.length), type: 'tag' }
      if (entry.includes('/')) return { name: entry, type: 'remote' }
      return { name: entry, type: 'branch' }
    })
}

export async function listGitLog(context, options = {}) {
  const signal = options.signal
  if (!(await isGitRepository(context.workspaceRoot, signal))) return { isGitRepository: false, commits: [] }
  const result = await git([
    'log',
    '--all',
    '--date=iso-strict',
    '--max-count=200',
    '--format=%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e',
  ], context.workspaceRoot, { allowFailure: true, signal })
  if (result.code !== 0) return { isGitRepository: true, commits: [] }
  const commits = result.stdout.toString('utf8').split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', shortHash = '', parents = '', author = '', date = '', decorations = '', subject = ''] = record.split('\x1f')
      return {
        hash,
        shortHash,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        author,
        date,
        subject,
        decorations: parseGitDecorations(decorations),
      }
    })
  return { isGitRepository: true, commits }
}

function countGitStatus(files) {
  return files.reduce((counts, file) => {
    if (file.conflict) counts.conflicts += 1
    else if (file.status === 'untracked') counts.untracked += 1
    else {
      if (file.staged) counts.staged += 1
      if (file.unstaged) counts.unstaged += 1
    }
    counts.total += 1
    return counts
  }, { staged: 0, unstaged: 0, untracked: 0, conflicts: 0, total: 0 })
}

function countTextLines(text) {
  if (text.length === 0) return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

// numstat 的路径列对 rename 用 "prefix/{old => new}" 或 "old => new" 形式，取新路径
function numstatNewPath(rawPath) {
  const arrow = rawPath.indexOf(' => ')
  if (arrow < 0) return rawPath
  const head = rawPath.slice(0, arrow)
  const tail = rawPath.slice(arrow + 4)
  const brace = head.lastIndexOf('{')
  if (brace < 0) return tail
  return `${head.slice(0, brace)}${tail.replace(/\}$/, '')}`
}

// 工作区 vs HEAD 的每个文件增删行数（口径与 git diff --numstat 一致）
async function collectNumstat(context, signal) {
  const map = new Map()
  const result = await git(['diff', 'HEAD', '--numstat', '-z'], context.workspaceRoot, { allowFailure: true, signal })
  if (result.code !== 0) return map
  const records = result.stdout.toString('utf8').split('\0').filter(Boolean)
  for (const record of records) {
    const fields = record.split('\t')
    if (fields.length < 3) continue
    const added = fields[0]
    const removed = fields[1]
    const rawPath = fields.slice(2).join('\t')
    if (added === '-' || removed === '-') continue // 二进制文件
    const additions = Number(added)
    const deletions = Number(removed)
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue
    map.set(numstatNewPath(rawPath), { additions, deletions })
  }
  return map
}

async function readUtf8FileAtMost(fullPath, maxBytes) {
  if (maxBytes === 0) return ''
  const handle = await fs.open(fullPath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    let offset = 0
    while (offset < maxBytes) {
      const { bytesRead } = await handle.read(buffer, offset, maxBytes - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return buffer.subarray(0, offset).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function poolMap(items, fn, concurrency) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

// 未跟踪文件不在 numstat 中，在有界预算内按工作区文件行数估算新增行
async function collectWorkspaceLineCounts(context, files) {
  const candidates = files
    .filter((file) => file.status === 'untracked' || file.status === 'added')
    .slice(0, MAX_GIT_LINE_COUNT_FILES)
  if (candidates.length === 0) return new Map()

  const validateWorkspacePath = await createWorkspacePathValidator(context)
  const inspected = await poolMap(candidates, async (file) => {
    try {
      const fullPath = resolveWorkspacePath(file.path, context)
      await validateWorkspacePath(fullPath, { allowSensitive: true })
      const stat = await fs.stat(fullPath)
      if (!stat.isFile() || stat.size > MAX_GIT_LINE_COUNT_FILE_BYTES) return null
      return { file, fullPath, size: stat.size }
    } catch {
      return null
    }
  }, GIT_LINE_COUNT_CONCURRENCY)

  let totalBytes = 0
  const selected = []
  for (const entry of inspected) {
    if (!entry || totalBytes + entry.size > MAX_GIT_LINE_COUNT_TOTAL_BYTES) continue
    totalBytes += entry.size
    selected.push(entry)
  }

  const counts = await poolMap(selected, async ({ file, fullPath, size }) => {
    try {
      const stat = await fs.stat(fullPath)
      if (!stat.isFile() || stat.size > size) return null
      const content = await readUtf8FileAtMost(fullPath, size)
      return [file.path, countTextLines(content)]
    } catch {
      return null
    }
  }, GIT_LINE_COUNT_CONCURRENCY)
  return new Map(counts.filter(Boolean))
}

export async function listGitStatus(context, options = {}) {
  const signal = options.signal
  // `git status` 的退出码同时用于判定仓库（非仓库为 128），省掉一次 rev-parse 子进程
  const result = await git(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--branch'],
    context.workspaceRoot,
    { allowFailure: true, signal },
  )
  if (result.code !== 0) return { isGitRepository: false, files: [] }
  const files = parseGitStatus(result.stdout)
  if (options.includeFileStats !== false) {
    const numstat = await collectNumstat(context, signal)
    const fallbackFiles = files.filter((file) => !numstat.has(file.path))
    const workspaceLineCounts = await collectWorkspaceLineCounts(context, fallbackFiles)
    for (const file of files) {
      const entry = numstat.get(file.path)
      if (entry) {
        file.additions = entry.additions
        file.deletions = entry.deletions
        continue
      }
      const count = workspaceLineCounts.get(file.path)
      if (typeof count === 'number') {
        file.additions = count
        file.deletions = 0
      }
    }
  }
  const parsedHead = parseGitStatusHead(result.stdout)
  // 分离 HEAD 的头记录只有 `HEAD (no branch)`：保留既有 `HEAD <short-sha>` 标签
  const head = !parsedHead || parsedHead.detached ? await currentGitHead(context.workspaceRoot, signal) : parsedHead
  return {
    isGitRepository: true,
    branch: head.branch,
    detached: head.detached,
    counts: countGitStatus(files),
    files,
  }
}

async function assertGitRepository(context) {
  if (await isGitRepository(context.workspaceRoot)) return
  const error = new Error('Not a Git repository')
  error.statusCode = 400
  throw error
}

function normalizeCommitMessage(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    const error = new Error('Commit message is required')
    error.statusCode = 400
    throw error
  }
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').slice(0, 4000)
}

async function hasStagedChanges(context) {
  const result = await git(['diff', '--cached', '--quiet'], context.workspaceRoot, { allowFailure: true })
  return result.code === 1
}

async function assertAttachedGitHead(context) {
  const head = await currentGitHead(context.workspaceRoot)
  if (!head.detached) return head
  const error = new Error('Cannot commit or push while HEAD is detached')
  error.statusCode = 400
  throw error
}

export async function commitGitChanges(context, message, includeUnstaged) {
  await assertGitRepository(context)
  await assertAttachedGitHead(context)
  const commitMessage = normalizeCommitMessage(message)
  if (includeUnstaged) await git(['add', '-A'], context.workspaceRoot)
  if (!(await hasStagedChanges(context))) {
    const error = new Error('No staged changes to commit')
    error.statusCode = 400
    throw error
  }
  await git(['commit', '-m', commitMessage], context.workspaceRoot)
  return listGitStatus(context)
}

async function normalizeGitOperationPath(context, value) {
  const relativePath = typeof value === 'string' ? value.trim().replace(/\\/g, '/') : ''
  if (!relativePath || relativePath === '.') {
    const error = new Error('path is required')
    error.statusCode = 400
    throw error
  }
  const file = resolveWorkspacePath(relativePath, context)
  await assertSafeWorkspacePath(file, context, { allowSensitive: true, ignoreMissing: true })
  return toWorkspaceRelative(file, context)
}

export async function stageGitPath(context, value) {
  await assertGitRepository(context)
  const relativePath = await normalizeGitOperationPath(context, value)
  await git(['add', '-A', '--', relativePath], context.workspaceRoot)
  return listGitStatus(context)
}

export async function stageAllGitChanges(context) {
  await assertGitRepository(context)
  await git(['add', '-A'], context.workspaceRoot)
  return listGitStatus(context)
}

export async function unstageGitPath(context, value) {
  await assertGitRepository(context)
  const relativePath = await normalizeGitOperationPath(context, value)
  await git(['restore', '--staged', '--', relativePath], context.workspaceRoot)
  return listGitStatus(context)
}

export async function unstageAllGitChanges(context) {
  await assertGitRepository(context)
  await git(['restore', '--staged', '--', '.'], context.workspaceRoot)
  return listGitStatus(context)
}

export async function restoreGitPath(context, value) {
  await assertGitRepository(context)
  const relativePath = await normalizeGitOperationPath(context, value)
  const status = await listGitStatus(context)
  const changedFile = status.files.find((file) => file.path === relativePath || file.oldPath === relativePath)
  if (!changedFile) return status

  if (changedFile.status === 'untracked') {
    const file = resolveWorkspacePath(changedFile.path, context)
    await assertSafeWorkspacePath(file, context, { allowSensitive: true, ignoreMissing: true })
    await fs.rm(file, { recursive: true, force: true })
    return listGitStatus(context)
  }

  const targets = [...new Set([changedFile.path, changedFile.oldPath].filter(Boolean))]
  if (changedFile.staged) {
    await git(['restore', '--staged', '--', ...targets], context.workspaceRoot, { allowFailure: true })
  }

  if (changedFile.status === 'added') {
    await git(['clean', '-fd', '--', changedFile.path], context.workspaceRoot)
    return listGitStatus(context)
  }

  if (changedFile.oldPath) {
    await git(['restore', '--worktree', '--', changedFile.oldPath], context.workspaceRoot, { allowFailure: true })
    await git(['clean', '-fd', '--', changedFile.path], context.workspaceRoot, { allowFailure: true })
  } else {
    await git(['restore', '--worktree', '--', changedFile.path], context.workspaceRoot)
  }
  return listGitStatus(context)
}

export async function restoreAllGitChanges(context) {
  await assertGitRepository(context)
  await git(['restore', '--staged', '--', '.'], context.workspaceRoot, { allowFailure: true })
  await git(['restore', '--worktree', '--', '.'], context.workspaceRoot, { allowFailure: true })
  await git(['clean', '-fd'], context.workspaceRoot)
  return listGitStatus(context)
}

export async function pushGitBranch(context) {
  await assertGitRepository(context)
  await assertAttachedGitHead(context)
  await git(['push'], context.workspaceRoot)
  return listGitStatus(context)
}

async function getApiKey(provider) {
  try {
    const keys = await readStore('provider-keys')
    return keys?.[provider] || undefined
  } catch {
    return undefined
  }
}

function trimForPrompt(text, max = 14000) {
  const raw = String(text || '').trim()
  if (raw.length <= max) return raw
  return `${raw.slice(0, max)}\n\n[Diff truncated]`
}

function normalizeAiCommitMessage(text) {
  const raw = String(text || '').trim()
    .replace(/^```(?:text)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const lines = raw.split('\n').map((line) => line.trimEnd())
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const message = lines.join('\n').trim().slice(0, 2000)
  if (!message) {
    const error = new Error('AI did not generate a commit message')
    error.statusCode = 502
    throw error
  }
  return message
}

export async function generateGitCommitMessage(context, model, thinkingLevel = 'off', includeUnstaged = false) {
  await assertGitRepository(context)
  if (!model) {
    const error = new Error('Please configure a default model first')
    error.statusCode = 400
    throw error
  }

  const status = await listGitStatus(context)
  if (!status.counts?.total) {
    const error = new Error('No Git changes to summarize')
    error.statusCode = 400
    throw error
  }

  const cachedStat = (await git(['diff', '--cached', '--stat'], context.workspaceRoot, { allowFailure: true })).stdout.toString('utf8')
  const cachedDiff = (await git(['diff', '--cached'], context.workspaceRoot, { allowFailure: true })).stdout.toString('utf8')
  const worktreeStat = includeUnstaged
    ? (await git(['diff', '--stat'], context.workspaceRoot, { allowFailure: true })).stdout.toString('utf8')
    : ''
  const worktreeDiff = includeUnstaged
    ? (await git(['diff'], context.workspaceRoot, { allowFailure: true })).stdout.toString('utf8')
    : ''
  const selectedFiles = includeUnstaged ? status.files : status.files.filter((file) => file.staged)
  if (!selectedFiles.length) {
    const error = new Error('No staged changes to summarize')
    error.statusCode = 400
    throw error
  }
  const files = selectedFiles.map((file) => `- ${file.status}${file.staged ? ' staged' : ''}${file.unstaged ? ' unstaged' : ''}: ${file.oldPath ? `${file.oldPath} -> ` : ''}${file.path}`).join('\n')
  const systemPrompt = `You generate Git commit messages.
Return only the commit message, no Markdown, no explanation.
Use Conventional Commit style when possible, for example: feat: add git tools summary.
Keep the subject under 72 characters. Add a short body only if it is useful.`
  const userPrompt = `Current branch: ${status.branch || 'unknown'}

Changed files:
${files}

Staged diff stat:
${cachedStat || '(none)'}

Staged diff:
${trimForPrompt(cachedDiff)}

Unstaged diff stat:
${worktreeStat || '(none)'}

Unstaged diff:
${trimForPrompt(worktreeDiff)}`

  try {
    const stream = streamSimpleWithAiHttpLogging(
      model,
      {
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
        tools: [],
      },
      {
        apiKey: await getApiKey(model.provider),
        maxTokens: 500,
        temperature: 0,
        reasoning: thinkingLevel === 'off' ? undefined : thinkingLevel,
        maxRetries: DEFAULT_AI_MAX_RETRIES,
        maxRetryDelayMs: 60000,
        totalTimeoutMs: AI_GIT_COMMIT_MESSAGE_TOTAL_TIMEOUT_MS,
      },
    )
    const message = await stream.result()
    const content = Array.isArray(message.content)
      ? message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n')
      : ''
    return normalizeAiCommitMessage(content)
  } catch (error) {
    if (error?.statusCode) throw error
    logger.warn('AI commit message generation failed:', error?.message || error)
    const wrapped = new Error(`AI generation failed: ${error?.message || 'check model configuration and API key'}`)
    wrapped.statusCode = 502
    throw wrapped
  }
}

export async function readGitFile(workspaceRoot, ref, relativePath, signal) {
  const result = await git(['show', `${ref}:${relativePath}`], workspaceRoot, { allowFailure: true, signal })
  return result.code === 0 ? result.stdout.toString('utf8') : ''
}

export async function commitAndPushGitChanges(context, message, includeUnstaged) {
  const committedStatus = await commitGitChanges(context, message, includeUnstaged)
  try {
    const pushedStatus = await pushGitBranch(context)
    return { ...pushedStatus, committed: true, pushed: true }
  } catch (error) {
    return {
      ...committedStatus,
      committed: true,
      pushed: false,
      pushError: error?.message || 'Push failed',
    }
  }
}

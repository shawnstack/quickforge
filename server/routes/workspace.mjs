import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import { sendJson, readJsonBody } from '../utils/response.mjs'
import { projectContextFromId } from '../project-config.mjs'
import { readStore } from '../storage.mjs'
import { logger } from '../utils/logger.mjs'
import { openPathInFileManager, openPathInIDEA, openPathInVSCode } from '../utils/platform.mjs'
import {
  assertSafeWorkspacePath,
  resolveWorkspacePath,
  toWorkspaceRelative,
} from '../utils/workspace.mjs'

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024
const MAX_STATIC_PREVIEW_BYTES = 50 * 1024 * 1024
const PREVIEW_ALLOWED_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.txt', '.md'])
const MAX_TREE_NODES = 50000
const SKIP_DIRS = new Set(['.git', 'node_modules'])

const extensionLanguageMap = new Map([
  ['ts', 'typescript'], ['tsx', 'typescript'], ['js', 'javascript'], ['jsx', 'javascript'],
  ['mjs', 'javascript'], ['cjs', 'javascript'], ['json', 'json'], ['jsonc', 'json'],
  ['css', 'css'], ['scss', 'scss'], ['less', 'less'], ['html', 'html'], ['htm', 'html'],
  ['md', 'markdown'], ['markdown', 'markdown'], ['py', 'python'], ['rb', 'ruby'], ['go', 'go'],
  ['rs', 'rust'], ['java', 'java'], ['c', 'c'], ['h', 'c'], ['cpp', 'cpp'], ['cc', 'cpp'],
  ['cxx', 'cpp'], ['hpp', 'cpp'], ['cs', 'csharp'], ['php', 'php'], ['swift', 'swift'],
  ['kt', 'kotlin'], ['kts', 'kotlin'], ['sh', 'shell'], ['bash', 'shell'], ['zsh', 'shell'],
  ['ps1', 'powershell'], ['yml', 'yaml'], ['yaml', 'yaml'], ['xml', 'xml'], ['sql', 'sql'],
  ['toml', 'toml'], ['ini', 'ini'], ['env', 'ini'],
])

function languageFromPath(filePath) {
  const fileName = path.basename(filePath).toLowerCase()
  if (fileName === 'dockerfile' || fileName.endsWith('.dockerfile')) return 'dockerfile'
  const extension = fileName.includes('.') ? fileName.split('.').pop() : fileName
  return extensionLanguageMap.get(extension) || 'plaintext'
}

function previewContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
  }
  return map[ext] || 'application/octet-stream'
}

async function projectContextFromUrl(url) {
  const projectId = url.searchParams.get('projectId')
  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  return projectContextFromId(projectId)
}

function git(args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      const out = Buffer.concat(stdout)
      const err = Buffer.concat(stderr).toString('utf8').trim()
      if (code === 0 || options.allowFailure) {
        resolve({ code, stdout: out, stderr: err })
      } else {
        const error = new Error(err || `git ${args.join(' ')} failed`)
        error.statusCode = 400
        reject(error)
      }
    })
  })
}

async function isGitRepository(workspaceRoot) {
  const result = await git(['rev-parse', '--is-inside-work-tree'], workspaceRoot, { allowFailure: true })
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

function parseGitStatus(buffer) {
  const entries = buffer.toString('utf8').split('\0').filter(Boolean)
  const files = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
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

async function currentGitHead(workspaceRoot) {
  const result = await git(['branch', '--show-current'], workspaceRoot, { allowFailure: true })
  const branch = result.stdout.toString('utf8').trim()
  if (branch) return { branch, detached: false }
  const head = await git(['rev-parse', '--short', 'HEAD'], workspaceRoot, { allowFailure: true })
  const commit = head.stdout.toString('utf8').trim()
  return { branch: commit ? `HEAD ${commit}` : undefined, detached: Boolean(commit) }
}

async function currentGitBranch(workspaceRoot) {
  return (await currentGitHead(workspaceRoot)).branch
}

async function assertValidBranchName(workspaceRoot, branch) {
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

async function listGitBranches(context) {
  if (!(await isGitRepository(context.workspaceRoot))) return { isGitRepository: false, branches: [] }
  const current = await currentGitBranch(context.workspaceRoot)
  const result = await git([
    'for-each-ref',
    '--format=%(refname)%1f%(refname:short)%1f%(objectname:short)%1f%(committerdate:iso8601-strict)%1f%(upstream:short)',
    'refs/heads',
    'refs/remotes',
  ], context.workspaceRoot)
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

async function listGitLog(context) {
  if (!(await isGitRepository(context.workspaceRoot))) return { isGitRepository: false, commits: [] }
  const result = await git([
    'log',
    '--all',
    '--date=iso-strict',
    '--max-count=200',
    '--format=%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e',
  ], context.workspaceRoot, { allowFailure: true })
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
async function collectNumstat(context) {
  const map = new Map()
  const result = await git(['diff', 'HEAD', '--numstat', '-z'], context.workspaceRoot, { allowFailure: true })
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

// 未跟踪文件不在 numstat 中，按工作区文件行数估算新增行
async function countWorkspaceLines(context, relativePath) {
  try {
    const { content } = await readWorkspaceTextFile(context, relativePath)
    return countTextLines(content)
  } catch {
    return undefined
  }
}

async function listGitStatus(context) {
  if (!(await isGitRepository(context.workspaceRoot))) return { isGitRepository: false, files: [] }
  const result = await git(['status', '--porcelain=v1', '-z'], context.workspaceRoot)
  const files = parseGitStatus(result.stdout)
  const numstat = await collectNumstat(context)
  for (const file of files) {
    const entry = numstat.get(file.path)
    if (entry) {
      file.additions = entry.additions
      file.deletions = entry.deletions
    } else if (file.status === 'untracked' || file.status === 'added') {
      const count = await countWorkspaceLines(context, file.path)
      if (typeof count === 'number') {
        file.additions = count
        file.deletions = 0
      }
    }
  }
  const head = await currentGitHead(context.workspaceRoot)
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

async function commitGitChanges(context, message, includeUnstaged) {
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

async function stageGitPath(context, value) {
  await assertGitRepository(context)
  const relativePath = await normalizeGitOperationPath(context, value)
  await git(['add', '-A', '--', relativePath], context.workspaceRoot)
  return listGitStatus(context)
}

async function stageAllGitChanges(context) {
  await assertGitRepository(context)
  await git(['add', '-A'], context.workspaceRoot)
  return listGitStatus(context)
}

async function unstageGitPath(context, value) {
  await assertGitRepository(context)
  const relativePath = await normalizeGitOperationPath(context, value)
  await git(['restore', '--staged', '--', relativePath], context.workspaceRoot)
  return listGitStatus(context)
}

async function unstageAllGitChanges(context) {
  await assertGitRepository(context)
  await git(['restore', '--staged', '--', '.'], context.workspaceRoot)
  return listGitStatus(context)
}

async function restoreGitPath(context, value) {
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

async function restoreAllGitChanges(context) {
  await assertGitRepository(context)
  await git(['restore', '--staged', '--', '.'], context.workspaceRoot, { allowFailure: true })
  await git(['restore', '--worktree', '--', '.'], context.workspaceRoot, { allowFailure: true })
  await git(['clean', '-fd'], context.workspaceRoot)
  return listGitStatus(context)
}

async function pushGitBranch(context) {
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

async function generateGitCommitMessage(context, model, thinkingLevel = 'off', includeUnstaged = false) {
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
    const stream = streamSimple(
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
        maxRetryDelayMs: 60000,
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

async function readGitFile(workspaceRoot, ref, relativePath) {
  const result = await git(['show', `${ref}:${relativePath}`], workspaceRoot, { allowFailure: true })
  return result.code === 0 ? result.stdout.toString('utf8') : ''
}

async function readWorkspaceTextFile(context, relativePath) {
  const file = resolveWorkspacePath(relativePath, context)
  await assertSafeWorkspacePath(file, context, { allowSensitive: true })
  const stat = await fs.stat(file)
  if (!stat.isFile()) {
    const error = new Error('Path is not a file')
    error.statusCode = 400
    throw error
  }
  if (stat.size > MAX_PREVIEW_BYTES) {
    const error = new Error('File is too large to preview')
    error.statusCode = 413
    throw error
  }
  const buffer = await fs.readFile(file)
  return { content: buffer.toString('utf8'), size: stat.size, path: toWorkspaceRelative(file, context) }
}

async function buildTreeForDirectory(dir, context, counter) {
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
        await assertSafeWorkspacePath(fullPath, context, { allowSensitive: true })
        counter.count += 1
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children: await buildTreeForDirectory(fullPath, context, counter),
        })
      } catch {
        // Skip directories that cannot be safely resolved.
      }
    } else if (entry.isFile()) {
      try {
        await assertSafeWorkspacePath(fullPath, context, { allowSensitive: true })
        counter.count += 1
        nodes.push({ name: entry.name, path: relativePath, type: 'file' })
      } catch {
        // Skip files that cannot be safely resolved.
      }
    }
  }
  return nodes
}

async function handleWorkspaceTree(req, res, url) {
  const context = await projectContextFromUrl(url)
  const tree = await buildTreeForDirectory(context.workspaceRoot, context, { count: 0 })
  sendJson(res, 200, { root: context.project.name, tree })
}

async function handleWorkspaceFile(req, res, url) {
  const context = await projectContextFromUrl(url)
  const relativePath = url.searchParams.get('path') || ''
  if (!relativePath) {
    const error = new Error('path is required')
    error.statusCode = 400
    throw error
  }
  const file = await readWorkspaceTextFile(context, relativePath)
  sendJson(res, 200, {
    ...file,
    language: languageFromPath(file.path),
    readonly: true,
  })
}

async function handleWorkspacePreview(req, res, url) {
  const prefix = '/api/workspace/preview/'
  const tail = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''
  const slashIndex = tail.indexOf('/')
  if (slashIndex <= 0) {
    const error = new Error('projectId and path are required')
    error.statusCode = 400
    throw error
  }

  const projectId = decodeURIComponent(tail.slice(0, slashIndex))
  const relativePath = decodeURIComponent(tail.slice(slashIndex + 1))
  if (!projectId || !relativePath) {
    const error = new Error('projectId and path are required')
    error.statusCode = 400
    throw error
  }

  const context = await projectContextFromId(projectId)
  const file = resolveWorkspacePath(relativePath, context)
  await assertSafeWorkspacePath(file, context)
  const extension = path.extname(file).toLowerCase()
  if (!PREVIEW_ALLOWED_EXTENSIONS.has(extension)) {
    const error = new Error('Unsupported preview file type')
    error.statusCode = 415
    throw error
  }
  const stat = await fs.stat(file)
  if (!stat.isFile()) {
    const error = new Error('Path is not a file')
    error.statusCode = 400
    throw error
  }
  if (stat.size > MAX_STATIC_PREVIEW_BYTES) {
    const error = new Error('File is too large to preview')
    error.statusCode = 413
    throw error
  }

  const contentType = previewContentType(file)
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  const buffer = await fs.readFile(file)
  res.end(buffer)
}

async function handleWorkspaceResolvePath(req, res) {
  const body = await readJsonBody(req, 16 * 1024)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const inputPath = typeof body?.path === 'string' ? body.path.trim() : ''

  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  if (!inputPath) {
    const error = new Error('path is required')
    error.statusCode = 400
    throw error
  }
  if (!path.isAbsolute(inputPath)) {
    const error = new Error('Only absolute paths are supported')
    error.statusCode = 400
    throw error
  }

  const context = await projectContextFromId(projectId)
  const file = resolveWorkspacePath(inputPath, context)
  await assertSafeWorkspacePath(file, context)
  const stat = await fs.stat(file)
  if (!stat.isFile()) {
    const error = new Error('Path is not a file')
    error.statusCode = 400
    throw error
  }

  sendJson(res, 200, {
    relativePath: toWorkspaceRelative(file, context),
    exists: true,
    isDirectory: false,
  })
}

export async function openWorkspaceExternalPath(context, inputPath, target, openers = {}) {
  const relativePath = typeof inputPath === 'string' ? inputPath.trim() : ''
  if (!relativePath) {
    const error = new Error('path is required')
    error.statusCode = 400
    throw error
  }
  if (target !== 'explorer' && target !== 'vscode' && target !== 'idea') {
    const error = new Error('target must be explorer, vscode, or idea')
    error.statusCode = 400
    throw error
  }

  const fullPath = resolveWorkspacePath(relativePath, context)
  await assertSafeWorkspacePath(fullPath, context, {
    allowSensitive: true,
    ignoreMissing: true,
  })
  const stat = await fs.stat(fullPath).catch(() => null)

  if (target === 'explorer') {
    const directory = stat?.isDirectory() ? fullPath : path.dirname(fullPath)
    await assertSafeWorkspacePath(directory, context, { allowSensitive: true })
    await (openers.explorer ?? openPathInFileManager)(directory)
    return { ok: true, opened: 'directory', target }
  }

  if (!stat?.isFile()) {
    const error = new Error(`File does not exist: ${toWorkspaceRelative(fullPath, context)}`)
    error.statusCode = 400
    throw error
  }
  const opener = target === 'vscode'
    ? (openers.vscode ?? openPathInVSCode)
    : (openers.idea ?? openPathInIDEA)
  await opener(fullPath)
  return { ok: true, opened: 'file', target }
}

async function handleWorkspaceOpenExternal(req, res) {
  const body = await readJsonBody(req, 16 * 1024)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  const context = await projectContextFromId(projectId)
  sendJson(res, 200, await openWorkspaceExternalPath(context, body?.path, body?.target))
}

async function handleGitStatus(req, res, url) {
  const context = await projectContextFromUrl(url)
  sendJson(res, 200, await listGitStatus(context))
}

async function handleGitBranches(req, res, url) {
  const context = await projectContextFromUrl(url)
  sendJson(res, 200, await listGitBranches(context))
}

async function handleGitLog(req, res, url) {
  const context = await projectContextFromUrl(url)
  sendJson(res, 200, await listGitLog(context))
}

async function handleGitCheckout(req, res) {
  const body = await readJsonBody(req, 16 * 1024)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  const context = await projectContextFromId(projectId)
  if (!(await isGitRepository(context.workspaceRoot))) {
    const error = new Error('This project is not a Git repository')
    error.statusCode = 400
    throw error
  }
  const branch = await assertValidBranchName(context.workspaceRoot, body?.branch)
  await git(['checkout', branch], context.workspaceRoot)
  sendJson(res, 200, await listGitStatus(context))
}

async function handleGitCreateBranch(req, res) {
  const body = await readJsonBody(req, 16 * 1024)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  const context = await projectContextFromId(projectId)
  if (!(await isGitRepository(context.workspaceRoot))) {
    const error = new Error('This project is not a Git repository')
    error.statusCode = 400
    throw error
  }
  const branch = await assertValidBranchName(context.workspaceRoot, body?.branch)
  await git(['checkout', '-b', branch], context.workspaceRoot)
  sendJson(res, 200, await listGitStatus(context))
}

async function handleGitFileDiff(req, res, url) {
  const context = await projectContextFromUrl(url)
  const relativePath = url.searchParams.get('path') || ''
  if (!relativePath) {
    const error = new Error('path is required')
    error.statusCode = 400
    throw error
  }

  const statusPayload = await listGitStatus(context)
  if (!statusPayload.isGitRepository) {
    const error = new Error('This project is not a Git repository')
    error.statusCode = 400
    throw error
  }
  const changedFile = statusPayload.files.find((file) => file.path === relativePath)
  if (!changedFile) {
    const error = new Error('File has no working tree changes')
    error.statusCode = 404
    throw error
  }

  const newRelativePath = changedFile.path
  const oldRelativePath = changedFile.oldPath || changedFile.path
  let oldContent = ''
  let newContent = ''

  if (changedFile.status !== 'added' && changedFile.status !== 'untracked') {
    const oldFile = resolveWorkspacePath(oldRelativePath, context)
    await assertSafeWorkspacePath(oldFile, context, { ignoreMissing: true })
    oldContent = await readGitFile(context.workspaceRoot, 'HEAD', oldRelativePath)
  }
  if (changedFile.status !== 'deleted') {
    newContent = (await readWorkspaceTextFile(context, newRelativePath)).content
  }

  sendJson(res, 200, {
    path: newRelativePath,
    oldPath: changedFile.oldPath,
    status: changedFile.status,
    oldContent,
    newContent,
    language: languageFromPath(newRelativePath),
  })
}

async function contextFromGitBody(req) {
  const body = await readJsonBody(req, 1024 * 1024)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  return { context: await projectContextFromId(projectId), body }
}

async function handleGitGenerateCommitMessage(req, res) {
  const { context, body } = await contextFromGitBody(req)
  const message = await generateGitCommitMessage(context, body?.model, body?.thinkingLevel, Boolean(body?.includeUnstaged))
  sendJson(res, 200, { message })
}

async function handleGitStage(req, res) {
  const { context, body } = await contextFromGitBody(req)
  sendJson(res, 200, await stageGitPath(context, body?.path))
}

async function handleGitStageAll(req, res) {
  const { context } = await contextFromGitBody(req)
  sendJson(res, 200, await stageAllGitChanges(context))
}

async function handleGitUnstage(req, res) {
  const { context, body } = await contextFromGitBody(req)
  sendJson(res, 200, await unstageGitPath(context, body?.path))
}

async function handleGitUnstageAll(req, res) {
  const { context } = await contextFromGitBody(req)
  sendJson(res, 200, await unstageAllGitChanges(context))
}

async function handleGitRestore(req, res) {
  const { context, body } = await contextFromGitBody(req)
  sendJson(res, 200, await restoreGitPath(context, body?.path))
}

async function handleGitRestoreAll(req, res) {
  const { context } = await contextFromGitBody(req)
  sendJson(res, 200, await restoreAllGitChanges(context))
}

async function handleGitCommit(req, res) {
  const { context, body } = await contextFromGitBody(req)
  sendJson(res, 200, await commitGitChanges(context, body?.message, Boolean(body?.includeUnstaged)))
}

async function handleGitPush(req, res) {
  const { context } = await contextFromGitBody(req)
  sendJson(res, 200, await pushGitBranch(context))
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

async function handleGitCommitAndPush(req, res) {
  const { context, body } = await contextFromGitBody(req)
  sendJson(res, 200, await commitAndPushGitChanges(context, body?.message, Boolean(body?.includeUnstaged)))
}

export async function handleWorkspaceApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/workspace/tree') {
    await handleWorkspaceTree(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/workspace/file') {
    await handleWorkspaceFile(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/workspace/preview/')) {
    await handleWorkspacePreview(req, res, url)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/workspace/resolve-path') {
    await handleWorkspaceResolvePath(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/workspace/open-external') {
    await handleWorkspaceOpenExternal(req, res)
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

export async function handleGitApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/git/status') {
    await handleGitStatus(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/git/branches') {
    await handleGitBranches(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/git/log') {
    await handleGitLog(req, res, url)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/checkout') {
    await handleGitCheckout(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/create-branch') {
    await handleGitCreateBranch(req, res)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/git/file-diff') {
    await handleGitFileDiff(req, res, url)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/generate-commit-message') {
    await handleGitGenerateCommitMessage(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/stage') {
    await handleGitStage(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/stage-all') {
    await handleGitStageAll(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/unstage') {
    await handleGitUnstage(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/unstage-all') {
    await handleGitUnstageAll(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/restore') {
    await handleGitRestore(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/restore-all') {
    await handleGitRestoreAll(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/commit') {
    await handleGitCommit(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/push') {
    await handleGitPush(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/commit-and-push') {
    await handleGitCommitAndPush(req, res)
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

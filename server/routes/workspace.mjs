import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { sendJson, readJsonBody } from '../utils/response.mjs'
import { projectContextFromId } from '../project-config.mjs'
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

async function currentGitBranch(workspaceRoot) {
  const result = await git(['branch', '--show-current'], workspaceRoot, { allowFailure: true })
  const branch = result.stdout.toString('utf8').trim()
  if (branch) return branch
  const head = await git(['rev-parse', '--short', 'HEAD'], workspaceRoot, { allowFailure: true })
  const commit = head.stdout.toString('utf8').trim()
  return commit ? `HEAD ${commit}` : undefined
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
  return {
    isGitRepository: true,
    branch: await currentGitBranch(context.workspaceRoot),
    counts: countGitStatus(files),
    files,
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

async function handleGitStatus(req, res, url) {
  const context = await projectContextFromUrl(url)
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

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

export async function handleGitApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/git/status') {
    await handleGitStatus(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/git/file-diff') {
    await handleGitFileDiff(req, res, url)
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { sendJson } from '../utils/response.mjs'
import { projectContextFromId } from '../project-config.mjs'
import {
  assertSafeWorkspacePath,
  isSensitiveWorkspacePath,
  resolveWorkspacePath,
  shouldSearchFile,
  toWorkspaceRelative,
} from '../utils/workspace.mjs'

const MAX_PREVIEW_BYTES = 1024 * 1024
const MAX_TREE_NODES = 5000
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'dist-ssr', 'package-dist', 'package-offline', '.vite', 'coverage'])

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

function isBinaryBuffer(buffer) {
  const length = Math.min(buffer.length, 8000)
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0) return true
  }
  return false
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

async function listGitStatus(context) {
  if (!(await isGitRepository(context.workspaceRoot))) return { isGitRepository: false, files: [] }
  const result = await git(['status', '--porcelain=v1', '-z'], context.workspaceRoot)
  return { isGitRepository: true, files: parseGitStatus(result.stdout) }
}

async function readGitFile(workspaceRoot, ref, relativePath) {
  const result = await git(['show', `${ref}:${relativePath}`], workspaceRoot, { allowFailure: true })
  return result.code === 0 ? result.stdout.toString('utf8') : ''
}

async function readWorkspaceTextFile(context, relativePath) {
  const file = resolveWorkspacePath(relativePath, context)
  await assertSafeWorkspacePath(file, context)
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
  if (isBinaryBuffer(buffer)) {
    const error = new Error('Binary file cannot be previewed')
    error.statusCode = 415
    throw error
  }
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
      if (SKIP_DIRS.has(entry.name) || isSensitiveWorkspacePath(fullPath, context)) continue
      try {
        await assertSafeWorkspacePath(fullPath, context)
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
      if (!shouldSearchFile(entry.name) || isSensitiveWorkspacePath(fullPath, context)) continue
      try {
        await assertSafeWorkspacePath(fullPath, context)
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

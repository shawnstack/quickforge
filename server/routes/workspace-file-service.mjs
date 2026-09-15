import path from 'node:path'
import { resolveWorkspacePath, assertSafeWorkspacePath, toWorkspaceRelative } from '../utils/workspace.mjs'
import { promises as fs } from 'node:fs'
import { openPathInFileManager, openPathInVSCode, openPathInIDEA } from '../utils/platform.mjs'

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024

const MAX_STATIC_PREVIEW_BYTES = 50 * 1024 * 1024

const PREVIEW_ALLOWED_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.txt', '.md', '.pdf', '.docx', '.xls', '.xlsx'])

const extensionLanguageMap = new Map([
  ['ts', 'typescript'], ['tsx', 'typescript'], ['js', 'javascript'], ['jsx', 'javascript'],
  ['mjs', 'javascript'], ['cjs', 'javascript'], ['json', 'json'], ['jsonc', 'json'],
  ['css', 'css'], ['scss', 'scss'], ['less', 'less'], ['html', 'html'], ['htm', 'html'],
  ['md', 'markdown'], ['mdx', 'markdown'], ['markdown', 'markdown'], ['py', 'python'], ['rb', 'ruby'], ['go', 'go'],
  ['rs', 'rust'], ['java', 'java'], ['c', 'c'], ['h', 'c'], ['cpp', 'cpp'], ['cc', 'cpp'],
  ['cxx', 'cpp'], ['hpp', 'cpp'], ['cs', 'csharp'], ['php', 'php'], ['swift', 'swift'],
  ['kt', 'kotlin'], ['kts', 'kotlin'], ['sh', 'shell'], ['bash', 'shell'], ['zsh', 'shell'],
  ['ps1', 'powershell'], ['yml', 'yaml'], ['yaml', 'yaml'], ['xml', 'xml'], ['sql', 'sql'],
  ['toml', 'toml'], ['ini', 'ini'], ['env', 'ini'],
])

export function languageFromPath(filePath) {
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
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return map[ext] || 'application/octet-stream'
}

// 安全校验 + stat（不读内容）：普通读取与 meta 轻量探测共用，保证两条路径
// 的 400/413/ENOENT 错误语义完全一致。
export async function statWorkspaceTextFile(context, relativePath) {
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
  return { file, size: stat.size, mtimeMs: stat.mtimeMs, path: toWorkspaceRelative(file, context) }
}

export async function readWorkspaceTextFile(context, relativePath) {
  const info = await statWorkspaceTextFile(context, relativePath)
  const buffer = await fs.readFile(info.file)
  return { content: buffer.toString('utf8'), size: info.size, mtimeMs: info.mtimeMs, path: info.path }
}

export function createWorkspacePreviewError(message, statusCode, previewCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.previewCode = previewCode
  return error
}

export function workspacePreviewIssueFromError(error, requestedPath = '') {
  let status = error?.statusCode || 500
  let code = error?.previewCode || 'PREVIEW_SERVICE_FAILED'

  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
    status = 404
    code = 'PREVIEW_FILE_NOT_FOUND'
  } else if (error?.name === 'URIError') {
    status = 400
    code = 'PREVIEW_INVALID_PATH'
  } else if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    status = 403
    code = 'PREVIEW_PERMISSION_DENIED'
  } else if (status === 403 && !error?.previewCode) {
    code = 'PREVIEW_PERMISSION_DENIED'
  } else if (status === 400 && !error?.previewCode) {
    code = 'PREVIEW_INVALID_PATH'
  }

  return {
    status,
    payload: {
      error: error?.message || 'Internal server error',
      code,
      path: requestedPath,
    },
  }
}

export async function inspectWorkspacePreviewFile(context, relativePath) {
  const file = resolveWorkspacePath(relativePath, context)
  await assertSafeWorkspacePath(file, context)
  const extension = path.extname(file).toLowerCase()
  if (!PREVIEW_ALLOWED_EXTENSIONS.has(extension)) {
    throw createWorkspacePreviewError('Unsupported preview file type', 415, 'PREVIEW_UNSUPPORTED_TYPE')
  }

  const stat = await fs.stat(file)
  if (!stat.isFile()) {
    throw createWorkspacePreviewError('Path is not a file', 400, 'PREVIEW_INVALID_PATH')
  }
  if (stat.size > MAX_STATIC_PREVIEW_BYTES) {
    throw createWorkspacePreviewError('File is too large to preview', 413, 'PREVIEW_FILE_TOO_LARGE')
  }

  return {
    file,
    stat,
    contentType: previewContentType(file),
  }
}

// ETag 源=stat（零额外 IO）：mtimeMs+size 足以标识本地文件版本
export function buildPreviewEtag(stat) {
  return `"${stat.mtimeMs}-${stat.size}"`
}

// If-None-Match 支持精确值、`*` 与逗号分隔列表（每项 trim 后比较）
export function ifNoneMatchSatisfied(headerValue, etag) {
  return String(headerValue)
    .split(',')
    .some((candidate) => {
      const value = candidate.trim()
      return value === etag || value === '*'
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

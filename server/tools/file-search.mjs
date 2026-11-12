/**
 * Read-only file tools: read_file and grep_files.
 *
 * read_file supports offset/limit paging and reads command log files by
 * absolute path (isCommandLogPath). grep_files prefers the bundled ripgrep
 * (JSON events, glob filters, context lines, limit short-circuit) and falls
 * back to a Node implementation when ripgrep is unavailable or the regex
 * uses JavaScript-only features. Both children are killed through
 * killProcessTree from process-control.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { resolveWorkspacePath, toWorkspaceRelative, assertSafeWorkspacePath, truncateText, splitLines, walkFiles, getToolWorkspaceRoot } from '../utils/workspace.mjs'
import { resolveRipgrepExecutable } from '../utils/ripgrep.mjs'
import { isCommandLogPath } from '../utils/command-log.mjs'
import { killProcessTree } from './process-control.mjs'
import { clampNumber } from './params.mjs'

// --- read_file ---
export async function toolReadFile(params, context) {
  const requestedPath = String(params?.path || '')
  const commandLog = path.isAbsolute(requestedPath) && isCommandLogPath(requestedPath)
  const file = commandLog ? path.resolve(requestedPath) : resolveWorkspacePath(requestedPath, context)
  if (!commandLog) await assertSafeWorkspacePath(file, context)

  const text = await fs.readFile(file, 'utf8')
  const lines = splitLines(text)
  const offset = Math.max(1, Number(params?.offset || 1))
  const limit = Math.min(2000, Math.max(1, Number(params?.limit || 200)))
  const selected = lines.slice(offset - 1, offset - 1 + limit)
  const content = selected.map((line, index) => `${offset + index}: ${line}`).join('\n')
  const suffix = offset - 1 + limit < lines.length ? `\n\n[showing ${selected.length} of ${lines.length} lines]` : ''

  return {
    content: truncateText(`${content}${suffix}`),
    details: {
      path: commandLog ? file : toWorkspaceRelative(file, context),
      project: context?.project,
      totalLines: lines.length,
      offset,
      limit,
      commandLog,
    },
  }
}

// --- grep_files ---

const RIPGREP_MAX_FILESIZE = '1M'
const RIPGREP_TIMEOUT_MS = 60 * 1000
const DEFAULT_EXCLUDE_GLOBS = [
  '!.git/**',
  '!node_modules/**',
  '!dist/**',
  '!dist-ssr/**',
  '!.vite/**',
  '!**/*.png',
  '!**/*.jpg',
  '!**/*.jpeg',
  '!**/*.gif',
  '!**/*.webp',
  '!**/*.ico',
  '!**/*.pdf',
  '!**/*.zip',
  '!**/*.gz',
  '!**/*.7z',
  '!**/*.exe',
  '!**/*.dll',
  '!**/*.woff',
  '!**/*.woff2',
  '!**/*.ttf',
]
const SENSITIVE_EXCLUDE_GLOBS = [
  '!.env',
  '!**/.env',
  '!.env.*',
  '!**/.env.*',
  '!**/*.pem',
  '!**/*.key',
  '!**/*.p12',
  '!**/*.pfx',
  '!**/*.crt',
  '!**/*.cer',
  '!**/*.token',
  '!credentials.json',
  '!**/credentials.json',
  '!secrets.json',
  '!**/secrets.json',
  '!id_rsa',
  '!**/id_rsa',
  '!id_ed25519',
  '!**/id_ed25519',
]

/**
 * Process items with bounded concurrency.  Returns results in input order.
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {number} concurrency
 * @returns {Promise<R[]>}
 */
async function poolMap(items, fn, concurrency = 20) {
  const results = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeGlobList(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return values
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 50)
}

function normalizeGrepParams(params, context) {
  const root = resolveWorkspacePath(params?.path || '.', context)
  const query = String(params?.query || '')
  if (!query) {
    const error = new Error('query is required')
    error.statusCode = 400
    throw error
  }

  const flags = params?.caseSensitive ? 'g' : 'gi'
  try {
    params?.regex
      ? new RegExp(query, flags)
      : new RegExp(escapeRegExp(query), flags)
  } catch {
    const error = new Error('Invalid regular expression')
    error.statusCode = 400
    throw error
  }

  return {
    root,
    query,
    regex: Boolean(params?.regex),
    caseSensitive: Boolean(params?.caseSensitive),
    limit: clampNumber(params?.limit, 200, 1, 1000),
    glob: normalizeGlobList(params?.glob),
    context: clampNumber(params?.context, 0, 0, 20),
    beforeContext: clampNumber(params?.beforeContext, 0, 0, 20),
    afterContext: clampNumber(params?.afterContext, 0, 0, 20),
    filesWithMatches: Boolean(params?.filesWithMatches),
    respectGitIgnore: Boolean(params?.respectGitIgnore),
  }
}

function isRegexLikelyRipgrepCompatible(query) {
  return !(/\(\?[=!<]/.test(query) || /\\[1-9]/.test(query))
}

function buildRipgrepArgs(options, context) {
  const args = [
    '--line-number',
    '--color=never',
    '--max-filesize',
    RIPGREP_MAX_FILESIZE,
  ]

  if (options.filesWithMatches) {
    args.push('--files-with-matches')
  } else {
    args.push('--json')
  }
  if (!options.regex) args.push('--fixed-strings')
  if (!options.caseSensitive) args.push('--ignore-case')
  if (!options.respectGitIgnore) args.push('--hidden', '--no-ignore')
  if (options.context > 0) args.push('-C', String(options.context))
  if (options.beforeContext > 0) args.push('-B', String(options.beforeContext))
  if (options.afterContext > 0) args.push('-A', String(options.afterContext))

  for (const pattern of options.glob) args.push('--glob', pattern)
  for (const pattern of DEFAULT_EXCLUDE_GLOBS) args.push('--glob', pattern)
  for (const pattern of SENSITIVE_EXCLUDE_GLOBS) args.push('--glob', pattern)

  args.push('--', options.query, toWorkspaceRelative(options.root, context) || '.')
  return args
}

function cleanRipgrepLine(value) {
  return String(value || '').replace(/[\r\n]+$/, '')
}

function ripgrepRelativePath(value) {
  return String(value || '').replace(/\\/g, '/')
}

function formatCommandArg(value) {
  const text = String(value ?? '')
  return /^[A-Za-z0-9_@%+=:,./\\-]+$/.test(text) ? text : JSON.stringify(text)
}

function formatSpawnCommand(command, args) {
  return [command, ...args].map(formatCommandArg).join(' ')
}

function grepSearchOptionsDetails(options) {
  return {
    regex: options.regex,
    caseSensitive: options.caseSensitive,
    glob: options.glob,
    context: options.context,
    beforeContext: options.beforeContext,
    afterContext: options.afterContext,
    filesWithMatches: options.filesWithMatches,
    respectGitIgnore: options.respectGitIgnore,
    maxFileSize: RIPGREP_MAX_FILESIZE,
    defaultExcludeGlobs: DEFAULT_EXCLUDE_GLOBS,
    sensitiveExcludeGlobs: SENSITIVE_EXCLUDE_GLOBS,
  }
}

function formatRipgrepJsonEvent(event) {
  if (event?.type !== 'match' && event?.type !== 'context') return null
  const data = event.data || {}
  const file = ripgrepRelativePath(data.path?.text)
  const lineNumber = data.line_number
  const line = cleanRipgrepLine(data.lines?.text)
  if (!file || !lineNumber) return null
  const separator = event.type === 'match' ? ':' : '-'
  return `${file}:${lineNumber}${separator} ${line}`
}

function fallbackDetails(extra = {}) {
  return Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined && value !== null && value !== ''))
}

async function grepFilesWithRipgrep(executable, options, context, runtime = {}) {
  if (options.regex && !isRegexLikelyRipgrepCompatible(options.query)) {
    throw new Error('regex uses JavaScript-only features that ripgrep does not support')
  }

  const cwd = getToolWorkspaceRoot(context)
  const args = buildRipgrepArgs(options, context)
  const matches = []
  let stderr = ''
  let buffer = ''
  let killedForLimit = false
  let settled = false

  await new Promise((resolve, reject) => {
    if (runtime.signal?.aborted) {
      reject(new Error('Search aborted'))
      return
    }

    const child = spawn(executable.command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const cleanup = () => {
      clearTimeout(timer)
      runtime.signal?.removeEventListener?.('abort', onAbort)
    }
    const finish = (error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }
    const stopForLimit = () => {
      if (killedForLimit) return
      killedForLimit = true
      killProcessTree(child, 'SIGTERM')
    }
    const processLine = (line) => {
      if (!line || matches.length >= options.limit) return
      if (options.filesWithMatches) {
        matches.push(ripgrepRelativePath(line))
      } else {
        try {
          const formatted = formatRipgrepJsonEvent(JSON.parse(line))
          if (formatted) matches.push(formatted)
        } catch {
          // Ignore malformed partial output and let process exit handling decide fallback.
        }
      }
      if (matches.length >= options.limit) stopForLimit()
    }
    const flushLines = (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) processLine(line)
    }
    function onAbort() {
      killProcessTree(child, 'SIGTERM')
      finish(new Error('Search aborted'))
    }

    const timer = setTimeout(() => {
      killProcessTree(child, 'SIGTERM')
      finish(new Error('ripgrep search timed out'))
    }, RIPGREP_TIMEOUT_MS)

    runtime.signal?.addEventListener?.('abort', onAbort, { once: true })
    child.stdout.on('data', flushLines)
    child.stderr.on('data', (chunk) => {
      stderr = truncateText(stderr + chunk.toString(), 2000)
    })
    child.once('error', finish)
    child.once('close', (code) => {
      if (buffer) processLine(buffer)
      if (killedForLimit || code === 0 || code === 1) {
        finish()
      } else {
        finish(new Error(stderr.trim() || `ripgrep exited with code ${code}`))
      }
    })
  })

  return {
    content: matches.length ? truncateText(matches.slice(0, options.limit).join('\n')) : 'No matches found.',
    details: {
      path: toWorkspaceRelative(options.root, context),
      project: context?.project,
      query: options.query,
      count: matches.length,
      limit: options.limit,
      backend: 'ripgrep',
      ripgrepSource: executable.source,
      cwd,
      command: formatSpawnCommand(executable.command, args),
      executable: executable.command,
      args,
      searchOptions: grepSearchOptionsDetails(options),
    },
  }
}

async function grepFilesWithNode(options, context, extraDetails = {}) {
  const flags = options.caseSensitive ? 'g' : 'gi'
  const matcher = options.regex
    ? new RegExp(options.query, flags)
    : new RegExp(escapeRegExp(options.query), flags)

  const files = await walkFiles(options.root, [], context)
  const matches = []

  // Stat and filter files in parallel, then grep in parallel batches.
  const candidateResults = await poolMap(files, async (file) => {
    try {
      const stat = await fs.stat(file)
      if (stat.size > 1024 * 1024) return { file, skip: true }
      return { file, skip: false }
    } catch {
      return { file, skip: true }
    }
  })

  const candidates = candidateResults.filter((r) => !r.skip).map((r) => r.file)

  // Grep with bounded concurrency — short-circuit when limit reached.
  let matchCount = 0
  const filesWithMatches = new Set()
  for (let batchStart = 0; batchStart < candidates.length && matchCount < options.limit; batchStart += 20) {
    const batch = candidates.slice(batchStart, batchStart + 20)
    const batchMatches = await Promise.all(
      batch.map(async (file) => {
        if (matchCount >= options.limit) return []
        try {
          const text = await fs.readFile(file, 'utf8')
          const lines = splitLines(text)
          const fileMatches = []
          for (let index = 0; index < lines.length && (matchCount + fileMatches.length) < options.limit; index++) {
            matcher.lastIndex = 0
            if (matcher.test(lines[index])) {
              const relative = toWorkspaceRelative(file, context)
              if (options.filesWithMatches) {
                if (!filesWithMatches.has(relative)) {
                  filesWithMatches.add(relative)
                  fileMatches.push(relative)
                }
              } else {
                fileMatches.push(`${relative}:${index + 1}: ${lines[index]}`)
              }
            }
          }
          return fileMatches
        } catch {
          return []
        }
      }),
    )
    for (const fm of batchMatches) {
      if (matchCount >= options.limit) break
      for (const m of fm) {
        if (matchCount >= options.limit) break
        matches.push(m)
        matchCount++
      }
    }
  }

  return {
    content: matches.length ? truncateText(matches.join('\n')) : 'No matches found.',
    details: {
      path: toWorkspaceRelative(options.root, context),
      project: context?.project,
      query: options.query,
      count: matches.length,
      limit: options.limit,
      backend: 'node',
      searchOptions: grepSearchOptionsDetails(options),
      ...fallbackDetails(extraDetails),
    },
  }
}

export async function toolGrepFiles(params, context, runtime = {}) {
  const options = normalizeGrepParams(params, context)
  await assertSafeWorkspacePath(options.root, context)

  const executable = await resolveRipgrepExecutable()
  if (executable) {
    try {
      return await grepFilesWithRipgrep(executable, options, context, runtime)
    } catch (error) {
      if (runtime.signal?.aborted) throw error
      return grepFilesWithNode(options, context, {
        fallbackFrom: 'ripgrep',
        fallbackReason: error?.message || 'ripgrep unavailable',
      })
    }
  }

  return grepFilesWithNode(options, context, { fallbackReason: 'ripgrep unavailable' })
}

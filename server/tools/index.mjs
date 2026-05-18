import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolveWorkspacePath, toWorkspaceRelative, assertSafeWorkspacePath, truncateText, splitLines, walkFiles } from '../utils/workspace.mjs'
import { createTextDiff } from '../utils/text-diff.mjs'
import {
  formatSkillActivation,
  loadSelectedGlobalSkills,
  loadSelectedProjectSkills,
  mergeSkills,
  readSkillResource,
} from '../skills.mjs'
import { getToolWorkspaceRoot } from '../utils/workspace.mjs'

const require = createRequire(import.meta.url)

// --- read_file ---
export async function toolReadFile(params, context) {
  const file = resolveWorkspacePath(params?.path, context)
  await assertSafeWorkspacePath(file, context)

  const text = await fs.readFile(file, 'utf8')
  const lines = splitLines(text)
  const offset = Math.max(1, Number(params?.offset || 1))
  const limit = Math.min(2000, Math.max(1, Number(params?.limit || 200)))
  const selected = lines.slice(offset - 1, offset - 1 + limit)
  const content = selected.map((line, index) => `${offset + index}: ${line}`).join('\n')
  const suffix = offset - 1 + limit < lines.length ? `\n\n[showing ${selected.length} of ${lines.length} lines]` : ''

  return {
    content: truncateText(`${content}${suffix}`),
    details: { path: toWorkspaceRelative(file, context), project: context?.project, totalLines: lines.length, offset, limit },
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

let cachedRipgrepExecutable

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

function clampNumber(value, defaultValue, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return defaultValue
  return Math.min(max, Math.max(min, Math.trunc(number)))
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

function ripgrepCandidatePath() {
  try {
    return require('@vscode/ripgrep').rgPath || null
  } catch {
    return null
  }
}

async function verifyRipgrepExecutable(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { shell: false, windowsHide: true })
    child.once('error', () => resolve(false))
    child.once('close', (code) => resolve(code === 0))
  })
}

async function resolveRipgrepExecutable() {
  if (cachedRipgrepExecutable !== undefined) return cachedRipgrepExecutable

  const bundled = ripgrepCandidatePath()
  if (bundled && await verifyRipgrepExecutable(bundled)) {
    cachedRipgrepExecutable = { command: bundled, source: 'bundled' }
    return cachedRipgrepExecutable
  }

  if (await verifyRipgrepExecutable('rg')) {
    cachedRipgrepExecutable = { command: 'rg', source: 'system' }
    return cachedRipgrepExecutable
  }

  cachedRipgrepExecutable = null
  return cachedRipgrepExecutable
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

// --- write_file ---
export async function toolWriteFile(params, context) {
  const file = resolveWorkspacePath(params?.path, context)
  await assertSafeWorkspacePath(file, context, { forWrite: true })

  const content = String(params?.content ?? '')
  const relativePath = toWorkspaceRelative(file, context)
  let oldText = ''
  let existed = true
  try {
    oldText = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    existed = false
  }
  const diff = createTextDiff(oldText, content, relativePath, { oldExists: existed })

  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, 'utf8')

  return {
    content: `${existed ? 'Wrote' : 'Created'} ${relativePath} (+${diff.addedLines} -${diff.removedLines})`,
    details: { path: relativePath, project: context?.project, bytes: Buffer.byteLength(content, 'utf8'), created: !existed, diff },
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

export async function toolEditFile(params, context) {
  const file = resolveWorkspacePath(params?.path, context)
  await assertSafeWorkspacePath(file, context)

  const oldText = String(params?.oldText ?? '')
  const newText = String(params?.newText ?? '')
  const text = await fs.readFile(file, 'utf8')
  const count = countOccurrences(text, oldText)

  if (count !== 1) {
    const error = new Error(`oldText must match exactly once; found ${count} matches`)
    error.statusCode = 400
    throw error
  }

  const nextText = text.replace(oldText, newText)
  const relativePath = toWorkspaceRelative(file, context)
  const diff = createTextDiff(text, nextText, relativePath)

  await fs.writeFile(file, nextText, 'utf8')

  return {
    content: `Edited ${relativePath} (+${diff.addedLines} -${diff.removedLines})`,
    details: { path: relativePath, project: context?.project, replaced: count, diff },
  }
}

// --- run_command ---
function activeSkillsForContext(context) {
  return mergeSkills(context?.globalSkills, context?.projectSkills)
}

function activeSkillByName(context, name) {
  const skillName = String(name || '')
  return activeSkillsForContext(context).find((skill) => skill.name === skillName)
}

export async function loadSkillToolContext(config = {}) {
  const globalSkills = await loadSelectedGlobalSkills(config.globalSkillNames)
  const projectSkills = config.workspaceRoot
    ? await loadSelectedProjectSkills(config.projectSkillNames, config.workspaceRoot)
    : []
  return { globalSkills, projectSkills }
}

// --- activate_skill ---
export async function toolActivateSkill(params, context) {
  const skill = activeSkillByName(context, params?.name)
  if (!skill) {
    const error = new Error(`Unknown or disabled skill: ${params?.name || ''}`)
    error.statusCode = 404
    throw error
  }

  return {
    content: truncateText(await formatSkillActivation(skill)),
    details: {
      skill: skill.name,
      source: skill.source,
      directory: skill.rootDir,
    },
  }
}

// --- read_skill_resource ---
export async function toolReadSkillResource(params, context) {
  const skill = activeSkillByName(context, params?.skill)
  if (!skill) {
    const error = new Error(`Unknown or disabled skill: ${params?.skill || ''}`)
    error.statusCode = 404
    throw error
  }

  const result = await readSkillResource(skill, params?.path, params)
  return {
    content: truncateText(result.content),
    details: result.details,
  }
}

// --- run_command ---
function commandStatus(meta = {}) {
  if (meta.running) return 'Status: running'
  const flags = [
    meta.timedOut ? 'timed out' : null,
    meta.aborted ? 'aborted' : null,
  ].filter(Boolean)
  const suffix = flags.length ? ` (${flags.join(', ')})` : ''
  return `Exit code: ${meta.code ?? 'unknown'}${meta.signal ? `, signal: ${meta.signal}` : ''}${suffix}`
}

function formatCommandOutput(command, stdout, stderr, meta = {}) {
  return [
    `Command: ${command}`,
    commandStatus(meta),
    '',
    'STDOUT:',
    stdout || '(empty)',
    '',
    'STDERR:',
    stderr || '(empty)',
  ].join('\n')
}

function killProcessTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => {
      try { child.kill(signal) } catch { /* ignore */ }
    })
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch {
    try { child.kill(signal) } catch { /* ignore */ }
  }
}

export async function toolRunCommand(params, context, runtime = {}) {
  const command = String(params?.command || '')
  if (!command.trim()) {
    const error = new Error('command is required')
    error.statusCode = 400
    throw error
  }

  const timeoutMs = Math.min(10 * 60, Math.max(1, Number(params?.timeoutSeconds || 60))) * 1000
  const cwd = getToolWorkspaceRoot(context)

  if (runtime.signal?.aborted) {
    const content = formatCommandOutput(command, '', 'Command aborted before start.', { aborted: true })
    return { content: truncateText(content), details: { command, project: context?.project, cwd, aborted: true } }
  }

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    let settled = false
    let updateTimer = null
    let updatePending = false
    let forceKillTimer = null

    const cleanup = () => {
      clearTimeout(timer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      if (updateTimer) clearTimeout(updateTimer)
      runtime.signal?.removeEventListener?.('abort', onAbort)
    }

    const finish = ({ code = null, signal = null, error = null } = {}) => {
      if (settled) return
      flushUpdate()
      settled = true
      cleanup()
      if (error) {
        resolve({
          isError: true,
          content: truncateText(`Error running command: ${error.message}`),
          details: { command, project: context?.project, cwd, error: error.message, aborted, timedOut },
        })
        return
      }
      const content = formatCommandOutput(command, stdout, stderr, { code, signal, timedOut, aborted })
      resolve({ content: truncateText(content), details: { command, project: context?.project, cwd, code, signal, timedOut, aborted } })
    }

    const stopChild = (reason) => {
      if (reason === 'timeout') timedOut = true
      if (reason === 'abort') aborted = true
      killProcessTree(child, 'SIGTERM')
      forceKillTimer = setTimeout(() => {
        killProcessTree(child, 'SIGKILL')
      }, 1500)
    }

    function onAbort() {
      stopChild('abort')
      finish({ signal: 'SIGTERM' })
    }

    const emitUpdate = () => {
      updateTimer = null
      if (settled || !updatePending) return
      updatePending = false
      runtime.onUpdate?.({
        content: [{ type: 'text', text: truncateText(formatCommandOutput(command, stdout, stderr, { running: true })) }],
        details: { command, project: context?.project, cwd, running: true, stdout, stderr },
      })
    }
    const flushUpdate = () => {
      if (updateTimer) {
        clearTimeout(updateTimer)
        updateTimer = null
      }
      if (!updatePending) return
      updatePending = false
      runtime.onUpdate?.({
        content: [{ type: 'text', text: truncateText(formatCommandOutput(command, stdout, stderr, { running: true })) }],
        details: { command, project: context?.project, cwd, running: true, stdout, stderr },
      })
    }
    const scheduleUpdate = () => {
      if (settled) return
      updatePending = true
      if (!updateTimer) updateTimer = setTimeout(emitUpdate, 150)
    }
    const timer = setTimeout(() => {
      stopChild('timeout')
      finish({ signal: 'SIGTERM' })
    }, timeoutMs)

    runtime.signal?.addEventListener?.('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk) => {
      if (settled) return
      stdout = truncateText(stdout + chunk.toString())
      scheduleUpdate()
    })
    child.stderr.on('data', (chunk) => {
      if (settled) return
      stderr = truncateText(stderr + chunk.toString())
      scheduleUpdate()
    })
    child.on('close', (code, signal) => {
      finish({ code, signal })
    })
    child.on('error', (err) => {
      finish({ error: err })
    })
  })
}

export const toolHandlers = {
  read_file: toolReadFile,
  grep_files: toolGrepFiles,
  write_file: toolWriteFile,
  edit_file: toolEditFile,
  run_command: toolRunCommand,
  activate_skill: toolActivateSkill,
  read_skill_resource: toolReadSkillResource,
}

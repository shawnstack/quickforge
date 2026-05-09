import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { resolveWorkspacePath, toWorkspaceRelative, assertSafeWorkspacePath, truncateText, splitLines, walkFiles } from '../utils/workspace.mjs'
import { createTextDiff } from '../utils/text-diff.mjs'
import { readProjectConfig, getActiveProject } from '../project-config.mjs'
import {
  formatSkillActivation,
  loadSelectedGlobalSkills,
  loadSelectedProjectSkills,
  mergeSkills,
  readSkillResource,
} from '../skills.mjs'
import { getWorkspaceRoot, getToolWorkspaceRoot } from '../utils/workspace.mjs'

// --- get_project_info ---
export async function toolGetProjectInfo(_params, context) {
  const config = context?.project ? null : await readProjectConfig()
  const project = context?.project || getActiveProject(config)
  const workspaceRoot = context?.workspaceRoot || project?.path || getWorkspaceRoot()

  if (!project) {
    return {
      content: 'No active project is configured.',
      details: { project: null, workspaceRoot },
    }
  }

  return {
    content: [`Project: ${project.name}`, `Path: ${workspaceRoot}`, `ID: ${project.id}`].join('\n'),
    details: { project, workspaceRoot },
  }
}

// --- list_dir ---
export async function toolListDir(params, context) {
  const dir = resolveWorkspacePath(params?.path || '.', context)
  await assertSafeWorkspacePath(dir, context)

  const entries = await fs.readdir(dir, { withFileTypes: true })
  const rows = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name)
    const stat = await fs.lstat(fullPath).catch(() => null)
    return {
      name: `${entry.name}${entry.isDirectory() ? '/' : ''}`,
      type: entry.isDirectory() ? 'directory' : stat?.isSymbolicLink() ? 'other' : entry.isFile() ? 'file' : 'other',
      size: stat?.size ?? 0,
      modified: stat?.mtime?.toISOString?.() ?? '',
    }
  }))

  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const content = rows.length
    ? rows.map((row) => `${row.type.padEnd(9)} ${String(row.size).padStart(10)} ${row.modified} ${row.name}`).join('\n')
    : '(empty directory)'

  return { content, details: { path: toWorkspaceRelative(dir, context), project: context?.project, count: rows.length } }
}

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

export async function toolGrepFiles(params, context) {
  const root = resolveWorkspacePath(params?.path || '.', context)
  await assertSafeWorkspacePath(root, context)

  const query = String(params?.query || '')
  if (!query) {
    const error = new Error('query is required')
    error.statusCode = 400
    throw error
  }

  const limit = Math.min(1000, Math.max(1, Number(params?.limit || 200)))
  const flags = params?.caseSensitive ? 'g' : 'gi'
  let matcher
  try {
    matcher = params?.regex
      ? new RegExp(query, flags)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  } catch {
    const error = new Error('Invalid regular expression')
    error.statusCode = 400
    throw error
  }

  const files = await walkFiles(root, [], context)
  const matches = []

  // Stat and filter files in parallel, then grep in parallel batches
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

  // Grep with bounded concurrency — short-circuit when limit reached
  let matchCount = 0
  for (let batchStart = 0; batchStart < candidates.length && matchCount < limit; batchStart += 20) {
    const batch = candidates.slice(batchStart, batchStart + 20)
    const batchMatches = await Promise.all(
      batch.map(async (file) => {
        if (matchCount >= limit) return []
        try {
          const text = await fs.readFile(file, 'utf8')
          const lines = splitLines(text)
          const fileMatches = []
          for (let index = 0; index < lines.length && (matchCount + fileMatches.length) < limit; index++) {
            matcher.lastIndex = 0
            if (matcher.test(lines[index])) {
              fileMatches.push(`${toWorkspaceRelative(file, context)}:${index + 1}: ${lines[index]}`)
            }
          }
          return fileMatches
        } catch {
          return []
        }
      }),
    )
    for (const fm of batchMatches) {
      if (matchCount >= limit) break
      for (const m of fm) {
        if (matchCount >= limit) break
        matches.push(m)
        matchCount++
      }
    }
  }

  return {
    content: matches.length ? truncateText(matches.join('\n')) : 'No matches found.',
    details: { path: toWorkspaceRelative(root, context), project: context?.project, query, count: matches.length, limit },
  }
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
export async function toolRunCommand(params, context) {
  const command = String(params?.command || '')
  if (!command.trim()) {
    const error = new Error('command is required')
    error.statusCode = 400
    throw error
  }

  const timeoutMs = Math.min(10 * 60, Math.max(1, Number(params?.timeoutSeconds || 60))) * 1000

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: getToolWorkspaceRoot(context),
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout = truncateText(stdout + chunk.toString())
    })
    child.stderr.on('data', (chunk) => {
      stderr = truncateText(stderr + chunk.toString())
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const content = [
        `Command: ${command}`,
        `Exit code: ${code ?? 'unknown'}${signal ? `, signal: ${signal}` : ''}${timedOut ? ' (timed out)' : ''}`,
        '',
        'STDOUT:',
        stdout || '(empty)',
        '',
        'STDERR:',
        stderr || '(empty)',
      ].join('\n')
      resolve({ content: truncateText(content), details: { command, project: context?.project, cwd: getToolWorkspaceRoot(context), code, signal, timedOut } })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        isError: true,
        content: truncateText(`Error running command: ${err.message}`),
        details: { command, project: context?.project, error: err.message },
      })
    })
  })
}

export const toolHandlers = {
  get_project_info: toolGetProjectInfo,
  list_dir: toolListDir,
  read_file: toolReadFile,
  grep_files: toolGrepFiles,
  write_file: toolWriteFile,
  edit_file: toolEditFile,
  run_command: toolRunCommand,
  activate_skill: toolActivateSkill,
  read_skill_resource: toolReadSkillResource,
}

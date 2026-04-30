import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { resolveWorkspacePath, toWorkspaceRelative, assertSafeWorkspacePath, truncateText, splitLines, shouldSkipSearchDir, shouldSearchFile, isSensitiveWorkspacePath } from '../utils/workspace.mjs'
import { readProjectConfig, getActiveProject } from '../project-config.mjs'
import { getWorkspaceRoot, getToolWorkspaceRoot } from '../utils/workspace.mjs'

// --- list_dir ---
export async function toolListDir(params, context) {
  const dir = resolveWorkspacePath(params?.path || '.', context)
  assertSafeWorkspacePath(dir, context)

  const entries = await fs.readdir(dir, { withFileTypes: true })
  const rows = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name)
    const stat = await fs.stat(fullPath).catch(() => null)
    return {
      name: `${entry.name}${entry.isDirectory() ? '/' : ''}`,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
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
  assertSafeWorkspacePath(file, context)

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
export async function toolGrepFiles(params, context) {
  const root = resolveWorkspacePath(params?.path || '.', context)
  assertSafeWorkspacePath(root, context)

  const query = String(params?.query || '')
  if (!query) {
    const error = new Error('query is required')
    error.statusCode = 400
    throw error
  }

  const limit = Math.min(1000, Math.max(1, Number(params?.limit || 200)))
  const flags = params?.caseSensitive ? 'g' : 'gi'
  const matcher = params?.regex
    ? new RegExp(query, flags)
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)

  const files = await walkFiles(root, [], context)
  const matches = []

  for (const file of files) {
    if (matches.length >= limit) break
    const stat = await fs.stat(file)
    if (stat.size > 1024 * 1024) continue

    const text = await fs.readFile(file, 'utf8').catch(() => '')
    const lines = splitLines(text)
    for (let index = 0; index < lines.length && matches.length < limit; index++) {
      matcher.lastIndex = 0
      if (matcher.test(lines[index])) {
        matches.push(`${toWorkspaceRelative(file, context)}:${index + 1}: ${lines[index]}`)
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
  assertSafeWorkspacePath(file, context)

  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, String(params?.content ?? ''), 'utf8')

  return {
    content: `Wrote ${toWorkspaceRelative(file, context)}`,
    details: { path: toWorkspaceRelative(file, context), project: context?.project, bytes: Buffer.byteLength(String(params?.content ?? ''), 'utf8') },
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
  assertSafeWorkspacePath(file, context)

  const oldText = String(params?.oldText ?? '')
  const newText = String(params?.newText ?? '')
  const text = await fs.readFile(file, 'utf8')
  const count = countOccurrences(text, oldText)

  if (count !== 1) {
    const error = new Error(`oldText must match exactly once; found ${count} matches`)
    error.statusCode = 400
    throw error
  }

  await fs.writeFile(file, text.replace(oldText, newText), 'utf8')

  return {
    content: `Edited ${toWorkspaceRelative(file, context)}`,
    details: { path: toWorkspaceRelative(file, context), project: context?.project, replaced: count },
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
  })
}

// --- get_project_info ---
export async function toolGetProjectInfo(_params, context) {
  if (context?.project) {
    return {
      content: `Project: ${context.project.name}\nRoot: ${context.project.path}`,
      details: { project: context.project, workspaceRoot: context.workspaceRoot },
    }
  }

  const config = await readProjectConfig()
  const project = getActiveProject(config)
  return {
    content: `Active project: ${project.name}\nRoot: ${project.path}`,
    details: { project, workspaceRoot: getWorkspaceRoot() },
  }
}

// Helper for grep
async function walkFiles(root, files = [], context) {
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (!shouldSkipSearchDir(entry.name)) await walkFiles(fullPath, files, context)
    } else if (entry.isFile() && shouldSearchFile(entry.name) && !isSensitiveWorkspacePath(fullPath, context)) {
      files.push(fullPath)
    }
  }
  return files
}

export const toolHandlers = {
  get_project_info: toolGetProjectInfo,
  list_dir: toolListDir,
  read_file: toolReadFile,
  grep_files: toolGrepFiles,
  write_file: toolWriteFile,
  edit_file: toolEditFile,
  run_command: toolRunCommand,
}

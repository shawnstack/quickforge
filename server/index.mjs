#!/usr/bin/env node
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const defaultWorkspaceRoot = path.resolve(process.env.QUICKFORGE_WORKSPACE_DIR || process.env.FASTCODE_WORKSPACE_DIR || projectRoot)
let activeWorkspaceRoot = defaultWorkspaceRoot
const isDev = process.argv.includes('--dev')
const host = process.env.QUICKFORGE_HOST || process.env.FASTCODE_HOST || '127.0.0.1'
const port = Number(process.env.QUICKFORGE_PORT || process.env.FASTCODE_PORT || (isDev ? 32176 : 5176))
const vitePort = Number(process.env.QUICKFORGE_VITE_PORT || process.env.FASTCODE_VITE_PORT || 5176)
const maxBodyBytes = Number(process.env.QUICKFORGE_MAX_BODY_BYTES || process.env.FASTCODE_MAX_BODY_BYTES || 50 * 1024 * 1024)

const stores = new Set([
  'settings',
  'provider-keys',
  'custom-providers',
  'sessions',
  'sessions-metadata',
])

const defaultDataDir = path.join(os.homedir(), '.quickforge')

function platformDataDir(appName) {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName)
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName)
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName)
}

function getDataDir() {
  if (process.env.QUICKFORGE_DATA_DIR) return path.resolve(process.env.QUICKFORGE_DATA_DIR)
  if (process.env.FASTCODE_DATA_DIR) return path.resolve(process.env.FASTCODE_DATA_DIR)

  return defaultDataDir
}

const dataDir = getDataDir()
const storageDir = path.join(dataDir, 'storage')

function storeFile(storeName) {
  return path.join(storageDir, `${storeName}.json`)
}

function projectConfigFile() {
  return path.join(storageDir, 'project.json')
}

const writeQueues = new Map()

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function uniquePaths(paths) {
  const seen = new Set()
  return paths.filter((item) => {
    const resolved = path.resolve(item)
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function readJsonObject(file) {
  try {
    const text = await fs.readFile(file, 'utf8')
    const parsed = text.trim() ? JSON.parse(text) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function mergeJsonObjectFile(sourceFile, targetFile) {
  const source = await readJsonObject(sourceFile)
  if (!source) return false

  const target = (await readJsonObject(targetFile)) ?? {}
  let changed = false
  for (const [key, value] of Object.entries(source)) {
    if (Object.hasOwn(target, key)) continue
    target[key] = value
    changed = true
  }

  if (!changed) return false

  await fs.mkdir(path.dirname(targetFile), { recursive: true })
  const tmp = `${targetFile}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(target, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, targetFile)
  return true
}

async function copyMissingRecursive(source, target) {
  const stat = await fs.stat(source).catch(() => null)
  if (!stat) return false

  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true })
    let copied = false
    const entries = await fs.readdir(source, { withFileTypes: true })
    for (const entry of entries) {
      copied = (await copyMissingRecursive(path.join(source, entry.name), path.join(target, entry.name))) || copied
    }
    return copied
  }

  if (!stat.isFile() || (await exists(target))) return false

  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
  return true
}

async function migrateLegacyDataDir(sourceDir) {
  const resolvedSource = path.resolve(sourceDir)
  const resolvedTarget = path.resolve(dataDir)
  const sourceKey = process.platform === 'win32' ? resolvedSource.toLowerCase() : resolvedSource
  const targetKey = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget
  if (sourceKey === targetKey) return false

  const sourceStorageDir = path.join(resolvedSource, 'storage')
  if (!(await exists(sourceStorageDir))) return false

  await fs.mkdir(storageDir, { recursive: true })

  let migrated = false
  for (const store of stores) {
    const sourceFile = path.join(sourceStorageDir, `${store}.json`)
    const targetFile = storeFile(store)
    if (!(await exists(sourceFile))) continue
    if (await exists(targetFile)) {
      migrated = (await mergeJsonObjectFile(sourceFile, targetFile)) || migrated
    } else {
      await fs.copyFile(sourceFile, targetFile)
      migrated = true
    }
  }

  const sourceProjectFile = path.join(sourceStorageDir, 'project.json')
  if ((await exists(sourceProjectFile)) && !(await exists(projectConfigFile()))) {
    await fs.copyFile(sourceProjectFile, projectConfigFile())
    migrated = true
  }

  migrated = (await copyMissingRecursive(sourceStorageDir, storageDir)) || migrated
  if (migrated) console.log(`Migrated legacy QuickForge data from ${resolvedSource} to ${resolvedTarget}`)
  return migrated
}

async function migrateLegacyDataDirs() {
  if (process.env.QUICKFORGE_DATA_DIR || process.env.FASTCODE_DATA_DIR) return

  const legacyDirs = uniquePaths([
    platformDataDir('QuickForge'),
    platformDataDir('FastCode'),
    path.join(os.homedir(), '.fastcode'),
  ])

  for (const dir of legacyDirs) {
    await migrateLegacyDataDir(dir)
  }
}

async function ensureStorage() {
  await fs.mkdir(storageDir, { recursive: true })
  await Promise.all(
    [...stores].map(async (store) => {
      const file = storeFile(store)
      if (!existsSync(file)) await fs.writeFile(file, '{}\n', 'utf8')
    }),
  )
}

function projectNameFromPath(dir) {
  return path.basename(dir) || dir
}

function defaultProjectConfig() {
  const now = new Date().toISOString()
  const id = 'default'
  return {
    activeProjectId: id,
    projects: [
      {
        id,
        name: projectNameFromPath(defaultWorkspaceRoot),
        path: defaultWorkspaceRoot,
        lastOpenedAt: now,
      },
    ],
  }
}

async function readProjectConfig() {
  await ensureStorage()
  const file = projectConfigFile()
  try {
    const text = await fs.readFile(file, 'utf8')
    const parsed = text.trim() ? JSON.parse(text) : defaultProjectConfig()
    if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) return defaultProjectConfig()
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultProjectConfig()
    throw error
  }
}

async function writeProjectConfig(config) {
  await ensureStorage()
  const file = projectConfigFile()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, file)
}

function getActiveProject(config) {
  return config.projects.find((project) => project.id === config.activeProjectId) || config.projects[0]
}

async function assertDirectory(dir) {
  const stat = await fs.stat(dir).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    const error = new Error(`Project directory does not exist: ${dir}`)
    error.statusCode = 400
    throw error
  }
}

async function setActiveProjectPath(inputPath) {
  const resolved = path.resolve(String(inputPath || ''))
  await assertDirectory(resolved)

  const config = await readProjectConfig()
  const now = new Date().toISOString()
  let project = config.projects.find((item) => path.resolve(item.path) === resolved)
  if (!project) {
    project = {
      id: randomUUID(),
      name: projectNameFromPath(resolved),
      path: resolved,
      lastOpenedAt: now,
    }
    config.projects.unshift(project)
  } else {
    project.name = projectNameFromPath(resolved)
    project.path = resolved
    project.lastOpenedAt = now
  }

  config.activeProjectId = project.id
  config.projects = [project, ...config.projects.filter((item) => item.id !== project.id)].slice(0, 20)
  await writeProjectConfig(config)
  activeWorkspaceRoot = resolved
  return { project, projects: config.projects }
}

async function initializeActiveProject() {
  const config = await readProjectConfig()
  const activeProject = getActiveProject(config)
  if (activeProject?.path) {
    try {
      await assertDirectory(activeProject.path)
      activeWorkspaceRoot = path.resolve(activeProject.path)
      return
    } catch {
      // Fall back to the app project if the stored project was removed.
    }
  }

  const fallback = await setActiveProjectPath(defaultWorkspaceRoot)
  activeWorkspaceRoot = path.resolve(fallback.project.path)
}

async function readStore(storeName) {
  assertStore(storeName)
  await ensureStorage()
  const file = storeFile(storeName)
  try {
    const text = await fs.readFile(file, 'utf8')
    return text.trim() ? JSON.parse(text) : {}
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

async function writeStore(storeName, data) {
  assertStore(storeName)
  const previous = writeQueues.get(storeName) || Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await ensureStorage()
      const file = storeFile(storeName)
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      await fs.rename(tmp, file)
    })
  writeQueues.set(storeName, next)
  return next
}

function assertStore(storeName) {
  if (!stores.has(storeName)) {
    const error = new Error(`Unknown storage store: ${storeName}`)
    error.statusCode = 404
    throw error
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendError(res, error) {
  const status = error?.statusCode || 500
  sendJson(res, status, { error: error?.message || 'Internal server error' })
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBodyBytes) {
      const error = new Error('Request body is too large')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : null
}

function decodeSegment(value) {
  return decodeURIComponent(value || '')
}

function getComparable(value, key) {
  if (!value || typeof value !== 'object') return undefined
  return key.split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return current[part]
  }, value)
}

async function directorySize(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const sizes = await Promise.all(entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return directorySize(full)
      const stat = await fs.stat(full)
      return stat.size
    }))
    return sizes.reduce((sum, value) => sum + value, 0)
  } catch {
    return 0
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function getWorkspaceRoot() {
  return activeWorkspaceRoot
}

function getToolWorkspaceRoot(context) {
  return context?.workspaceRoot || getWorkspaceRoot()
}

function resolveWorkspacePath(input = '.', context) {
  const workspaceRoot = getToolWorkspaceRoot(context)
  const candidate = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(workspaceRoot, input)

  if (!isInside(workspaceRoot, candidate)) {
    const error = new Error(`Path is outside the selected project: ${input}`)
    error.statusCode = 403
    throw error
  }

  return candidate
}

function toWorkspaceRelative(fullPath, context) {
  return path.relative(getToolWorkspaceRoot(context), fullPath).replace(/\\/g, '/') || '.'
}

function isSensitiveWorkspacePath(fullPath, context) {
  const relative = toWorkspaceRelative(fullPath, context)
  const parts = relative.split('/')
  const name = parts.at(-1) || ''
  return (
    parts.includes('.git') ||
    name === '.env' ||
    name.startsWith('.env.') ||
    name.endsWith('.pem') ||
    name.endsWith('.key') ||
    name.endsWith('.p12') ||
    name.endsWith('.pfx') ||
    name.endsWith('.crt') ||
    name.endsWith('.cer') ||
    name.endsWith('.token') ||
    name === 'credentials.json' ||
    name === 'secrets.json' ||
    name === 'id_rsa' ||
    name === 'id_ed25519'
  )
}

function assertSafeWorkspacePath(fullPath, context) {
  if (isSensitiveWorkspacePath(fullPath, context)) {
    const error = new Error(`Access to sensitive path is blocked: ${toWorkspaceRelative(fullPath, context)}`)
    error.statusCode = 403
    throw error
  }
}

function truncateText(text, maxChars = 50000) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} characters]`
}

function splitLines(text) {
  return text.split(/\r?\n/)
}

async function toolListDir(params, context) {
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

async function toolReadFile(params, context) {
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

function shouldSkipSearchDir(name) {
  return ['.git', 'node_modules', 'dist', 'dist-ssr', '.vite'].includes(name)
}

function shouldSearchFile(name) {
  const lower = name.toLowerCase()
  const blocked = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.7z', '.exe', '.dll', '.woff', '.woff2', '.ttf']
  return !blocked.some((extension) => lower.endsWith(extension))
}

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

async function toolGrepFiles(params, context) {
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

async function toolWriteFile(params, context) {
  const file = resolveWorkspacePath(params?.path, context)
  assertSafeWorkspacePath(file, context)

  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, String(params?.content ?? ''), 'utf8')

  return {
    content: `Wrote ${toWorkspaceRelative(file, context)}`,
    details: { path: toWorkspaceRelative(file, context), project: context?.project, bytes: Buffer.byteLength(String(params?.content ?? ''), 'utf8') },
  }
}

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

async function toolEditFile(params, context) {
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

async function toolRunCommand(params, context) {
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

async function toolGetProjectInfo(_params, context) {
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

const toolHandlers = {
  get_project_info: toolGetProjectInfo,
  list_dir: toolListDir,
  read_file: toolReadFile,
  grep_files: toolGrepFiles,
  write_file: toolWriteFile,
  edit_file: toolEditFile,
  run_command: toolRunCommand,
}

function spawnCollect(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function selectDirectoryDialog() {
  if (process.platform === 'win32') {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select QuickForge project folder'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`
    const result = await spawnCollect('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script])
    if (result.code === 0) return result.stdout.trim()
    const error = new Error(result.stderr.trim() || 'Failed to open folder picker')
    error.statusCode = 500
    throw error
  }

  if (process.platform === 'darwin') {
    const result = await spawnCollect('osascript', ['-e', 'POSIX path of (choose folder with prompt "Select QuickForge project folder")'])
    if (result.code === 0) return result.stdout.trim()
    if (/User canceled/i.test(result.stderr)) return ''
    const error = new Error(result.stderr.trim() || 'Failed to open folder picker')
    error.statusCode = 500
    throw error
  }

  const zenity = await spawnCollect('zenity', ['--file-selection', '--directory', '--title=Select QuickForge project folder']).catch(() => null)
  if (zenity) {
    if (zenity.code === 0) return zenity.stdout.trim()
    if (zenity.code === 1) return ''
  }

  const kdialog = await spawnCollect('kdialog', ['--getexistingdirectory', os.homedir(), 'Select QuickForge project folder']).catch(() => null)
  if (kdialog) {
    if (kdialog.code === 0) return kdialog.stdout.trim()
    if (kdialog.code === 1) return ''
  }

  const error = new Error('No supported folder picker found. Install zenity or kdialog on Linux.')
  error.statusCode = 501
  throw error
}

async function handleProjectApi(req, res, url) {
  const config = await readProjectConfig()

  if (req.method === 'GET' && url.pathname === '/api/project') {
    sendJson(res, 200, { project: getActiveProject(config), projects: config.projects, workspaceRoot: getWorkspaceRoot() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/project/select-directory') {
    const selectedPath = await selectDirectoryDialog()
    if (!selectedPath) {
      sendJson(res, 200, { cancelled: true, project: getActiveProject(config), projects: config.projects })
      return
    }
    const result = await setActiveProjectPath(selectedPath)
    sendJson(res, 200, { cancelled: false, ...result, workspaceRoot: getWorkspaceRoot() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/project/active') {
    const body = await readJsonBody(req)
    const selected = config.projects.find((project) => project.id === body?.id)
    if (!selected) {
      const error = new Error('Unknown project')
      error.statusCode = 404
      throw error
    }
    const result = await setActiveProjectPath(selected.path)
    sendJson(res, 200, { ...result, workspaceRoot: getWorkspaceRoot() })
    return
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/project/')) {
    const id = decodeSegment(url.pathname.split('/').filter(Boolean)[2])
    const nextProjects = config.projects.filter((project) => project.id !== id)
    if (nextProjects.length === config.projects.length) {
      const error = new Error('Unknown project')
      error.statusCode = 404
      throw error
    }
    config.projects = nextProjects.length ? nextProjects : defaultProjectConfig().projects
    if (config.activeProjectId === id) config.activeProjectId = config.projects[0].id
    await writeProjectConfig(config)
    const active = getActiveProject(config)
    activeWorkspaceRoot = path.resolve(active.path)
    sendJson(res, 200, { project: active, projects: config.projects, workspaceRoot: getWorkspaceRoot() })
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

async function projectContextFromId(projectId) {
  const config = await readProjectConfig()
  const project = config.projects.find((item) => item.id === projectId)
  if (!project) {
    const error = new Error('Unknown project')
    error.statusCode = 404
    throw error
  }

  await assertDirectory(project.path)
  return { project, workspaceRoot: path.resolve(project.path) }
}

async function handleToolApi(req, res, url) {
  if (req.method !== 'POST') {
    const error = new Error('Tool endpoints require POST')
    error.statusCode = 405
    throw error
  }

  const parts = url.pathname.split('/').filter(Boolean)
  let name = decodeSegment(parts[2])
  let context

  if (parts[1] === 'projects' && parts[3] === 'tools') {
    context = await projectContextFromId(decodeSegment(parts[2]))
    name = decodeSegment(parts[4])
  }

  const handler = toolHandlers[name]
  if (!handler) {
    const error = new Error(`Unknown tool: ${name}`)
    error.statusCode = 404
    throw error
  }

  const params = await readJsonBody(req)
  const result = await handler(params || {}, context)
  sendJson(res, 200, result)
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && url.pathname === '/api/health') {
    const config = await readProjectConfig()
    sendJson(res, 200, {
      ok: true,
      mode: isDev ? 'development' : 'production',
      dataDir,
      storageDir,
      workspaceRoot: getWorkspaceRoot(),
      project: getActiveProject(config),
    })
    return
  }

  if (url.pathname === '/api/project' || url.pathname.startsWith('/api/project/')) {
    await handleProjectApi(req, res, url)
    return
  }

  if (url.pathname.startsWith('/api/tools/') || (parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'tools')) {
    await handleToolApi(req, res, url)
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/storage/quota') {
    const usage = await directorySize(storageDir)
    sendJson(res, 200, { usage, quota: 0, percent: 0 })
    return
  }

  if (parts[0] !== 'api' || parts[1] !== 'storage') {
    const error = new Error('Not found')
    error.statusCode = 404
    throw error
  }

  const store = decodeSegment(parts[2])
  assertStore(store)

  if (req.method === 'GET' && parts[3] === 'keys') {
    const prefix = url.searchParams.get('prefix') || ''
    const data = await readStore(store)
    const keys = Object.keys(data).filter((key) => !prefix || key.startsWith(prefix))
    sendJson(res, 200, { keys })
    return
  }

  if (req.method === 'GET' && parts[3] === 'index') {
    const indexName = decodeSegment(parts[4])
    const direction = url.searchParams.get('direction') === 'desc' ? 'desc' : 'asc'
    const data = await readStore(store)
    const values = Object.values(data)
    values.sort((a, b) => {
      const left = getComparable(a, indexName)
      const right = getComparable(b, indexName)
      if (left === right) return 0
      if (left === undefined || left === null) return direction === 'desc' ? 1 : -1
      if (right === undefined || right === null) return direction === 'desc' ? -1 : 1
      const result = String(left).localeCompare(String(right))
      return direction === 'desc' ? -result : result
    })
    sendJson(res, 200, { values })
    return
  }

  if (req.method === 'DELETE' && parts.length === 3) {
    await writeStore(store, {})
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && parts[3] === 'has') {
    const key = decodeSegment(parts[4])
    const data = await readStore(store)
    sendJson(res, 200, { exists: Object.prototype.hasOwnProperty.call(data, key) })
    return
  }

  if (parts[3] === 'key') {
    const key = decodeSegment(parts[4])
    if (!key) {
      const error = new Error('Missing storage key')
      error.statusCode = 400
      throw error
    }

    if (req.method === 'GET') {
      const data = await readStore(store)
      sendJson(res, 200, { value: Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null })
      return
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req)
      const data = await readStore(store)
      data[key] = body?.value
      await writeStore(store, data)
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'DELETE') {
      const data = await readStore(store)
      delete data[key]
      await writeStore(store, data)
      sendJson(res, 200, { ok: true })
      return
    }
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  }[extension] || 'application/octet-stream'
}

async function serveStatic(req, res, url) {
  const distDir = path.join(projectRoot, 'dist')
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
  const normalized = path.normalize(requested).replace(/^([.][.][\/])+/, '')
  let filePath = path.join(distDir, normalized)

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
  } catch {
    filePath = path.join(distDir, 'index.html')
  }

  try {
    const data = await fs.readFile(filePath)
    res.writeHead(200, {
      'content-type': getContentType(filePath),
      'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Build output not found. Run npm run build first.')
  }
}

function openBrowser(url) {
  if (process.env.QUICKFORGE_NO_OPEN === '1' || process.env.FASTCODE_NO_OPEN === '1') return

  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false })
  child.unref()
}

function startVite() {
  const isWindows = process.platform === 'win32'
  const command = isWindows ? 'npm.cmd' : 'npm'
  const child = spawn(command, ['run', 'dev:web'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: isWindows,
    env: { ...process.env, QUICKFORGE_SERVER_PORT: String(port) },
  })
  child.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code
  })
  process.on('exit', () => child.kill())
  process.on('SIGINT', () => {
    child.kill('SIGINT')
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    child.kill('SIGTERM')
    process.exit(0)
  })
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
      return
    }

    if (isDev) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('QuickForge local API server is running. Open the Vite app at http://127.0.0.1:5176')
      return
    }

    await serveStatic(req, res, url)
  } catch (error) {
    console.error(error)
    sendError(res, error)
  }
})

await migrateLegacyDataDirs()
await ensureStorage()
await initializeActiveProject()

server.listen(port, host, () => {
  console.log(`QuickForge local API: http://${host}:${port}`)
  console.log(`QuickForge data dir: ${dataDir}`)
  console.log(`QuickForge project: ${getWorkspaceRoot()}`)

  if (isDev) {
    startVite()
    setTimeout(() => openBrowser(`http://localhost:${vitePort}`), 1000)
  } else {
    openBrowser(`http://localhost:${port}`)
  }
})

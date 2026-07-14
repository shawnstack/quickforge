import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dataDir, readStore } from './storage.mjs'

export const GLOBAL_MEMORY_SETTINGS_KEY = 'memory-settings'
export const GLOBAL_MEMORY_FILE_NAME = 'MEMORY.md'
export const DEFAULT_GLOBAL_MEMORY_SETTINGS = { enabled: true }

const MAX_MEMORY_FILE_BYTES = 16 * 1024

let memoryWriteQueue = Promise.resolve()

export function normalizeGlobalMemorySettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_GLOBAL_MEMORY_SETTINGS }
  return { enabled: value.enabled !== false }
}

export async function readGlobalMemorySettings() {
  const settings = await readStore('settings')
  return normalizeGlobalMemorySettings(settings?.[GLOBAL_MEMORY_SETTINGS_KEY])
}

export async function isGlobalMemoryEnabled() {
  return (await readGlobalMemorySettings()).enabled
}

export function globalMemoryFilePath(baseDir = dataDir) {
  return path.join(baseDir, GLOBAL_MEMORY_FILE_NAME)
}

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

export function containsSensitiveMemory(value) {
  const text = String(value || '')
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/,
    /\bauthorization\s*:\s*bearer\s+\S+/i,
    /\bcookie\s*:\s*\S+/i,
    /\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|password|passwd|secret)\s*(?:is|是|为|:|=)\s*\S{8,}/i,
    /(?:^|\n)\s*[A-Z][A-Z0-9_]{2,}\s*=\s*[^\s]{8,}(?:\n|$)/,
  ]
  return patterns.some((pattern) => pattern.test(text))
}

function validateGlobalMemoryMarkdown(markdown) {
  if (typeof markdown !== 'string') throw requestError('Memory Markdown is required.')
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MEMORY_FILE_BYTES) throw requestError('Global memory exceeds the size limit.')
  if (containsSensitiveMemory(markdown)) throw requestError('Sensitive credentials or secrets cannot be stored in global memory.')
  return markdown
}

export async function getGlobalMemoryRevision(options = {}) {
  const file = globalMemoryFilePath(options.dataDir)
  try {
    const content = await fs.readFile(file)
    return createHash('sha256').update(content).digest('hex')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function readGlobalMemory(options = {}) {
  const file = globalMemoryFilePath(options.dataDir)
  try {
    const markdown = await fs.readFile(file, 'utf8')
    return { file, markdown }
  } catch (error) {
    if (error?.code === 'ENOENT') return { file, markdown: '' }
    throw error
  }
}

export async function readGlobalMemoryDocument(options = {}) {
  const memory = await readGlobalMemory(options)
  return {
    enabled: options.enabled === undefined ? await isGlobalMemoryEnabled() : options.enabled,
    markdown: memory.markdown,
    path: '~/.quickforge/MEMORY.md',
  }
}

async function writeGlobalMemoryMarkdown(markdown, options = {}) {
  const file = globalMemoryFilePath(options.dataDir)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, markdown, 'utf8')
  await fs.rename(temporary, file)
  return file
}

function withMemoryWriteLock(operation) {
  const result = memoryWriteQueue.then(operation, operation)
  memoryWriteQueue = result.catch(() => undefined)
  return result
}

async function assertMemoryEnabled(options) {
  const enabled = options.enabled === undefined ? await isGlobalMemoryEnabled() : options.enabled
  if (!enabled) throw requestError('Global memory is disabled in Settings.', 403)
}

export async function saveGlobalMemoryDocument(markdown, options = {}) {
  await assertMemoryEnabled(options)
  const validated = validateGlobalMemoryMarkdown(markdown)
  return withMemoryWriteLock(async () => {
    const file = await writeGlobalMemoryMarkdown(validated, options)
    return {
      enabled: true,
      markdown: validated,
      path: '~/.quickforge/MEMORY.md',
      file,
      chars: validated.length,
    }
  })
}

export async function readGlobalMemoryPrompt(options = {}) {
  if (options.enabled === false) return null
  if (options.enabled === undefined && !(await isGlobalMemoryEnabled())) return null
  const memory = await readGlobalMemory(options)
  return {
    source: '~/.quickforge/MEMORY.md',
    content: memory.markdown.trim() || null,
    enabled: true,
  }
}

export async function manageGlobalMemory(params = {}, options = {}) {
  await assertMemoryEnabled(options)
  const action = String(params.action || '').trim().toLowerCase()

  if (action === 'read') {
    const memory = await readGlobalMemory(options)
    return {
      content: memory.markdown || 'Global user memory is empty.',
      details: {
        action,
        status: memory.markdown ? 'loaded' : 'empty',
        markdown: memory.markdown,
        chars: memory.markdown.length,
        path: '~/.quickforge/MEMORY.md',
      },
    }
  }

  if (action === 'write') {
    const saved = await saveGlobalMemoryDocument(params.markdown, options)
    return {
      content: 'Global user memory saved.',
      details: {
        action,
        status: 'saved',
        markdown: saved.markdown,
        chars: saved.chars,
        path: saved.path,
      },
    }
  }

  throw requestError('Memory action must be read or write.')
}

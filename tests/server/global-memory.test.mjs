import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  containsSensitiveMemory,
  getGlobalMemoryRevision,
  globalMemoryFilePath,
  manageGlobalMemory,
  readGlobalMemory,
  readGlobalMemoryDocument,
  readGlobalMemoryPrompt,
  saveGlobalMemoryDocument,
} from '../../server/global-memory.mjs'

const tempDirs = []

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-memory-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('global memory', () => {
  it('reads an empty document when the file does not exist', async () => {
    const dataDir = await createTempDir()
    await expect(readGlobalMemory({ dataDir })).resolves.toEqual({
      file: globalMemoryFilePath(dataDir),
      markdown: '',
    })
    await expect(readGlobalMemoryDocument({ dataDir, enabled: false })).resolves.toMatchObject({
      enabled: false,
      markdown: '',
      path: '~/.quickforge/MEMORY.md',
    })
  })

  it('saves free-form Markdown exactly as provided', async () => {
    const dataDir = await createTempDir()
    const markdown = '# 我的记忆\n\n我主要使用中文沟通。\n\n| 工具 | 偏好 |\n| --- | --- |\n| Python | 使用虚拟环境 |\n'
    const saved = await saveGlobalMemoryDocument(markdown, { dataDir, enabled: true })

    expect(saved.markdown).toBe(markdown)
    expect(saved.chars).toBe(markdown.length)
    await expect(fs.readFile(globalMemoryFilePath(dataDir), 'utf8')).resolves.toBe(markdown)
    await expect(readGlobalMemoryPrompt({ dataDir, enabled: true })).resolves.toMatchObject({
      content: markdown.trim(),
      enabled: true,
    })
  })

  it('reads and writes the complete document through the agent tool', async () => {
    const dataDir = await createTempDir()
    const options = { dataDir, enabled: true }
    const markdown = '# Preferences\n\nUse Chinese by default.\n'

    const written = await manageGlobalMemory({ action: 'write', markdown }, options)
    expect(written.content).toBe('Global user memory saved.')
    expect(written.details).toMatchObject({ action: 'write', status: 'saved', markdown })

    const read = await manageGlobalMemory({ action: 'read' }, options)
    expect(read.content).toBe(markdown)
    expect(read.details).toMatchObject({ action: 'read', status: 'loaded', markdown })
  })

  it('returns a stable empty status when the memory document is empty', async () => {
    const dataDir = await createTempDir()
    const read = await manageGlobalMemory({ action: 'read' }, { dataDir, enabled: true })

    expect(read.content).toBe('Global user memory is empty.')
    expect(read.details).toMatchObject({
      action: 'read',
      status: 'empty',
      markdown: '',
      chars: 0,
    })
  })

  it('rejects disabled writes and keeps existing data', async () => {
    const dataDir = await createTempDir()
    const markdown = '# Existing memory\n'
    await saveGlobalMemoryDocument(markdown, { dataDir, enabled: true })

    await expect(manageGlobalMemory({ action: 'write', markdown: '# Replacement\n' }, { dataDir, enabled: false }))
      .rejects.toThrow('Global memory is disabled')
    await expect(fs.readFile(globalMemoryFilePath(dataDir), 'utf8')).resolves.toBe(markdown)
  })

  it('rejects credentials, secrets, and oversized documents', async () => {
    const dataDir = await createTempDir()
    expect(containsSensitiveMemory('API key is sk-abcdefghijklmnopqrstuvwxyz')).toBe(true)
    await expect(saveGlobalMemoryDocument('API key is sk-abcdefghijklmnopqrstuvwxyz', { dataDir, enabled: true }))
      .rejects.toThrow('Sensitive credentials')
    await expect(saveGlobalMemoryDocument('x'.repeat(16 * 1024 + 1), { dataDir, enabled: true }))
      .rejects.toThrow('size limit')
  })

  it('updates the file revision when the document changes', async () => {
    const dataDir = await createTempDir()
    expect(await getGlobalMemoryRevision({ dataDir })).toBeNull()
    await saveGlobalMemoryDocument('# One\n', { dataDir, enabled: true })
    const first = await getGlobalMemoryRevision({ dataDir })
    await saveGlobalMemoryDocument('# Two\n', { dataDir, enabled: true })
    expect(await getGlobalMemoryRevision({ dataDir })).not.toBe(first)
  })
})

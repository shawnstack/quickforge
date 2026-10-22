import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storageMocks = vi.hoisted(() => ({ logsDir: '' }))

vi.mock('../../../server/storage.mjs', () => ({
  get logsDir() { return storageMocks.logsDir },
}))

const tempDirs = []

async function makeLogDir() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qf-command-log-'))
  tempDirs.push(root)
  const commands = path.join(root, 'logs', 'commands')
  await mkdir(commands, { recursive: true })
  storageMocks.logsDir = path.join(root, 'logs')
  return commands
}

beforeEach(() => {
  tempDirs.length = 0
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})))
})

describe('isCommandLogPath', () => {
  it('accepts only .log files inside <logsDir>/commands', async () => {
    const { isCommandLogPath } = await import('../../../server/utils/command-log.mjs')
    const commands = await makeLogDir()

    expect(isCommandLogPath(path.join(commands, 'a.log'))).toBe(true)
    expect(isCommandLogPath(path.join(commands, 'nested', 'a.log'))).toBe(true)
    expect(isCommandLogPath(path.join(commands, 'a.txt'))).toBe(false)
    expect(isCommandLogPath(commands)).toBe(false)
    expect(isCommandLogPath(path.join(commands, '..', 'other', 'a.log'))).toBe(false)
    expect(isCommandLogPath(path.join(commands, '..', '..', 'config.json'))).toBe(false)
    expect(isCommandLogPath('')).toBe(false)
    expect(isCommandLogPath(undefined)).toBe(false)
  })
})

describe('readCommandLog', () => {
  it('returns a readonly file response shaped like /api/workspace/file', async () => {
    const { readCommandLog } = await import('../../../server/utils/command-log.mjs')
    const commands = await makeLogDir()
    const file = path.join(commands, 'a.log')
    await writeFile(file, 'line 1\nline 2\nline 3\n', 'utf8')

    const result = await readCommandLog(file)

    expect(result).toMatchObject({
      path: path.resolve(file),
      content: 'line 1\nline 2\nline 3\n',
      language: 'plaintext',
      readonly: true,
      totalLines: 4,
      truncated: false,
    })
    expect(result.size).toBeGreaterThan(0)
  })

  it('windows the tail and reports truncation instead of returning a huge log', async () => {
    const { readCommandLog } = await import('../../../server/utils/command-log.mjs')
    const commands = await makeLogDir()
    const file = path.join(commands, 'big.log')
    await writeFile(file, Array.from({ length: 50 }, (_, index) => `row ${index + 1}`).join('\n'), 'utf8')

    const result = await readCommandLog(file, { limit: 10, offset: 41 })

    expect(result.content.split('\n')).toEqual(Array.from({ length: 10 }, (_, index) => `row ${index + 41}`))
    expect(result.totalLines).toBe(50)
    expect(result.truncated).toBe(false)

    const head = await readCommandLog(file, { limit: 10 })
    expect(head.truncated).toBe(true)
  })

  it('rejects paths outside the command log root', async () => {
    const { readCommandLog } = await import('../../../server/utils/command-log.mjs')
    const commands = await makeLogDir()

    await expect(readCommandLog(path.join(commands, '..', '..', 'config.json'))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid command log path',
    })
  })
})

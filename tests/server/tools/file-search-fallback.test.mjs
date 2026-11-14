import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// 数据目录指到本进程专属空临时目录（与 tools/index.test.mjs 同一套路）：避免任何
// 传递依赖摸到用户真实的 ~/.quickforge。
const testDataDir = vi.hoisted(() => {
  const previous = process.env.QUICKFORGE_DATA_DIR
  if (previous) return { dir: null, previous }
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp'
  const dir = base + '/qf-test-grep-fallback-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  process.env.QUICKFORGE_DATA_DIR = dir
  return { dir, previous }
})

// ripgrep 在这台机器上是能用的，所以「Node 回落」这条路径此前从没被真正跑到过：
// tools/index.test.mjs 那组用例自己也在注释里承认「接受 ripgrep 或 node 任一后端」。
// 把解析函数钉成 null，断言才真正落在回落实现上。
vi.mock('../../../server/utils/ripgrep.mjs', () => ({
  resolveRipgrepExecutable: vi.fn(async () => null),
}))

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { toolGrepFiles } from '../../../server/tools/file-search.mjs'
import { setWorkspaceRoot } from '../../../server/utils/workspace.mjs'

let tmpDir
let context

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-grep-fallback-'))
  setWorkspaceRoot(tmpDir)
  context = { workspaceRoot: tmpDir, project: 'test-project' }

  await fs.writeFile(path.join(tmpDir, 'app.js'), 'const helper = () => "needle"\n', 'utf8')
  await fs.mkdir(path.join(tmpDir, 'nested'), { recursive: true })
  await fs.writeFile(path.join(tmpDir, 'nested', 'deep.txt'), 'needle in nested\n', 'utf8')

  // 与 ripgrep 后端 SENSITIVE_EXCLUDE_GLOBS 对应的文件：内容里放一个独特标记，
  // 两个后端一致的判据就是「这个标记一条都不许出现在结果里」。
  await fs.writeFile(path.join(tmpDir, '.env'), 'API_KEY=sk-live-secret\n', 'utf8')
  await fs.writeFile(path.join(tmpDir, '.env.local'), 'API_KEY=sk-live-secret\n', 'utf8')
  await fs.writeFile(path.join(tmpDir, 'id_rsa'), 'sk-live-secret\n', 'utf8')
  await fs.writeFile(path.join(tmpDir, 'server.pem'), 'sk-live-secret\n', 'utf8')
  await fs.writeFile(path.join(tmpDir, 'credentials.json'), '{"token":"sk-live-secret"}\n', 'utf8')
  await fs.mkdir(path.join(tmpDir, 'config'), { recursive: true })
  await fs.writeFile(path.join(tmpDir, 'config', 'secrets.json'), '{"token":"sk-live-secret"}\n', 'utf8')
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  if (!testDataDir.dir) return
  const { flushLogger } = await import('../../../server/utils/logger.mjs')
  flushLogger()
  delete process.env.QUICKFORGE_DATA_DIR
  await fs.rm(testDataDir.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

describe('grep_files Node fallback', () => {
  it('searches the workspace when ripgrep is unavailable', async () => {
    const result = await toolGrepFiles({ query: 'needle' }, context)
    expect(result.details.backend).toBe('node')
    expect(result.details.count).toBeGreaterThanOrEqual(2)
    expect(result.content).toContain('app.js')
    expect(result.content).toContain('deep.txt')
  })

  it('skips the same sensitive files the ripgrep backend excludes', async () => {
    const result = await toolGrepFiles({ query: 'sk-live-secret' }, context)
    expect(result.content).toBe('No matches found.')
    expect(result.details.count).toBe(0)
  })

  it('still skips sensitive files in filesWithMatches mode', async () => {
    const result = await toolGrepFiles({ query: 'sk-live-secret', filesWithMatches: true }, context)
    expect(result.content).toBe('No matches found.')
  })
})

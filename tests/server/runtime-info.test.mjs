import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  buildChildProcessEnv,
  clearRuntimeInfo,
  getRuntimeInfo,
  setRuntimeInfo,
} from '../../server/runtime-info.mjs'
import { toolRunCommand } from '../../server/tools/index.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const skillDir = path.join(repoRoot, 'skills', 'quickforge-api')
const scriptPath = path.join(skillDir, 'scripts', 'qf-api.mjs')
const tempDirs = []

afterEach(async () => {
  clearRuntimeInfo()
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})))
})

describe('runtime-info', () => {
  it('exposes a loopback base URL when the server binds a wildcard host', () => {
    expect(setRuntimeInfo({ host: '0.0.0.0', port: 5176 })).toMatchObject({
      host: '127.0.0.1',
      port: 5176,
      baseUrl: 'http://127.0.0.1:5176',
    })
    expect(getRuntimeInfo()).toMatchObject({ baseUrl: 'http://127.0.0.1:5176' })
  })

  it('keeps an explicit bind host, because 127.0.0.1 would not answer on it', () => {
    expect(setRuntimeInfo({ host: '192.168.1.20', port: 6000 })).toMatchObject({
      baseUrl: 'http://192.168.1.20:6000',
    })
  })

  it('ignores invalid ports instead of producing a broken base URL', () => {
    expect(setRuntimeInfo({ host: 'localhost', port: 0 })).toBeNull()
    expect(setRuntimeInfo({ port: 'nope' })).toBeNull()
    expect(getRuntimeInfo()).toBeNull()
  })

  it('injects identity variables without mutating process.env', () => {
    setRuntimeInfo({ host: '0.0.0.0', port: 5176 })
    const env = buildChildProcessEnv({
      sessionId: 'session-1',
      projectId: 'project-1',
      workspaceRoot: '/tmp/workspace',
    }, { PATH: '/usr/bin' })

    expect(env).toMatchObject({
      PATH: '/usr/bin',
      QUICKFORGE_API_BASE: 'http://127.0.0.1:5176',
      QUICKFORGE_SESSION_ID: 'session-1',
      QUICKFORGE_PROJECT_ID: 'project-1',
      QUICKFORGE_WORKSPACE_ROOT: '/tmp/workspace',
    })
    expect(process.env.QUICKFORGE_SESSION_ID).toBeUndefined()
  })

  it('omits variables it cannot know yet instead of writing empty strings', () => {
    const env = buildChildProcessEnv({}, { PATH: '/usr/bin' })
    expect(env.QUICKFORGE_API_BASE).toBeUndefined()
    expect(env.QUICKFORGE_SESSION_ID).toBeUndefined()
    expect(env.QUICKFORGE_PROJECT_ID).toBeUndefined()
  })
})

describe('run_command identity injection', () => {
  it('hands the session id and API base to the child process', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'quickforge-runtime-info-'))
    tempDirs.push(cwd)
    setRuntimeInfo({ host: '0.0.0.0', port: 5999 })

    const result = await toolRunCommand({
      command: 'node -e "process.stdout.write(JSON.stringify({ base: process.env.QUICKFORGE_API_BASE, session: process.env.QUICKFORGE_SESSION_ID, project: process.env.QUICKFORGE_PROJECT_ID }))"',
    }, {
      workspaceRoot: cwd,
      sessionId: 'session-env-probe',
      projectId: 'project-env-probe',
    }, { toolCallId: 'tool-env-probe' })

    expect(JSON.parse(result.details.stdout)).toEqual({
      base: 'http://127.0.0.1:5999',
      session: 'session-env-probe',
      project: 'project-env-probe',
    })
  }, 30000)
})

describe('quickforge-api skill', () => {
  it('parses as a bundled skill with a description short enough for the catalog', async () => {
    const { promises: fsp } = await import('node:fs')
    const raw = await fsp.readFile(path.join(skillDir, 'SKILL.md'), 'utf8')
    const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] || ''
    expect(frontmatter).toContain('name: quickforge-api')
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1] || ''
    expect(description.length).toBeGreaterThan(20)
    expect(description.length).toBeLessThanOrEqual(1024)
  })

  it('prints usage without touching the network', async () => {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, '--help'], { timeout: 15000 })
    expect(stdout).toContain('whoami')
    expect(stdout).toContain('spawn')
    expect(stdout).toContain('QUICKFORGE_SESSION_ID')
  })

  it('keeps the endpoint surface read/write-safe: no DELETE, no self-prompt', async () => {
    const source = await fs.readFile(scriptPath, 'utf8')
    // 本机回环即认证：任何 DELETE 或多出来的破坏性端点都会放大成事故。
    expect(source).not.toMatch(/method:\s*'DELETE'/)
    expect(source).not.toMatch(/'DELETE'/)
    for (const forbidden of ['/api/terminal', '/api/backup', '/api/lan-access', '/api/plugins', '/api/mcp', '/access-mode', '/yolo-mode']) {
      expect(source).not.toContain(forbidden)
    }
    // 给自己发 prompt 必然 409，脚本必须提前拦住。
    expect(source).toContain('GENERATION_ALREADY_RUNNING')
  })

  it('refuses to prompt the running agent itself', async () => {
    const previous = process.env.QUICKFORGE_SESSION_ID
    process.env.QUICKFORGE_SESSION_ID = 'self-session'
    try {
      const error = await execFileAsync(process.execPath, [
        scriptPath, 'prompt', 'self-session', 'hello',
        '--api', 'http://127.0.0.1:1',
      ], { timeout: 15000 }).then(() => null, (failure) => failure)
      expect(error).not.toBeNull()
      expect(String(error.stderr)).toContain('Refusing to prompt myself')
    } finally {
      if (previous === undefined) delete process.env.QUICKFORGE_SESSION_ID
      else process.env.QUICKFORGE_SESSION_ID = previous
    }
  })
})

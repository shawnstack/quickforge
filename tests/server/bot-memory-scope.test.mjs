import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * `manage_global_memory` 的落点由会话决定，不能由「这个工具叫什么」决定。
 *
 * bot 会话的系统提示注入的是它自己工作区根上的 MEMORY.md（
 * server/project-config.mjs 里 kind === 'bot' 时顶掉全局记忆块），所以 bot 调这个
 * 工具必须写 <workspaceRoot>/MEMORY.md；否则它整篇覆盖的是用户的全局记忆。
 * 反过来，非 bot 会话的行为一个字都不能变。
 *
 * 这里刻意用临时数据目录 + 临时工作区，绝不碰真实的 ~/.quickforge。
 */

let tmpDir
let previousDataDir

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-bot-memory-scope-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
  vi.resetModules()
})

afterEach(async () => {
  // logger 的 5s 刷盘定时器还挂在这个临时数据目录上：先刷完关流，再删目录。
  const { flushLogger } = await import('../../server/utils/logger.mjs')
  flushLogger()
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
})

function dataDir() {
  return process.env.QUICKFORGE_DATA_DIR
}

function globalMemoryFile() {
  return path.join(dataDir(), 'memory', 'MEMORY.md')
}

function botWorkspace() {
  return path.join(tmpDir, 'bot-workspace')
}

function botMemoryFile() {
  return path.join(botWorkspace(), 'MEMORY.md')
}

async function registerProject(project) {
  const { writeProjectConfigData } = await import('../../server/storage.mjs')
  await writeProjectConfigData({ activeProjectId: null, globalSkills: [], projects: [project] })
}

async function manageGlobalMemory(params, context) {
  const { toolManageGlobalMemory } = await import('../../server/tools/global-memory.mjs')
  return toolManageGlobalMemory(params, context)
}

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function makeBotProject() {
  await mkdir(botWorkspace(), { recursive: true })
  const project = { id: 'bot-project', name: 'bot', path: botWorkspace(), skills: [], commandDir: '', kind: 'bot' }
  await registerProject(project)
  return project
}

// context 的形状照 server/agent-tool-assembly.mjs 组装出来的那份来：projectContext
// 展开 + sessionId / scope / projectId。
function sessionContext({ project, workspaceRoot, scope = 'project', projectId = project?.id }) {
  return {
    ...(project ? { project } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    sessionId: 'bot-memory-scope-session',
    scope,
    projectId: projectId ?? null,
  }
}

describe('manage_global_memory lands on the file the session actually owns', () => {
  it('writes a bot session to its workspace MEMORY.md and never touches the global file', async () => {
    const project = await makeBotProject()
    const context = sessionContext({ project, workspaceRoot: botWorkspace() })

    const first = await manageGlobalMemory({ markdown: '# bot memory\n\n第一条。\n' }, context)

    // 今天的 bug：全局文件被 bot 整篇替换。这两条断言必须红在「全局文件被写了」，
    // 所以放在最前面——先红在别的（返回值文案）上就说明没测到这个 bug。
    await expect(exists(globalMemoryFile())).resolves.toBe(false)
    await expect(readFile(botMemoryFile(), 'utf8')).resolves.toBe('# bot memory\n\n第一条。\n')

    expect(first.content).toBe('Bot workspace memory saved.')
    expect(first.details).toMatchObject({ action: 'write', status: 'saved', target: 'workspace', path: 'bot workspace MEMORY.md' })

    // 全局那份已经有用户内容时，bot 再写一次也必须一个字都不动（内容 + mtime）。
    await mkdir(path.dirname(globalMemoryFile()), { recursive: true })
    const userMemory = '# 用户偏好\n\n用中文交互。\n'
    await writeFile(globalMemoryFile(), userMemory, 'utf8')
    const before = await stat(globalMemoryFile())

    await manageGlobalMemory({ markdown: '# bot memory\n\n第二条。\n' }, context)

    await expect(readFile(botMemoryFile(), 'utf8')).resolves.toBe('# bot memory\n\n第二条。\n')
    await expect(readFile(globalMemoryFile(), 'utf8')).resolves.toBe(userMemory)
    const after = await stat(globalMemoryFile())
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.size).toBe(before.size)
  })

  it('keeps an ordinary project session writing the global file', async () => {
    const workspace = path.join(tmpDir, 'user-project')
    await mkdir(workspace, { recursive: true })
    // 普通项目没有 kind 字段——正是要靠 projectId 查一次项目记录才判得出来。
    const project = { id: 'user-project', name: 'user', path: workspace, skills: [], commandDir: '' }
    await registerProject(project)

    const written = await manageGlobalMemory(
      { markdown: '# 用户偏好\n\n用中文交互。\n' },
      sessionContext({ project, workspaceRoot: workspace }),
    )

    expect(written.content).toBe('Global user memory saved.')
    expect(written.details).toMatchObject({ action: 'write', status: 'saved', path: '~/.quickforge/memory/MEMORY.md' })
    await expect(readFile(globalMemoryFile(), 'utf8')).resolves.toBe('# 用户偏好\n\n用中文交互。\n')
    await expect(exists(path.join(workspace, 'MEMORY.md'))).resolves.toBe(false)
  })

  it('throws instead of falling back to the global file when a bot has no workspace root', async () => {
    await registerProject({ id: 'bot-project', name: 'bot', path: botWorkspace(), skills: [], commandDir: '', kind: 'bot' })
    // 拿不到 workspaceRoot，也没有可解析的项目 path：不许悄悄写全局。
    const context = sessionContext({ project: { id: 'bot-project', name: 'bot', kind: 'bot' }, workspaceRoot: null })

    await expect(manageGlobalMemory({ markdown: '# bot memory\n' }, context))
      .rejects.toThrow('Bot memory file is unavailable for this session.')
    await expect(exists(globalMemoryFile())).resolves.toBe(false)
    await expect(exists(botMemoryFile())).resolves.toBe(false)
  })

  it('throws instead of falling back to the global file when the project record is gone', async () => {
    // project 记录已删（会话还活着）：既证明不了是 bot，也不许把用户文件覆盖掉。
    await registerProject({ id: 'some-other-project', name: 'other', path: path.join(tmpDir, 'other'), skills: [], commandDir: '' })
    const context = sessionContext({ project: undefined, workspaceRoot: path.join(tmpDir, 'gone'), projectId: 'gone-project' })

    await expect(manageGlobalMemory({ markdown: '# memory\n' }, context))
      .rejects.toThrow('Bot memory file is unavailable for this session.')
    await expect(exists(globalMemoryFile())).resolves.toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * bot 会话读的是它自己工作区根上的 MEMORY.md。
 *
 * 写入侧 2026-11-16 01:22 修好了（`94d1823c`：`manage_global_memory` 落 bot 自己那份），
 * 但读侧一直是坏的：`readWorkspaceMemoryPrompt()` 返回**裸字符串**，而
 * `composeSystemPrompt()` 判 `instructions.globalMemory?.enabled`——字符串没有
 * `enabled`，于是整个 `<memory_policy>` + `<global_user_memory>` 段被跳过，
 * bot 写进自己的记忆、下一次醒来一个字也看不到。
 *
 * 这里用临时数据目录 + 临时工作区，绝不碰真实的 ~/.quickforge。
 */

let tmpDir
let previousDataDir

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-bot-memory-read-'))
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

async function registerProjects(projects) {
  const { writeProjectConfigData } = await import('../../server/storage.mjs')
  await writeProjectConfigData({ activeProjectId: null, globalSkills: [], projects })
}

async function seedGlobalMemory(markdown) {
  const { globalMemoryFilePath } = await import('../../server/global-memory.mjs')
  const file = globalMemoryFilePath()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, markdown, 'utf8')
}

function botProject(id, workspace) {
  return { id, name: 'bot', path: workspace, skills: [], commandDir: '', kind: 'bot' }
}

describe('bot memory is readable by the session that owns it', () => {
  it('injects the bot own MEMORY.md into its system prompt', async () => {
    const workspace = path.join(tmpDir, 'bot-ws')
    await mkdir(workspace, { recursive: true })
    await writeFile(path.join(workspace, 'MEMORY.md'), '# 我的记忆\n\n独特串-BOT-ONLY-7f3a\n', 'utf8')
    await registerProjects([botProject('bot-p', workspace)])

    const { buildInstructionsPayload } = await import('../../server/project-config.mjs')
    const payload = await buildInstructionsPayload('bot-p')

    // 形状必须和全局那份一致：渲染层判 `enabled`，裸字符串等于这段记忆谁也读不到。
    expect(payload.globalMemory).toMatchObject({ enabled: true })
    expect(payload.globalMemory.content).toContain('BOT-ONLY-7f3a')

    const { composeSystemPrompt } = await import('../../server/system-prompt.mjs')
    const prompt = composeSystemPrompt(payload)
    expect(prompt).toContain('<memory_policy>')
    expect(prompt).toContain('<global_user_memory')
    expect(prompt).toContain('BOT-ONLY-7f3a')
  })

  it('never borrows the user global memory for a bot that has no memory file yet', async () => {
    const workspace = path.join(tmpDir, 'fresh-bot-ws')
    await mkdir(workspace, { recursive: true })
    await seedGlobalMemory('# 用户偏好\n\nGL0BAL-USER-9c1 用中文交互。\n')
    await registerProjects([botProject('bot-fresh', workspace)])

    const { buildInstructionsPayload } = await import('../../server/project-config.mjs')
    const payload = await buildInstructionsPayload('bot-fresh')
    const { composeSystemPrompt } = await import('../../server/system-prompt.mjs')
    const prompt = composeSystemPrompt(payload)

    // 还没写记忆的 bot 不该看到用户的全局记忆：它看到的必须是「自己家」的东西。
    expect(prompt).not.toContain('GL0BAL-USER-9c1')
    expect(payload.globalMemory).toMatchObject({ enabled: true, content: null })
    expect(prompt).toContain('<memory_policy>')
  })

  it('keeps ordinary project sessions on the user global memory', async () => {
    const workspace = path.join(tmpDir, 'user-project')
    await mkdir(workspace, { recursive: true })
    await seedGlobalMemory('# 用户偏好\n\nGL0BAL-USER-9c1 用中文交互。\n')
    await registerProjects([{ id: 'user-p', name: 'user', path: workspace, skills: [], commandDir: '' }])

    const { buildInstructionsPayload } = await import('../../server/project-config.mjs')
    const payload = await buildInstructionsPayload('user-p')

    expect(payload.globalMemory).toMatchObject({ enabled: true })
    expect(payload.globalMemory.content).toContain('GL0BAL-USER-9c1')
    expect(payload.globalMemory.source).toBe('~/.quickforge/memory/MEMORY.md')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// Skills 开关的实时生效契约：会话在创建时快照 runtime 设置没有错——运行中的
// 一轮需要一致的视图——错的是快照曾经永不更新，导致设置页开关之后，活跃会话
// 的 activate_skill 枚举与 <available_skills> 目录停在创建时刻。现在每个轮界
// （runPrompt / continueSession / goal 轮）都会用 refreshSessionRuntime 对账。

let tmpDir
let workspaceDir
let previousDataDir

async function writeGlobalSkill(name) {
  const skillDir = path.join(process.env.QUICKFORGE_DATA_DIR, 'skills', name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: Live refresh fixture skill ${name}.\n---\n\nBody for ${name}.\n`)
}

async function writeProjectSkill(name) {
  const skillDir = path.join(workspaceDir, '.quickforge', 'skills', name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: Project live refresh fixture ${name}.\n---\n\nProject body for ${name}.\n`)
}

function activateEnum(session) {
  const tool = session.agent.state.tools.find((entry) => entry.name === 'activate_skill')
  return tool?.parameters?.properties?.name?.enum ?? null
}

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-skills-live-refresh-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
  workspaceDir = path.join(tmpDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  vi.resetModules()
})

afterEach(async () => {
  const { destroyAgent, listSessions } = await import('../../server/agent-manager.mjs')
  for (const { sessionId } of listSessions()) {
    try {
      await destroyAgent(sessionId)
    } catch {
      // session already gone
    }
  }
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
})

describe('skill selection changes reach a live session at the turn boundary', () => {
  it('enables a freshly selected skill without recreating the session', async () => {
    await writeGlobalSkill('alpha-live')
    const { atomicProjectConfigUpdate } = await import('../../server/storage.mjs')
    const { createAgent } = await import('../../server/agent-manager.mjs')
    const { refreshSessionRuntime } = await import('../../server/agent-session-lifecycle.mjs')

    await atomicProjectConfigUpdate((cfg) => {
      cfg.globalSkills = []
      return cfg
    })
    const session = await createAgent('skills-live-global', {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
    })
    expect(activateEnum(session)).toBeNull()

    await atomicProjectConfigUpdate((cfg) => {
      cfg.globalSkills = ['alpha-live']
      return cfg
    })
    await refreshSessionRuntime(session)

    expect(activateEnum(session)).toEqual(['alpha-live'])
    expect(session.agent.state.tools.some((tool) => tool.name === 'read_skill_resource')).toBe(true)
    expect(session.globalSkillNames).toEqual(['alpha-live'])
  })

  it('removes a disabled skill and leaves the tool set untouched when nothing changed', async () => {
    await writeGlobalSkill('alpha-live')
    const { atomicProjectConfigUpdate } = await import('../../server/storage.mjs')
    const { createAgent } = await import('../../server/agent-manager.mjs')
    const { refreshSessionRuntime } = await import('../../server/agent-session-lifecycle.mjs')

    await atomicProjectConfigUpdate((cfg) => {
      cfg.globalSkills = ['alpha-live']
      return cfg
    })
    const session = await createAgent('skills-live-toggle', {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
    })
    expect(activateEnum(session)).toEqual(['alpha-live'])

    // Nothing changed: the reconciliation must not rebuild the tool set.
    const toolsBefore = session.agent.state.tools
    await refreshSessionRuntime(session)
    expect(session.agent.state.tools).toBe(toolsBefore)

    await atomicProjectConfigUpdate((cfg) => {
      cfg.globalSkills = []
      return cfg
    })
    await refreshSessionRuntime(session)
    expect(activateEnum(session)).toBeNull()
    expect(session.globalSkillNames).toEqual([])
  })

  it('rebuilds the managed system prompt catalog when the selection changes', async () => {
    await writeGlobalSkill('alpha-live')
    const { atomicProjectConfigUpdate } = await import('../../server/storage.mjs')
    const { createAgent } = await import('../../server/agent-manager.mjs')
    const { refreshSessionRuntime } = await import('../../server/agent-session-lifecycle.mjs')

    await atomicProjectConfigUpdate((cfg) => {
      cfg.globalSkills = []
      return cfg
    })
    // No explicit systemPrompt: the session owns a managed prompt.
    const session = await createAgent('skills-live-prompt', {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
    })
    expect(session.agent.state.systemPrompt).not.toContain('<available_skills>')

    await atomicProjectConfigUpdate((cfg) => {
      cfg.globalSkills = ['alpha-live']
      return cfg
    })
    await refreshSessionRuntime(session)

    expect(session.agent.state.systemPrompt).toContain('<available_skills>')
    expect(session.agent.state.systemPrompt).toContain('alpha-live')
  })

  it('follows project-scope selections for project sessions', async () => {
    await writeProjectSkill('proj-live')
    const { atomicProjectConfigUpdate } = await import('../../server/storage.mjs')
    const { createAgent } = await import('../../server/agent-manager.mjs')
    const { refreshSessionRuntime } = await import('../../server/agent-session-lifecycle.mjs')

    await atomicProjectConfigUpdate((cfg) => {
      cfg.projects.push({ id: 'proj-live-id', name: 'Live project', path: workspaceDir, skills: [] })
      return cfg
    })
    const session = await createAgent('skills-live-project', {
      scope: 'project',
      projectId: 'proj-live-id',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
    })
    // Baseline before the selection change: enabled plugins contribute skills
    // to project sessions unconditionally, so the enum may be non-empty here.
    const baseline = activateEnum(session) ?? []
    expect(baseline).not.toContain('proj-live')

    await atomicProjectConfigUpdate((cfg) => {
      const project = cfg.projects.find((item) => item.id === 'proj-live-id')
      project.skills = ['proj-live']
      return cfg
    })
    await refreshSessionRuntime(session)

    expect(activateEnum(session)).toEqual(expect.arrayContaining([...baseline, 'proj-live']))
    expect(session.projectSkillNames).toEqual(['proj-live'])
  })
})

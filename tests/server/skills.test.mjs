import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

describe('bundled skills', () => {
  let tempDir
  let previousDataDir
  let previousHome
  let previousUserProfile

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quickforge-skills-'))
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    previousHome = process.env.HOME
    previousUserProfile = process.env.USERPROFILE
    process.env.QUICKFORGE_DATA_DIR = path.join(tempDir, 'data')
    process.env.HOME = tempDir
    process.env.USERPROFILE = tempDir
    vi.resetModules()
  })

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
    vi.resetModules()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('discovers the bundled skill-creator and its extended resources', async () => {
    const skills = await import('../../server/skills.mjs')
    const skill = await skills.findGlobalSkill('skill-creator')

    expect(skill).toMatchObject({ name: 'skill-creator', source: 'builtin' })
    await expect(skills.listSkillResourceFiles(skill)).resolves.toEqual(expect.arrayContaining([
      'agents/grader.md',
      'eval-viewer/generate_review.py',
      'references/schemas.md',
    ]))
    await expect(skills.readSkillResource(skill, 'agents/grader.md')).resolves.toMatchObject({
      details: { skill: 'skill-creator', path: 'agents/grader.md' },
    })
  })

  it('selects skill-creator once and preserves later user opt-out', async () => {
    const skills = await import('../../server/skills.mjs')
    const storage = await import('../../server/storage.mjs')

    await storage.ensureStorage()
    await expect(skills.ensureDefaultGlobalSkills()).resolves.toBe(true)
    await expect(storage.readProjectConfigData()).resolves.toMatchObject({
      globalSkills: ['skill-creator'],
    })

    await storage.atomicProjectConfigUpdate((config) => {
      config.globalSkills = []
      return config
    })

    await expect(skills.ensureDefaultGlobalSkills()).resolves.toBe(false)
    await expect(storage.readProjectConfigData()).resolves.toMatchObject({
      globalSkills: [],
    })
  })

  it('lets a QuickForge user skill override the bundled copy', async () => {
    const userSkillDir = path.join(process.env.QUICKFORGE_DATA_DIR, 'skills', 'skill-creator')
    await fs.mkdir(userSkillDir, { recursive: true })
    await fs.writeFile(
      path.join(userSkillDir, 'SKILL.md'),
      '---\nname: skill-creator\ndescription: User override for testing.\n---\nUse the user override.\n',
      'utf8',
    )

    const { findGlobalSkill } = await import('../../server/skills.mjs')
    await expect(findGlobalSkill('skill-creator')).resolves.toMatchObject({
      source: 'user',
      description: 'User override for testing.',
      instructions: 'Use the user override.',
    })
  })
})

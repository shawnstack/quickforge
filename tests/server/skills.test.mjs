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
    // logger 的 5s 刷盘定时器还挂在这个临时数据目录上：留着它会在 rm 之后把
    // data/logs 重新 mkdir 出来（Windows 上表现为 ENOTEMPTY 或 %TEMP% 空壳目录）。
    // 先把缓冲刷完并关流，再恢复 env / 删目录；之后 logger 会按需重建。
    const { flushLogger } = await import('../../server/utils/logger.mjs')
    flushLogger()
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

  it('selects the bundled global skills once and preserves later user opt-out', async () => {
    const skills = await import('../../server/skills.mjs')
    const storage = await import('../../server/storage.mjs')

    await storage.ensureStorage()
    await expect(skills.ensureDefaultGlobalSkills()).resolves.toBe(true)
    await expect(storage.readProjectConfigData()).resolves.toMatchObject({
      globalSkills: ['skill-creator', 'plugin-creator', 'quickforge-api'],
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

  it('only adds the newly introduced default skill to installs that already opted out', async () => {
    const skills = await import('../../server/skills.mjs')
    const storage = await import('../../server/storage.mjs')

    await storage.ensureStorage()
    // 存量安装：默认 skill 早就初始化过（v1 marker 在），用户手动取消了 plugin-creator。
    await storage.atomicProjectConfigUpdate((config) => {
      config.globalSkills = ['skill-creator']
      return config
    })
    await fs.mkdir(storage.configDir, { recursive: true })
    await fs.writeFile(path.join(storage.configDir, '.default-skills-v1'), 'v1\n', { flag: 'wx' })

    await expect(skills.ensureDefaultGlobalSkills()).resolves.toBe(true)
    await expect(storage.readProjectConfigData()).resolves.toMatchObject({
      // 只补 v2 新增的 quickforge-api；plugin-creator 不能被复活。
      globalSkills: ['skill-creator', 'quickforge-api'],
    })
  })

  it('discovers a standard skill by its canonical frontmatter name when the directory differs', async () => {
    const userSkillDir = path.join(process.env.QUICKFORGE_DATA_DIR, 'skills', 'Descriptive Folder')
    await fs.mkdir(path.join(userSkillDir, 'references'), { recursive: true })
    await fs.writeFile(
      path.join(userSkillDir, 'SKILL.md'),
      '---\nname: Canonical-Skill\ndescription: Canonical frontmatter identifier test.\nmetadata:\n  displayName: Canonical Skill\n---\nUse canonical instructions.\n',
      'utf8',
    )
    await fs.writeFile(path.join(userSkillDir, 'references', 'guide.md'), 'actual directory resource', 'utf8')

    const skills = await import('../../server/skills.mjs')
    const skill = await skills.findGlobalSkill('canonical-skill')

    expect(skill).toMatchObject({
      name: 'canonical-skill',
      displayName: 'Canonical Skill',
      source: 'user',
      rootDir: userSkillDir,
    })
    await expect(skills.listSkillResourceFiles(skill)).resolves.toContain('references/guide.md')
    await expect(skills.readSkillResource(skill, 'references/guide.md')).resolves.toMatchObject({
      content: expect.stringContaining('actual directory resource'),
      details: { skill: 'canonical-skill', path: 'references/guide.md' },
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

  // 端到端：解析器认短横线列表之后，技能对象上的 tags 才不是空的。仓库自带的三个插件
  // 技能就是这么写 metadata.tags 的（用户自己按标准 YAML 写也一样）。
  it('reads dash-list tags from a standard project SKILL.md', async () => {
    const projectDir = path.join(tempDir, 'tagged-project')
    const skillDir = path.join(projectDir, '.claude', 'skills', 'tagged')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: tagged',
        'description: A skill whose tags are written as a YAML list.',
        'metadata:',
        '  version: 1.2.3',
        '  tags:',
        '    - alpha',
        '    - beta',
        '---',
        '',
        'Body.',
        '',
      ].join('\n'),
      'utf8',
    )

    const { loadProjectSkills } = await import('../../server/skills.mjs')
    const loaded = await loadProjectSkills(projectDir)
    const tagged = loaded.find((skill) => skill.name === 'tagged')

    expect(tagged?.tags).toEqual(['alpha', 'beta'])
    expect(tagged?.version).toBe('1.2.3')
  })
})

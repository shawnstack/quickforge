import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

function mockResponse() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    },
  }
}

async function getSkills(url) {
  const { handleSkillsApi } = await import('../../../server/routes/skills.mjs')
  const res = mockResponse()
  await handleSkillsApi({ method: 'GET' }, res, new URL(url))
  return res
}

async function writeSkill(dir, name, description = `${name} description`) {
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\nUse ${name} instructions.\n`,
    'utf8',
  )
}

describe('GET /api/skills?available=true', () => {
  let tmpDir
  let workspaceRoot
  let previousDataDir
  let previousHome
  let previousUserProfile

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-skills-available-'))
    workspaceRoot = path.join(tmpDir, 'workspace')
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    previousHome = process.env.HOME
    previousUserProfile = process.env.USERPROFILE
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    process.env.HOME = tmpDir
    process.env.USERPROFILE = tmpDir
    vi.resetModules()

    await writeSkill(path.join(workspaceRoot, '.claude', 'skills', 'proj-skill'), 'proj-skill')
    const pluginDir = path.join(workspaceRoot, '.quickforge', 'plugins', 'demo-plugin')
    await writeSkill(path.join(pluginDir, 'skills', 'demo-plugin-skill'), 'demo-plugin-skill')
    await writeFile(
      path.join(pluginDir, 'plugin.json'),
      JSON.stringify({
        name: 'demo-plugin',
        displayName: 'Demo Plugin',
        version: '1.0.0',
        apiVersion: 1,
        enabledByDefault: true,
        contributes: { skills: [{ path: 'skills/demo-plugin-skill' }] },
      }, null, 2),
      'utf8',
    )

    const { atomicProjectConfigUpdate } = await import('../../../server/storage.mjs')
    await atomicProjectConfigUpdate((config) => {
      config.projects = [{
        id: 'proj-1',
        name: 'workspace',
        path: workspaceRoot,
        lastOpenedAt: '',
        sortOrder: 0,
        skills: ['proj-skill'],
        commandDir: '',
      }]
      config.activeProjectId = 'proj-1'
      config.globalSkills = ['skill-creator']
      return config
    })
  })

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
    vi.resetModules()
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns only globally enabled skills without a projectId', async () => {
    const res = await getSkills('http://localhost/api/skills?available=true')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ available: true, skills: [expect.objectContaining({ name: 'skill-creator' })] })
    expect(res.body.skills.map((skill) => skill.name)).toEqual(['skill-creator'])
    expect(res.body.skills.every((skill) => !('instructions' in skill))).toBe(true)
  })

  it('merges global and project enabled skills, including plugin skills', async () => {
    const res = await getSkills('http://localhost/api/skills?available=true&projectId=proj-1')

    expect(res.status).toBe(200)
    expect(res.body.available).toBe(true)
    const names = res.body.skills.map((skill) => skill.name)
    expect(names).toEqual(expect.arrayContaining(['skill-creator', 'proj-skill', 'demo-plugin-skill']))
    // Bundled plugins (documents/presentations/spreadsheets) also contribute
    // project-scope skills for any workspace, so assert dedup instead of count.
    expect(new Set(names).size).toBe(names.length)
    expect(res.body.skills.every((skill) => !('instructions' in skill))).toBe(true)
    expect(res.body.skills.find((skill) => skill.name === 'demo-plugin-skill')).toMatchObject({
      source: 'plugin:demo-plugin',
    })
  })

  it('falls back to global-only skills for an unknown projectId', async () => {
    const res = await getSkills('http://localhost/api/skills?available=true&projectId=missing')

    expect(res.status).toBe(200)
    expect(res.body.available).toBe(true)
    expect(res.body.skills.map((skill) => skill.name)).toEqual(['skill-creator'])
  })

  it('keeps the existing scope responses unchanged', async () => {
    const global = await getSkills('http://localhost/api/skills?scope=global')
    expect(global.body.scope).toBe('global')
    expect(global.body).not.toHaveProperty('available')
    expect(global.body.selectedSkills).toEqual(['skill-creator'])

    const project = await getSkills('http://localhost/api/skills?projectId=proj-1')
    expect(project.body.scope).toBe('project')
    expect(project.body.projectId).toBe('proj-1')
    expect(project.body.selectedSkills).toEqual(['proj-skill'])
  })
})

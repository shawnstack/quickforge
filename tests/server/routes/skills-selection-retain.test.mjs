import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// 保存技能勾选时，服务端会用「此刻能加载到的技能」做白名单过滤整表覆盖。
// 加载不到的技能（SKILL.md 写到一半、被占用限流、插件临时停用）就会从列表里消失，
// 用户下一次保存任何勾选，它的启用状态就被永久抹掉——即使故障随后恢复。
// 这组用例钉住：无法解析但原本已启用的名字要保留；从没启用过的野名字仍然丢掉。

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

async function requestSkills({ method = 'GET', url, body }) {
  const { handleSkillsApi } = await import('../../../server/routes/skills.mjs')
  const res = mockResponse()
  const req = { method }
  if (body !== undefined) {
    req[Symbol.asyncIterator] = async function* () {
      yield Buffer.from(JSON.stringify(body), 'utf8')
    }
  }
  await handleSkillsApi(req, res, new URL(url))
  return res
}

async function writeSkill(dir, name) {
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description\n---\nUse ${name} instructions.\n`,
    'utf8',
  )
}

// 保留目录、保留 name，但少了必需的 description：loader 会当成「不存在」。
// 这比真的删掉目录更接近现场——用户正在编辑器里改这份 SKILL.md。
async function breakSkill(dir, name) {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\nHalf-written instructions.\n`, 'utf8')
}

describe('保存技能勾选时保留暂时加载不到的名字', () => {
  let tmpDir
  let userSkillsDir
  let workspaceRoot
  let projectSkillsDir
  let previousDataDir
  let previousHome
  let previousUserProfile

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-skills-retain-'))
    workspaceRoot = path.join(tmpDir, 'workspace')
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    previousHome = process.env.HOME
    previousUserProfile = process.env.USERPROFILE
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    process.env.HOME = tmpDir
    process.env.USERPROFILE = tmpDir
    vi.resetModules()

    userSkillsDir = path.join(tmpDir, 'data', 'skills')
    projectSkillsDir = path.join(workspaceRoot, '.claude', 'skills')
    await writeSkill(path.join(userSkillsDir, 'alpha-keep'), 'alpha-keep')
    await writeSkill(path.join(userSkillsDir, 'beta-flaky'), 'beta-flaky')
    await writeSkill(path.join(projectSkillsDir, 'proj-keep'), 'proj-keep')
    await writeSkill(path.join(projectSkillsDir, 'proj-flaky'), 'proj-flaky')

    const { atomicProjectConfigUpdate } = await import('../../../server/storage.mjs')
    await atomicProjectConfigUpdate((config) => {
      config.projects = [{
        id: 'proj-1',
        name: 'workspace',
        path: workspaceRoot,
        lastOpenedAt: '',
        sortOrder: 0,
        skills: ['proj-keep', 'proj-flaky'],
        commandDir: '',
      }]
      config.activeProjectId = 'proj-1'
      config.globalSkills = ['alpha-keep', 'beta-flaky']
      return config
    })
  })

  afterEach(async () => {
    // logger 的 5s 刷盘定时器还挂在这个临时数据目录上：留着它会在 rm 之后把
    // data/logs 重新 mkdir 出来（Windows 上表现为 ENOTEMPTY 或 %TEMP% 空壳目录）。
    const { flushLogger } = await import('../../../server/utils/logger.mjs')
    flushLogger()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
    vi.resetModules()
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  })

  async function readConfig() {
    const { readProjectConfig } = await import('../../../server/project-config.mjs')
    return readProjectConfig()
  }

  it('全局技能：原本启用、此刻解析不出来，保存别人的勾选不会把它关掉', async () => {
    await breakSkill(path.join(userSkillsDir, 'beta-flaky'), 'beta-flaky')

    const res = await requestSkills({
      method: 'PUT',
      url: 'http://localhost/api/skills/global',
      body: { selectedSkills: ['alpha-keep'] },
    })

    expect(res.status).toBe(200)
    expect(res.body.selectedSkills).toEqual(['alpha-keep', 'beta-flaky'])
    expect((await readConfig()).globalSkills).toEqual(['alpha-keep', 'beta-flaky'])
  })

  it('全局技能：从没启用过的名字仍然被丢掉', async () => {
    const res = await requestSkills({
      method: 'PUT',
      url: 'http://localhost/api/skills/global',
      body: { selectedSkills: ['alpha-keep', 'not-a-real-skill'] },
    })

    expect(res.status).toBe(200)
    expect(res.body.selectedSkills).toEqual(['alpha-keep'])
    expect((await readConfig()).globalSkills).toEqual(['alpha-keep'])
  })

  it('全局技能：能加载的技能取消勾选仍然生效', async () => {
    const res = await requestSkills({
      method: 'PUT',
      url: 'http://localhost/api/skills/global',
      body: { selectedSkills: ['alpha-keep'] },
    })

    expect(res.status).toBe(200)
    expect(res.body.selectedSkills).toEqual(['alpha-keep'])
    expect((await readConfig()).globalSkills).toEqual(['alpha-keep'])
  })

  it('全局技能：清空勾选也不会顺手关掉暂时加载不到的那个', async () => {
    await breakSkill(path.join(userSkillsDir, 'beta-flaky'), 'beta-flaky')

    const res = await requestSkills({
      method: 'PUT',
      url: 'http://localhost/api/skills/global',
      body: { selectedSkills: [] },
    })

    // 用户看不见 beta-flaky，也就无法对它表达「关掉」；把它一起清掉属于替他做决定。
    expect(res.status).toBe(200)
    expect(res.body.selectedSkills).toEqual(['beta-flaky'])
    expect((await readConfig()).globalSkills).toEqual(['beta-flaky'])
  })

  it('全局技能：技能恢复加载后仍然可以正常取消勾选（保留不会变成钉子）', async () => {
    await breakSkill(path.join(userSkillsDir, 'beta-flaky'), 'beta-flaky')
    await requestSkills({
      method: 'PUT',
      url: 'http://localhost/api/skills/global',
      body: { selectedSkills: ['alpha-keep'] },
    })
    expect((await readConfig()).globalSkills).toEqual(['alpha-keep', 'beta-flaky'])

    await writeSkill(path.join(userSkillsDir, 'beta-flaky'), 'beta-flaky')
    const res = await requestSkills({
      method: 'PUT',
      url: 'http://localhost/api/skills/global',
      body: { selectedSkills: ['alpha-keep'] },
    })

    expect(res.status).toBe(200)
    expect(res.body.selectedSkills).toEqual(['alpha-keep'])
    expect((await readConfig()).globalSkills).toEqual(['alpha-keep'])
  })

  it('项目技能：插件或 SKILL.md 暂时加载不到时，已启用的项目技能也不会被清掉', async () => {
    await breakSkill(path.join(projectSkillsDir, 'proj-flaky'), 'proj-flaky')

    const res = await requestSkills({
      method: 'PUT',
      url: 'http://localhost/api/skills/project',
      body: { projectId: 'proj-1', selectedSkills: ['proj-keep'] },
    })

    expect(res.status).toBe(200)
    expect(res.body.selectedSkills).toEqual(['proj-keep', 'proj-flaky'])
    const config = await readConfig()
    expect(config.projects[0].skills).toEqual(['proj-keep', 'proj-flaky'])
  })

  it('项目技能：能加载的技能取消勾选仍然生效', async () => {
    const res = await requestSkills({
      method: 'PUT',
      url: 'http://localhost/api/skills/project',
      body: { projectId: 'proj-1', selectedSkills: ['proj-keep'] },
    })

    expect(res.status).toBe(200)
    expect(res.body.selectedSkills).toEqual(['proj-keep'])
    const config = await readConfig()
    expect(config.projects[0].skills).toEqual(['proj-keep'])
  })
})

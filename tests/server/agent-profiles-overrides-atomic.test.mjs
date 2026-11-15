import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

/**
 * 读不动「内置 agent 覆盖项」时，不能当作「没有覆盖」接着整表写回。
 *
 * `updateBuiltinAgentOverrides` 现在是
 *   `const overrides = await readStore('agent-profile-overrides').catch(() => ({}))`
 *   …改完一条… `await writeStore('agent-profile-overrides', next)`
 * 而 config store 的 `writeStore` **不会先读**（`storage.mjs` 里 writeConfigStore 直接写），
 * 所以：配置文件一时读不出来（半截 JSON、被杀软/别的进程占着、权限不足）→ base 变成空表 →
 * 写回去只剩本次改的这一条 → 别的内置 agent 的 model / thinkingLevel 覆盖被永久清零，
 * 接口返回 200，界面上看不出来。
 *
 * 环境事实（14:23 探针实测）：内置 agent 只有 `general`、`explore` 两个；`readStore` 撞半截
 * JSON 确实会抛（`Expected ',' or '}' after property value …`）——错误本来能被看见，被 catch 吞了。
 * 思考档合法值是 inherit / off / low / medium / high / xhigh（'think' 会先抛另一条错，别用）。
 */
async function withTempStorage(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-agent-overrides-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  vi.resetModules()
  const database = await import('../../server/sqlite/database.mjs')
  try {
    await database.initializeSqliteStorage()
    const storage = await import('../../server/storage.mjs')
    const agentProfiles = await import('../../server/agent-profiles.mjs')
    await testFn({ storage, agentProfiles, tmpDir })
  } finally {
    await database.closeSqliteStorage().catch(() => {})
    const { flushLogger } = await import('../../server/utils/logger.mjs')
    flushLogger()
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    vi.resetModules()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

describe('内置 agent 覆盖项：读失败不许静默清空别人', () => {
  it('覆盖项文件损坏时报错，而不是把别的 agent 的覆盖盖掉', async () => {
    await withTempStorage(async ({ storage, agentProfiles, tmpDir }) => {
      await storage.writeStore('agent-profile-overrides', {
        general: { thinkingLevel: 'high' },
      })

      const overridesFile = path.join(tmpDir, 'config', 'agent-profile-overrides.json')
      const broken = '{"general": {"thinkingLevel": "high"'  // 半截 JSON：模拟写到一半 / 被截断
      await fs.writeFile(overridesFile, broken, 'utf8')

      let outcome
      try {
        outcome = await agentProfiles.updateBuiltinAgentOverrides('explore', { thinkingLevel: 'low' })
      } catch (error) {
        outcome = error
      }

      expect(outcome).toBeInstanceOf(Error)
      // 关键：文件不能被「空表 + 本次一条」盖掉，损坏内容要原样留着等人来救
      expect(await fs.readFile(overridesFile, 'utf8')).toBe(broken)
    })
  })
})

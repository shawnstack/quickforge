import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let tmpDir
let previousDataDir

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-memory-tools-gate-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
  vi.resetModules()
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
})

const NOTE_TOOL_NAMES = ['list_memory_notes', 'read_memory_note', 'write_memory_note', 'move_memory_note']

async function buildToolNames() {
  const { createServerTools } = await import('../../server/agent-manager.mjs')
  const tools = await createServerTools(
    null,
    null,
    { globalSkillNames: [], projectSkillNames: [] },
    false,
    {},
    { includeMcpTools: false, includePluginTools: false, includeSkillTools: false },
  )
  return tools.map((tool) => tool.name)
}

describe('agent tool registration and the working-memory switch', () => {
  it('registers no note tools while working memory is disabled', async () => {
    const { saveWorkingMemorySettings } = await import('../../server/working-memory.mjs')
    await saveWorkingMemorySettings({ enabled: false })

    const names = await buildToolNames()

    for (const toolName of NOTE_TOOL_NAMES) expect(names).not.toContain(toolName)
  })

  it('hands the main agent all note tools once working memory is enabled', async () => {
    const { saveWorkingMemorySettings } = await import('../../server/working-memory.mjs')
    await saveWorkingMemorySettings({ enabled: true })

    const names = await buildToolNames()

    for (const toolName of NOTE_TOOL_NAMES) expect(names).toContain(toolName)
  })
})

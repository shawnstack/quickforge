import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Drives the real Agent with a fake model stream.
 *
 * The guard and the prompt are unit-tested elsewhere; this covers the part only
 * an end-to-end run can: that the four tool definitions are actually usable by
 * `Agent`, that a tool call really lands on disk, and that a call outside the
 * allowed set is refused without killing the turn.
 */

const state = vi.hoisted(() => ({
  replies: [],
  contexts: [],
}))

vi.mock('../../server/ai-http-logger.mjs', () => ({
  streamSimpleWithAiHttpLogging: (_model, context) => {
    state.contexts.push(context)
    const content = state.replies.shift() ?? [{ type: 'text', text: 'done' }]
    const message = {
      role: 'assistant',
      content,
      api: 'openai-completions',
      provider: 'mock',
      model: 'mock-model',
      usage: {
        input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
      timestamp: Date.now(),
    }
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'start', partial: message }
        yield { type: 'done', reason: message.stopReason, message }
      },
      result: async () => message,
    }
  },
}))

let directory
let runCuratorTurn

const MODEL = { provider: 'mock', id: 'mock-model', api: 'openai-completions', baseUrl: 'http://localhost:9/v1' }
const SESSION = { sessionId: 'sess-1', projectId: 'proj-1', title: 'work', updatedAt: 1000, messageCount: 4 }

function toolCall(name, args) {
  return { type: 'toolCall', id: `call-${name}`, name, arguments: args }
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-curator-agent-'))
  process.env.QUICKFORGE_DATA_DIR = directory
  state.replies = []
  state.contexts = []
  vi.resetModules()
  ;({ runCuratorTurn } = await import('../../server/dreaming/curator.mjs'))
})

afterEach(async () => {
  delete process.env.QUICKFORGE_DATA_DIR
  await rm(directory, { recursive: true, force: true })
})

function run(options = {}) {
  return runCuratorTurn({
    runId: 'run-1',
    model: MODEL,
    session: SESSION,
    transcript: 'user: 修一下构建\nassistant: 清掉 dist 就好了',
    periodFrom: 0,
    periodTo: 2000,
    contentLanguage: 'zh',
    ...options,
  })
}

describe('curator turn with the real Agent', () => {
  it('writes a working-memory note through the tool and reports the action', async () => {
    state.replies = [
      [toolCall('list_memory_notes', { scope: 'working' })],
      [toolCall('write_memory_note', {
        scope: 'working',
        name: '构建失败先清 dist',
        content: '# 构建失败先清 dist\n\n删掉 dist 再 build 就好。',
      })],
      [{ type: 'text', text: '写了一条笔记。' }],
    ]
    const result = await run()

    expect(result.ok).toBe(true)
    expect(result.toolCalls).toBe(2)
    expect(result.actions).toEqual([
      expect.objectContaining({ kind: 'write', scope: 'working', title: '构建失败先清 dist' }),
    ])
    const written = await readFile(path.join(directory, 'working-memory', '构建失败先清 dist.md'), 'utf8')
    expect(written).toContain('删掉 dist 再 build 就好')
    expect(result.reply).toBe('写了一条笔记。')
  })

  it('promotes into the experience library and rebuilds its index', async () => {
    state.replies = [
      [toolCall('write_memory_note', {
        scope: 'experience',
        name: '改配置前先备份',
        content: '# 改配置前先备份\n\n- 何时用：动 config 目录前\n- 怎么做：cp 一份\n- 候选技能：是',
      })],
      [{ type: 'text', text: '沉淀成经验了。' }],
    ]
    const result = await run()
    expect(result.actions).toEqual([
      expect.objectContaining({ kind: 'write', scope: 'experience', title: '改配置前先备份' }),
    ])
    const index = await readFile(path.join(directory, 'experiences', 'index.md'), 'utf8')
    expect(index).toContain('- ★ 改配置前先备份 —— 动 config 目录前')
  })

  it('survives a model that asks for a tool it does not have', async () => {
    state.replies = [
      [toolCall('run_command', { command: 'rm -rf /' })],
      [{ type: 'text', text: '我只有记忆工具。' }],
    ]
    const result = await run()
    // Two independent guards: the tool list does not contain run_command at all,
    // so the agent loop rejects the call before anything runs; `beforeToolCall`
    // is the second line and is covered by dreaming-curator.test.mjs directly.
    expect(result.ok).toBe(true)
    expect(result.toolCalls).toBe(0)
    expect(result.actions).toEqual([])
    expect(state.contexts[0].tools.map((tool) => tool.name)).not.toContain('run_command')
  })

  it('stops issuing tools once the budget is spent', async () => {
    state.replies = [
      [toolCall('list_memory_notes', { scope: 'working' })],
      [toolCall('list_memory_notes', { scope: 'experience' })],
      [{ type: 'text', text: '预算用完了。' }],
    ]
    const result = await run({ maxToolCalls: 1 })
    expect(result.toolCalls).toBe(2)
    expect(result.blockedCalls.at(-1)).toEqual({ tool: 'list_memory_notes', reason: 'over_budget' })
  })

  it('passes the curator system prompt and only the memory tools to the model', async () => {
    await run()
    const first = state.contexts[0]
    expect(first.systemPrompt).toMatch(/memory curator/i)
    expect(first.tools.map((tool) => tool.name)).toEqual([
      'list_memory_notes', 'read_memory_note', 'write_memory_note', 'move_memory_note',
    ])
  })
})

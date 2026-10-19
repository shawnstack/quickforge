import { describe, expect, it, vi } from 'vitest'

vi.mock('../../server/agent-subagent-runner.mjs', () => ({
  runWorkflowSubagent: vi.fn(async () => ({ content: 'mock subagent', details: {} })),
}))
vi.mock('../../server/agent-workflow-tools.mjs', () => ({
  createWorkflowToolset: vi.fn(async () => new Map()),
  runWorkflowTool: vi.fn(async (_session, _toolset, _toolCallId, request) => ({ content: `tool:${request.name}` })),
}))

import { parseStructuredAgentResult, runWorkflow } from '../../server/agent-workflow-runner.mjs'

const parentSession = {
  sessionId: 'workflow-session',
  projectContext: { workspaceRoot: process.cwd() },
  model: { provider: 'test', id: 'test-model' },
}

function runWorkflowScript(script, { args, options, runAgent, runTool, createToolset, signal, onUpdate, session } = {}) {
  return runWorkflow(
    session ? { ...parentSession, ...session } : parentSession,
    'tool-call-1',
    { script, args, options },
    signal,
    onUpdate,
    { runAgent, runTool, createToolset },
  )
}

function echoAgent() {
  return vi.fn(async (_session, _toolCallId, params) => ({ content: `echo:${params.prompt}` }))
}

async function readResultJson(result) {
  return JSON.parse(result.details.resultPreview)
}

describe('run_workflow worker orchestration', () => {
  it('runs phases, logs and named agents and returns the script result', async () => {
    const runAgent = echoAgent()
    const updates = []
    const result = await runWorkflowScript([
      'phase("Research")',
      'log("starting research")',
      'const a = await agent("alpha", { label: "Alpha" })',
      'const b = await agent("beta", { label: "Beta", profile: "explore" })',
      'return { a, b }',
    ].join('\n'), {
      runAgent,
      onUpdate: (update) => updates.push(update.details),
    })

    expect(result.details).toMatchObject({
      workflow: true,
      status: 'done',
      agentCount: 2,
      failedAgentCount: 0,
    })
    expect(result.details.agents.map((agent) => agent.label)).toEqual(['Alpha', 'Beta'])
    expect(result.details.agents.every((agent) => agent.status === 'done')).toBe(true)
    expect(result.details.phases.map((phase) => phase.title)).toEqual(['Research'])
    expect(result.details.logs.some((log) => log.message === 'starting research')).toBe(true)
    expect(await readResultJson(result)).toEqual({ a: 'echo:alpha', b: 'echo:beta' })
    expect(runAgent).toHaveBeenCalledTimes(2)
    expect(runAgent.mock.calls[1][2]).toMatchObject({ profile: 'explore', label: 'Beta' })
    expect(result.details.resultPreview).toContain('echo:alpha')
    expect(updates.some((details) => details.status === 'running')).toBe(true)
  })

  it('respects the concurrency limit while parallel() keeps result order', async () => {
    let active = 0
    let maximum = 0
    const runAgent = vi.fn(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 30))
      active -= 1
      return { content: 'ok' }
    })

    const result = await runWorkflowScript([
      'const out = await parallel([',
      '  () => agent("a"),',
      '  () => agent("b"),',
      '  () => agent("c"),',
      '  () => agent("d"),',
      '])',
      'return out',
    ].join('\n'), { runAgent, options: { concurrency: 2, maxAgents: 8 }, session: { accessMode: 'full-access' } })

    expect(maximum).toBe(2)
    expect(await readResultJson(result)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(result.details.agentCount).toBe(4)
    expect(result.details.concurrency).toBe(2)
  })

  it('serializes agents in default access mode so tool approvals stay visible', async () => {
    let active = 0
    let maximum = 0
    const runAgent = vi.fn(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
      return { content: 'ok' }
    })

    const result = await runWorkflowScript(
      'const out = await parallel([() => agent("a"), () => agent("b")]); return out',
      { runAgent, options: { concurrency: 4 } },
    )

    expect(maximum).toBe(1)
    expect(result.details.concurrency).toBe(1)
    expect(await readResultJson(result)).toEqual(['ok', 'ok'])
  })

  it('runs tool() steps alongside agents and records them in details', async () => {
    const runAgent = echoAgent()
    const runTool = vi.fn(async (_session, _toolset, _toolCallId, request) => ({ content: `tool:${request.name}:${request.args.path}` }))
    const result = await runWorkflowScript([
      'phase("Inspect")',
      'const content = await tool("read_file", { path: "a.ts" }, { label: "read a" })',
      'const answer = await agent("after tool")',
      'return { content, answer }',
    ].join('\n'), { runAgent, runTool })

    expect(result.details).toMatchObject({ status: 'done', agentCount: 1, toolCount: 1, failedToolCount: 0 })
    expect(result.details.tools[0]).toMatchObject({
      name: 'read_file',
      label: 'read a',
      phase: 'Inspect',
      status: 'done',
      args: { path: 'a.ts' },
      resultPreview: 'tool:read_file:a.ts',
    })
    expect(result.details.agents[0]).toMatchObject({ label: 'general #1', phase: 'Inspect', status: 'done' })
    expect(result.details.tools[0].seq).toBeLessThan(result.details.agents[0].seq)
    expect(await readResultJson(result)).toEqual({ content: 'tool:read_file:a.ts', answer: 'echo:after tool' })
  })

  it('resolves a failed tool() to null and records the error without failing the workflow', async () => {
    const runTool = vi.fn(async () => { throw new Error('tool blocked') })
    const result = await runWorkflowScript(
      'const content = await tool("write_file", { path: "x.txt" }, { label: "write x" }); return { content }',
      { runTool },
    )

    expect(result.details.status).toBe('done')
    expect(result.details.tools[0]).toMatchObject({ name: 'write_file', status: 'error', error: 'tool blocked' })
    expect(result.details.failedToolCount).toBe(1)
    expect(result.details.logs.some((log) => log.level === 'error' && log.message.includes('tool blocked'))).toBe(true)
    expect(await readResultJson(result)).toEqual({ content: null })
  })

  it('streams tool partial output into the running details', async () => {
    const runTool = vi.fn(async (_session, _toolset, _toolCallId, _request, _signal, onUpdate) => {
      onUpdate?.({ content: [{ type: 'text', text: 'partial output' }], details: {} })
      // Let the 200ms progress throttle flush the partial frame before the
      // tool settles and the final frame replaces it.
      await new Promise((resolve) => setTimeout(resolve, 250))
      return { content: 'final output' }
    })
    const updates = []
    const result = await runWorkflowScript(
      'const out = await tool("run_command", { command: "echo hello" }); return out',
      { runTool, onUpdate: (update) => updates.push(update.details) },
    )

    expect(updates.some((details) => details.tools?.[0]?.resultPreview === 'partial output')).toBe(true)
    expect(result.details.tools[0].resultPreview).toBe('final output')
    expect(await readResultJson(result)).toBe('final output')
  })

  it('caps tool() calls at maxTools and logs the skipped request', async () => {
    const runTool = vi.fn(async () => ({ content: 'ok' }))
    const result = await runWorkflowScript([
      'const a = await tool("read_file", { path: "a" })',
      'const b = await tool("read_file", { path: "b" })',
      'return { a, b }',
    ].join('\n'), { runTool, options: { maxTools: 1 } })

    expect(runTool).toHaveBeenCalledTimes(1)
    expect(result.details.toolCount).toBe(1)
    expect(result.details.logs.some((log) => log.message.includes('Tool budget exhausted'))).toBe(true)
    expect(await readResultJson(result)).toEqual({ a: 'ok', b: null })
  })

  it('serializes tools and agents together in default access mode', async () => {
    let active = 0
    let maximum = 0
    const step = async (content) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
      return { content }
    }
    const runAgent = vi.fn(async () => step('agent'))
    const runTool = vi.fn(async () => step('tool'))

    const result = await runWorkflowScript(
      'const out = await parallel([() => agent("a"), () => tool("read_file", { path: "a" })]); return out',
      { runAgent, runTool, options: { concurrency: 4 } },
    )

    expect(maximum).toBe(1)
    expect(result.details).toMatchObject({ concurrency: 1, agentCount: 1, toolCount: 1 })
    expect(await readResultJson(result)).toEqual(['agent', 'tool'])
  })

  it('drops failing pipeline items to null without a barrier between items', async () => {
    const result = await runWorkflowScript([
      'const out = await pipeline([1, 2, 3],',
      '  (value) => value + 1,',
      '  (previous, item) => { if (item === 2) throw new Error("skip"); return previous * 10 })',
      'return out',
    ].join('\n'), {})

    expect(await readResultJson(result)).toEqual([20, null, 40])
  })

  it('captures a bounded subagent trace for the run detail panel', async () => {
    const runAgent = vi.fn(async () => ({
      content: 'done',
      details: {
        subagent: 'explore',
        label: 'Explore',
        messages: [
          { role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'working' }, { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }] },
          { role: 'toolResult', timestamp: 2, toolCallId: 'call-1', toolName: 'read_file', content: [{ type: 'text', text: 'file body' }] },
        ],
        tools: [{ name: 'read_file', label: 'Read file', description: 'Read a file' }],
        allowedTools: ['read_file'],
        pendingToolCalls: [],
        toolCalls: 1,
        model: { provider: 'test', id: 'model' },
        thinkingLevel: 'off',
        durationMs: 500,
      },
    }))
    const result = await runWorkflowScript(
      'const out = await agent("inspect", { label: "Trace" }); return out',
      { runAgent },
    )

    expect(result.details.agents[0].subagentRun).toMatchObject({
      subagent: 'explore',
      label: 'Explore',
      toolCalls: 1,
      allowedTools: ['read_file'],
      thinkingLevel: 'off',
    })
    expect(result.details.agents[0].subagentRun.messages).toHaveLength(2)
    expect(result.details.agents[0].subagentRun.tools).toEqual([
      { name: 'read_file', label: 'Read file', description: 'Read a file' },
    ])
  })

  it('captures terminal subagent details when an agent fails', async () => {
    const runAgent = vi.fn(async () => {
      const error = new Error('agent failed')
      error.quickforgeSubagentDetails = {
        subagent: 'general',
        label: 'General',
        messages: [{ role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'started' }] }],
        toolCalls: 1,
      }
      throw error
    })
    const result = await runWorkflowScript(
      'const out = await agent("fail", { label: "Failed" }); return out',
      { runAgent },
    )

    expect(result.details.agents[0]).toMatchObject({ status: 'error', label: 'Failed' })
    expect(result.details.agents[0].subagentRun).toMatchObject({ subagent: 'general', toolCalls: 1 })
    expect(result.details.agents[0].subagentRun.messages).toHaveLength(1)
  })

  it('resolves a failed agent() to null and records the error without failing the workflow', async () => {
    const runAgent = vi.fn(async (_session, _toolCallId, params) => {
      if (params.prompt === 'bad') throw new Error('agent exploded')
      return { content: 'fine' }
    })
    const result = await runWorkflowScript([
      'const ok = await agent("good", { label: "Good" })',
      'const bad = await agent("bad", { label: "Bad" })',
      'return { ok, bad }',
    ].join('\n'), { runAgent })

    expect(result.details.status).toBe('done')
    expect(result.details.agents.map((agent) => agent.status)).toEqual(['done', 'error'])
    expect(result.details.agents[1].error).toContain('agent exploded')
    expect(result.details.failedAgentCount).toBe(1)
    expect(result.details.logs.some((log) => log.level === 'error' && log.message.includes('agent exploded'))).toBe(true)
    expect(await readResultJson(result)).toEqual({ ok: 'fine', bad: null })
  })

  it('validates structured agent output against a JSON schema', async () => {
    const runAgent = vi.fn(async () => ({ content: 'Result follows:\n```json\n{"answer":42}\n```' }))
    const result = await runWorkflowScript([
      'const out = await agent("structured", { label: "Structured", schema: {',
      '  type: "object",',
      '  properties: { answer: { type: "number" } },',
      '  required: ["answer"],',
      '  additionalProperties: false,',
      '} })',
      'return out',
    ].join('\n'), { runAgent })

    expect(result.details.agents[0].schemaValidated).toBe(true)
    expect(await readResultJson(result)).toEqual({ answer: 42 })
  })

  it('returns null for schema validation failures and reports the reason', async () => {
    const runAgent = vi.fn(async () => ({ content: 'not json at all' }))
    const result = await runWorkflowScript([
      'const out = await agent("structured", { label: "Structured", schema: { type: "object" } })',
      'return out',
    ].join('\n'), { runAgent })

    expect(await readResultJson(result)).toBeNull()
    expect(result.details.agents[0].status).toBe('error')
    expect(result.details.agents[0].error).toMatch(/schema|JSON/i)
  })

  it('exposes only the documented hooks and blocks Node.js globals', async () => {
    const result = await runWorkflowScript([
      'return {',
      '  process: typeof process,',
      '  require: typeof require,',
      '  fetch: typeof fetch,',
      '  console: typeof console,',
      '  setTimeout: typeof setTimeout,',
      '  hostCall: typeof __hostCall,',
      '  argsJson: typeof __argsJson,',
      '  args: args,',
      '}',
    ].join('\n'), { args: { topic: 'workflow' } })

    expect(await readResultJson(result)).toEqual({
      process: 'undefined',
      require: 'undefined',
      fetch: 'undefined',
      console: 'undefined',
      setTimeout: 'undefined',
      hostCall: 'undefined',
      argsJson: 'undefined',
      args: { topic: 'workflow' },
    })
  })

  it('blocks host-function constructor escapes in the guest bridge', async () => {
    const result = await runWorkflowScript([
      'const attempts = []',
      'for (const value of [agent, parallel, pipeline, phase, log, args, {}]) {',
      '  try {',
      '    const F = value && value.constructor && value.constructor.constructor',
      '    attempts.push(typeof F === "function" ? String(F("return typeof process")()) : "blocked")',
      '  } catch {',
      '    attempts.push("blocked")',
      '  }',
      '}',
      'return attempts',
    ].join('\n'), { args: { topic: 'workflow' } })

    expect(await readResultJson(result)).toEqual(Array(7).fill('blocked'))
  })

  it('caps agent() calls at maxAgents and logs the skipped request', async () => {
    const runAgent = echoAgent()
    const result = await runWorkflowScript([
      'const a = await agent("a")',
      'const b = await agent("b")',
      'return { a, b }',
    ].join('\n'), { runAgent, options: { maxAgents: 1 } })

    expect(runAgent).toHaveBeenCalledTimes(1)
    expect(result.details.agentCount).toBe(1)
    expect(result.details.logs.some((log) => log.message.includes('budget exhausted'))).toBe(true)
    expect(await readResultJson(result)).toEqual({ a: 'echo:a', b: null })
  })

  it('reports a script syntax error as a failed workflow', async () => {
    await expect(runWorkflowScript('return {')).rejects.toMatchObject({
      errorCode: 'WORKFLOW_FAILED',
    })
  })

  it('rejects non-serializable script results', async () => {
    await expect(runWorkflowScript('return () => 1')).rejects.toThrow(/JSON-serializable/)
  })

  it('times out an unresolved workflow and records the timeout', async () => {
    const runAgent = vi.fn(() => new Promise(() => {}))
    const error = await runWorkflowScript('await agent("hang", { label: "Hang" }); return 1', {
      runAgent,
      options: { maxRuntimeMs: 1000 },
    }).catch((caught) => caught)

    expect(error.errorCode).toBe('WORKFLOW_TIMEOUT')
    expect(error.message).toMatch(/timed out/i)
    expect(error.quickforgeWorkflowDetails).toMatchObject({ timedOut: true, status: 'error' })
    expect(error.quickforgeWorkflowDetails.agents[0]).toMatchObject({ label: 'Hang', status: 'aborted' })
    expect(error.quickforgeWorkflowDetails.agents.some((agent) => agent.status === 'running')).toBe(false)
  })

  it('marks orphaned agent() calls as aborted when the script returns first', async () => {
    const runAgent = vi.fn(() => new Promise(() => {}))
    const result = await runWorkflowScript('agent("orphan"); return { ok: true }', { runAgent })

    expect(result.details.status).toBe('done')
    expect(result.details.agents[0]).toMatchObject({ status: 'aborted' })
    expect(result.details.agents[0].error).toContain('completed before this step settled')
  })

  it('aborts the workflow and its agents with the parent signal', async () => {
    const controller = new AbortController()
    let markStarted
    const started = new Promise((resolve) => { markStarted = resolve })
    const runAgent = vi.fn((_session, _toolCallId, _params, signal) => new Promise((_resolve, reject) => {
      markStarted()
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const promise = runWorkflowScript('await agent("hang"); return 1', {
      runAgent,
      signal: controller.signal,
    })
    await started
    controller.abort()

    const error = await promise.catch((caught) => caught)
    expect(error.errorCode).toBe('WORKFLOW_ABORTED')
    expect(error.quickforgeWorkflowDetails).toMatchObject({ aborted: true, status: 'aborted' })
    expect(error.quickforgeWorkflowDetails.agents[0].status).toBe('aborted')
    expect(error.quickforgeWorkflowDetails.agents.some((agent) => agent.status === 'running')).toBe(false)
  })

  it('treats schema:false as a schema that rejects every result', async () => {
    const result = await runWorkflowScript(
      'const out = await agent("x", { label: "Never", schema: false }); return out',
      { runAgent: echoAgent() },
    )

    expect(await readResultJson(result)).toBeNull()
    expect(result.details.agents[0].status).toBe('error')
    expect(result.details.agents[0].error).toMatch(/schema/i)
  })

  it('keeps a bounded subagent trace with tool details while the agent is running', async () => {
    const longText = 'x'.repeat(5000)
    const runAgent = vi.fn(async (_session, _toolCallId, _params, _signal, onUpdate) => {
      onUpdate?.({
        details: {
          subagent: 'explore',
          toolCalls: 1,
          allowedTools: ['read_file'],
          pendingToolCalls: ['call-1'],
          model: { mode: 'inherit', provider: 'test', id: 'model' },
          thinkingLevel: 'low',
          messages: [
            { role: 'assistant', timestamp: 1, stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }] },
            { role: 'toolResult', timestamp: 2, toolCallId: 'call-1', toolName: 'read_file', isError: false, content: [{ type: 'text', text: longText }], details: { durationMs: 12, diff: { path: 'a.ts', text: longText } } },
          ],
          tools: [{ name: 'read_file', label: 'Read file', description: 'y'.repeat(500) }],
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 250))
      return { content: 'done', details: { toolCalls: 1, messages: [], tools: [] } }
    })
    let run
    const result = await runWorkflowScript('return await agent("inspect", { profile: "explore" })', {
      runAgent,
      onUpdate: (update) => {
        const snapshot = update.details?.agents?.[0]?.subagentRun
        if (snapshot?.pendingToolCalls?.length) run = snapshot
      },
    })
    expect(result.details.agents[0].status).toBe('done')
    expect(run).toBeTruthy()
    expect(run.pendingToolCalls).toEqual(['call-1'])
    expect(run.messages[1].details.durationMs).toBe(12)
    expect(run.messages[1].details.diff.path).toBe('a.ts')
    expect(run.messages[1].content[0].text.length).toBeLessThan(longText.length)
    expect(run.messages[1].details.diff.text.length).toBeLessThan(longText.length)
    expect(run.tools[0].description.length).toBeLessThan(500)
    expect(JSON.stringify(run).length).toBeLessThanOrEqual(6000)
  })

  it('bounds the details payload when a script logs heavily', async () => {
    const result = await runWorkflowScript([
      'for (let index = 0; index < 150; index += 1) log("x".repeat(900))',
      'return 1',
    ].join('\n'), {})

    expect(result.details.detailsTruncated).toBe(true)
    expect(result.details.logs.length).toBeLessThanOrEqual(50)
  })
})

describe('parseStructuredAgentResult', () => {
  it('accepts raw JSON, fenced JSON and embedded objects', () => {
    expect(parseStructuredAgentResult('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseStructuredAgentResult('text\n```json\n{"a":2}\n```')).toEqual({ ok: true, value: { a: 2 } })
    expect(parseStructuredAgentResult('prefix {"a":3} suffix')).toEqual({ ok: true, value: { a: 3 } })
  })

  it('rejects empty and non-JSON text', () => {
    expect(parseStructuredAgentResult('').ok).toBe(false)
    expect(parseStructuredAgentResult('no json here').ok).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readStore: vi.fn(async () => ({})) }))

vi.mock('../../../server/storage.mjs', () => ({ readStore: mocks.readStore }))

// Replace the shared event core with a bare EventEmitter so the engine test
// does not pull the full tool-wiring/agent-manager import graph.
vi.mock('../../../server/agent-session-events.mjs', () => import('node:events').then(({ EventEmitter }) => ({ agentEvents: new EventEmitter() })))

const engine = await import('../../../server/hooks/hook-engine.mjs')
const { agentEvents } = await import('../../../server/agent-session-events.mjs')
const { agentSessions } = await import('../../../server/agent-session-store.mjs')

function commandHook(id, command, overrides = {}) {
  return {
    id,
    name: `hook-${id}`,
    enabled: true,
    events: ['agent_start'],
    action: { type: 'command', command },
    timeoutSeconds: 10,
    silentOnFailure: false,
    ...overrides,
  }
}

async function configureHooks(settings) {
  mocks.readStore.mockResolvedValue({ 'hooks-settings': settings })
  await engine.refreshHooksSettings()
}

// Hook executions are fire-and-forget (spawned processes settle
// asynchronously), so tests poll the execution log until a matching record
// shows up instead of awaiting a promise.
async function waitForRecord(predicate, { attempts = 300, intervalMs = 10 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const record = engine.getRecentHookExecutions().find(predicate)
    if (record) return record
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return engine.getRecentHookExecutions().find(predicate)
}

function settleBackgroundHooks() {
  return new Promise((resolve) => setTimeout(resolve, 150))
}

describe('hook engine', () => {
  // Most tests drive the engine through the shared event bus, so keep the
  // subscription installed (idempotent) and detach it after every test.
  beforeEach(async () => {
    await engine.startHookEngine()
  })

  afterEach(() => {
    engine.stopHookEngine()
  })

  it('ignores event types outside the hook event set', async () => {
    await configureHooks({ enabled: true, hooks: [commandHook('e1', 'node -e "process.stdout.write(\'hi\')"')] })
    agentEvents.emit('agent_event', { sessionId: 's1', type: 'message_end' })
    agentEvents.emit('agent_event', { sessionId: 's1', type: 'state' })
    await settleBackgroundHooks()
    expect(engine.getRecentHookExecutions().some((execution) => execution.hookId === 'e1')).toBe(false)
  })

  it('skips everything while hooks are globally disabled', async () => {
    await configureHooks({ enabled: false, hooks: [commandHook('e2', 'node -e "process.stdout.write(\'hi\')"')] })
    agentEvents.emit('agent_event', { sessionId: 's1', type: 'agent_start' })
    await settleBackgroundHooks()
    expect(engine.getRecentHookExecutions().some((execution) => execution.hookId === 'e2')).toBe(false)
  })

  it('fires only enabled hooks subscribed to the emitted event', async () => {
    await configureHooks({
      enabled: true,
      hooks: [
        commandHook('match', 'node -e "process.stdout.write(\'matched\')"'),
        commandHook('disabled', 'node -e "process.stdout.write(\'nope\')"', { enabled: false }),
        commandHook('other-event', 'node -e "process.stdout.write(\'nope\')"', { events: ['agent_end'] }),
      ],
    })
    agentEvents.emit('agent_event', { sessionId: 's1', type: 'agent_start' })
    const record = await waitForRecord((execution) => execution.hookId === 'match')
    expect(record.status).toBe('success')
    expect(record.event).toBe('agent_start')
    await settleBackgroundHooks()
    expect(engine.getRecentHookExecutions().some((execution) => execution.hookId === 'disabled')).toBe(false)
    expect(engine.getRecentHookExecutions().some((execution) => execution.hookId === 'other-event')).toBe(false)
  })

  it('keeps failed executions of silentOnFailure hooks out of the log', async () => {
    await configureHooks({
      enabled: true,
      hooks: [
        commandHook('silent-fail', 'node -e "process.exit(1)"', { silentOnFailure: true }),
        commandHook('loud-fail', 'node -e "process.exit(2)"'),
      ],
    })
    agentEvents.emit('agent_event', { sessionId: 's1', type: 'agent_start' })
    const record = await waitForRecord((execution) => execution.hookId === 'loud-fail')
    expect(record.status).toBe('error')
    await settleBackgroundHooks()
    expect(engine.getRecentHookExecutions().some((execution) => execution.hookId === 'silent-fail')).toBe(false)
  })

  it('resolves session project context and error messages into the hook context', async () => {
    agentSessions.set('s-ctx', { projectContext: { project: { name: 'demo', path: 'D:/work/demo' } } })
    try {
      await configureHooks({
        enabled: true,
        hooks: [
          commandHook('ctx', 'node -e "process.stdout.write(process.argv[1])" "{{session.project}}|{{session.projectPath}}|{{event}}|{{tool.name}}|{{message}}"', { events: ['tool_execution_start', 'error'] }),
        ],
      })

      agentEvents.emit('agent_event', { sessionId: 's-ctx', type: 'tool_execution_start', toolName: 'read_file' })
      const toolRecord = await waitForRecord((execution) => execution.hookId === 'ctx' && execution.output.includes('tool_execution_start'))
      expect(toolRecord.output).toBe('demo|D:/work/demo|tool_execution_start|read_file|')

      agentEvents.emit('agent_event', { sessionId: 's-ctx', type: 'error', error: 'boom' })
      const errorRecord = await waitForRecord((execution) => execution.hookId === 'ctx' && execution.output.endsWith('boom'))
      expect(errorRecord.output).toBe('demo|D:/work/demo|error||boom')
    } finally {
      agentSessions.delete('s-ctx')
    }
  })

  it('caps the in-memory execution log at 50 entries', () => {
    const baseline = engine.getRecentHookExecutions().length
    const records = Array.from({ length: 60 }, (_, index) => ({ id: `r${index}` }))
    records.forEach((record) => engine.pushHookExecution(record))
    const executions = engine.getRecentHookExecutions()
    expect(executions.length).toBe(Math.min(baseline + 60, 50))
    expect(executions[executions.length - 1].id).toBe('r59')
    if (baseline + 60 > 50) {
      // Exactly the last 50 of the 60 pushed records survive, regardless of
      // how many records earlier tests left in the buffer.
      expect(executions[0].id).toBe('r10')
    }
  })

  it('subscribes and unsubscribes the shared agent event bus cleanly', async () => {
    // beforeEach already installed the (idempotent) subscription.
    const withListener = agentEvents.listenerCount('agent_event')
    expect(withListener).toBeGreaterThan(0)
    await engine.startHookEngine()
    expect(agentEvents.listenerCount('agent_event')).toBe(withListener)

    await configureHooks({ enabled: true, hooks: [commandHook('bus', 'node -e "process.stdout.write(\'bus\')"')] })
    agentEvents.emit('agent_event', { sessionId: 's1', type: 'agent_start' })
    const record = await waitForRecord((execution) => execution.hookId === 'bus')
    expect(record.status).toBe('success')

    engine.stopHookEngine()
    expect(agentEvents.listenerCount('agent_event')).toBe(withListener - 1)
    agentEvents.emit('agent_event', { sessionId: 's1', type: 'agent_start' })
    const countAfterStop = engine.getRecentHookExecutions().filter((execution) => execution.hookId === 'bus').length
    await settleBackgroundHooks()
    expect(engine.getRecentHookExecutions().filter((execution) => execution.hookId === 'bus').length).toBe(countAfterStop)
  })

  it('falls back to defaults when the settings store is unreadable', async () => {
    mocks.readStore.mockRejectedValue(new Error('storage down'))
    const settings = await engine.refreshHooksSettings()
    expect(settings).toEqual({ enabled: true, hooks: [] })
    agentEvents.emit('agent_event', { sessionId: 's1', type: 'agent_start' })
    await settleBackgroundHooks()
  })
})

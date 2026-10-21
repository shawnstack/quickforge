import { describe, expect, it } from 'vitest'
import {
  SubagentRunStore,
  type SubagentRunI18n,
  type SubagentToolDisplayMode,
} from '../../src/lib/subagent-run-detail'
import { WorkflowAgentRunEventPublisher } from '../../src/lib/workflow-agent-run-events'

const tStub: SubagentRunI18n = (key, params) => {
  if (key === 'subagentRunning') return `${params?.name ?? ''} running`
  if (key === 'subagentCompleted') return `${params?.name ?? ''} completed`
  if (key === 'subagentFailed') return `${params?.name ?? ''} failed`
  return key
}

function createPublisher(store: SubagentRunStore, mode: SubagentToolDisplayMode = 'concise') {
  return new WorkflowAgentRunEventPublisher({ store, t: tStub, getToolDisplayMode: () => mode })
}

function workflowDetails(overrides: Record<string, unknown> = {}) {
  return {
    workflow: true,
    runId: 'wf-1',
    status: 'running',
    maxAgents: 8,
    concurrency: 2,
    phases: [{ title: 'Scan', startedAt: 900 }],
    agents: [{
      id: 'agent-1',
      seq: 1,
      label: 'Scan src',
      profile: 'explore',
      phase: 'Scan',
      status: 'running',
      startedAt: 1000,
      durationMs: 0,
      toolCalls: 1,
      promptPreview: 'scan the source',
      context: 'repo map',
      expectedOutput: 'short answer',
      subagentRun: {
        subagent: 'explore',
        label: 'Scan src',
        messages: [{
          role: 'assistant',
          timestamp: 1001,
          content: [{ type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }],
        }],
        tools: [{ name: 'read_file', label: 'Read file' }],
        allowedTools: ['read_file'],
        pendingToolCalls: ['call-1'],
        toolCalls: 1,
        model: { mode: 'inherit', provider: 'test', id: 'model' },
        thinkingLevel: 'low',
        durationMs: 0,
      },
    }],
    tools: [],
    logs: [],
    ...overrides,
  }
}

describe('WorkflowAgentRunEventPublisher', () => {
  it('publishes every workflow agent on updates and follows the live trace', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolStart({ toolCallId: 'wf-1', toolName: 'run_workflow', args: { script: 'return 1' } })
    // start carries no agent details; the first update creates the snapshot.
    expect(store.size).toBe(0)

    publisher.handleToolUpdate({
      toolCallId: 'wf-1',
      partialResult: { content: [], details: workflowDetails() },
    })
    const first = store.get('wf-1:agent:agent-1')
    expect(first).toMatchObject({
      runId: 'wf-1:agent:agent-1',
      canonicalToolCallId: 'wf-1:agent:agent-1',
      task: 'scan the source',
      context: 'repo map',
      expectedOutput: 'short answer',
      status: 'running',
      pendingToolCalls: ['call-1'],
    })
    expect(first?.traceMessages).toHaveLength(1)
    expect(first?.timing?.startedAt).toBe(1000)
    expect(first?.model).toMatchObject({ provider: 'test', id: 'model' })

    publisher.handleToolUpdate({
      toolCallId: 'wf-1',
      partialResult: {
        content: [],
        details: workflowDetails({
          agents: [{
            ...workflowDetails().agents[0],
            toolCalls: 1,
            subagentRun: {
              ...workflowDetails().agents[0].subagentRun,
              messages: [
                ...workflowDetails().agents[0].subagentRun.messages,
                { role: 'toolResult', timestamp: 1002, toolCallId: 'call-1', toolName: 'read_file', content: [{ type: 'text', text: 'file body' }] },
              ],
              pendingToolCalls: [],
            },
          }],
        }),
      },
    })
    const second = store.get('wf-1:agent:agent-1')
    expect(second?.traceMessages).toHaveLength(2)
    expect(second?.pendingToolCalls).toEqual([])
    expect(second?.fingerprint).not.toBe(first?.fingerprint)

    publisher.handleToolEnd({
      toolCallId: 'wf-1',
      result: {
        content: [],
        details: workflowDetails({
          status: 'done',
          agents: [{
            ...workflowDetails().agents[0],
            status: 'done',
            durationMs: 500,
            toolCalls: 1,
            resultPreview: 'found 2 files',
            subagentRun: {
              ...workflowDetails().agents[0].subagentRun,
              messages: [
                ...workflowDetails().agents[0].subagentRun.messages,
                { role: 'toolResult', timestamp: 1002, toolCallId: 'call-1', toolName: 'read_file', content: [{ type: 'text', text: 'file body' }] },
                { role: 'assistant', timestamp: 1003, content: [{ type: 'text', text: 'found 2 files' }] },
              ],
              pendingToolCalls: [],
              durationMs: 500,
            },
          }],
        }),
      },
    })
    const done = store.get('wf-1:agent:agent-1')
    expect(done?.status).toBe('done')
    expect(done?.output).toBe('found 2 files')
    expect(done?.traceMessages).toHaveLength(3)
    expect(done?.timing).toMatchObject({ startedAt: 1000, durationMs: 500 })
  })

  it('keeps the last visible trace and flags it when a frame drops subagentRun', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolUpdate({
      toolCallId: 'wf-1',
      partialResult: { content: [], details: workflowDetails() },
    })

    const droppedAgent = Object.fromEntries(
      Object.entries(workflowDetails().agents[0]).filter(([key]) => key !== 'subagentRun'),
    )
    publisher.handleToolEnd({
      toolCallId: 'wf-1',
      result: {
        content: [],
        details: workflowDetails({
          status: 'done',
          agents: [{
            ...droppedAgent,
            status: 'done',
            durationMs: 500,
            subagentRunDropped: true,
            resultPreview: 'done',
          }],
        }),
      },
    })

    const done = store.get('wf-1:agent:agent-1')
    expect(done?.status).toBe('done')
    expect(done?.traceDropped).toBe(true)
    expect(done?.traceMessages).toHaveLength(1)
  })

  it('keeps the longer visible trace when a running frame is partially truncated', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    const fullTrace = Array.from({ length: 30 }, (_, index) => ({
      role: 'assistant',
      timestamp: index + 1,
      content: [{ type: 'text', text: `step ${index}` }],
    }))
    const agentWithTrace = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
      ...workflowDetails().agents[0],
      ...extra,
      subagentRun: {
        ...workflowDetails().agents[0].subagentRun,
        messages,
        pendingToolCalls: [],
      },
    })
    publisher.handleToolUpdate({
      toolCallId: 'wf-1',
      partialResult: { content: [], details: workflowDetails({ agents: [agentWithTrace(fullTrace)] }) },
    })
    expect(store.get('wf-1:agent:agent-1')?.traceMessages).toHaveLength(30)

    // Budget trimming shrinks this frame to the last 5 messages but marks it
    // incomplete; the Inspector must not silently drop 25 cards the user saw.
    publisher.handleToolUpdate({
      toolCallId: 'wf-1',
      partialResult: {
        content: [],
        details: workflowDetails({
          agents: [agentWithTrace(fullTrace.slice(-5), { subagentRunTruncated: true })],
        }),
      },
    })
    const payload = store.get('wf-1:agent:agent-1')
    expect(payload?.traceMessages).toHaveLength(30)
    expect(payload?.traceDropped).toBe(true)
  })

  it('backfills from the newer store snapshot instead of an older publish cache', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolEnd({
      toolCallId: 'wf-1',
      result: {
        content: [],
        details: workflowDetails({
          status: 'done',
          agents: [{
            ...workflowDetails().agents[0],
            status: 'done',
            durationMs: 500,
            resultPreview: 'done',
            subagentRun: {
              ...workflowDetails().agents[0].subagentRun,
              messages: workflowDetails().agents[0].subagentRun.messages.slice(0, 1),
            },
          }],
        }),
      },
    })
    expect(store.get('wf-1:agent:agent-1')?.traceMessages).toHaveLength(1)

    // A render-time safe correction can publish a fuller terminal trace that
    // this publisher never produced (e.g. after an SSE reconnect).
    const richStore = new SubagentRunStore()
    const richPublisher = createPublisher(richStore)
    richPublisher.handleToolEnd({
      toolCallId: 'wf-1',
      result: {
        content: [],
        details: workflowDetails({
          status: 'done',
          agents: [{
            ...workflowDetails().agents[0],
            status: 'done',
            durationMs: 500,
            resultPreview: 'done',
            subagentRun: {
              ...workflowDetails().agents[0].subagentRun,
              messages: Array.from({ length: 20 }, (_, index) => ({
                role: 'assistant',
                timestamp: index + 1,
                content: [{ type: 'text', text: `step ${index}` }],
              })),
            },
          }],
        }),
      },
    })
    store.publish(richStore.get('wf-1:agent:agent-1')!)

    // A late duplicate end frame without a trace must not shrink the store back
    // to this publisher's 1-message cache.
    publisher.handleToolEnd({
      toolCallId: 'wf-1',
      result: {
        content: [],
        details: workflowDetails({
          status: 'done',
          agents: [{
            ...workflowDetails().agents[0],
            status: 'done',
            durationMs: 500,
            resultPreview: 'done',
            subagentRunDropped: true,
          }],
        }),
      },
    })
    const payload = store.get('wf-1:agent:agent-1')
    expect(payload?.traceMessages).toHaveLength(20)
    expect(payload?.traceDropped).toBe(true)
  })

  it('never regresses a finished run to running on a late frame', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolUpdate({
      toolCallId: 'wf-1',
      partialResult: { content: [], details: workflowDetails() },
    })
    publisher.handleToolEnd({
      toolCallId: 'wf-1',
      result: {
        content: [],
        details: workflowDetails({
          status: 'done',
          agents: [{ ...workflowDetails().agents[0], status: 'done', durationMs: 500, resultPreview: 'done' }],
        }),
      },
    })
    expect(store.get('wf-1:agent:agent-1')?.status).toBe('done')

    publisher.handleToolUpdate({
      toolCallId: 'wf-1',
      partialResult: { content: [], details: workflowDetails() },
    })
    expect(store.get('wf-1:agent:agent-1')?.status).toBe('done')
  })

  it('ignores tools other than run_workflow', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolStart({ toolCallId: 'call-1', toolName: 'read_file', args: { path: 'a.ts' } })
    publisher.handleToolUpdate({
      toolCallId: 'call-1',
      partialResult: { content: [], details: { messages: [] } },
    })
    publisher.handleToolEnd({ toolCallId: 'call-1', result: { content: [], details: { messages: [] } } })
    expect(store.size).toBe(0)
  })
})

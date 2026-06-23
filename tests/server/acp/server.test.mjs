import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { convertEventToUpdates, createQuickForgeAcpAgent } from '../../../server/acp/server.mjs'

describe('ACP event conversion', () => {
  it('converts assistant message updates to incremental ACP chunks', () => {
    const state = { messageTextById: new Map() }

    const first = convertEventToUpdates({
      type: 'message_update',
      message: { id: 'm1', role: 'assistant', content: 'Hello' },
    }, state)
    const second = convertEventToUpdates({
      type: 'message_update',
      message: { id: 'm1', role: 'assistant', content: 'Hello world' },
    }, state)

    expect(first).toEqual([{
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello' },
      messageId: 'm1',
    }])
    expect(second).toEqual([{
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: ' world' },
      messageId: 'm1',
    }])
  })

  it('converts tool lifecycle events to ACP tool call updates', () => {
    expect(convertEventToUpdates({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'run_command',
      args: { command: 'npm test' },
    })).toEqual([{
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: 'Run run_command',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'npm test' },
    }])

    expect(convertEventToUpdates({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'run_command',
      result: 'ok',
    })).toEqual([{
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      status: 'completed',
      rawOutput: 'ok',
      content: [{ type: 'content', content: { type: 'text', text: 'ok' } }],
    }])
  })

  it('rejects unsafe ACP cwd values', async () => {
    const agent = await createQuickForgeAcpAgent()

    await expect(agent.newSession({ cwd: 'relative', mcpServers: [] })).rejects.toThrow('absolute path')
    await expect(agent.newSession({ cwd: path.parse(process.cwd()).root, mcpServers: [] })).rejects.toThrow('unsafe ACP workspace root')
  })
})

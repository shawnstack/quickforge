import { describe, expect, it } from 'vitest'
import { subagentProcessTraceMessages } from '../../src/lib/subagent-process-trace'

describe('subagent process trace', () => {
  it('keeps assistant plans, tool activity, and final explanations in timeline order', () => {
    const plan = { role: 'assistant', content: [{ type: 'text', text: 'Plan first' }] }
    const tools = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Checking files' },
        { type: 'toolCall', id: 'tool-a', name: 'read_file', arguments: { path: 'src/app.ts' } },
      ],
    }
    const result = { role: 'toolResult', toolCallId: 'tool-a', content: [] }
    const final = { role: 'assistant', content: [{ type: 'text', text: 'Done' }] }

    expect(subagentProcessTraceMessages([
      { role: 'user', content: [{ type: 'text', text: 'Task' }] },
      plan,
      tools,
      result,
      final,
    ])).toEqual([plan, tools, result, final])
  })

  it('drops unrelated tool results that cannot be rendered by the agent trace', () => {
    expect(subagentProcessTraceMessages([
      { role: 'toolResult', toolCallId: 'missing', content: [] },
      { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
    ])).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
    ])
  })
})

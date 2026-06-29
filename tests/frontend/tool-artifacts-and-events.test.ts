import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it, vi } from 'vitest'
import { extractCurrentTurnArtifacts, extractSessionArtifacts } from '../../src/lib/tool-artifacts'
import {
  extractQuickForgeTiming,
  toolStartEventWithPartialResult,
  upsertMessage,
  upsertToolResult,
} from '../../src/lib/tool-execution-events'

function messages(value: unknown): AgentMessage[] {
  return value as AgentMessage[]
}

function message(value: unknown): AgentMessage {
  return value as AgentMessage
}

describe('tool artifacts', () => {
  it('extracts file artifacts from write_file and edit_file tool results', () => {
    const artifacts = extractSessionArtifacts(messages([
      {
        role: 'toolResult',
        toolName: 'write_file',
        toolCallId: 'write-1',
        details: { path: 'public/index.html' },
      },
      {
        role: 'toolResult',
        toolName: 'edit_file',
        toolCallId: 'edit-1',
        details: { path: 'README.md', diff: { addedLines: 3, removedLines: 1 } },
      },
    ]))

    expect(artifacts).toMatchObject([
      {
        source: 'write_file',
        confidence: 'high',
        path: 'public/index.html',
        toolCallId: 'write-1',
        kind: 'html',
        preview: true,
        presentation: 'inferred',
      },
      {
        source: 'edit_file',
        confidence: 'high',
        path: 'README.md',
        toolCallId: 'edit-1',
        kind: 'markdown',
        preview: true,
        presentation: 'inferred',
        addedLines: 3,
        removedLines: 1,
      },
    ])
  })

  it('extracts explicit present_files artifacts from details and JSON text payloads', () => {
    const artifacts = extractSessionArtifacts(messages([
      {
        role: 'toolResult',
        toolName: 'present_files',
        toolCallId: 'present-1',
        details: {
          defaultPreview: 'report.html',
          files: [
            { path: 'report.html', title: 'Report', description: 'Generated report' },
            { path: 'diagram.svg', preview: false },
          ],
        },
      },
      {
        role: 'toolResult',
        toolName: 'present_files',
        toolCallId: 'present-2',
        content: [
          {
            type: 'text',
            text: JSON.stringify({ files: ['notes.txt'], previewed: ['notes.txt'] }),
          },
        ],
      },
    ]))

    expect(artifacts).toHaveLength(3)
    expect(artifacts[0]).toMatchObject({
      source: 'present_files',
      path: 'report.html',
      title: 'Report',
      description: 'Generated report',
      kind: 'html',
      preview: true,
      defaultPreview: true,
      presentation: 'explicit',
    })
    expect(artifacts[1]).toMatchObject({ path: 'diagram.svg', kind: 'image', preview: false })
    expect(artifacts[2]).toMatchObject({ path: 'notes.txt', kind: 'code', preview: true })
  })

  it('extracts low-confidence command artifacts and deduplicates repeated entries', () => {
    const artifacts = extractSessionArtifacts(messages([
      {
        role: 'toolResult',
        toolName: 'run_command',
        toolCallId: 'cmd-1',
        details: { command: 'npm run build', outputFile: 'dist/index.html' },
      },
      {
        role: 'toolResult',
        toolName: 'run_command',
        toolCallId: 'cmd-1',
        details: { command: 'npm run build', outputFile: 'dist/index.html' },
      },
    ]))

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      source: 'run_command',
      confidence: 'low',
      command: 'npm run build',
      outputFile: 'dist/index.html',
      toolCallId: 'cmd-1',
    })
  })

  it('extracts only artifacts after the latest user message for the current turn', () => {
    const artifacts = extractCurrentTurnArtifacts(messages([
      { role: 'user', content: 'first' },
      { role: 'toolResult', toolName: 'write_file', details: { path: 'old.html' } },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'second' },
      { role: 'toolResult', toolName: 'write_file', details: { path: 'new.png' } },
    ]))

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ path: 'new.png', kind: 'image' })
  })
})

describe('tool execution events', () => {
  it('upserts messages by tool call id, assistant timestamp, or last role', () => {
    const first = messages([{ role: 'toolResult', toolCallId: 'a', content: ['old'] }])
    expect(upsertMessage(first, message({ role: 'toolResult', toolCallId: 'a', content: ['new'] }))).toEqual([
      { role: 'toolResult', toolCallId: 'a', content: ['new'] },
    ])

    const assistantMessages = messages([{ role: 'assistant', timestamp: 1, content: 'old' }])
    expect(upsertMessage(assistantMessages, message({ role: 'assistant', timestamp: 1, content: 'new' }))).toEqual([
      { role: 'assistant', timestamp: 1, content: 'new' },
    ])

    expect(upsertMessage(messages([{ role: 'user', content: 'old' }]), message({ role: 'user', content: 'new' }))).toEqual([
      { role: 'user', content: 'new' },
    ])
    expect(upsertMessage(messages([{ role: 'user', content: 'ask' }]), message({ role: 'assistant', content: 'answer' }))).toEqual([
      { role: 'user', content: 'ask' },
      { role: 'assistant', content: 'answer' },
    ])
  })

  it('extracts quickforge timing only from valid timing details', () => {
    expect(extractQuickForgeTiming(null)).toBeUndefined()
    expect(extractQuickForgeTiming({ quickforgeTiming: {} })).toBeUndefined()
    expect(extractQuickForgeTiming({ quickforgeTiming: { startedAt: 1, finishedAt: 'bad', durationMs: 20 } })).toEqual({
      startedAt: 1,
      finishedAt: undefined,
      durationMs: 20,
    })
  })

  it('creates partial tool start results with timing and runtime ids', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    try {
      expect(toolStartEventWithPartialResult({ toolCallId: 'call-1' }, 'session-1')).toMatchObject({
        toolCallId: 'call-1',
        partialResult: {
          content: [],
          details: {
            quickforgeTiming: { startedAt: 1000 },
            sessionId: 'session-1',
            toolCallId: 'call-1',
          },
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('upserts partial and final tool results while preserving timing', () => {
    vi.useFakeTimers()
    vi.setSystemTime(2000)
    try {
      const partialMessages = upsertToolResult([], {
        sessionId: 'session-1',
        toolCallId: 'call-1',
        toolName: 'read_file',
        partialResult: {
          content: [],
          details: { quickforgeTiming: { startedAt: 1000 } },
        },
      }, true)

      expect(partialMessages).toHaveLength(1)
      expect(partialMessages[0]).toMatchObject({
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read_file',
        isError: false,
        details: {
          quickforgeTiming: { startedAt: 1000 },
          sessionId: 'session-1',
          toolCallId: 'call-1',
        },
        timestamp: 2000,
      })

      vi.setSystemTime(2500)
      const finalMessages = upsertToolResult(partialMessages, {
        sessionId: 'session-1',
        toolCallId: 'call-1',
        toolName: 'read_file',
        result: { content: [{ type: 'text', text: 'done' }], details: { path: 'README.md' } },
      }, false)

      expect(finalMessages).toHaveLength(1)
      expect(finalMessages[0]).toMatchObject({
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read_file',
        content: [{ type: 'text', text: 'done' }],
        details: {
          path: 'README.md',
          quickforgeTiming: { startedAt: 1000 },
          sessionId: 'session-1',
          toolCallId: 'call-1',
        },
        timestamp: 2500,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the original messages when a tool result event is incomplete', () => {
    const originalMessages = messages([{ role: 'user', content: 'ask' }])
    expect(upsertToolResult(originalMessages, { toolName: 'read_file', result: { content: [] } }, false)).toBe(originalMessages)
    expect(upsertToolResult(originalMessages, { toolCallId: 'call-1', result: { content: [] } }, false)).toBe(originalMessages)
  })
})

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it, vi } from 'vitest'
import { extractCurrentTurnArtifacts, extractSessionArtifacts, extractTurnArtifacts } from '../../src/lib/tool-artifacts'
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

  it('recognizes Markdown, code, and readable text files presented explicitly', () => {
    const artifacts = extractSessionArtifacts(messages([
      {
        role: 'toolResult',
        toolName: 'present_files',
        toolCallId: 'present-readable',
        details: {
          files: ['guide.mdx', 'report.csv', 'Dockerfile', 'archive.bin'],
          previewed: ['guide.mdx', 'report.csv', 'Dockerfile'],
        },
      },
    ]))

    expect(artifacts).toMatchObject([
      { path: 'guide.mdx', kind: 'markdown', preview: true },
      { path: 'report.csv', kind: 'code', preview: true },
      { path: 'Dockerfile', kind: 'code', preview: true },
      { path: 'archive.bin', kind: 'unknown', preview: false },
    ])
  })

  it('recognizes document files (PDF/DOCX/Excel) presented explicitly', () => {
    const artifacts = extractSessionArtifacts(messages([
      {
        role: 'toolResult',
        toolName: 'present_files',
        toolCallId: 'present-documents',
        details: {
          files: ['report.pdf', 'brief.docx', 'data.xlsx', { path: 'legacy.xls', preview: false }],
          previewed: ['report.pdf', 'brief.docx', 'data.xlsx'],
        },
      },
    ]))

    expect(artifacts).toMatchObject([
      { path: 'report.pdf', kind: 'pdf', preview: true },
      { path: 'brief.docx', kind: 'docx', preview: true },
      { path: 'data.xlsx', kind: 'excel', preview: true },
      { path: 'legacy.xls', kind: 'excel', preview: false },
    ])
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

  it('slices per-turn artifacts at user and user-with-attachments boundaries', () => {
    const turns = extractTurnArtifacts(messages([
      { role: 'user', content: 'first' },
      { role: 'toolResult', toolName: 'write_file', toolCallId: 'w1', details: { path: 'a.html' } },
      { role: 'assistant', content: 'done' },
      { role: 'user-with-attachments', content: 'second', attachments: [] },
      { role: 'toolResult', toolName: 'write_file', toolCallId: 'w2', details: { path: 'b.md' } },
      { role: 'toolResult', toolName: 'write_file', toolCallId: 'w3', details: { path: 'c.css' } },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'third' },
      { role: 'assistant', content: 'no artifacts' },
    ]))

    // 无产物的第三轮不返回；userIndex 为该轮首条 user 消息在完整数组中的下标。
    expect(turns.map((turn) => turn.userIndex)).toEqual([0, 3])
    expect(turns[0].artifacts).toMatchObject([{ path: 'a.html' }])
    expect(turns[1].artifacts).toMatchObject([{ path: 'b.md' }, { path: 'c.css' }])
  })

  it('dedupes within a turn slice and keeps cross-turn duplicates independent', () => {
    const turns = extractTurnArtifacts(messages([
      { role: 'user', content: 'first' },
      { role: 'toolResult', toolName: 'write_file', toolCallId: 'w1', details: { path: 'a.html' } },
      { role: 'toolResult', toolName: 'write_file', toolCallId: 'w1', details: { path: 'a.html' } },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'second' },
      { role: 'toolResult', toolName: 'write_file', toolCallId: 'w2', details: { path: 'a.html' } },
    ]))

    // 轮内同 toolCallId 去重；跨轮同路径互不影响（各自归入自己的轮）。
    expect(turns.map((turn) => turn.userIndex)).toEqual([0, 4])
    expect(turns[0].artifacts).toHaveLength(1)
    expect(turns[1].artifacts).toMatchObject([{ path: 'a.html' }])
  })

  it('collects the deduplicated turnIds of every artifact in a turn (original + retry runs)', () => {
    const turns = extractTurnArtifacts(messages([
      { role: 'user', content: 'first' },
      { role: 'toolResult', toolName: 'write_file', toolCallId: 'w1', details: { path: 'a.html', turnId: 'turn-1' } },
      { role: 'toolResult', toolName: 'edit_file', toolCallId: 'e1', details: { path: 'b.md', turnId: 'turn-2' } },
      // 同一轮的重试 run：新 turnId + 与原 run 重复的 turnId。
      { role: 'toolResult', toolName: 'write_file', toolCallId: 'w2', details: { path: 'c.css', turnId: 'turn-3' } },
      { role: 'toolResult', toolName: 'write_file', toolCallId: 'w3', details: { path: 'd.txt', turnId: 'turn-1' } },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'second' },
      { role: 'toolResult', toolName: 'edit_file', toolCallId: 'e2', details: { path: 'e.md' } },
    ]))

    // 轮 turnIds = 该轮全部产物 turnId 的去重集合（切片序保序）；重试 run 的
    // 新 turnId 并入同一轮。产物级 turnId 照原样保留。
    expect(turns[0].artifacts.map((artifact) => artifact.turnId)).toEqual(['turn-1', 'turn-2', 'turn-3', 'turn-1'])
    expect(turns[0].turnIds).toEqual(['turn-1', 'turn-2', 'turn-3'])
    // 全部产物都没有 turnId（无 turnId 的历史产物路径）→ 空数组（卡片不渲染撤销按钮）。
    expect(turns[1].artifacts[0]).toMatchObject({ turnId: undefined })
    expect(turns[1].turnIds).toEqual([])
  })

  it('groups leading content before the first user message into userIndex -1 without a turnId', () => {
    const turns = extractTurnArtifacts(messages([
      { role: 'toolResult', toolName: 'write_file', toolCallId: 'w0', details: { path: 'old.html' } },
      { role: 'assistant', content: 'residual' },
      { role: 'user', content: 'first' },
      { role: 'toolResult', toolName: 'write_file', toolCallId: 'w1', details: { path: 'new.html' } },
    ]))

    expect(turns.map((turn) => turn.userIndex)).toEqual([-1, 2])
    expect(turns[0].artifacts).toMatchObject([{ path: 'old.html' }])
    expect(turns[0].turnIds).toEqual([])
    expect(turns[1].turnIds).toEqual([])
  })
})

describe('tool execution events', () => {
  it('upserts messages by tool call id, assistant timestamp, or last role', () => {
    const first = messages([{ role: 'toolResult', toolCallId: 'a', content: ['old'] }])
    expect(upsertMessage(first, message({ role: 'toolResult', toolCallId: 'a', content: ['new'] }))).toEqual([
      { role: 'toolResult', toolCallId: 'a', content: ['new'] },
    ])

    expect(upsertMessage(first, message({ role: 'toolResult', toolCallId: 'b', content: ['other'] }))).toEqual([
      { role: 'toolResult', toolCallId: 'a', content: ['old'] },
      { role: 'toolResult', toolCallId: 'b', content: ['other'] },
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

    expect(upsertMessage(messages([
      { role: 'user', timestamp: 10, content: 'old question' },
      { role: 'assistant', content: 'working' },
    ]), message({ role: 'user', timestamp: 10, content: 'new question' }))).toEqual([
      { role: 'user', timestamp: 10, content: 'new question' },
      { role: 'assistant', content: 'working' },
    ])

    expect(upsertMessage(messages([
      { role: 'user-with-attachments', timestamp: 11, content: 'old file question' },
      { role: 'assistant', content: 'working' },
    ]), message({ role: 'user-with-attachments', timestamp: 11, content: 'new file question' }))).toEqual([
      { role: 'user-with-attachments', timestamp: 11, content: 'new file question' },
      { role: 'assistant', content: 'working' },
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

  it('keeps parallel tool results isolated across interleaved updates', () => {
    let current = upsertToolResult([], {
      toolCallId: 'subagent-a',
      toolName: 'run_subagent',
      partialResult: { content: [], details: { subagent: 'explore' } },
    }, true)
    current = upsertToolResult(current, {
      toolCallId: 'subagent-b',
      toolName: 'run_subagent',
      partialResult: { content: [], details: { subagent: 'general' } },
    }, true)
    current = upsertToolResult(current, {
      toolCallId: 'subagent-a',
      toolName: 'run_subagent',
      result: { content: [{ type: 'text', text: 'A done' }], details: { subagent: 'explore' } },
    }, false)
    current = upsertToolResult(current, {
      toolCallId: 'subagent-b',
      toolName: 'run_subagent',
      partialResult: { content: [], details: { subagent: 'general', toolCalls: 1 } },
    }, true)

    expect(current).toHaveLength(2)
    expect(current.find((item) => item.role === 'toolResult' && item.toolCallId === 'subagent-a')).toMatchObject({
      content: [{ type: 'text', text: 'A done' }],
      details: { subagent: 'explore' },
    })
    expect(current.find((item) => item.role === 'toolResult' && item.toolCallId === 'subagent-b')).toMatchObject({
      content: [],
      details: { subagent: 'general', toolCalls: 1 },
    })
  })

  it('returns the original messages when a tool result event is incomplete', () => {
    const originalMessages = messages([{ role: 'user', content: 'ask' }])
    expect(upsertToolResult(originalMessages, { toolName: 'read_file', result: { content: [] } }, false)).toBe(originalMessages)
    expect(upsertToolResult(originalMessages, { toolCallId: 'call-1', result: { content: [] } }, false)).toBe(originalMessages)
  })
})

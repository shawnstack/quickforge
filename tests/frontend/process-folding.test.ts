import { describe, expect, it, vi } from 'vitest'
import {
  isProcessToolsGroupMember,
  isTopLevelProcessDetail,
  processFinishedAtFromMessages,
  processGroupTargetIndex,
  processNodeSequenceIsCurrent,
  processThinkingChildIndexes,
  processToolGroupStateKey,
  processToolSuffixAppendStart,
  processTurnUpdateMode,
  resolveProcessExpandedState,
  shouldPreserveProcessGroupDuringHandoff,
  shouldToggleProcessSummary,
  splitConsecutiveProcessNodes,
  summarizeProcessTools,
} from '../../src/components/chat/panel-decoration/process-folding'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })
vi.mock('@/lib/tool-display-settings', () => ({
  getCachedToolDisplaySettings: () => ({ toolDisplayMode: 'compact', showContextUsage: false }),
}), { virtual: true })

describe('process folding timing', () => {
  it('restores a persisted thinking-only completion time after the panel is rebuilt', () => {
    expect(processFinishedAtFromMessages([
      { role: 'assistant', timestamp: 1_000, details: { quickforgeProcessFinishedAt: 6_000 } },
    ])).toBe(6_000)
  })

  it('accepts persisted ISO timestamps and uses the latest assistant completion', () => {
    expect(processFinishedAtFromMessages([
      { role: 'assistant', details: { quickforgeProcessFinishedAt: '2026-01-01T00:00:05.000Z' } },
      { role: 'assistant', details: { quickforgeProcessFinishedAt: '1767225610000' } },
    ])).toBe(1_767_225_610_000)
  })
})

describe('process streaming updates', () => {
  it('builds the live process group when it does not exist or content changed', () => {
    expect(processTurnUpdateMode(true, false, false, false)).toBe('full')
    expect(processTurnUpdateMode(true, false, true, false)).toBe('full')
  })

  it('updates only the live label when the grouped node sequence is unchanged', () => {
    expect(processTurnUpdateMode(true, false, true, true)).toBe('update')
  })

  it('skips stable historical turns while another turn is streaming', () => {
    expect(processTurnUpdateMode(false, true, true, true)).toBe('skip')
  })

  it('fully reconciles completed turns even when their fingerprint matches', () => {
    expect(processTurnUpdateMode(false, false, true, true)).toBe('full')
  })

  it('fully rebuilds a streaming process when Lit replaced the grouped nodes', () => {
    expect(processTurnUpdateMode(true, false, true, true, false)).toBe('full')
    expect(processNodeSequenceIsCurrent(
      [{ node: { isConnected: false }, sourceAssistant: 'assistant-a' }],
      [{ node: {}, sourceAssistant: 'assistant-a' }],
    )).toBe(false)
  })

  it('activates a streaming process on primary pointerdown without toggling again on pointer click', () => {
    expect(shouldToggleProcessSummary(true, 'pointerdown', { button: 0, isPrimary: true })).toBe(true)
    expect(shouldToggleProcessSummary(true, 'click', { detail: 1 })).toBe(false)
    expect(shouldToggleProcessSummary(true, 'pointerdown', { button: 2, isPrimary: true })).toBe(false)
    expect(shouldToggleProcessSummary(true, 'pointerdown', { button: 0, isPrimary: false })).toBe(false)
  })

  it('keeps keyboard activation for streaming process summaries', () => {
    expect(shouldToggleProcessSummary(true, 'click', { detail: 0 })).toBe(true)
  })

  it('keeps completed process summaries on normal click activation', () => {
    expect(shouldToggleProcessSummary(false, 'pointerdown', { button: 0, isPrimary: true })).toBe(false)
    expect(shouldToggleProcessSummary(false, 'click', { detail: 1 })).toBe(true)
  })

  it('defaults a new streaming process to expanded and preserves explicit state', () => {
    expect(resolveProcessExpandedState(undefined, false, false, true)).toBe(true)
    expect(resolveProcessExpandedState(undefined, false, false, false)).toBe(false)
    expect(resolveProcessExpandedState(false, false, true, true)).toBe(false)
    expect(resolveProcessExpandedState(true, false, false, false)).toBe(true)
    expect(resolveProcessExpandedState(undefined, true, true, false)).toBe(true)
    expect(resolveProcessExpandedState(undefined, true, false, true)).toBe(false)
  })

  it('uses mode defaults for tool groups while preserving explicit state within the same mode', () => {
    expect(resolveProcessExpandedState(undefined, false, false, false)).toBe(false)
    expect(resolveProcessExpandedState(undefined, false, false, true)).toBe(true)
    expect(resolveProcessExpandedState(false, false, true, true)).toBe(false)
    expect(resolveProcessExpandedState(true, false, false, false)).toBe(true)
    expect(resolveProcessExpandedState(undefined, true, true, false)).toBe(true)
    expect(resolveProcessExpandedState(undefined, false, true, false)).toBe(false)
  })

  it('anchors a running turn to a stable assistant instead of the temporary streaming assistant', () => {
    expect(processGroupTargetIndex([
      { streaming: false, hasGroup: false },
      { streaming: true, hasGroup: false },
    ])).toBe(0)
    expect(processGroupTargetIndex([
      { streaming: true, hasGroup: false },
    ])).toBe(0)
  })

  it('keeps using the stable assistant that already owns the process group', () => {
    expect(processGroupTargetIndex([
      { streaming: false, hasGroup: true },
      { streaming: false, hasGroup: false },
      { streaming: true, hasGroup: false },
    ])).toBe(0)
  })

  it('keeps a tools group key stable when more consecutive tools are appended', () => {
    expect(processToolGroupStateKey('turn:0', 'tool-a', 0)).toBe('turn:0:tools:tool-a')
    expect(processToolGroupStateKey('turn:0', 'tool-a', 1)).toBe('turn:0:tools:tool-a')
  })

  it('recognizes a connected same-assistant tool suffix that can be appended in place', () => {
    const toolA = { isConnected: true, tagName: 'TOOL-MESSAGE', toolCall: { name: 'read_file' } }
    const toolB = { isConnected: true, tagName: 'TOOL-MESSAGE', toolCall: { name: 'edit_file' } }
    expect(processToolSuffixAppendStart(
      [{ node: toolA, sourceAssistant: 'assistant-a' }],
      [
        { node: toolA, sourceAssistant: 'assistant-a' },
        { node: toolB, sourceAssistant: 'assistant-a' },
      ],
    )).toBe(1)
  })

  it('recognizes a connected tool suffix across assistant message boundaries', () => {
    const toolA = { isConnected: true, tagName: 'TOOL-MESSAGE', toolCall: { name: 'read_file' } }
    const toolB = { isConnected: true, tagName: 'TOOL-MESSAGE', toolCall: { name: 'edit_file' } }
    expect(processToolSuffixAppendStart(
      [{ node: toolA, sourceAssistant: 'assistant-a' }],
      [
        { node: toolA, sourceAssistant: 'assistant-a' },
        { node: toolB, sourceAssistant: 'assistant-b' },
      ],
    )).toBe(1)
  })

  it('rejects suffix appends that would change the process structure', () => {
    const toolA = { isConnected: true, tagName: 'TOOL-MESSAGE', toolCall: { name: 'read_file' } }
    const toolB = { isConnected: true, tagName: 'TOOL-MESSAGE', toolCall: { name: 'edit_file' } }
    const thinking = { isConnected: true, tagName: 'THINKING-BLOCK' }

    expect(processToolSuffixAppendStart(
      [{ node: toolA, sourceAssistant: 'assistant-a' }],
      [
        { node: toolA, sourceAssistant: 'assistant-a' },
        { node: thinking, sourceAssistant: 'assistant-a' },
      ],
    )).toBeUndefined()
    expect(processToolSuffixAppendStart(
      [{ node: toolA, sourceAssistant: 'assistant-a' }],
      [
        { node: toolA, sourceAssistant: 'assistant-a' },
        {
          node: { isConnected: true, tagName: 'TOOL-MESSAGE', toolCall: { name: 'run_subagent' } },
          sourceAssistant: 'assistant-a',
        },
      ],
    )).toBeUndefined()
    expect(processToolSuffixAppendStart(
      [{ node: { ...toolA, isConnected: false }, sourceAssistant: 'assistant-a' }],
      [
        { node: toolA, sourceAssistant: 'assistant-a' },
        { node: toolB, sourceAssistant: 'assistant-a' },
      ],
    )).toBeUndefined()
  })

  it('preserves an existing process group during the streaming-to-stable DOM handoff', () => {
    expect(shouldPreserveProcessGroupDuringHandoff(false, true, true)).toBe(true)
    expect(shouldPreserveProcessGroupDuringHandoff(false, true, false)).toBe(false)
    expect(shouldPreserveProcessGroupDuringHandoff(true, true, true)).toBe(false)
    expect(shouldPreserveProcessGroupDuringHandoff(false, false, true)).toBe(false)
  })
})

describe('process folding order', () => {
  it('treats subagents as independent process items instead of tools summary members', () => {
    expect(isProcessToolsGroupMember('run_subagent')).toBe(false)
    expect(isProcessToolsGroupMember('read_file')).toBe(true)
    expect(isProcessToolsGroupMember('edit_file')).toBe(true)
  })

  it('keeps agent calls between separate surrounding tool groups', () => {
    const nodes = ['tool-a', 'tool-b', 'run_subagent', 'tool-c', 'run_subagent', 'tool-d']
    expect(splitConsecutiveProcessNodes(nodes, (node) => node.startsWith('tool'))).toEqual([
      { kind: 'tools', items: ['tool-a', 'tool-b'] },
      { kind: 'detail', items: ['run_subagent'] },
      { kind: 'tools', items: ['tool-c'] },
      { kind: 'detail', items: ['run_subagent'] },
      { kind: 'tools', items: ['tool-d'] },
    ])
  })

  it('groups only consecutive tools and preserves the surrounding timeline', () => {
    const nodes = ['plan', 'thinking-a', 'tool-1', 'tool-2', 'thinking-b', 'tool-3']
    expect(splitConsecutiveProcessNodes(nodes, (node) => node.startsWith('tool'))).toEqual([
      { kind: 'detail', items: ['plan', 'thinking-a'] },
      { kind: 'tools', items: ['tool-1', 'tool-2'] },
      { kind: 'detail', items: ['thinking-b'] },
      { kind: 'tools', items: ['tool-3'] },
    ])
  })

  it('treats assistant message boundaries as protocol metadata rather than visual boundaries', () => {
    const items = [
      { source: 'assistant-a', value: 'thinking-a' },
      { source: 'assistant-a', value: 'tool-a' },
      { source: 'assistant-b', value: 'tool-b' },
    ]

    expect(splitConsecutiveProcessNodes(items, (item) => item.value.startsWith('tool'))).toEqual([
      { kind: 'detail', items: items.slice(0, 1) },
      { kind: 'tools', items: items.slice(1) },
    ])
  })

  it('keeps the injected Thinking icon separate from the native chevron after re-decoration', () => {
    expect(processThinkingChildIndexes([
      { quickforgeIcon: true, hasSvg: true },
      { markedLabel: true },
      { markedChevron: true, hasSvg: true },
    ])).toEqual({ chevronIndex: 2, labelIndex: 1, chevronExpanded: false })
  })

  it('finds the native Thinking chevron by its svg when Lit replaces marker classes', () => {
    expect(processThinkingChildIndexes([
      { quickforgeIcon: true, hasSvg: true },
      {},
      { hasSvg: true },
    ])).toEqual({ chevronIndex: 2, labelIndex: 1, chevronExpanded: false })
  })

  it('preserves the native Thinking expanded state when removing upstream classes', () => {
    expect(processThinkingChildIndexes([
      { quickforgeIcon: true, hasSvg: true },
      { markedLabel: true },
      { markedChevron: true, hasSvg: true, rotated: true },
    ])).toEqual({ chevronIndex: 2, labelIndex: 1, chevronExpanded: true })
  })

  it('groups consecutive tools across assistant message boundaries', () => {
    const items = [
      { source: 'assistant-a', value: 'tool-a' },
      { source: 'assistant-b', value: 'tool-b' },
    ]

    expect(splitConsecutiveProcessNodes(items, (item) => item.value.startsWith('tool'))).toEqual([
      { kind: 'tools', items },
    ])
  })

  it('keeps Thinking and agents as hard boundaries across assistant messages', () => {
    const items = [
      { source: 'assistant-a', value: 'tool-a' },
      { source: 'assistant-b', value: 'thinking' },
      { source: 'assistant-c', value: 'tool-b' },
      { source: 'assistant-d', value: 'run_subagent' },
      { source: 'assistant-e', value: 'tool-c' },
    ]

    expect(splitConsecutiveProcessNodes(items, (item) => item.value.startsWith('tool'))).toEqual([
      { kind: 'tools', items: items.slice(0, 1) },
      { kind: 'detail', items: items.slice(1, 2) },
      { kind: 'tools', items: items.slice(2, 3) },
      { kind: 'detail', items: items.slice(3, 4) },
      { kind: 'tools', items: items.slice(4, 5) },
    ])
  })

  it('excludes markdown rendered inside a thinking block from top-level process details', () => {
    const topLevel = { parentElement: null, closest: () => null } as unknown as HTMLElement
    const nested = {
      closest: () => null,
      parentElement: {
        closest: () => ({ tagName: 'THINKING-BLOCK', closest: () => null }),
      },
    } as unknown as HTMLElement

    expect(isTopLevelProcessDetail(topLevel)).toBe(true)
    expect(isTopLevelProcessDetail(nested)).toBe(false)
  })
})

describe('process tool summary', () => {
  it('recognizes a command-only group', () => {
    expect(summarizeProcessTools([
      { toolCall: { name: 'run_command' }, result: {} },
      { tool: { name: 'run_command' }, result: {} },
    ])).toEqual({ count: 2, errorCount: 0, commandsOnly: true })
  })

  it('counts repeated edit and write calls by unique file path', () => {
    expect(summarizeProcessTools([
      { toolCall: { name: 'edit_file', arguments: { path: 'src/app.ts' } }, result: {} },
      { toolCall: { name: 'edit_file', arguments: { path: 'src/app.ts' } }, result: { isError: true } },
      { toolCall: { name: 'write_file', arguments: { path: 'src/index.ts' } }, result: {} },
    ])).toEqual({ count: 3, errorCount: 1, commandsOnly: false, editedFileCount: 2 })
  })

  it('falls back to the result path after a file edit completes', () => {
    expect(summarizeProcessTools([
      { toolCall: { name: 'edit_file' }, result: { details: { path: 'src/app.ts' } } },
    ])).toEqual({ count: 1, errorCount: 0, commandsOnly: false, editedFileCount: 1 })
  })

  it('uses the generic tool summary when file edits are mixed with other tools', () => {
    expect(summarizeProcessTools([
      { toolCall: { name: 'edit_file', arguments: { path: 'src/app.ts' } }, result: {} },
      { toolCall: { name: 'read_file', arguments: { path: 'src/app.ts' } }, result: {} },
    ])).toEqual({ count: 2, errorCount: 0, commandsOnly: false })
  })

  it('uses the generic tool summary for mixed tools and counts failures', () => {
    expect(summarizeProcessTools([
      { toolCall: { name: 'grep_files' }, result: {} },
      { toolCall: { name: 'run_command' }, result: { isError: true } },
      { toolCall: { name: 'read_file' }, aborted: true },
    ])).toEqual({ count: 3, errorCount: 2, commandsOnly: false })
  })
})

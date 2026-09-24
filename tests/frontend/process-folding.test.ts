import { describe, expect, it, vi } from 'vitest'
import {
  formatProcessDuration,
  isProcessToolsGroupMember,
  assistantProcessSourceHasVisibleError,
  isFoldableProcessTimelineNode,
  isTopLevelProcessDetail,
  processGroupAnchorIndex,
  processFinishedAtFromMessages,
  processGroupDefaultExpanded,
  processGroupTargetIndex,
  processNodeSequenceIsCurrent,
  processStatusLabel,
  processStageDefaultExpanded,
  processStageLabel,
  processStageStateKey,
  processThinkingChildIndexes,
  processToolSuffixAppendStart,
  processSectionNeedsStage,
  processTurnFingerprint,
  processTurnUpdateMode,
  resolveProcessExpandedState,
  selectFoldableProcessItems,
  shouldDiscardGroupedProcessNode,
  shouldPreserveProcessGroupDuringHandoff,
  shouldToggleProcessSummary,
  splitProcessStageSections,
  splitStreamingThinkingRuns,
  summarizeProcessStageTools,
} from '../../src/components/chat/panel-decoration/process-folding'
import { applyToolDisplaySettingsValue } from '../../src/lib/tool-display-settings'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })

describe('process folding source visibility', () => {
  it('keeps an error-only assistant visible when it carries a concrete error message', () => {
    expect(assistantProcessSourceHasVisibleError({ role: 'assistant', stopReason: 'error', errorMessage: 'Provider failed' })).toBe(true)
    expect(assistantProcessSourceHasVisibleError({ role: 'assistant', stopReason: 'aborted', errorMessage: 'Request aborted' })).toBe(true)
    expect(assistantProcessSourceHasVisibleError({ role: 'assistant', stopReason: 'error', errorMessage: '   ' })).toBe(false)
    expect(assistantProcessSourceHasVisibleError({ role: 'assistant', stopReason: 'stop', errorMessage: 'ignored' })).toBe(false)
  })
})

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

  it('formats the top-level elapsed time in seconds and minutes', () => {
    expect(formatProcessDuration(999)).toBe('')
    expect(formatProcessDuration(12_400)).toBe('processDurationSeconds')
    expect(formatProcessDuration(72_400)).toBe('processDurationMinutesSeconds')
  })

  it('keeps the top-level label limited to status and elapsed time', () => {
    expect(processStatusLabel('processExecuting', 'processDurationSeconds')).toBe(
      'processExecuting · processDurationSeconds',
    )
    expect(processStatusLabel('processExecuted', '')).toBe('processExecuted')
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

  it('skips already-grouped non-live turns when their fingerprint still matches', () => {
    // 第一个参数在调用点是该 turn 的 isActiveTurn；canShortCircuit 由调用点以
    // `!isActiveTurn` 传入。同一条 skip 快路径既覆盖流式中的历史 turn，
    // 也覆盖非流式（静态）装饰下的已完成 turn：指纹命中即内容未变。
    expect(processTurnUpdateMode(false, true, true, true)).toBe('skip')
  })

  it('fully rebuilds when the fingerprint no longer matches or no group survives', () => {
    expect(processTurnUpdateMode(false, true, true, false)).toBe('full')
    expect(processTurnUpdateMode(false, true, false, true)).toBe('full')
    // 函数级保守默认：调用方未提供短路标记时仍走全量重建
    // （新语义下 canShortCircuit = !isActiveTurn，调用点不再产生该输入）。
    expect(processTurnUpdateMode(false, false, true, true)).toBe('full')
  })

  it('fully rebuilds a streaming process when a re-render replaced the grouped nodes', () => {
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

  it('preserves an expanded process when streaming completes so clicking 已执行 collapses it', () => {
    expect(resolveProcessExpandedState(true, true, true, false)).toBe(true)
    expect(resolveProcessExpandedState(false, true, false, false)).toBe(false)
    expect(resolveProcessExpandedState(undefined, true, true, false)).toBe(true)
  })

  it('defaults the top-level process group from the agent streaming state', () => {
    // 旧语义：只有正在流式的回合默认展开，历史回合默认收起。
    expect(processGroupDefaultExpanded(true)).toBe(true)
    expect(processGroupDefaultExpanded(false)).toBe(false)
  })

  it('uses resolve defaults while preserving explicit state within the same key', () => {
    expect(resolveProcessExpandedState(undefined, false, false, false)).toBe(false)
    expect(resolveProcessExpandedState(undefined, false, false, true)).toBe(true)
    expect(resolveProcessExpandedState(false, false, true, true)).toBe(false)
    expect(resolveProcessExpandedState(true, false, false, false)).toBe(true)
    expect(resolveProcessExpandedState(undefined, true, true, false)).toBe(true)
    expect(resolveProcessExpandedState(undefined, false, true, false)).toBe(false)
  })

  it('anchors a process group at the first connected process node', () => {
    expect(processGroupAnchorIndex([
      { connected: true },
      { connected: true },
      { connected: true },
    ])).toBe(0)
  })

  it('falls back to the next connected process node when the original anchor is detached', () => {
    expect(processGroupAnchorIndex([
      { connected: false },
      { connected: true },
    ])).toBe(1)
    expect(processGroupAnchorIndex([])).toBe(-1)
  })

  it('discards detached or replaced grouped nodes before rebuilding the full process body', () => {
    expect(shouldDiscardGroupedProcessNode(false, false)).toBe(true)
    expect(shouldDiscardGroupedProcessNode(true, true)).toBe(true)
    expect(shouldDiscardGroupedProcessNode(true, false)).toBe(false)
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
  it('treats subagents and generated images as independent details instead of compact tools summary members', () => {
    expect(isProcessToolsGroupMember('run_subagent')).toBe(false)
    expect(isProcessToolsGroupMember('generate_image')).toBe(false)
    expect(isProcessToolsGroupMember('read_file')).toBe(true)
    expect(isProcessToolsGroupMember('edit_file')).toBe(true)
    expect(isProcessToolsGroupMember('run_command')).toBe(true)
    expect(isProcessToolsGroupMember('run_command', { details: { background: true, running: true } })).toBe(false)
    expect(isProcessToolsGroupMember('run_command', { details: { background: true, running: false } })).toBe(true)
  })

  it('keeps the injected Thinking icon separate from the native chevron after re-decoration', () => {
    expect(processThinkingChildIndexes([
      { quickforgeIcon: true, hasSvg: true },
      { markedLabel: true },
      { markedChevron: true, hasSvg: true },
    ])).toEqual({ chevronIndex: 2, labelIndex: 1, chevronExpanded: false })
  })

  it('finds the native Thinking chevron by its svg when a re-render replaces marker classes', () => {
    expect(processThinkingChildIndexes([
      { quickforgeIcon: true, hasSvg: true },
      {},
      { hasSvg: true },
    ])).toEqual({ chevronIndex: 2, labelIndex: 1, chevronExpanded: false })
  })

  it('recognizes a chevron that is the svg itself (React ThinkingBlock header children)', () => {
    // React header 的子级就是 [svg(ChevronRight), span]：svg 本体不是 HTMLElement，
    // 也 querySelector 不到自身，必须由 selfSvg 分支识别（否则接管永远提前 return）。
    expect(processThinkingChildIndexes([
      { selfSvg: true },
      { markedLabel: true },
    ])).toEqual({ chevronIndex: 0, labelIndex: 1, chevronExpanded: false })
  })

  it('carries the expanded state of a self-svg chevron', () => {
    expect(processThinkingChildIndexes([
      { selfSvg: true, rotated: true },
      {},
    ])).toEqual({ chevronIndex: 0, labelIndex: 1, chevronExpanded: true })
  })

  it('preserves the native Thinking expanded state when removing upstream classes', () => {
    expect(processThinkingChildIndexes([
      { quickforgeIcon: true, hasSvg: true },
      { markedLabel: true },
      { markedChevron: true, hasSvg: true, rotated: true },
    ])).toEqual({ chevronIndex: 2, labelIndex: 1, chevronExpanded: true })
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

  it('keeps markdown rendered inside a thinking block out of the foldable timeline', () => {
    // 回归护栏：运行中点击「思考过程」会展开思考块并在其内部渲染 MarkdownBlock。
    // 若该节点被折叠收集搬进过程组 step，父链变化会翻转它的顶层判定，于是它每帧
    // 在「折叠项 / 终答 markdown」之间互翻，整组每帧全量重建并搬动全部节点（页面
    // 一直重刷/闪烁）。嵌套 detail 必须从收集阶段就排除。
    const thinkingBlock = { tagName: 'THINKING-BLOCK', closest: () => null }
    const nested = {
      closest: () => null,
      parentElement: { closest: () => thinkingBlock },
    } as unknown as HTMLElement
    const topLevel = { closest: () => null, parentElement: null } as unknown as HTMLElement

    expect(isFoldableProcessTimelineNode(nested, true)).toBe(false)
    expect(isFoldableProcessTimelineNode(topLevel, true)).toBe(true)
    // 既不是本 assistant 渲染的、也没有折叠追踪记录的节点本就不收集。
    expect(isFoldableProcessTimelineNode(topLevel, false)).toBe(false)
  })

  it('still collects folded nodes whose parents are process group scaffolding', () => {
    // 已在过程组内的节点父链上没有 detail 祖先，仍是顶层 detail：增量追加与指纹
    // 短路依赖它们持续参与收集，改用「位于过程组内即非顶层」会让每帧全量重建。
    const grouped = {
      closest: () => null,
      parentElement: { closest: () => null },
    } as unknown as HTMLElement

    expect(isFoldableProcessTimelineNode(grouped, true)).toBe(true)
  })
})

describe('single top-level process group', () => {
  const isMarkdown = (item: string) => item.startsWith('markdown')
  const isFinal = (item: string) => item === 'markdown-final'

  it('keeps intermediate markdown, thinking, and tools in the same top-level group', () => {
    const items = ['thinking-a', 'markdown-stage', 'tool-a', 'thinking-b', 'markdown-final']
    expect(selectFoldableProcessItems(items, isFinal, isMarkdown, true)).toEqual([
      'thinking-a',
      'markdown-stage',
      'tool-a',
      'thinking-b',
    ])
  })

  it('keeps generate_image in the top-level process group instead of creating a sibling boundary', () => {
    const items = ['tool-a', 'generate-image', 'markdown-stage', 'thinking-b', 'markdown-final']
    expect(selectFoldableProcessItems(items, isFinal, isMarkdown, true)).toEqual([
      'tool-a',
      'generate-image',
      'markdown-stage',
      'thinking-b',
    ])
  })

  it('does not fold plain markdown when the turn has no process signals', () => {
    expect(selectFoldableProcessItems(['markdown-final'], isFinal, isMarkdown, false)).toEqual([])
    expect(selectFoldableProcessItems(['markdown-only'], () => false, isMarkdown, false)).toEqual([])
  })
})

describe('nested process stage groups', () => {
  it('nests every process fragment in its own stage between unfolded intermediate markdown', () => {
    const items = ['thinking-a', 'tool-a', 'markdown-stage', 'thinking-b', 'tool-b', 'markdown-stage-2', 'tool-c']
    expect(splitProcessStageSections(items, (item) => item.startsWith('markdown'))).toEqual([
      { kind: 'stage', items: ['thinking-a', 'tool-a'] },
      { kind: 'detail', items: ['markdown-stage'] },
      { kind: 'stage', items: ['thinking-b', 'tool-b'] },
      { kind: 'detail', items: ['markdown-stage-2'] },
      { kind: 'stage', items: ['tool-c'] },
    ])
  })

  it('does not create an empty stage before a leading intermediate markdown block', () => {
    expect(splitProcessStageSections(
      ['markdown-stage', 'thinking-a', 'tool-a'],
      (item) => item.startsWith('markdown'),
    )).toEqual([
      { kind: 'detail', items: ['markdown-stage'] },
      { kind: 'stage', items: ['thinking-a', 'tool-a'] },
    ])
  })

  it('skips the stage header for tool-less fragments (thinking-only turns show no empty 已执行)', () => {
    const fragmentOf = (...kinds: string[]) => kinds.map((kind) => ({
      node: {
        tagName: 'div',
        classList: { contains: (name: string) => name === `qf-${kind}` },
      } as unknown as HTMLElement,
    }))
    // 纯思考段：没有工具行可聚合，不包 stage 头。
    expect(processSectionNeedsStage(fragmentOf('thinking-block', 'thinking-block'))).toBe(false)
    // 段内出现任何工具行（含不可分组的 subagent / 生图卡）就需要 stage 头。
    expect(processSectionNeedsStage(fragmentOf('thinking-block', 'tool-message'))).toBe(true)
    expect(processSectionNeedsStage(fragmentOf('tool-message'))).toBe(true)
    expect(processSectionNeedsStage([])).toBe(false)
  })

  it('splits streaming-thinking items out of stage runs in order (they never hide inside a collapsed stage)', () => {
    const isLive = (item: string) => item.startsWith('live')
    // 典型序：流式思考行在段尾（本轮的思考行先于本轮工具行出现）。
    expect(splitStreamingThinkingRuns(
      ['thinking-done', 'tool-a', 'live-thinking'],
      isLive,
    )).toEqual([
      { kind: 'stage', items: ['thinking-done', 'tool-a'] },
      { kind: 'liveThinking', items: ['live-thinking'] },
    ])
    // 工具行的 toolCall chunk 先于 message_end 出现时，流式思考行会夹在工具行之前
    // ——按位置切（stage / live / stage），保持原顺序。
    expect(splitStreamingThinkingRuns(
      ['live-thinking', 'tool-a'],
      isLive,
    )).toEqual([
      { kind: 'liveThinking', items: ['live-thinking'] },
      { kind: 'stage', items: ['tool-a'] },
    ])
    expect(splitStreamingThinkingRuns(['live-a', 'live-b'], isLive)).toEqual([
      { kind: 'liveThinking', items: ['live-a', 'live-b'] },
    ])
    expect(splitStreamingThinkingRuns([], isLive)).toEqual([])
  })

  it('expands inner stages by default from the expandProcessStageByDefault setting, while manual/saved state still wins', () => {
    // 默认（未配置）→ 展开，每条工具调用直接可见。
    applyToolDisplaySettingsValue(undefined)
    expect(processStageDefaultExpanded()).toBe(true)
    // 无 saved state 且非增量 key 命中 → 取设置默认值（默认展开）。
    expect(resolveProcessExpandedState(undefined, false, true, processStageDefaultExpanded())).toBe(true)
    // 设置为默认收起 → stage 初始收起。
    applyToolDisplaySettingsValue({ expandProcessStageByDefault: false })
    expect(processStageDefaultExpanded()).toBe(false)
    expect(resolveProcessExpandedState(undefined, false, true, processStageDefaultExpanded())).toBe(false)
    // 增量 key 命中（同一 stage 追加工具行）保留当前开合：手动收起不被弹回。
    expect(resolveProcessExpandedState(undefined, true, false, processStageDefaultExpanded())).toBe(false)
    // saved state（用户手动开合记忆）优先于设置默认值（无论默认开或关）。
    expect(resolveProcessExpandedState(false, false, true, processStageDefaultExpanded())).toBe(false)
    expect(resolveProcessExpandedState(true, false, false, processStageDefaultExpanded())).toBe(true)
    applyToolDisplaySettingsValue(undefined)
    expect(resolveProcessExpandedState(false, false, true, processStageDefaultExpanded())).toBe(false)
    expect(resolveProcessExpandedState(true, false, false, processStageDefaultExpanded())).toBe(true)
  })

  it('uses independent stable keys for inner stage state', () => {
    expect(processStageStateKey('turn:0', 0)).toBe('turn:0:stage:0')
    expect(processStageStateKey('turn:0', 1)).toBe('turn:0:stage:1')
  })

  it('builds stage titles from status and independent tool statistics', () => {
    const summary = summarizeProcessStageTools([
      ...Array.from({ length: 7 }, () => ({ toolCall: { name: 'run_command' } })),
      ...Array.from({ length: 5 }, (_, index) => ({
        toolCall: { name: 'edit_file', arguments: { path: `src/${index}.ts` } },
      })),
    ])
    expect(summary).toEqual({ toolCallCount: 12, commandCount: 7, editedFileCount: 5, errorCount: 0 })
    expect(processStageLabel(summary, true)).toBe(
      'processExecuting  processGroupToolsCalled · processGroupCommandsRan · processGroupFilesEdited',
    )
    expect(processStageLabel(summary, false)).toBe(
      'processExecuted  processGroupToolsCalled · processGroupCommandsRan · processGroupFilesEdited',
    )
    expect(processStageLabel(summarizeProcessStageTools([]), true)).toBe('processExecuting')
  })

  it('appends the failure count to the stage title when any grouped tool failed', () => {
    const summary = summarizeProcessStageTools([
      { toolCall: { name: 'grep_files' }, result: {} },
      { toolCall: { name: 'run_command' }, result: { isError: true } },
      { toolCall: { name: 'read_file' }, aborted: true },
    ])
    expect(summary).toEqual({ toolCallCount: 3, commandCount: 1, editedFileCount: 0, errorCount: 2 })
    expect(processStageLabel(summary, false)).toBe(
      'processExecuted  processGroupToolsCalled · processGroupCommandsRan · processToolsFailedCount',
    )
  })
})

/**
 * 指纹用例的最小 fake assistant：`processTurnFingerprint` 只用到 querySelectorAll
 * （过程组 / 思考块 / detail 节点）与 message bridge；closest 一律返回 null（节点不在
 * message-list 作用域内时 `isTopLevelProcessDetail` 仍把它当作顶层 detail）。
 */
function fingerprintAssistant(nodes: Array<{ tagName: string; className?: string; toolCall?: { id?: string } }>) {
  const elements = nodes.map(({ tagName, className = '', toolCall }) => ({
    tagName,
    className,
    toolCall,
    dataset: {} as Record<string, string>,
    parentElement: null,
    classList: { contains: (name: string) => className.split(/\s+/).filter(Boolean).includes(name) },
    closest: () => null,
  }))
  const assistant = {
    message: { role: 'assistant', content: [] },
    querySelectorAll: (selector: string) => {
      if (selector === '.quickforge-process-group') return []
      if (selector === 'thinking-block, .qf-thinking-block') {
        return elements.filter((node) => node.tagName === 'THINKING-BLOCK')
      }
      return elements
    },
    closest: () => null,
  }
  return {
    assistants: [assistant] as unknown as Parameters<typeof processTurnFingerprint>[0],
    elements: elements as unknown as HTMLElement[],
  }
}

describe('process turn fingerprint (folded structure only)', () => {
  it('ignores the final answer markdown so its first appearance cannot trigger a full rebuild', () => {
    const streaming = fingerprintAssistant([{ tagName: 'THINKING-BLOCK' }])
    // 思考过程结束、正文开始输出：时间线末尾多出终答 markdown。
    const withFinalAnswer = fingerprintAssistant([
      { tagName: 'THINKING-BLOCK' },
      { tagName: 'DIV', className: 'qf-markdown-block' },
    ])

    expect(processTurnFingerprint(streaming.assistants)).toBe('1|0:thinking-block')
    // 不排除终答 markdown 时它被算进指纹 → 判定为结构变化 → 整组 full 重建（思考结束
    // 瞬间「页面重新刷一下」的来源之一）。
    expect(processTurnFingerprint(withFinalAnswer.assistants)).toBe('1|0:thinking-block|0:markdown-block')
    expect(processTurnFingerprint(withFinalAnswer.assistants, withFinalAnswer.elements[1])).toBe('1|0:thinking-block')
  })

  it('still counts foldable intermediate markdown as structure', () => {
    const withStage = fingerprintAssistant([
      { tagName: 'THINKING-BLOCK' },
      { tagName: 'DIV', className: 'qf-markdown-block' },
      { tagName: 'DIV', className: 'qf-tool-message', toolCall: { id: 'call-1' } },
      { tagName: 'DIV', className: 'qf-markdown-block' },
    ])

    // 中间 markdown 是可折叠过程段：即使排除了末尾终答 markdown，它仍在指纹里。
    expect(processTurnFingerprint(withStage.assistants, withStage.elements[3])).toBe(
      '1|0:thinking-block|0:markdown-block|0:tool-message:call-1',
    )
  })
})

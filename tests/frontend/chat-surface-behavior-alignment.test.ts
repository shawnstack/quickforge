import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { readAgentSnapshot } from '../../src/components/chat/surface/ChatSurface'
import type { Agent, AgentMessage } from '../../src/components/chat/surface/ChatTypes'

// Behavior-alignment contracts for the migrated React chat surface
// (self-hosted-chat-ui): each test pins a behavior the legacy Lit panel had
// and the first React port lost. The suite follows the repo's Node-only
// vitest setup: pure functions are exercised directly, JSX wiring is pinned
// through source assertions (same pattern as side-chat-workspace-tab.test.ts).

const chatSurfaceSource = readFileSync(new URL('../../src/components/chat/surface/ChatSurface.tsx', import.meta.url), 'utf8')
const messageEditorSource = readFileSync(new URL('../../src/components/chat/surface/MessageEditor.tsx', import.meta.url), 'utf8')
const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')

function fakeAgent(messages: AgentMessage[], model: { id: string; provider: string }): Agent {
  return {
    state: {
      systemPrompt: '',
      model,
      thinkingLevel: 'off',
      tools: [],
      messages,
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
    },
    subscribe: vi.fn(() => () => {}),
    abort: vi.fn(),
    prompt: vi.fn(async () => {}),
  } as unknown as Agent
}

describe('model refresh through chatPanelRevision', () => {
  it('re-reads the live agent state, so an in-place model switch lands in the next snapshot', () => {
    // Model switching (updateCurrentAgentModel) rewrites state.model without
    // emitting an agent event; the surface's revision-keyed sync relies on
    // readAgentSnapshot reading that live state.
    const agent = fakeAgent([{ role: 'user', content: 'hi', timestamp: 1 }], { id: 'old-model', provider: 'anthropic' })
    expect(readAgentSnapshot(agent).model?.id).toBe('old-model')

    agent.state.model = { id: 'new-model', provider: 'openai' }
    expect(readAgentSnapshot(agent).model?.id).toBe('new-model')
  })

  it('wires the host revision into a snapshot-refresh effect on the surface', () => {
    expect(hostSource).toContain('chatPanelRevision={revision}')
    expect(chatSurfaceSource).toContain('if (!agent || chatPanelRevision === undefined) return')
    expect(chatSurfaceSource).toContain('}, [chatPanelRevision, agent, syncSnapshot])')
    // The event subscription keeps refreshing through the same hoisted sync.
    expect(chatSurfaceSource).toContain('if (isSnapshotRefreshEvent(event.type)) syncSnapshot()')
  })
})

describe('composer mount autofocus', () => {
  it('focuses the textarea once on mount (legacy firstUpdated), never per render', () => {
    expect(messageEditorSource).toMatch(/useEffect\(\(\) => \{\s*textareaRef\.current\?\.focus\(\)\s*\}, \[\]\)/)
  })
})

describe('onInitialRenderReady barrier', () => {
  it('initializes after the surface paint settles (updateComplete + afterPaint semantics)', () => {
    // Nested rAF instead of Promise.resolve(): the notify must not fire on a
    // bare microtask before the surface has painted.
    expect(hostSource).toMatch(/const initializePanel = new Promise<void>\(\(resolve\) => \{\s*window\.requestAnimationFrame\(\(\) => \{\s*window\.requestAnimationFrame\(\(\) => resolve\(\)\)\s*\}\)\s*\}\)/)
    expect(hostSource).not.toContain('const initializePanel = Promise.resolve()')
    expect(hostSource).toContain('scheduleAfterPaint(() => {')
  })
})

describe('auto-scroll ownership', () => {
  it('does not keep a ChatSurface scroll listener; host scroll-sync owns follow', () => {
    expect(chatSurfaceSource).not.toContain('distanceFromBottom < 10')
    expect(chatSurfaceSource).not.toContain('lastScrollTopRef')
    expect(chatSurfaceSource).toContain('autoScrollRef.current && messageWindow.atTail')
    expect(hostSource).toMatch(
      /onReachTop:\s*\(\)\s*=>\s*\{[\s\S]*?beginProgrammaticScroll\(\)[\s\S]*?loadMoreMessages\(\)[\s\S]*?\.finally\(/,
    )
    expect(hostSource).not.toContain('requestAnimationFrame(endProgrammaticScroll)')
    expect(chatSurfaceSource).toContain('loadMoreMessages: () => Promise<void>')
  })
})

describe('message windowing stays off for turn navigation', () => {
  it('renders the complete conversation up front, like the legacy window layer', () => {
    // Legacy ChatPanelHost: `createMessageWindow({ enabled: false })` so turn
    // navigation can scroll directly to DOM nodes that already exist; silently
    // falling back to the default (windowing) would drop older turns from the DOM.
    expect(chatSurfaceSource).toContain('createMessageWindow({ enabled: false })')
    expect(chatSurfaceSource).not.toContain('createMessageWindow()')
    // The disabled window layer still exposes the handle API the host drives.
    expect(chatSurfaceSource).toContain('getWindowMessages: () => committedWindowRef.current.messages')
    expect(chatSurfaceSource).toContain('getWindowStart: () => committedWindowRef.current.start')
  })
})

describe('streaming code-block gate', () => {
  const messageListSource = readFileSync(new URL('../../src/components/chat/surface/MessageList.tsx', import.meta.url), 'utf8')
  const assistantMessageSource = readFileSync(new URL('../../src/components/chat/surface/AssistantMessage.tsx', import.meta.url), 'utf8')

  it('renders the streaming row as the same keyed list child its committed form becomes', () => {
    // `message_end` must update the tail row in place (same fiber ⇒ same DOM
    // subtree, keeping the thinking disclosure state and every CSS animation).
    // That only happens when the streaming row and its committed form are the
    // same keyed element type inside ONE sibling array: a separate JSX slot
    // after `items.map(...)` gets its own reconcile scope and remounts the row
    // even with a matching key. The combined key array also applies
    // `messageRenderKeys`'s occurrence suffix to same-identity duplicates.
    expect(messageListSource).toContain('messageRenderKeys(streamingAssistant ? [...messages, streamingAssistant] : messages)')
    expect(messageListSource).toContain('rows.push(')
    expect(messageListSource).toContain('key={renderKeys[messages.length]}')
    // No wrapper element around the row either (see the next case).
    expect(messageListSource).not.toContain('AssistantStreamingContext')
  })

  it('marks the streaming row from inside AssistantMessage instead of a row wrapper', () => {
    // The streaming gate provider lives *inside* the row component: a wrapper
    // element that vanishes when the partial commits would remount the row
    // just as surely as a key change. An enclosing trace surface (subagent
    // run-detail, no streaming row) keeps gating its whole subtree through the
    // ORed `surfaceStreaming` value. CodeBlock reads the context instead of
    // probing `closest('.qf-streaming-message')`.
    expect(assistantMessageSource).toContain('const surfaceStreaming = useAssistantStreaming()')
    expect(assistantMessageSource).toContain('<AssistantStreamingContext.Provider value={surfaceStreaming || isStreaming}>')
    // The surface keeps only the (self-hiding) cursor anchor outside the list:
    // the streaming message itself is owned by the list so `message_end`
    // commits it in place instead of remounting it between two subtrees.
    expect(chatSurfaceSource).toContain('className="qf-streaming-message mb-3 flex flex-col gap-3"')
    expect(chatSurfaceSource).toContain('streamingAssistant={rendersStreamingRow ? streamingAssistant : undefined}')
  })
})

describe('stable surface key across Deferred→Real promotion', () => {
  const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

  it('keys the surface by runtime scope id so promotion updates in place', () => {
    // `agent.sessionId` flips from `pending-*` to the real session id at the
    // Deferred→Real promotion; keying by it remounted the whole surface mid
    // first message (the visible "reload" flash). The runtime scope id stays
    // `pending-*` through the promotion and follows the target session on
    // switches, so both behaviors keep their intended shape.
    expect(hostSource).toContain('key={agentRuntimeScopeId ?? agent.sessionId}')
    expect(hostSource).not.toContain('key={agent.sessionId}')
    // App (the only DeferredSessionAgent host) feeds the stable id in.
    expect(appSource).toContain('agentRuntimeScopeId={agentManager.currentRuntimeScopeId}')
  })
})

describe('structural release ownership (no pre-release outside the boundary)', () => {
  it('lets ProcessGroupReleaseBoundary own messages_replaced releases with same-commit re-fold', () => {
    // A host-side `releaseStreamingProcessGroups(panel)` in the event callback
    // ran before the React commit, so the boundary found no groups, skipped the
    // synchronous re-fold request, and the re-fold fell to the next rAF — one
    // painted frame with the released (unfolded) rows. Structural releases
    // must go through the boundary (auto_compact_completed is always followed
    // by messages_replaced server-side).
    expect(hostSource).not.toMatch(/releaseStreamingProcessGroups\s*\(/)
    expect(hostSource).toContain('onProcessGroupsReleased={requestSurfaceDecorateNow}')
    expect(chatSurfaceSource).toContain('if (released) this.props.onReleased?.()')
  })
})

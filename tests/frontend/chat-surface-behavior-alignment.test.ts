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
    // Bottom pinning goes through the single scroll writer, gated on the
    // window's right edge covering the conversation tail (not on "the window
    // contains the newest user turn", which is also true for a paged-back
    // window and used to yank the viewport to the bottom).
    expect(chatSurfaceSource).toContain("scrollOwnerRef.current?.apply({ kind: 'tail' })")
    expect(chatSurfaceSource).not.toContain('messageWindow.atTail &&')
    expect(hostSource).toMatch(
      /onReachTop:\s*\(\)\s*=>\s*\{[\s\S]*?beginProgrammaticScroll\(\)[\s\S]*?loadMoreMessages\(\)[\s\S]*?\.finally\(/,
    )
    expect(hostSource).not.toContain('requestAnimationFrame(endProgrammaticScroll)')
    expect(chatSurfaceSource).toContain('loadMoreMessages: () => Promise<void>')
  })

  it('lets the surface own the follow flag and the tail edge', () => {
    // Two copies of either fact drifted apart: scroll-sync re-armed its own
    // follow flag on any bottom-edge scroll (which pinned the viewport and
    // chained pages to the newest message), and the surface pinned on a window
    // that still had unmounted turns below it.
    expect(chatSurfaceSource).toContain('isFollowing: () => autoScrollRef.current')
    expect(chatSurfaceSource).toContain('coversTail: () => windowController.coversTail()')
    expect(hostSource).toContain('getFollowing: () => surfaceRef.current?.isFollowing() ?? true')
    expect(hostSource).toContain('canFollowTail: () => surfaceRef.current?.coversTail() ?? true')
  })
})

describe('message windowing is on by default', () => {
  it('constructs the controller with its default (windowing) configuration', () => {
    // Long conversations must not mount the whole history: the controller's own
    // thresholds (`WINDOW_ENABLE_*`) already pass short conversations through
    // unchanged, so the surface has no reason to force `enabled: false`.
    expect(chatSurfaceSource).toContain('createMessageWindow()')
    expect(chatSurfaceSource).not.toContain('createMessageWindow({ enabled: false })')
    // The window layer still exposes the handle API the host drives.
    expect(chatSurfaceSource).toContain('getWindowMessages: () => committedWindowRef.current.messages')
    expect(chatSurfaceSource).toContain('getWindowStart: () => committedWindowRef.current.start')
  })

  it('replaces turn-navigation DOM lookups with a window move before measuring', () => {
    // This is what used to force windowing off: jumping to an old turn needs the
    // target row in the DOM. The jump must move the window first (`showMessageIndex`
    // resolves after the window commit) and only then measure/scroll.
    const turnNavigationSource = readFileSync(
      new URL('../../src/components/chat/turn-navigation.ts', import.meta.url),
      'utf8',
    )
    expect(turnNavigationSource).toMatch(
      /if \(showMessageIndex\) void showMessageIndex\(turn\.messageIndex\)\.then\(finish, finishProgrammaticScroll\)/,
    )
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

describe('reading anchor across background history hydration', () => {
  it('captures the anchor at replace time, not at request time', () => {
    // Hydration is a network round trip; the user can scroll during it. An
    // anchor captured when the request starts would restore a position the user
    // has already left. `hydrateFullHistory` therefore takes a callback it
    // invokes immediately before swapping the message list.
    const serverAgentSource = readFileSync(new URL('../../src/lib/server-agent.ts', import.meta.url), 'utf8')
    expect(serverAgentSource).toContain('async hydrateFullHistory(beforeReplace?')
    expect(serverAgentSource).toContain('const cancelAnchor = beforeReplace?.()')
    // The swap happens after the callback, never before it.
    const callbackIndex = serverAgentSource.indexOf('const cancelAnchor = beforeReplace?.()')
    // 替换走统一的 `applyLog`（数组与 baseSeq 成对更新），不再直接赋
    // `this.state.messages = all`。
    const swapIndex = serverAgentSource.indexOf("this.applyLog({ kind: 'snapshot', baseSeq: 0, messages: all })", callbackIndex)
    expect(swapIndex).toBeGreaterThan(callbackIndex)
  })

  it('measures the anchor delta against the viewport offset captured before the prepend', () => {
    // The delta must be computed from the SAME measurement taken on both sides.
    // Two approaches were tried and rejected against a real browser: `offsetTop`
    // (measured before the prepended rows settled their height, so the delta was
    // wrong) and raw node identity (works only when the anchor node survives;
    // folded process groups are rebuilt). The formula now lives in
    // `components/chat/scroll-anchor.ts` and is unit-tested there; this assertion
    // keeps the surface wired to it.
    const anchorSource = readFileSync(new URL('../../src/components/chat/scroll-anchor.ts', import.meta.url), 'utf8')
    expect(anchorSource).toContain('offsetFromTop: anchor.getBoundingClientRect().top - containerTop')
    expect(anchorSource).toContain('const delta = (retained.getBoundingClientRect().top - containerTop) - anchor.offsetFromTop')
    // The restore now lives in the single scroll writer, and a failed anchor
    // resolution must NOT fall back to a stale `scrollTop` (that fallback is what
    // parked the viewport at the bottom of the evicted window).
    const scrollOwnerSource = readFileSync(new URL('../../src/components/chat/scroll-owner.ts', import.meta.url), 'utf8')
    expect(scrollOwnerSource).toContain('anchoredScrollTop(container, anchor, { requireMessageIndex: true })')
    expect(scrollOwnerSource).toContain('if (!retained) return \'blocked\'')
    expect(scrollOwnerSource).toContain('if (anchor.messageIndex !== undefined && !indexedRow) return \'blocked\'')
    expect(chatSurfaceSource).toContain("apply({ kind: 'anchor', anchor })")
    expect(chatSurfaceSource).not.toContain('container.scrollHeight - heightBefore')
  })

  it('identifies the anchor by absolute message index, falling back to ordinal', () => {
    // Prepending shifts every ordinal, so the absolute `data-message-index` is
    // the primary handle (window offset stays 0, so an index identifies the same
    // message across the prepend). Folded process groups carry no index, so the
    // rendered ordinal is the fallback for them.
    const anchorSource = readFileSync(new URL('../../src/components/chat/scroll-anchor.ts', import.meta.url), 'utf8')
    expect(anchorSource).toContain('messageIndex: anchor.dataset.messageIndex')
    expect(anchorSource).toContain('ordinal: rows.indexOf(anchor)')
    expect(anchorSource).toContain('if (byIndex) return byIndex')
  })

  it('defers history hydration to an idle slot instead of the first-paint callback', () => {
    // Measured: the full-history fetch is ~10MB / 140-190ms. Firing it inside the
    // first-paint callback competes with the user's first interaction for the main
    // thread. It must be scheduled for an idle slot (with a timeout fallback), and
    // its cancel handle must be independent of the first-paint notify handle —
    // reusing that variable made the ready notification uncancellable.
    expect(hostSource).toContain('requestIdleCallback')
    expect(hostSource).toContain('cancelHydration')
    expect(hostSource).toContain('cancelHydration?.()')
    // The hydration cancel handle must not overwrite the ready-notify handle.
    expect(hostSource).not.toContain('cancelInitialRenderReady = () => window.cancelIdleCallback')
  })

  it('hosts the hydration trigger in the panel host, which owns the surface ref', () => {
    // The anchor API lives on the surface handle; `useAgentManager` has no
    // access to it, so the trigger belongs to the host's ready callback.
    expect(hostSource).toContain('hydrateFullHistory')
    expect(hostSource).toContain('captureScrollAnchor')
  })

  it('guards the deferred anchor release for non-DOM consumers', () => {
    // `server-agent.ts` also runs in tests and the ACP/Node paths where `window`
    // is undefined; an unguarded requestAnimationFrame throws there.
    const serverAgentSource = readFileSync(new URL('../../src/lib/server-agent.ts', import.meta.url), 'utf8')
    expect(serverAgentSource).toContain("typeof window !== 'undefined'")
  })
})

describe('readiness is republished on view reactivation', () => {
  it('publishes readiness from exactly one place, called by mount and by reactivation', () => {
    // The conversation transition overlay only lowers on this signal. A kept
    // view never re-runs the panel effect, so returning to a session whose task
    // is still resident (i.e. one that is actively streaming) used to leave the
    // overlay stuck on "loading conversation" until a page reload: the effect
    // deps (`agent`, `agentRuntimeScopeId`) do not change, so the only ready
    // signal this view ever sends was the one from its initial mount.
    expect(hostSource).toContain('const publishViewReady = () => {')
    // One publisher: no ad-hoc `scheduleAfterPaint` around onInitialRenderReady
    // anywhere else, which is what let the two paths drift apart.
    expect(hostSource.match(/onInitialRenderReady\?\.\(sessionId\)/g)).toHaveLength(1)
    expect(hostSource.match(/scheduleAfterPaint\(/g)).toHaveLength(1)
    // The reactivation branch of the activity subscription ends with it.
    expect(hostSource).toMatch(/decorateFnRef\.current\?\.\(\)[\s\S]{0,600}?publishViewReady\(\)\s*\n\s*\},/)
  })

  it('keeps the mount-time path (which arms hydration) separate from republishing', () => {
    // Reactivating must not re-run the full-history hydration: the tail window
    // was already topped up. The flag is armed by the mount path only, and the
    // paint callback consumes it once.
    expect(hostSource).toContain('pendingHistoryHydration = true')
    expect(hostSource).toMatch(/if \(!pendingHistoryHydration \|\| historyHydrated\) return/)
    expect(hostSource).toMatch(/historyHydrated = true\s*\n\s*pendingHistoryHydration = false/)
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

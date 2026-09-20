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
  it('marks the streaming container from the surface context instead of relying on a DOM probe', () => {
    // The container (not the message list) is what streams, so it is the one
    // place that provides `AssistantStreamingContext`; CodeBlock no longer
    // probes `closest('.qf-streaming-message')`, which the subagent trace (no
    // such ancestor) could never satisfy.
    expect(chatSurfaceSource).toContain('<AssistantStreamingContext.Provider value={true}>')
    expect(chatSurfaceSource).toContain('className="qf-streaming-message mb-3 flex flex-col gap-3"')
    expect(chatSurfaceSource).toMatch(
      /<AssistantStreamingContext\.Provider value=\{true\}>[\s\S]*?qf-streaming-message[\s\S]*?<\/AssistantStreamingContext\.Provider>/,
    )
  })
})

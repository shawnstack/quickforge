import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Source contracts for the conversation trace view.
 *
 * These pin the *decisions* that are easy to quietly undo later: where the view
 * is mounted (inside the conversation surface, not as a dialog), that the chat
 * surface is covered instead of unmounted, that the inspector is opt-in, and
 * that the timeline keeps the DOM+percent contract instead of an SVG viewBox.
 */

const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const view = readFileSync(new URL('../../src/components/chat/trace/ConversationTraceView.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/components/chat/trace/conversation-trace.css', import.meta.url), 'utf8')
const uiState = readFileSync(new URL('../../src/hooks/useUIState.ts', import.meta.url), 'utf8')
const projection = readFileSync(new URL('../../src/lib/conversation-trace.ts', import.meta.url), 'utf8')

describe('trace view mounting', () => {
  it('is rendered inside the conversation surface, not as a dialog or a side panel', () => {
    expect(app).toContain('<ConversationTraceView')
    // Rendered as a sibling layer inside ChatConversationSurface.
    const surfaceIndex = app.indexOf('<ChatConversationSurface')
    const traceIndex = app.indexOf('<ConversationTraceView')
    expect(surfaceIndex).toBeGreaterThan(-1)
    expect(traceIndex).toBeGreaterThan(surfaceIndex)
    // Never a portal/dialog: no overlay wrapper for the trace.
    expect(app).not.toMatch(/createPortal\(\s*<ConversationTraceView/)
  })

  it('covers the chat surface instead of unmounting it', () => {
    // The layer keeps ChatPanelHost / SessionViewPool mounted underneath, so the
    // composer draft, scroll position and message window survive a round trip.
    expect(app).toContain('quickforge-trace-layer')
    expect(app).toContain("{conversationView === 'trace' && agentManager.agent ? (")
    // SessionViewPool is still rendered unconditionally (guarded by needsModelSetup only).
    expect(app).toMatch(/<SessionViewPool[\s\S]{0,200}activeKey=/)
  })

  it('binds the view choice to the session scope so switching sessions returns to chat', () => {
    expect(uiState).toMatch(/conversationViewScope/)
    expect(uiState).toMatch(/useState<\{ scopeId: string; view: 'chat' \| 'trace' \} \| null>\(null\)/)
    // Derived, never reset through a setState-in-effect side channel.
    expect(app).toContain('ui.conversationViewScope?.scopeId === agentManager.currentRuntimeScopeId')
    expect(app).not.toMatch(/useEffect\(\(\) => \{\s*setConversationViewScope/)
  })

  it('renders the view switcher as a plain two-way toggle, without a count badge', () => {
    // The switcher only answers "which view am I in" — a tool count belongs in the
    // trace itself, not in the header (it made the toggle look like a filter chip).
    expect(app).toContain("t('trace.viewChat')")
    expect(app).toContain("t('trace.viewTrace')")
    expect(app).not.toContain('quickforge-chat-view-switch-count')
    expect(app).not.toContain('countTraceTools')
    // No counting helper left behind either (it had exactly this one caller).
    expect(projection).not.toContain('countTraceTools')
    expect(css).not.toContain('.quickforge-chat-view-switch-count')
  })
})

describe('timeline contract', () => {
  it('positions bars with inline percentages instead of an SVG viewBox', () => {
    expect(view).toContain('style={{ left: `${span.left}%`, width: `${span.width}%` }}')
    expect(view).not.toMatch(/viewBox="0 0 1000/)
  })

  it('offers all three layout modes', () => {
    expect(view).toContain("(['sequence', 'duration', 'time'] as TraceLayoutMode[])")
    expect(css).toContain('.quickforge-trace-seg button[aria-pressed=\'true\']')
  })

  it('only allows range selection in clock mode, where x means wall-clock', () => {
    expect(view).toContain("if (mode !== 'time' || event.button !== 0) return")
    expect(view).toContain('onContextMenu')
  })

  it('renders exactly three overview lanes', () => {
    expect(view).toContain("(['input', 'model', 'tools'] as const).map((lane)")
    expect(css).toContain(".quickforge-trace-span[data-lane='tools']")
  })
})

describe('inspector default', () => {
  it('stays hidden until a row is selected', () => {
    expect(view).toContain('{selected ? (')
    expect(view).toContain('<TraceInspector')
    // No always-on inspector container.
    expect(view).not.toMatch(/<aside className="quickforge-trace-inspector"[\s\S]{0,40}aria-label=\{t\('trace\.title'\)\}>\s*$/)
  })

  it('offers per-kind tabs', () => {
    expect(projection).toBeTruthy()
    expect(view).toContain("tool: ['summary', 'args', 'result', 'timing']")
    expect(view).toContain("step: ['summary', 'output', 'usage', 'raw']")
    expect(view).toContain("user: ['summary', 'raw']")
  })

  it('hides the turn-navigation rail while the trace view covers the conversation', () => {
    // The rail is an absolutely-positioned child of the chat panel host with
    // z-index 20, while the trace layer is z-index 10 — without suppressing it the
    // rail floats on top of the trace panel. The host exposes a runtime switch for
    // exactly this (structural `showTurnNavigation` would rebuild the panel).
    const host = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
    const indexCss = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

    expect(host).toMatch(/hideTurnNavigation\?: boolean/)
    expect(host).toContain("data-turn-navigation={hideTurnNavigation ? 'hidden' : undefined}")
    // App ties it to the view, not to a session or a manual toggle.
    expect(app).toContain("hideTurnNavigation={conversationView === 'trace'}")
    // CSS actually hides both the rail and its body-mounted tooltip.
    expect(indexCss).toMatch(/\.quickforge-chat-panel-host\[data-turn-navigation='hidden'\] \.quickforge-turn-navigation \{\s*display: none !important;/)
    expect(indexCss).toMatch(/body:has\(\.quickforge-chat-panel-host\[data-turn-navigation='hidden'\]\) \.quickforge-turn-navigation-tooltip \{\s*display: none !important;/)
  })

  it('closes on Escape', () => {
    expect(view).toContain("if (event.key === 'Escape') onClose()")
  })
})

describe('honest timing', () => {
  it('projects durations from recorded timings only', () => {
    // No Date.now() inside the projection's duration math; `now` is injected.
    expect(projection).toContain('const now = options.now ?? Date.now()')
    // A missing duration formats as an em dash, never 0.
    expect(projection).toMatch(/if \(ms === undefined \|\| !Number\.isFinite\(ms\)\) return '—'/)
  })

  it('distinguishes running from interrupted via pendingToolCalls', () => {
    expect(projection).toContain("return pending.has(toolCallId) ? 'running' : 'interrupted'")
  })

  it('reads timing from details.quickforgeTiming (the persisted field)', () => {
    expect(projection).toContain('extractQuickForgeTiming')
  })
})

describe('trace CSS tokens', () => {
  it('uses the shared divider recipe and motion tokens', () => {
    expect(css).toContain('color-mix(in oklab, var(--border) 60%, transparent)')
    expect(css).toContain('var(--quickforge-dur-fast) var(--quickforge-ease-out)')
  })

  it('downgrades every animation under prefers-reduced-motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('.quickforge-trace-layer {\n    animation: none;')
  })

  it('nests tool rows under their step with a 1px indent rule', () => {
    expect(css).toContain('.quickforge-trace-tool-rows::before')
    expect(css).toMatch(/\.quickforge-trace-tool-rows::before \{[^}]*width: 1px;/)
  })
})

describe('trace color language', () => {
  it('declares one hue per lane with enough chroma to actually read as color', () => {
    // Three lanes, three hue families. Chroma must be high enough to be visible at
    // 10px bar height (≥ 0.08) but stay below the point where the panel reads as a
    // brand-colored chart (≤ 0.20).
    const hueDecls = [...css.matchAll(/--qf-trace-hue-(input|model|tool):\s*oklch\(([\d.]+)\s+([\d.]+)\s+(\d+)\)/g)]
    expect(hueDecls.length).toBeGreaterThanOrEqual(6) // light + dark
    for (const [, lane, , chroma] of hueDecls) {
      expect(Number(chroma)).toBeGreaterThanOrEqual(lane === 'input' ? 0.08 : 0.12)
      expect(Number(chroma)).toBeLessThanOrEqual(0.2)
    }
    // One distinct hue per lane (dark mode may nudge it a few degrees).
    const byLane = new Map<string, number[]>()
    for (const [, lane, , , hue] of hueDecls) {
      byLane.set(lane, [...(byLane.get(lane) ?? []), Number(hue)])
    }
    expect([...byLane.keys()].sort()).toEqual(['input', 'model', 'tool'])
    for (const degrees of byLane.values()) {
      expect(Math.max(...degrees) - Math.min(...degrees)).toBeLessThanOrEqual(8)
    }
  })

  it('keeps every hue inside the blue → teal band and away from indigo/violet', () => {
    // The agreed palette: 150–260 (blue → teal). Indigo (270–300) and magenta were
    // explicitly rejected, so a future "let's add a purple accent" must fail here.
    const hueDecls = [...css.matchAll(/--qf-trace-hue-(?:input|model|tool):\s*oklch\([\d.]+\s+[\d.]+\s+(\d+)\)/g)]
    expect(hueDecls.length).toBeGreaterThanOrEqual(6)
    for (const [, hue] of hueDecls) {
      const degrees = Number(hue)
      expect(degrees).toBeGreaterThanOrEqual(150)
      expect(degrees).toBeLessThanOrEqual(260)
    }
    // …and the three lanes must stay ordered so the gradient still reads as a ramp.
    const laneHue = (lane: string) => Number(css.match(new RegExp(`--qf-trace-hue-${lane}:\\s*oklch\\([\\d.]+\\s+[\\d.]+\\s+(\\d+)\\)`))?.[1])
    expect(laneHue('input')).toBeGreaterThan(laneHue('model'))
    expect(laneHue('model')).toBeGreaterThan(laneHue('tool'))
  })

  it('leaves at least 25 degrees between the tool hue and the running green', () => {
    // --workflow-done is oklch(0.55 0.13 158). If the tool hue creeps toward it,
    // "this is a tool" and "this is running" become the same colour.
    const toolHue = Number(css.match(/--qf-trace-hue-tool:\s*oklch\([\d.]+\s+[\d.]+\s+(\d+)\)/)?.[1])
    expect(Math.abs(toolHue - 158)).toBeGreaterThanOrEqual(25)
  })

  it('paints hue on lines and text, never on surfaces', () => {
    // The rule after the last round of feedback: colour belongs on 1px/2px lines,
    // glyphs and text — every *background* that is a surface stays on the grey ramp.
    // Only the timeline bars and the 2px row rules may carry a hue as background.
    const hueBackgrounds = [...css.matchAll(/^\s*background:[^;]*--qf-trace-hue[^;]*;/gm)].map((match) => match[0].trim())
    expect(hueBackgrounds.length).toBeGreaterThan(0)

    for (const declaration of hueBackgrounds) {
      // Must be inside a bar or a 2px rule selector.
      const index = css.indexOf(declaration)
      const before = css.slice(Math.max(0, index - 700), index)
      const selector = before.slice(before.lastIndexOf('}') + 1)
      expect(selector).toMatch(/quickforge-trace-span(?!-parallel)|quickforge-trace-row-rule/)
    }

    // Surfaces that used to be tinted are neutral again.
    const segSelected = css.match(/\.quickforge-trace-seg button\[aria-pressed='true'\] \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(segSelected).not.toMatch(/background: color-mix\(in oklab, var\(--qf-trace-hue/)
    const badge = css.match(/\.quickforge-trace-badge\[data-kind='tool'\] \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(badge).not.toMatch(/background:/)
    const pre = css.match(/\.quickforge-trace-inspector-section pre \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(pre).not.toMatch(/background: color-mix\(in oklab, var\(--qf-trace-hue/)
    const tabSelected = css.match(/\.quickforge-trace-inspector-tabs button\[aria-selected='true'\] \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(tabSelected).not.toMatch(/background: color-mix\(in oklab, var\(--qf-trace-hue/)
    const parallel = css.match(/\.quickforge-trace-parallel \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(parallel).not.toMatch(/background:/)
    const highlight = css.match(/\.quickforge-trace-highlight \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(highlight).not.toMatch(/background: color-mix\(in oklab, var\(--qf-trace-hue/)
    // Structural connector line stays on the shared divider recipe.
    expect(css).toMatch(/\.quickforge-trace-tool-rows::before \{[\s\S]*?background: color-mix\(in oklab, var\(--border\) 60%, transparent\)/)
  })

  it('leaves the turn header and the selected row fully neutral', () => {
    // Turn headers are structure and selection is interaction feedback — neither is
    // data, so both must stay on the grey ramp. Only the row's own 2px rule carries
    // the record-type hue.
    const turnHead = css.match(/\.quickforge-trace-turn-head \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(turnHead).not.toMatch(/qf-trace-hue/)
    expect(turnHead).toMatch(/background: color-mix\(in oklab, var\(--muted\) 42%, transparent\)/)

    const selected = css.match(/\.quickforge-trace-row\[data-selected\] \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(selected).not.toMatch(/qf-trace-hue/)
    expect(selected).toMatch(/var\(--muted\)/)

    const selectedSpan = css.match(/\.quickforge-trace-span\[data-selected\] \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(selectedSpan).not.toMatch(/qf-trace-hue/)
  })

  it('tints data carriers, not structure', () => {
    // Lanes / spans / badges / row rules carry the hue…
    expect(css).toMatch(/\.quickforge-trace-span\[data-lane='model'\] \{[^}]*--qf-trace-hue-model/)
    expect(css).toMatch(/\.quickforge-trace-badge\[data-kind='tool'\] \{[^}]*--qf-trace-hue-tool/)
    expect(css).toMatch(/\.quickforge-trace-row\[data-kind='step'\] \.quickforge-trace-row-rule \{[^}]*--qf-trace-hue-model/)
    // …while the panel background, dividers and body text stay neutral.
    expect(css).toMatch(/\.quickforge-trace \{[^}]*background: var\(--quickforge-main-bg\)/)
    expect(css).toMatch(/\.quickforge-trace-toolbar \{[^}]*border-bottom: 1px solid color-mix\(in oklab, var\(--border\) 60%, transparent\)/)
  })

  it('keeps error semantics above the hue system', () => {
    // An error row must still be destructive, never a hue.
    expect(css).toMatch(/\.quickforge-trace-row\[data-status='error'\] \.quickforge-trace-row-rule \{[^}]*var\(--destructive\)/)
    expect(css).toMatch(/\.quickforge-trace-span\[data-status='error'\] \{[^}]*var\(--destructive\)/)
    // Running keeps the shared --workflow-done green.
    expect(css).toMatch(/\.quickforge-trace-row\[data-status='running'\] \.quickforge-trace-row-rule \{[^}]*var\(--workflow-done\)/)
  })

  it('scopes the hues so they cannot leak into the rest of the app', () => {
    expect(css).toContain(':where(.quickforge-trace, .quickforge-chat-view-switch) {')
    expect(css).toContain('.dark :where(.quickforge-trace, .quickforge-chat-view-switch) {')
    // No bare :root override — the app palette is untouched.
    expect(css).not.toMatch(/^:root\s*\{/m)
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const localTools = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '')
const renderer = localTools.slice(
  localTools.indexOf('class LocalWorkspaceToolRenderer'),
  localTools.indexOf('function askUserQuestionsFromParams'),
)

function ruleFor(selector: string) {
  for (const match of cssRules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]
      .split(',')
      .map((item) => item.trim())
    if (selectors.includes(selector)) return { selectors, body: match[2] }
  }
  throw new Error(`missing CSS rule: ${selector}`)
}

describe('ordinary local tool running sweep wiring', () => {
  it('adds the sweep class only to the running label and keeps non-visual busy semantics', () => {
    expect(renderer).toContain("aria-busy=${status === 'running' ? 'true' : nothing}")
    expect(renderer).toContain("<span class=${status === 'running' ? 'quickforge-tool-label quickforge-tool-running-sweep' : 'quickforge-tool-label'}>")
    expect(renderer.match(/quickforge-tool-running-sweep/g)).toHaveLength(1)

    const labelStart = renderer.indexOf("<span class=${status === 'running'")
    const labelEnd = renderer.indexOf('</span>', labelStart)
    expect(labelStart).toBeGreaterThan(-1)
    expect(labelEnd).toBeGreaterThan(labelStart)
    expect(renderer.slice(labelStart, labelEnd)).toContain('quickforge-tool-summary-detail')

    for (const excludedArea of [
      'renderToolIcon(this.toolName)',
      'quickforge-tool-chevron',
      'renderInlineDiffStats',
      'quickforge-tool-actions',
    ]) {
      const line = renderer.split('\n').find((candidate) => candidate.includes(excludedArea))
      expect(line).toBeDefined()
      expect(line).not.toContain('quickforge-tool-running-sweep')
    }
  })

  it('skips renderStatus while running and preserves it for done, error, and called states', () => {
    expect(renderer).toContain("${status === 'running' ? nothing : renderStatus(status, timing)}")
    expect(renderer).not.toMatch(/^\s*\$\{renderStatus\(status, timing\)\}\s*$/m)
  })

  it('keeps run_command output expansion and termination behavior unchanged', () => {
    expect(renderer).toContain("this.toolName === 'run_command' ? html`<console-block")
    expect(renderer).toContain('${renderTerminateCommandButton(this.toolName, status, result?.details)}')
  })
})

describe('ordinary local tool running sweep CSS', () => {
  it('clips a low-intensity left-to-right sweep to the label without layout or glow effects', () => {
    const host = ruleFor('.quickforge-tool-running-sweep').body
    const sweep = ruleFor('.quickforge-tool-running-sweep::after').body

    expect(host).toMatch(/position:\s*relative/)
    expect(sweep).toMatch(/position:\s*absolute/)
    expect(sweep).toMatch(/inset:\s*0/)
    expect(sweep).toMatch(/pointer-events:\s*none/)
    expect(sweep).toMatch(/linear-gradient\(\s*90deg/)
    expect(sweep).toMatch(/currentColor\s+12%/)
    expect(sweep).toMatch(/transform:\s*translateX\(-100%\)/)
    expect(sweep).toMatch(/animation:\s*quickforge-tool-running-sweep\s+1\.8s\s+ease-in-out\s+infinite/)
    expect(sweep).not.toMatch(/box-shadow|filter|text-shadow/)

    const keyframes = css.slice(
      css.indexOf('@keyframes quickforge-tool-running-sweep'),
      css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('@keyframes quickforge-tool-running-sweep')),
    )
    expect(keyframes).toMatch(/to\s*\{[^}]*transform:\s*translateX\(100%\)/s)
  })

  it('removes the sweep entirely for reduced motion without adding a static running treatment', () => {
    const mediaStart = css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.quickforge-tool-running-sweep::after'))
    const reducedMotion = css.slice(mediaStart, css.indexOf('/* subagent', mediaStart))

    expect(mediaStart).toBeGreaterThan(-1)
    expect(reducedMotion).toMatch(/\.quickforge-tool-running-sweep::after\s*\{[^}]*content:\s*none[^}]*animation:\s*none/s)
    expect(reducedMotion).not.toMatch(/background:|box-shadow:|filter:|text-shadow:/)
  })

  it('preserves ordinary title flex sizing and label ellipsis', () => {
    expect(css).toMatch(/\.quickforge-tool-title\s*\{[^}]*flex:\s*0 1 auto/s)

    const label = ruleFor('.quickforge-tool-label').body
    expect(label).toMatch(/min-width:\s*0/)
    expect(label).toMatch(/flex:\s*0 1 auto/)
    expect(label).toMatch(/overflow:\s*hidden/)
    expect(label).toMatch(/text-overflow:\s*ellipsis/)
    expect(label).toMatch(/white-space:\s*nowrap/)
  })
})

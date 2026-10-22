import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// T4：LocalWorkspaceToolRenderer 已迁至 tool-renderers/local-workspace-tool-renderer.tsx（React）；
// 折叠箭头/图标等 SVG 类名随 renderToolChevron 落在 shared.tsx。
const rendererSource = readFileSync(new URL('../../src/lib/tool-renderers/local-workspace-tool-renderer.tsx', import.meta.url), 'utf8')
const sharedSource = readFileSync(new URL('../../src/lib/tool-renderers/shared.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '')
const renderer = rendererSource.slice(
  rendererSource.indexOf('export class LocalWorkspaceToolRenderer'),
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
    expect(renderer).toContain("aria-busy={status === 'running' ? 'true' : undefined}")
    expect(renderer).toContain("status === 'running' ? 'quickforge-tool-label quickforge-tool-running-sweep' : this.toolName === 'run_command' && isRecord(result?.details) && result.details.background === true ? 'quickforge-tool-label line-through' : 'quickforge-tool-label'")
    expect(renderer.match(/quickforge-tool-running-sweep/g)).toHaveLength(1)

    const labelStart = renderer.indexOf("<span className={status === 'running'")
    const labelEnd = renderer.indexOf('</span>', labelStart)
    expect(labelStart).toBeGreaterThan(-1)
    expect(labelEnd).toBeGreaterThan(labelStart)
    expect(renderer.slice(labelStart, labelEnd)).toContain('quickforge-tool-summary-detail')

    for (const excludedArea of [
      'renderToolIcon(this.toolName)',
      'renderInlineDiffStats',
      'quickforge-tool-actions',
    ]) {
      const line = renderer.split('\n').find((candidate) => candidate.includes(excludedArea))
      expect(line).toBeDefined()
      expect(line).not.toContain('quickforge-tool-running-sweep')
    }
    // 折叠箭头的 SVG 类名在 shared.tsx 的 renderToolChevron 中；排除区断言
    // 跟随实际源码位置（跑马灯不得染上箭头图标）。
    const chevronLine = sharedSource.split('\n').find((candidate) => candidate.includes('quickforge-tool-chevron'))
    expect(chevronLine).toBeDefined()
    expect(chevronLine).not.toContain('quickforge-tool-running-sweep')
  })

  it('skips renderStatus while running and preserves it for done, error, and called states', () => {
    expect(renderer).toContain("{status === 'running' ? null : renderStatus(status, timing)}")
    expect(renderer).not.toMatch(/^\s*\{renderStatus\(status, timing\)\}\s*$/m)
  })

  it('keeps run_command output expansion and termination behavior unchanged', () => {
    expect(renderer).toContain("this.toolName === 'run_command' ? renderConsoleBlock(output, variant, runCommandLogContext(params, result)) : renderCodeBlock(output, 'text')")
    expect(renderer).toContain('{rawSummary}</span>')
    expect(renderer).toContain('{renderTerminateCommandButton(this.toolName, status, result?.details)}')
  })

  it('keeps the command reachable via the title when the summary shows the description', () => {
    expect(renderer).toContain('title={summaryTitle}')
    expect(renderer).toContain("? `${summaryText}\\n${commandText}`")
  })
})

describe('ordinary local tool running sweep CSS', () => {
  it('runs the highlight through the label glyphs instead of sliding a band over the box', () => {
    const host = ruleFor('.quickforge-tool-running-sweep').body

    // 复用思考 shimmer 范式：文字本身承载渐变高光（gradient + 200% 位移 + text-clip）。
    expect(host).toMatch(/background-image:\s*linear-gradient\(\s*90deg/)
    expect(host).toMatch(/background-size:\s*200%\s+100%/)
    expect(host).toMatch(/-webkit-background-clip:\s*text/)
    expect(host).toMatch(/background-clip:\s*text/)
    expect(host).toMatch(/color:\s*transparent/)
    expect(host).toMatch(/animation:\s*shimmer\s+2s\s+ease-in-out\s+infinite/)
    // 底色兜底：任何相位都有不透明填充，渐变端点不会让文字短暂消失。
    expect(host).toMatch(/background-color:\s*var\(--muted-foreground\)/)
    // 不再有覆盖层的伪元素扫光。
    expect(css).not.toContain('.quickforge-tool-running-sweep::after')
    expect(host).not.toMatch(/box-shadow|filter|text-shadow|position:\s*absolute/)
  })

  it('lets the argument summary flow with the label instead of staying static grey', () => {
    // detail 必须透明，由父级 text-clip 的渐变透出：否则长命令永远静止，
    // 只有「运行命令」四个字在动，看起来像扫光没生效。
    const detail = ruleFor('.quickforge-tool-running-sweep .quickforge-tool-summary-detail').body
    expect(detail).toMatch(/color:\s*transparent/)
  })

  it('restores plain readable text for reduced motion without a static running gradient', () => {
    const mediaStart = css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.quickforge-tool-running-sweep {'))
    const mediaEnd = css.indexOf('/* subagent', mediaStart)
    const reducedMotion = css.slice(mediaStart, mediaEnd)

    expect(mediaStart).toBeGreaterThan(-1)
    expect(mediaEnd).toBeGreaterThan(mediaStart)
    expect(reducedMotion).toMatch(
      /\.quickforge-tool-running-sweep\s*\{[^}]*background-image:\s*none[^}]*background-clip:\s*border-box[^}]*color:\s*inherit[^}]*animation:\s*none/s,
    )
    // 降级态父级没有 text-clip，detail 与内层摘要必须一起回到实色（否则文字不可见）。
    // 三者并成一条规则，选择器列表以逗号相连、声明块共用。
    expect(reducedMotion).toMatch(
      /\.quickforge-tool-running-sweep \.quickforge-tool-summary-detail,\s*\.quickforge-tool-running-sweep \.quickforge-command-summary,\s*\.quickforge-tool-running-sweep \.quickforge-tool-file-summary \{\s*color:\s*var\(--muted-foreground\)/s,
    )
    expect(reducedMotion).not.toMatch(/box-shadow|filter:\s|text-shadow/)
  })

  it('preserves ordinary title flex sizing and label ellipsis', () => {
    expect(css).toMatch(/\.quickforge-tool-title\s*\{[^}]*flex:\s*0 1 auto/s)

    const label = ruleFor('.quickforge-tool-label').body
    expect(label).toMatch(/min-width:\s*0/)
    expect(css).toMatch(/\.quickforge-tool-label\s*\{[^}]*flex:\s*0 1 auto/s)
    expect(label).toMatch(/overflow:\s*hidden/)
    expect(label).toMatch(/text-overflow:\s*ellipsis/)
    expect(label).toMatch(/white-space:\s*nowrap/)
  })
})

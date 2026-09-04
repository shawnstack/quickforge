import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('motion design tokens and primitives', () => {
  it('defines the shared motion duration/easing tokens in index.css', () => {
    const css = readSource('../../src/index.css')
    expect(css).toContain('--quickforge-dur-fast: 120ms;')
    expect(css).toContain('--quickforge-dur-base: 180ms;')
    expect(css).toContain('--quickforge-dur-slow: 280ms;')
    expect(css).toContain('--quickforge-ease-out: cubic-bezier(0.2, 0, 0, 1);')
  })

  it('defines dialog enter animations that consume the tokens', () => {
    const css = readSource('../../src/index.css')
    expect(css).toContain('.quickforge-dialog-backdrop-in {')
    expect(css).toContain('.quickforge-dialog-panel-in {')
    expect(css.match(/animation: quickforge-dialog-panel-in var\(--quickforge-dur-base\) var\(--quickforge-ease-out\) both;/g)).toHaveLength(1)
    // Panel settles from a slight rise + scale, backdrop only fades.
    const panelKeyframes = css.slice(
      css.indexOf('@keyframes quickforge-dialog-panel-in'),
      css.indexOf('@keyframes quickforge-sidebar-label-in'),
    )
    expect(panelKeyframes).toContain('translateY(4px) scale(0.97)')
  })

  it('applies dialog enter animations to both portal dialogs', () => {
    const prompt = readSource('../../src/components/ui/prompt-dialog.tsx')
    expect(prompt).toContain('quickforge-dialog-backdrop-in fixed inset-0 z-50')
    expect(prompt).toContain("'quickforge-dialog-panel-in w-full max-w-sm")

    const confirm = readSource('../../src/components/ui/confirm-dialog.tsx')
    expect(confirm).toContain('quickforge-dialog-backdrop-in fixed inset-0 z-50')
    expect(confirm).toContain("'quickforge-dialog-panel-in w-full max-w-[420px]")
  })

  it('fades sidebar labels and section headers in on mount', () => {
    const css = readSource('../../src/index.css')
    expect(css).toContain('.quickforge-sidebar-label-in {')

    const sidebar = readSource('../../src/components/sidebar/ChatSidebar.tsx')
    // Shared title class covers nav labels, session titles, project names, and footer rows.
    expect(sidebar).toContain("const sidebarSessionTitleClass = 'quickforge-sidebar-label-in truncate text-sm font-[350] leading-5'")
    // Section headers (Pinned / Projects / Tasks) ride the same fade.
    expect(sidebar).toContain('`quickforge-sidebar-label-in quickforge-sidebar-section-header')
  })

  it('gives the shared Button a token-driven press micro-interaction', () => {
    const button = readSource('../../src/components/ui/button.tsx')
    const base = button.slice(button.indexOf("'inline-flex"), button.indexOf("',\n  {"))
    // Tailwind v4 scale utilities animate the standalone `scale` property.
    expect(base).toContain('transition-[background-color,color,border-color,scale]')
    expect(base).toContain('duration-(--quickforge-dur-fast)')
    expect(base).toContain('active:scale-[0.97]')
  })

  it('keeps the tool-running sweep as an exempt long-running loop', () => {
    const css = readSource('../../src/index.css')
    const sweep = css.slice(css.indexOf('/* Tool-running highlight sweep'))
    expect(sweep.slice(0, sweep.indexOf('.quickforge-tool-running-sweep::after'))).toContain('exempt from the motion')
    expect(sweep).toContain('animation: quickforge-tool-running-sweep 1.8s ease-in-out infinite')
  })

  it('guards all new animation primitives under prefers-reduced-motion', () => {
    const css = readSource('../../src/index.css')
    const guardBlock = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.quickforge-dialog-backdrop-in,\s*\.quickforge-dialog-panel-in,\s*\.quickforge-sidebar-label-in \{\s*animation: none;/)
    expect(guardBlock).not.toBeNull()
  })
})

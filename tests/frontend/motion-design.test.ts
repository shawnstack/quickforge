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
    const guardBlock = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.quickforge-dialog-backdrop-in,\s*\.quickforge-dialog-panel-in,\s*\.quickforge-sidebar-label-in,\s*\.quickforge-menu-in,\s*\.quickforge-list-item-in \{\s*animation: none;/)
    expect(guardBlock).not.toBeNull()
  })
})

describe('motion design batch 2', () => {
  it('adds the exit duration token for enter/exit pairs', () => {
    const css = readSource('../../src/index.css')
    expect(css).toContain('--quickforge-dur-exit: 140ms;')
  })

  it('defines the menu-in primitive and wires both dropdown menus with trigger-corner origins', () => {
    const css = readSource('../../src/index.css')
    expect(css).toContain('.quickforge-menu-in {')
    const menuKeyframes = css.slice(
      css.indexOf('@keyframes quickforge-menu-in'),
      css.indexOf('@keyframes quickforge-list-item-in'),
    )
    expect(menuKeyframes).toContain('scale(0.96) translateY(-4px)')

    const branchMenu = readSource('../../src/components/git/GitBranchMenu.tsx')
    expect(branchMenu).toContain("'quickforge-menu-in absolute left-0 top-10 z-40 w-[340px] origin-top-left")

    const openMenu = readSource('../../src/components/project/ProjectOpenMenu.tsx')
    expect(openMenu).toContain('quickforge-menu-in absolute right-0 top-10 z-50 w-52 origin-top-right')
  })

  it('reuses the dialog enter classes in the four large feature dialogs', () => {
    const dialogs = [
      '../../src/components/skills-dialog.tsx',
      '../../src/components/git/GitGraphDialog.tsx',
      '../../src/components/share/ShareConversationDialog.tsx',
      '../../src/components/project-directory-picker.tsx',
    ]
    for (const path of dialogs) {
      const source = readSource(path)
      expect(source).toContain('quickforge-dialog-backdrop-in fixed inset-0 z-50')
      expect(source).toContain('quickforge-dialog-panel-in flex')
    }
  })

  it('retunes toast to translate/opacity only with token-driven enter and faster exit', () => {
    const toast = readSource('../../src/components/ui/toast.tsx')
    expect(toast).toContain('transition-[translate,opacity] ease-(--quickforge-ease-out) motion-reduce:transition-none')
    expect(toast).toContain("'duration-(--quickforge-dur-base) translate-x-0 opacity-100'")
    expect(toast).toContain("'duration-(--quickforge-dur-exit) translate-x-4 opacity-0'")
    // JS unmount timeout matches the exit token.
    expect(toast).toContain('const toastExitMs = 140')
    expect(toast).not.toContain('transition-all duration-200')
  })

  it('fades newly mounted git-change rows in via the list-item primitive', () => {
    const css = readSource('../../src/index.css')
    expect(css).toContain('.quickforge-list-item-in {')
    const changes = readSource('../../src/components/workspace/WorkspaceChangesList.tsx')
    expect(changes).toContain("'quickforge-list-item-in group min-w-0 overflow-hidden'")
  })

  it('retunes all five sidebar session delete exits from 360ms to the exit token', () => {
    const sidebar = readSource('../../src/components/sidebar/ChatSidebar.tsx')
    expect(sidebar).toContain('const deleteSessionFadeMs = 140')
    expect(sidebar).not.toContain('duration-[360ms]')
    expect(sidebar.match(/duration-\(--quickforge-dur-exit\) ease-\(--quickforge-ease-out\)/g)).toHaveLength(10)
  })
})

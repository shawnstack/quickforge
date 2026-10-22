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
    expect(sweep.slice(0, sweep.indexOf('.quickforge-tool-running-sweep {'))).toContain('exempt from the motion')
    // 复用思考 shimmer 的 keyframes 与节奏：文字内部渐变流动。
    expect(sweep).toContain('animation: shimmer 2s ease-in-out infinite')
  })

  it('guards all new animation primitives under prefers-reduced-motion', () => {
    const css = readSource('../../src/index.css')
    const guardBlock = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.quickforge-dialog-backdrop-in,\s*\.quickforge-dialog-panel-in,\s*\.quickforge-sidebar-label-in,\s*\.quickforge-menu-in,\s*\.quickforge-list-item-in \{\s*animation: none;/)
    expect(guardBlock).not.toBeNull()
  })

  it('exempts the thinking shimmer keyframes under prefers-reduced-motion', () => {
    const css = readSource('../../src/index.css')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.animate-shimmer \{\s*animation: none;\s*\}/)
  })

  it('runs the shared shimmer highlight left to right', () => {
    // 方向契约：background-size 200% 时百分比定位会被 (容器宽 - 图宽) 的负值翻折，
    // 所以「左→右」必须写成 200% → -200%。写成递增（-200% → 200%）实际是从右往左，
    // 与旧的覆盖层扫光（translateX(-100%) → translateX(100%)）方向相反。
    const css = readSource('../../src/index.css')
    const keyframes = css.slice(css.indexOf('@keyframes shimmer'), css.indexOf('.animate-shimmer {'))
    const positions = [...keyframes.matchAll(/background-position:\s*(-?[\d.]+)%\s+0/g)].map((m) => Number(m[1]))
    expect(positions).toEqual([200, -200])
    expect(positions[0]).toBeGreaterThan(positions[1])
  })

  it('keeps the adopted process-thinking label flowing via a data attribute', () => {
    // 接管会整体重写 label 的 class（process-folding.ts），挂在其上的流光类会被抹掉，
    // 因此接管理由的流光只能按 data 属性命中；ThinkingBlock 必须在流式态写这个属性。
    const css = readSource('../../src/index.css')
    expect(css).toContain(
      ".quickforge-process-thinking-label[data-quickforge-thinking-streaming='true'] {",
    )
    const sweepRule = css.slice(
      css.indexOf(".quickforge-process-thinking-label[data-quickforge-thinking-streaming='true'] {"),
      css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf(".quickforge-process-thinking-label[data-quickforge-thinking-streaming='true'] {")),
    )
    expect(sweepRule).toMatch(/background-clip:\s*text/)
    expect(sweepRule).toMatch(/animation:\s*shimmer\s+2s\s+ease-in-out\s+infinite/)

    const guard = css.match(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.quickforge-process-thinking-label\[data-quickforge-thinking-streaming='true'\] \{[^}]*animation:\s*none;/s,
    )
    expect(guard).not.toBeNull()

    const thinking = readSource('../../src/components/chat/surface/ThinkingBlock.tsx')
    expect(thinking).toContain('data-quickforge-thinking-streaming={isStreaming ?')
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

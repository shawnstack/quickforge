import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const sidebarSource = readFileSync(new URL('../../src/components/sidebar/ChatSidebar.tsx', import.meta.url), 'utf8')
const inspectorSource = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')

describe('Mobile H5 fullscreen adaptation', () => {
  it('renders the mobile sidebar drawer at full viewport width', () => {
    expect(sidebarSource).toContain("isMobile ? 'flex h-full w-full flex-col'")
    expect(sidebarSource).not.toContain('max-w-[85vw]')
    expect(appSource).not.toContain('max-w-[85vw]')
  })

  it('keeps the PanelRight Inspector toggle reachable on all viewport sizes', () => {
    expect(appSource).not.toContain("'hidden rounded-[10px]")
    expect(appSource).toContain("'rounded-[10px] text-muted-foreground/85 hover:bg-muted/45 hover:text-foreground/90 disabled:opacity-40 inline-flex'")
  })

  it('shows the Workspace Inspector as a fullscreen overlay on narrow viewports', () => {
    expect(inspectorSource).toContain('quickforge-workspace-inspector-fullscreen z-20')
    expect(inspectorSource).toContain("matchMedia('(min-width: 1024px)')")
    expect(inspectorSource).toContain('visible && !fullscreen && !mobileOverlay ? (')
    expect(inspectorSource).toContain('visible && !fullscreen && !mobileOverlay ? {')
  })
})

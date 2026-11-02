import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath) => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')

const panel = read('src/components/browser/AgentBrowserPanel.tsx')
const bridge = read('src/lib/desktop-browser-bridge.ts')
const inspector = read('src/components/workspace/WorkspaceInspector.tsx')
const panelTabs = read('src/components/workspace/workspace-panel-tabs.ts')
const tabModel = read('src/components/workspace/workspace-inspector-tabs.ts')
const app = read('src/App.tsx')
const preload = read('desktop/electron-preload.cjs')

describe('agent browser panel contract', () => {
  it('keeps the native view rect in sync without polling', () => {
    expect(panel).toContain('new ResizeObserver')
    expect(panel).toContain('requestAnimationFrame')
    expect(panel).toContain('bridge.setBounds(')
    expect(panel).not.toContain('setInterval')
  })

  it('hides the native view whenever it would cover a dialog or the app itself', () => {
    expect(panel).toContain('settingsDialogOpen')
    expect(panel).toContain("document.visibilityState === 'hidden'")
    expect(panel).toContain('bridge.setVisible(false)')
  })

  it('degrades to a plain hint when the desktop bridge is missing', () => {
    expect(panel).toContain('agentBrowserUnavailable')
    expect(bridge).toContain("isDesktopApp()")
  })

  it('renders inside the inspector as a programmatic tab only', () => {
    expect(inspector).toContain('<AgentBrowserPanel />')
    expect(inspector).toContain("request.kind === 'agent-browser'")
    // 「+」菜单不新增入口：既有 tab 列表与交互保持不变。
    expect(panelTabs).not.toContain("kind: 'agent-browser'")
    expect(tabModel).toContain("tab.kind === 'agent-browser'")
    expect(tabModel).toContain("| 'agent-browser'")
  })

  it('opens itself when the agent starts driving the desktop browser', () => {
    expect(app).toContain("toolName.startsWith('mcp__desktop-browser__')")
    expect(app).toContain("kind: 'agent-browser'")
  })

  it('bridges only bounds/visibility/state, never page content', () => {
    expect(preload).toContain("'set-bounds'")
    expect(preload).toContain("'set-visible'")
    expect(preload).not.toContain('executeJavaScript')
    expect(panel).not.toContain('executeJavaScript')
    expect(panel).not.toContain('webContents')
  })
})

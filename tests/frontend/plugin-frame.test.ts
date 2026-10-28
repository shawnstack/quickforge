import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PluginFrame, PluginPanelDialog } from '../../src/components/plugins/PluginFrame'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import type { PluginUiPanel } from '../../src/lib/plugin-ui-types'

// The sandbox attribute is the whole security story for L2: `allow-scripts`
// gives the panel JS, and the *absence* of `allow-same-origin` is what makes its
// origin opaque (no host localStorage, no same-origin fetch). A refactor that
// adds allow-same-origin must fail here, not in production.

const panel: PluginUiPanel = {
  id: 'hello',
  title: 'Hello panel',
  width: 420,
  url: '/api/plugins/hello-ui/assets/panel/index.html',
}

function renderFrame(): string {
  return renderToStaticMarkup(createElement(PluginFrame, { plugin: 'hello-ui', panel }) as ReactElement)
}

describe('PluginFrame sandbox', () => {
  it('runs scripts but never grants same-origin', () => {
    const html = renderFrame()
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).not.toContain('allow-same-origin')
    expect(html).not.toContain('allow-top-navigation')
    expect(html).not.toContain('allow-popups')
  })

  it('keeps the panel isolated from the host referrer', () => {
    // React 19 SSR keeps the camelCase spelling (`referrerPolicy`); browsers
    // treat HTML attribute names case-insensitively, so match loosely.
    expect(renderFrame()).toMatch(/referrerpolicy="no-referrer"/i)
  })

  it('points the frame at the asset route the server exposes', () => {
    const html = renderFrame()
    expect(html).toContain('src="/api/plugins/hello-ui/assets/panel/index.html"')
  })
})

describe('PluginFrame chrome', () => {
  it('draws the host-owned title bar with panel title and plugin name', () => {
    const html = renderFrame()
    expect(html).toContain('Hello panel')
    expect(html).toContain('hello-ui')
    expect(html).toContain('data-quickforge-plugin-panel="hello-ui:hello"')
  })

  it('shows a loading state until the frame reports load', () => {
    // onLoad never fires during SSR, so the spinner branch is what renders.
    expect(renderFrame()).toContain('animate-spin')
  })
})

describe('PluginPanelDialog', () => {
  it('renders the panel plus a keyboard-labelled close control', () => {
    applyAppLanguageFromSnapshot('en')
    const html = renderToStaticMarkup(
      createElement(PluginPanelDialog, { plugin: 'hello-ui', panel, onClose: vi.fn() }) as ReactElement,
    )
    expect(html).toContain('Hello panel')
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('sandbox="allow-scripts"')
  })
})

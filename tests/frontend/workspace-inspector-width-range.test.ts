import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')

describe('workspace inspector width range constants', () => {
  it('declares the min width, dynamic max cap, viewport ratio and auto expand width', () => {
    expect(source).toContain('const WORKSPACE_INSPECTOR_MIN_WIDTH = 340')
    expect(source).toContain('const WORKSPACE_INSPECTOR_MAX_WIDTH = 1200')
    expect(source).toContain('const WORKSPACE_INSPECTOR_MAX_VIEWPORT_RATIO = 0.75')
    expect(source).toContain('const WORKSPACE_INSPECTOR_AUTO_EXPAND_WIDTH = 640')
  })

  it('derives the max width from the viewport with an absolute cap and a min-width floor', () => {
    expect(source).toContain('function getInspectorMaxWidth()')
    expect(source).toMatch(/Math\.max\(WORKSPACE_INSPECTOR_MIN_WIDTH, Math\.min\(WORKSPACE_INSPECTOR_MAX_WIDTH, window\.innerWidth \* WORKSPACE_INSPECTOR_MAX_VIEWPORT_RATIO\)\)/)
  })

  it('clamps through clampInspectorWidth in both persisted restore and drag resize', () => {
    expect(source).toMatch(/readPersistedInspectorWidth[\s\S]*?return clampInspectorWidth\(value\)/)
    expect(source).toMatch(/start\.currentWidth = clampInspectorWidth\(start\.startWidth \+ start\.startX - event\.clientX\)/)
  })

  it('auto-expands to the fixed AUTO_EXPAND_WIDTH instead of the viewport max', () => {
    expect(source).toMatch(/expandInspectorToMax[\s\S]*?WORKSPACE_INSPECTOR_AUTO_EXPAND_WIDTH : current/)
    expect(source).not.toMatch(/expandInspectorToMax[\s\S]{0,220}?WORKSPACE_INSPECTOR_MAX_WIDTH/)
  })

  it('renders aside maxWidth and separator aria-valuemax from getInspectorMaxWidth', () => {
    expect(source).toContain('visible && !fullscreen && !mobileOverlay ? { width, minWidth: WORKSPACE_INSPECTOR_MIN_WIDTH, maxWidth: getInspectorMaxWidth() } : undefined')
    expect(source).toMatch(/aria-valuemin=\{WORKSPACE_INSPECTOR_MIN_WIDTH\}\s*\n\s*aria-valuemax=\{getInspectorMaxWidth\(\)\}/)
  })

  it('re-clamps stored width on window resize while skipping fullscreen and mobile overlay', () => {
    expect(source).toMatch(/const syncWidthToViewport = \(\) => \{\s*\n\s*if \(fullscreen \|\| mobileOverlay\) return\s*\n\s*setWidth\(\(current\) => clampInspectorWidth\(current\)\)/)
    expect(source).toMatch(/window\.addEventListener\('resize', syncWidthToViewport\)/)
    expect(source).toMatch(/window\.removeEventListener\('resize', syncWidthToViewport\)/)
  })
})

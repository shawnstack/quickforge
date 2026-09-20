import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The removed UI runtime is uninstalled, so its absence is enforced by the
// module graph itself (an import would no longer resolve); the local registry
// tests below keep the contract that no package registry takes part.
// i18n/settings are migrated independently of the registry.
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/lib/tool-display-settings', () => ({ getCachedToolDisplaySettings: () => ({ toolDisplayMode: 'concise' }) }))

import { getToolRenderer, registerToolRenderer, type ToolRenderer } from '../../src/lib/tool-renderer-registry'
import { getLocalWorkspaceTools } from '../../src/lib/local-tools'

function renderer(tag: string): ToolRenderer {
  return { render: () => ({ content: createElement('span', null, tag), isCustom: true }) }
}

describe('React-only tool-renderer-registry', () => {
  it('registers the original renderer and renders real React content', () => {
    const local = renderer('local-owner')
    registerToolRenderer('registry_test', local)
    expect(getToolRenderer('registry_test')).toBe(local)
    expect(renderToStaticMarkup(local.render(undefined, undefined).content)).toBe('<span>local-owner</span>')
  })

  it('uses last registration and returns undefined for unknown tools (no package fallback)', () => {
    registerToolRenderer('registry_replace', renderer('first'))
    const second = renderer('second')
    registerToolRenderer('registry_replace', second)
    expect(getToolRenderer('registry_replace')).toBe(second)
    expect(getToolRenderer('never_registered')).toBeUndefined()
  })

  it('keeps server metadata intact and registers built-in and MCP tools locally', () => {
    const tools = [{ name: 'mcp__demo__fetch', label: 'Fetch from demo', parameters: { type: 'object' }, description: 'MCP tool' }]
    expect(getLocalWorkspaceTools(tools)).toBe(tools)
    expect(getToolRenderer('read_file')).toBeDefined()
    expect(getToolRenderer('run_subagent')).toBeDefined()
    expect(getToolRenderer('mcp__demo__fetch')).toBeDefined()
  })
})

import { describe, expect, it } from 'vitest'
import {
  PLUGIN_UI_BRIDGE_METHODS,
  PLUGIN_UI_BRIDGE_TIMEOUT_MS,
  PLUGIN_UI_BRIDGE_TOOL_TIMEOUT_MS,
  bridgeTimeoutMs,
  isPluginUiBridgeMethod,
  resolvePanelToolName,
} from '../../src/lib/plugin-ui-bridge'

describe('bridge method list', () => {
  it('is closed and includes callTool', () => {
    expect(PLUGIN_UI_BRIDGE_METHODS).toEqual(['kv.get', 'kv.set', 'notify', 'callTool'])
  })

  it('rejects anything outside the list', () => {
    for (const method of ['kv.remove', 'eval', 'fetch', '__proto__', '']) {
      expect(isPluginUiBridgeMethod(method)).toBe(false)
    }
    expect(isPluginUiBridgeMethod('kv.get')).toBe(true)
  })

  it('gives tool calls the server tool budget, not the click budget', () => {
    expect(bridgeTimeoutMs('kv.get')).toBe(PLUGIN_UI_BRIDGE_TIMEOUT_MS)
    expect(bridgeTimeoutMs('callTool')).toBe(PLUGIN_UI_BRIDGE_TOOL_TIMEOUT_MS)
    expect(PLUGIN_UI_BRIDGE_TOOL_TIMEOUT_MS).toBeGreaterThan(PLUGIN_UI_BRIDGE_TIMEOUT_MS)
  })
})

describe('resolvePanelToolName', () => {
  it('accepts a tool the same plugin declares', () => {
    expect(resolvePanelToolName('counter-panel', 'plugin__counter-panel__bump')).toBe('plugin__counter-panel__bump')
  })

  it('trims surrounding whitespace', () => {
    expect(resolvePanelToolName('demo', '  plugin__demo__run  ')).toBe('plugin__demo__run')
  })

  it('rejects another plugin\'s tools', () => {
    expect(resolvePanelToolName('demo', 'plugin__other__run')).toBeNull()
  })

  it('rejects non-plugin tools so a panel is not a generic tool launcher', () => {
    for (const name of ['run_command', 'write_file', 'mcp__playwright__click', 'todo_write']) {
      expect(resolvePanelToolName('demo', name)).toBeNull()
    }
  })

  it('rejects malformed names', () => {
    for (const name of ['plugin__', 'plugin__demo', 'plugin____run', 'plugin__demo__', 'plugin__demo__bad name']) {
      expect(resolvePanelToolName('demo', name)).toBeNull()
    }
  })

  it('rejects non-string input', () => {
    expect(resolvePanelToolName('demo', undefined)).toBeNull()
    expect(resolvePanelToolName('demo', 42)).toBeNull()
    expect(resolvePanelToolName('demo', { name: 'plugin__demo__run' })).toBeNull()
  })
})

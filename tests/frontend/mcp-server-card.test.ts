import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { McpServerCard } from '../../src/components/mcp/mcp-server-card'
import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'
import type { McpServer } from '../../src/lib/types/mcp'

type NodeProps = { children?: ReactNode; onClick?: () => void; role?: string; 'aria-label'?: string }
function elements(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<NodeProps>(node)) return []
  return [node, ...elements(node.props.children)]
}
function props(builtin = true) {
  const server: McpServer = { name: builtin ? 'playwright' : 'custom', builtin, enabled: true, transport: 'stdio', command: 'npx', args: [], status: 'error' }
  return { server, toggling: false, reconnecting: false, onToggle: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onReconnect: vi.fn() }
}

describe('MCP builtin card', () => {
  it.each(['zh', 'en'] as const)('renders builtin badge without a delete button in %s', (language) => {
    applyAppLanguageFromSnapshot(language)
    const html = renderToStaticMarkup(createElement(McpServerCard, props()))
    expect(html).toContain(t('mcpBuiltIn'))
    expect(html).not.toContain(`aria-label="${t('delete')}"`)
    expect(html).toContain(`aria-label="${t('editTask')}"`)
    expect(html).toContain('role="switch"')
    expect(html).toContain(`aria-label="${t('mcpReconnectServer')}"`)
  })
  it('keeps actual edit, toggle and reconnect handlers for builtin services', () => {
    const p = props()
    const nodes = elements(McpServerCard(p))
    nodes.find((n) => n.props.role === 'switch')!.props.onClick!()
    nodes.find((n) => n.props['aria-label'] === t('editTask'))!.props.onClick!()
    nodes.find((n) => n.props['aria-label'] === t('mcpReconnectServer'))!.props.onClick!()
    expect(p.onToggle).toHaveBeenCalledWith(p.server)
    expect(p.onEdit).toHaveBeenCalledWith(p.server)
    expect(p.onReconnect).toHaveBeenCalledWith('playwright')
    expect(p.onDelete).not.toHaveBeenCalled()
  })
  it('keeps the delete button and handler for ordinary services', () => {
    const p = props(false)
    const html = renderToStaticMarkup(createElement(McpServerCard, p))
    expect(html).not.toContain(t('mcpBuiltIn'))
    expect(html).toContain(`aria-label="${t('delete')}"`)
    elements(McpServerCard(p)).find((n) => n.props['aria-label'] === t('delete'))!.props.onClick!()
    expect(p.onDelete).toHaveBeenCalledWith('custom')
  })
  it.each([{ enabled: false, status: 'disabled' }, { enabled: true, status: 'connected' }])('retains reconnect visibility conditions: $status', (state) => {
    const p = props()
    Object.assign(p.server, state)
    expect(renderToStaticMarkup(createElement(McpServerCard, p))).not.toContain(`aria-label="${t('mcpReconnectServer')}"`)
  })
})

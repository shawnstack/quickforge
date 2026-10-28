import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginSlot, PluginUiToasts } from '../../src/components/plugins/PluginSlot'
import { resolvePluginUiPayload } from '../../src/lib/plugin-ui-resolve'
import { clearPluginUiToasts, dispatchPluginUiAction, refreshPluginUi } from '../../src/lib/plugin-ui-client'
import type { PluginUiSnapshot } from '../../src/lib/plugin-ui-types'

async function loadSnapshot(snapshot: Partial<PluginUiSnapshot>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    slots: snapshot.slots || {},
    plugins: snapshot.plugins || [],
  }), { headers: { 'content-type': 'application/json' } })))
  await refreshPluginUi()
}

function pluginEntry(name = 'demo') {
  return { name, actions: ['greet'], permissions: ['ui:composer'], panels: [], state: {} }
}

function renderSlot(slot: 'composer.actions' | 'session.header' | 'sidebar.footer', props?: Record<string, unknown>): string {
  const element = createElement(PluginSlot, { slot, props }) as ReactElement
  return renderToStaticMarkup(element)
}

afterEach(() => {
  clearPluginUiToasts()
  vi.unstubAllGlobals()
})

describe('PluginSlot', () => {
  it('renders nothing when no plugin contributes to the slot', async () => {
    await loadSnapshot({ slots: {}, plugins: [] })
    expect(renderSlot('sidebar.footer')).toBe('')
  })

  it('renders a declared button with host chrome attributes', async () => {
    await loadSnapshot({
      slots: {
        'composer.actions': [{
          plugin: 'demo',
          nodes: [{ type: 'button', label: 'Greet', icon: 'sparkles', variant: 'ghost' }],
        }],
      },
      plugins: [pluginEntry()],
    })

    const markup = renderSlot('composer.actions', { sessionId: 's1' })
    expect(markup).toContain('data-quickforge-plugin-slot="composer.actions"')
    expect(markup).toContain('data-quickforge-plugin="demo"')
    expect(markup).toContain('Greet')
  })

  it('drops unknown node types without failing the rest of the slot', async () => {
    await loadSnapshot({
      slots: {
        'composer.actions': [{
          plugin: 'demo',
          nodes: [
            { type: 'marquee', label: 'SHOULD_NOT_RENDER' },
            { type: 'badge', label: 'kept', tone: 'accent' },
          ],
        }],
      },
      plugins: [pluginEntry()],
    })

    const markup = renderSlot('composer.actions')
    expect(markup).not.toContain('SHOULD_NOT_RENDER')
    expect(markup).toContain('kept')
  })

  it('renders nested containers and badges', async () => {
    await loadSnapshot({
      slots: {
        'session.header': [{
          plugin: 'demo',
          nodes: [{
            type: 'hstack',
            children: [
              { type: 'text', text: 'state:' },
              { type: 'badge', label: 'ready', tone: 'neutral' },
            ],
          }],
        }],
      },
      plugins: [pluginEntry()],
    })

    const markup = renderSlot('session.header')
    expect(markup).toContain('state:')
    expect(markup).toContain('ready')
  })

  it('skips a plugin that contributes an empty node list', async () => {
    await loadSnapshot({
      slots: {
        'composer.actions': [
          { plugin: 'demo', nodes: [{ type: 'button', label: 'Only' }] },
          { plugin: 'empty', nodes: [] },
        ],
      },
      plugins: [pluginEntry(), pluginEntry('empty')],
    })

    const markup = renderSlot('composer.actions')
    expect(markup).toContain('Only')
    expect(markup).not.toContain('data-quickforge-plugin="empty"')
  })
})

describe('snapshot refresh and per-plugin overrides', () => {
  it('replaces the whole snapshot on refresh, so a removed slot disappears', async () => {
    await loadSnapshot({
      slots: { 'composer.actions': [{ plugin: 'demo', nodes: [{ type: 'button', label: 'BeforeReload' }] }] },
      plugins: [pluginEntry()],
    })
    expect(renderSlot('composer.actions')).toContain('BeforeReload')

    // What the plugins page triggers after POST /api/plugins/reload.
    await loadSnapshot({
      slots: { 'session.header': [{ plugin: 'demo', nodes: [{ type: 'badge', label: 'AfterReload' }] }] },
      plugins: [pluginEntry()],
    })

    expect(renderSlot('composer.actions')).toBe('')
    expect(renderSlot('session.header')).toContain('AfterReload')
  })

  it('lets one plugin replace its own nodes without touching its neighbours', async () => {
    await loadSnapshot({
      slots: {
        'composer.actions': [
          { plugin: 'alpha', nodes: [{ type: 'button', label: 'AlphaOld' }] },
          { plugin: 'beta', nodes: [{ type: 'button', label: 'Beta' }] },
        ],
      },
      plugins: [pluginEntry('alpha'), pluginEntry('beta')],
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      slots: { 'composer.actions': [{ type: 'button', label: 'AlphaNew' }] },
      toast: { level: 'info', message: 'ok' },
    }), { headers: { 'content-type': 'application/json' } })))

    await dispatchPluginUiAction('alpha', 'composer.actions', { action: 'greet' })

    const markup = renderSlot('composer.actions')
    expect(markup).toContain('AlphaNew')
    expect(markup).not.toContain('AlphaOld')
    expect(markup).toContain('Beta')
  })

  it('drops a plugin from the slot when its action returns no nodes', async () => {
    await loadSnapshot({
      slots: {
        'composer.actions': [
          { plugin: 'alpha', nodes: [{ type: 'button', label: 'AlphaOld' }] },
          { plugin: 'beta', nodes: [{ type: 'button', label: 'Beta' }] },
        ],
      },
      plugins: [pluginEntry('alpha'), pluginEntry('beta')],
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      slots: { 'composer.actions': [] },
    }), { headers: { 'content-type': 'application/json' } })))

    await dispatchPluginUiAction('alpha', 'composer.actions', { action: 'greet' })

    const markup = renderSlot('composer.actions')
    expect(markup).not.toContain('AlphaOld')
    expect(markup).toContain('Beta')
  })
})

describe('resolvePluginUiPayload', () => {
  it('substitutes $slot and $state references', () => {
    const resolved = resolvePluginUiPayload(
      { action: 'go', payload: { id: '$slot.sessionId', count: '$state.count', plain: 'x', n: 3 } },
      { props: { sessionId: 's1' }, state: { count: 7 } },
    )
    expect(resolved).toEqual({ action: 'go', payload: { id: 's1', count: 7, plain: 'x', n: 3 } })
  })

  it('drops references that resolve to nothing instead of leaking the placeholder', () => {
    const resolved = resolvePluginUiPayload(
      { action: 'go', payload: { missing: '$slot.nope', nested: '$state.a.b' } },
      { props: {}, state: { a: {} } },
    )
    expect(resolved.payload).toEqual({})
  })

  it('passes events without a payload through unchanged', () => {
    expect(resolvePluginUiPayload({ action: 'go' }, {})).toEqual({ action: 'go' })
  })
})

describe('PluginUiToasts', () => {
  it('renders nothing when the queue is empty', () => {
    expect(renderToStaticMarkup(createElement(PluginUiToasts) as ReactElement)).toBe('')
  })
})

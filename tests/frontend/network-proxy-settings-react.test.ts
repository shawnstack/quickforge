import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HookLifecycle, deferred, flushPromises } from './helpers/hook-lifecycle'

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  ...(await import('./helpers/hook-lifecycle')).hookRuntime,
}))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))

import { NetworkProxySettingsSection } from '../../src/components/settings/tabs/NetworkProxySettingsSection'

type Node = ReactElement<{ children?: unknown; disabled?: boolean; onClick?: () => void; value?: unknown }>
function nodes(tree: unknown): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const node = tree as Node
  return [node, ...nodes(node.props.children)]
}
function text(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(text).join('')
  return tree && typeof tree === 'object' && 'props' in tree ? text((tree as Node).props.children) : ''
}

const proxyPayload = JSON.stringify({
  config: { mode: 'system', proxyUrl: '' },
  status: { effectiveMode: 'system', supported: true, source: 'system', runtimeKind: 'desktop' },
})

let lifecycle = new HookLifecycle()
afterEach(() => {
  lifecycle.unmount()
  lifecycle = new HookLifecycle()
  vi.unstubAllGlobals()
})

function render(active?: boolean) {
  return lifecycle.render(() => nodes(NetworkProxySettingsSection({ active })))
}
function refreshButton(tree: Node[]) {
  return tree.find((node) => node.type === 'button' && ['networkProxyRefresh', 'saving'].includes(text(node)))
}

describe('React network proxy settings', () => {
  it('loads only while active and allows consecutive refreshes', async () => {
    let refreshRequest = deferred<Response>()
    let refreshCalls = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/system/network-proxy') return new Response(proxyPayload, { status: 200 })
      if (url === '/api/system/network-proxy/refresh') {
        refreshCalls += 1
        return refreshRequest.promise
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    let tree = render(false)
    await flushPromises()
    tree = render(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(refreshButton(tree)).toBeUndefined()

    tree = render(true)
    await vi.waitFor(() => {
      tree = render(true)
      expect(refreshButton(tree)?.props.disabled).toBe(false)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    refreshButton(tree)!.props.onClick!()
    tree = render(true)
    expect(refreshButton(tree)?.props.disabled).toBe(true)
    refreshRequest.resolve(new Response(proxyPayload, { status: 200 }))
    await vi.waitFor(() => {
      tree = render(true)
      expect(refreshButton(tree)?.props.disabled).toBe(false)
    })

    refreshRequest = deferred<Response>()
    refreshButton(tree)!.props.onClick!()
    tree = render(true)
    expect(refreshButton(tree)?.props.disabled).toBe(true)
    refreshRequest.resolve(new Response(proxyPayload, { status: 200 }))
    await vi.waitFor(() => {
      tree = render(true)
      expect(refreshButton(tree)?.props.disabled).toBe(false)
    })
    expect(refreshCalls).toBe(2)
  })
})

describe('React network proxy settings load ordering', () => {
  function payloadFor(mode: 'direct' | 'manual', proxyUrl: string) {
    return JSON.stringify({
      config: { mode, proxyUrl },
      status: { effectiveMode: mode, supported: true, source: 'config', runtimeKind: 'desktop' },
    })
  }

  it('ignores a stale load that returns after the section is reactivated', async () => {
    const firstLoad = deferred<Response>()
    const secondLoad = deferred<Response>()
    let loads = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/system/network-proxy') {
        loads += 1
        return loads === 1 ? firstLoad.promise : secondLoad.promise
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    let tree = render(true)
    await flushPromises()
    tree = render(false)
    await flushPromises()
    tree = render(true)
    await flushPromises()
    expect(loads).toBe(2)

    secondLoad.resolve(new Response(payloadFor('manual', 'http://127.0.0.1:7890'), { status: 200 }))
    await vi.waitFor(() => {
      tree = render(true)
      expect(tree.some((node) => node.props.value === 'http://127.0.0.1:7890')).toBe(true)
    })

    firstLoad.resolve(new Response(payloadFor('direct', ''), { status: 200 }))
    await flushPromises()
    tree = render(true)
    expect(tree.some((node) => node.props.value === 'http://127.0.0.1:7890')).toBe(true)
  })
})

import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HookLifecycle, deferred, flushPromises } from './helpers/hook-lifecycle'

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  ...(await import('./helpers/hook-lifecycle')).hookRuntime,
}))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

import { ProjectDirectoryPicker } from '../../src/components/project-directory-picker'

type Node = ReactElement<{ children?: unknown; id?: string; value?: unknown }>
function nodes(tree: unknown): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const node = tree as Node
  return [node, ...nodes(node.props.children)]
}

function directoryPayload(path: string) {
  return new Response(JSON.stringify({ path, parent: null, directories: [] }), { status: 200 })
}

let lifecycle = new HookLifecycle()

beforeEach(() => {
  // 组件用 window.setTimeout 聚焦输入框、用 document 挂 Esc 监听；node 环境里没有这两样。
  vi.stubGlobal('window', { setTimeout: (callback: () => void) => setTimeout(callback, 0) })
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
  lifecycle.unmount()
  lifecycle = new HookLifecycle()
  vi.unstubAllGlobals()
})

function render(open: boolean) {
  return lifecycle.render(() => nodes(ProjectDirectoryPicker({
    open,
    initialPath: 'C:/root',
    onOpenChange: () => {},
    onSelect: async () => {},
  })))
}

function pathInputValue(tree: Node[]) {
  return tree.find((node) => node.props.id === 'project-path-input')?.props.value
}

describe('project directory picker load ordering', () => {
  it('ignores a stale directory listing that returns after the dialog was reopened', async () => {
    const directoryLoads: Array<ReturnType<typeof deferred<Response>>> = []
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/filesystem/roots') {
        return new Response(JSON.stringify({ roots: [{ name: 'root', path: 'C:/root' }] }), { status: 200 })
      }
      if (url.startsWith('/api/filesystem/directories?path=')) {
        const pending = deferred<Response>()
        directoryLoads.push(pending)
        return pending.promise
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(true)
    await flushPromises()
    render(false)
    render(true)
    await flushPromises()
    expect(directoryLoads.length).toBe(2)

    directoryLoads[1].resolve(directoryPayload('C:/root/two'))
    await flushPromises()
    expect(pathInputValue(render(true))).toBe('C:/root/two')

    directoryLoads[0].resolve(directoryPayload('C:/root/one'))
    await flushPromises()
    expect(pathInputValue(render(true))).toBe('C:/root/two')
  })
})

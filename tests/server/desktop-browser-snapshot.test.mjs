import { describe, expect, it } from 'vitest'
import { buildSnapshot, parseRef, resolveRef } from '../../desktop/browser/page-snapshot.mjs'

function axNode(overrides) {
  return { nodeId: '1', ignored: false, role: { value: 'generic' }, childIds: [], ...overrides }
}

const tree = [
  axNode({ nodeId: 'root', role: { value: 'RootWebArea' }, name: { value: 'Demo' }, childIds: ['h', 'form', 'skip', 'text'] }),
  axNode({ nodeId: 'h', parentId: 'root', role: { value: 'heading' }, name: { value: 'Sign in' }, backendDOMNodeId: 11 }),
  axNode({ nodeId: 'form', parentId: 'root', role: { value: 'form' }, childIds: ['btn'] }),
  axNode({ nodeId: 'btn', parentId: 'form', role: { value: 'button' }, name: { value: '  Submit \n form ' }, backendDOMNodeId: 42 }),
  axNode({ nodeId: 'skip', parentId: 'root', ignored: true, role: { value: 'button' }, name: { value: 'hidden' }, backendDOMNodeId: 43 }),
  axNode({ nodeId: 'text', parentId: 'root', role: { value: 'StaticText' }, name: { value: 'Footer text' }, backendDOMNodeId: 44 }),
]

describe('page snapshot', () => {
  it('renders named/interactive nodes with generation-scoped refs', () => {
    const snapshot = buildSnapshot(tree, { generation: 3 })
    expect(snapshot.text).toContain('- heading - Sign in [ref=e1@g3]')
    expect(snapshot.text).toContain('- button - Submit form [ref=e2@g3]')
    expect(snapshot.text).toContain('- StaticText - Footer text [ref=e3@g3]')
    expect(snapshot.generation).toBe(3)
    expect(snapshot.refs.get('e2@g3')).toBe(42)
  })

  it('drops ignored subtrees and anonymous containers without changing depth', () => {
    const snapshot = buildSnapshot(tree, { generation: 1 })
    const lines = snapshot.text.split('\n')
    const formIndex = lines.findIndex((line) => line.includes('- button'))
    // form 没有可读名字，不占一行也不增加缩进，按钮直接落在顶层。
    expect(lines[formIndex]).toBe('- button - Submit form [ref=e2@g1]')
    expect(snapshot.text).not.toContain('hidden')
  })

  it('assigns no ref to nodes without a backend node id', () => {
    const snapshot = buildSnapshot([axNode({ nodeId: 'n', role: { value: 'heading' }, name: { value: 'Title' } })], { generation: 2 })
    expect(snapshot.refs.size).toBe(0)
    expect(snapshot.text).toBe('- heading - Title')
  })

  it('truncates by character budget', () => {
    const nodes = [
      axNode({ nodeId: 'root', role: { value: 'RootWebArea' }, childIds: ['a', 'b'] }),
      axNode({ nodeId: 'a', parentId: 'root', role: { value: 'heading' }, name: { value: 'x'.repeat(50) } }),
      axNode({ nodeId: 'b', parentId: 'root', role: { value: 'heading' }, name: { value: 'y'.repeat(50) } }),
    ]
    const snapshot = buildSnapshot(nodes, { generation: 1, maxChars: 60 })
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.text).toContain('snapshot truncated')
  })

  it('parses and resolves refs strictly by generation', () => {
    const snapshot = buildSnapshot(tree, { generation: 4 })
    expect(parseRef('e2@g4')).toEqual({ id: 'e2', generation: 4 })
    expect(parseRef('e2')).toBeNull()
    expect(parseRef('button-1')).toBeNull()
    expect(resolveRef('e2@g4', snapshot)).toEqual({ ok: true, backendNodeId: 42 })
    expect(resolveRef('e2@g3', snapshot)).toMatchObject({ ok: false })
    expect(resolveRef('e9@g4', snapshot)).toMatchObject({ ok: false })
    expect(resolveRef('e2@g4', null)).toMatchObject({ ok: false })
    expect(resolveRef('e2@g4', snapshot).ok).toBe(true)
  })
})

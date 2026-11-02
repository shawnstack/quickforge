import { describe, expect, it } from 'vitest'
import { parseBrowserRequest } from '../../desktop/browser/ipc-contract.mjs'

/**
 * 窄桥解析是渲染进程 → 主进程的安全边界：这里只放行白名单形状，
 * 任何多字段、错类型、非法矩形都必须被丢弃（主进程随后直接 return null）。
 */
describe('desktop browser IPC request contract', () => {
  it('accepts the two argument-free requests', () => {
    expect(parseBrowserRequest({ type: 'is-available' })).toEqual({ type: 'is-available' })
    expect(parseBrowserRequest({ type: 'get-state' })).toEqual({ type: 'get-state' })
  })

  it('rejects argument-free requests carrying extra fields', () => {
    expect(parseBrowserRequest({ type: 'get-state', url: 'https://example.com' })).toBeNull()
  })

  it('accepts a boolean visibility flag and nothing else', () => {
    expect(parseBrowserRequest({ type: 'set-visible', visible: false })).toEqual({ type: 'set-visible', visible: false })
    expect(parseBrowserRequest({ type: 'set-visible', visible: 'yes' })).toBeNull()
    expect(parseBrowserRequest({ type: 'set-visible', visible: true, extra: 1 })).toBeNull()
  })

  it('normalizes a valid bounds request down to the four known keys', () => {
    expect(parseBrowserRequest({ type: 'set-bounds', rect: { x: 10, y: 20, width: 300, height: 200 } }))
      .toEqual({ type: 'set-bounds', rect: { x: 10, y: 20, width: 300, height: 200 } })
  })

  it('rejects bounds with missing, extra or non-finite fields', () => {
    expect(parseBrowserRequest({ type: 'set-bounds', rect: { x: 0, y: 0, width: 300 } })).toBeNull()
    expect(parseBrowserRequest({ type: 'set-bounds', rect: { x: 0, y: 0, width: 300, height: 200, z: 1 } })).toBeNull()
    expect(parseBrowserRequest({ type: 'set-bounds', rect: { x: Number.NaN, y: 0, width: 300, height: 200 } })).toBeNull()
    expect(parseBrowserRequest({ type: 'set-bounds', rect: { x: 0, y: '0', width: 300, height: 200 } })).toBeNull()
  })

  it('rejects degenerate rects the clamp would have to grow', () => {
    expect(parseBrowserRequest({ type: 'set-bounds', rect: { x: 0, y: 0, width: 0, height: 200 } })).toBeNull()
    expect(parseBrowserRequest({ type: 'set-bounds', rect: { x: 0, y: 0, width: 300, height: -5 } })).toBeNull()
  })

  it('rejects payloads that are not plain objects', () => {
    expect(parseBrowserRequest(null)).toBeNull()
    expect(parseBrowserRequest('set-visible')).toBeNull()
    expect(parseBrowserRequest([{ type: 'get-state' }])).toBeNull()
  })

  it('rejects unknown request types', () => {
    expect(parseBrowserRequest({ type: 'navigate', url: 'https://example.com' })).toBeNull()
  })
})

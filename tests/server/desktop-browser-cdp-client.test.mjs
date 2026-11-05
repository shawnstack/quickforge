import { afterEach, describe, expect, it, vi } from 'vitest'
import { CdpClient, CdpTimeoutError } from '../../desktop/browser/cdp-client.mjs'

function makeWebContents() {
  const debuggerApi = {
    attached: false,
    attachCalls: 0,
    detachCalls: 0,
    listeners: new Map(),
    isAttached() { return this.attached },
    attach() { this.attachCalls += 1; this.attached = true },
    detach() { this.detachCalls += 1; this.attached = false },
    on(name, handler) { this.listeners.set(name, handler) },
    async sendCommand() { return {} },
  }
  return {
    debugger: debuggerApi,
    destroyed: false,
    isDestroyed() { return this.destroyed },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('desktop browser CDP client', () => {
  it('attaches once and binds protocol events a single time', () => {
    const webContents = makeWebContents()
    const client = new CdpClient(webContents)
    expect(client.attached).toBe(false)
    client.attach()
    client.attach()
    expect(webContents.debugger.attachCalls).toBe(1)
    expect(webContents.debugger.listeners.has('message')).toBe(true)
    expect(webContents.debugger.listeners.has('detach')).toBe(true)
  })

  it('forwards protocol events and detach notifications', () => {
    const webContents = makeWebContents()
    const client = new CdpClient(webContents)
    client.attach()
    const seen = []
    client.on('Page.loadEventFired', (params) => seen.push(params))
    webContents.debugger.listeners.get('message')({}, 'Page.loadEventFired', { timestamp: 1 })
    expect(seen).toEqual([{ timestamp: 1 }])
    let reason = null
    client.on('detach', (info) => { reason = info.reason })
    webContents.debugger.listeners.get('detach')({}, 'target closed')
    expect(reason).toBe('target closed')
  })

  it('reports attachment state from the underlying debugger', () => {
    const webContents = makeWebContents()
    const client = new CdpClient(webContents)
    client.attach()
    expect(client.attached).toBe(true)
    webContents.destroyed = true
    expect(client.attached).toBe(false)
  })

  it('refuses to attach to a destroyed view', () => {
    const webContents = makeWebContents()
    webContents.destroyed = true
    const client = new CdpClient(webContents)
    expect(() => client.attach()).toThrow(/not available for debugging/)
  })

  it('detach is a no-op when nothing is attached', () => {
    const webContents = makeWebContents()
    const client = new CdpClient(webContents)
    expect(client.detach()).toBe(false)
    client.attach()
    expect(client.detach()).toBe(true)
    expect(webContents.debugger.attached).toBe(false)
  })

  it('re-attaches lazily when a command follows a detach', async () => {
    const webContents = makeWebContents()
    const client = new CdpClient(webContents)
    client.attach()
    client.detach()
    await client.send('Runtime.evaluate', { expression: '1' })
    expect(webContents.debugger.isAttached()).toBe(true)
    expect(webContents.debugger.attachCalls).toBe(2)
  })

  it('wraps command failures with the CDP method name and keeps the cause', async () => {
    const webContents = makeWebContents()
    webContents.debugger.sendCommand = async () => { throw new Error('boom') }
    const client = new CdpClient(webContents)
    await expect(client.send('Page.navigate')).rejects.toThrow(/CDP Page.navigate failed: boom/)
    try {
      await client.send('Page.navigate')
    } catch (error) {
      expect(error.cause.message).toBe('boom')
    }
  })

  it('times out a hung command instead of waiting forever', async () => {
    vi.useFakeTimers()
    const webContents = makeWebContents()
    webContents.debugger.sendCommand = () => new Promise(() => {})
    const client = new CdpClient(webContents)
    const pending = client.send('Input.dispatchKeyEvent')
    const assertion = expect(pending).rejects.toThrow(/CDP command timed out: Input.dispatchKeyEvent/)
    await vi.advanceTimersByTimeAsync(31000)
    await assertion
  })

  it('detaches the debugger when a command times out so the session cannot poison later calls', async () => {
    vi.useFakeTimers()
    const webContents = makeWebContents()
    webContents.debugger.sendCommand = () => new Promise(() => {})
    const client = new CdpClient(webContents)
    const pending = client.send('Page.enable')
    const assertion = expect(pending).rejects.toThrow(CdpTimeoutError)
    await vi.advanceTimersByTimeAsync(31000)
    await assertion
    // 超时必须主动断开调试器，坏会话不得被复用。
    expect(webContents.debugger.isAttached()).toBe(false)
    expect(webContents.debugger.detachCalls).toBe(1)
  })

  it('resolves waitForEvent when the predicate matches', async () => {
    const webContents = makeWebContents()
    const client = new CdpClient(webContents)
    client.attach()
    const waiting = client.waitForEvent('Page.frameNavigated', { predicate: (params) => params?.frame?.parentId === undefined })
    client.emit('Page.frameNavigated', { frame: { parentId: 'parent' } })
    client.emit('Page.frameNavigated', { frame: { id: 'main' } })
    await expect(waiting).resolves.toEqual({ frame: { id: 'main' } })
  })

  it('returns null instead of throwing when the event never arrives', async () => {
    vi.useFakeTimers()
    const webContents = makeWebContents()
    const client = new CdpClient(webContents)
    client.attach()
    const waiting = client.waitForEvent('Page.loadEventFired', { timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1200)
    await expect(waiting).resolves.toBeNull()
  })
})

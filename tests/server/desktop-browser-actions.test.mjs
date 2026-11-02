import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PageActions } from '../../desktop/browser/page-actions.mjs'
import { buildSnapshot } from '../../desktop/browser/page-snapshot.mjs'

function createFakeCdp(handlers = {}) {
  const emitter = new EventEmitter()
  const calls = []
  return {
    calls,
    on: (...args) => emitter.on(...args),
    off: (...args) => emitter.off(...args),
    emit: (...args) => emitter.emit(...args),
    waitForEvent: () => Promise.resolve(null),
    async send(method, params) {
      calls.push({ method, params })
      const handler = handlers[method]
      return handler ? handler(params) : {}
    },
  }
}

function createActions(cdp, screenshotDir = path.join(os.tmpdir(), 'qf-browser-test')) {
  return new PageActions({
    cdp,
    webContents: { isDestroyed: () => false, getURL: () => 'https://example.com/', getTitle: () => 'Example' },
    screenshotDir,
  })
}

const quadsFor = (x, y) => ({ quads: [[x, y, x + 100, y, x + 100, y + 40, x, y + 40]] })

describe('page actions', () => {
  let tempDir

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-browser-actions-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('clicks the resolved element through a move/press/release sequence', async () => {
    const cdp = createFakeCdp({ 'DOM.getContentQuads': () => quadsFor(10, 20) })
    const actions = createActions(cdp, tempDir)
    actions.snapshot = buildSnapshot([{ nodeId: '1', role: { value: 'button' }, name: { value: 'Go' }, backendDOMNodeId: 7 }], { generation: 2 })

    const result = await actions.click({ ref: 'e1@g2' })

    expect(result.ok).toBe(true)
    expect(cdp.calls.filter((call) => call.method === 'Input.dispatchMouseEvent').map((call) => call.params.type))
      .toEqual(['mouseMoved', 'mousePressed', 'mouseReleased'])
    const pressed = cdp.calls.find((call) => call.params?.type === 'mousePressed')
    expect(pressed.params).toMatchObject({ x: 60, y: 40, button: 'left', buttons: 1 })
    expect(cdp.calls.some((call) => call.method === 'DOM.scrollIntoViewIfNeeded' && call.params.backendNodeId === 7)).toBe(true)
  })

  it('refuses to click with a stale ref and never dispatches input', async () => {
    const cdp = createFakeCdp({ 'DOM.getContentQuads': () => quadsFor(10, 20) })
    const actions = createActions(cdp, tempDir)
    actions.snapshot = buildSnapshot([{ nodeId: '1', role: { value: 'button' }, name: { value: 'Go' }, backendDOMNodeId: 7 }], { generation: 5 })

    const result = await actions.click({ ref: 'e1@g4' })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('stale')
    expect(cdp.calls.some((call) => call.method === 'Input.dispatchMouseEvent')).toBe(false)
  })

  it('reports a missing layout box instead of guessing coordinates', async () => {
    const cdp = createFakeCdp({ 'DOM.getContentQuads': () => ({ quads: [] }) })
    const actions = createActions(cdp, tempDir)
    actions.snapshot = buildSnapshot([{ nodeId: '1', role: { value: 'button' }, name: { value: 'Go' }, backendDOMNodeId: 7 }], { generation: 1 })

    const result = await actions.click({ ref: 'e1@g1' })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('not visible')
  })

  it('types into the focused element and optionally submits', async () => {
    const cdp = createFakeCdp({ 'DOM.getContentQuads': () => quadsFor(0, 0) })
    const actions = createActions(cdp, tempDir)
    actions.snapshot = buildSnapshot([{ nodeId: '1', role: { value: 'textbox' }, name: { value: 'Search' }, backendDOMNodeId: 3 }], { generation: 1 })

    const result = await actions.typeText({ ref: 'e1@g1', text: 'quickforge', submit: true })

    expect(result.ok).toBe(true)
    expect(cdp.calls.find((call) => call.method === 'Input.insertText').params.text).toBe('quickforge')
    expect(cdp.calls.filter((call) => call.method === 'Input.dispatchKeyEvent').map((call) => call.params.type))
      .toEqual(['keyDown', 'keyUp'])
  })

  it('writes screenshots to disk and returns the file path', async () => {
    const payload = Buffer.from('fake-png').toString('base64')
    const cdp = createFakeCdp({ 'Page.captureScreenshot': () => ({ data: payload }) })
    const actions = createActions(cdp, tempDir)

    const result = await actions.screenshot({ fullPage: false })

    expect(result.ok).toBe(true)
    expect(result.path.startsWith(tempDir)).toBe(true)
    expect(await fs.readFile(result.path, 'utf8')).toBe('fake-png')
  })

  it('returns an actionable error when the capture yields no data', async () => {
    const cdp = createFakeCdp({ 'Page.captureScreenshot': () => ({ data: '' }) })
    const actions = createActions(cdp, tempDir)

    const result = await actions.screenshot({})

    expect(result.ok).toBe(false)
    expect(result.message).toContain('panel is open')
  })

  it('invalidates the snapshot on main-frame navigation only', () => {
    const cdp = createFakeCdp()
    const actions = createActions(cdp, tempDir)
    actions.snapshot = buildSnapshot([{ nodeId: '1', role: { value: 'button' }, name: { value: 'Go' }, backendDOMNodeId: 7 }], { generation: 1 })

    cdp.emit('Page.frameNavigated', { frame: { parentId: 'parent' } })
    expect(actions.snapshot).not.toBeNull()
    expect(actions.generation).toBe(0)

    cdp.emit('Page.frameNavigated', { frame: {} })
    expect(actions.snapshot).toBeNull()
    expect(actions.generation).toBe(1)
  })

  it('collects console errors for later inspection', () => {
    const cdp = createFakeCdp()
    const actions = createActions(cdp, tempDir)

    cdp.emit('Runtime.consoleAPICalled', { type: 'error', args: [{ value: 'boom' }] })
    cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'ignored' }] })

    expect(actions.recentConsoleErrors()).toEqual(['boom'])
  })
})

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildSnapshot, resolveRef } from './page-snapshot.mjs'

const LOAD_TIMEOUT_MS = 20_000
const TYPE_SETTLE_MS = 40
const MAX_EVALUATE_CHARS = 8_000
const CONSOLE_ERROR_BUFFER = 5

const KEY_TABLE = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
}

const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }
const MOUSE_BUTTON_BITS = { left: 1, right: 2, middle: 4 }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function quadCenter(quads) {
  const quad = Array.isArray(quads) ? quads[0] : null
  if (!Array.isArray(quad) || quad.length < 8) return null
  const xs = [quad[0], quad[2], quad[4], quad[6]]
  const ys = [quad[1], quad[3], quad[5], quad[7]]
  return {
    x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    y: ys.reduce((sum, value) => sum + value, 0) / ys.length,
  }
}

function truncate(value, max = MAX_EVALUATE_CHARS) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]` : text
}

/**
 * 页面动作层：只做「CDP 调用 → 结构化结果」，不持有窗口/视图生命周期。
 * 每个动作都返回字符串结果（给模型读）而不是抛错误，错误以 `{ ok: false }` 表达，
 * 这样 MCP 层能统一转成 isError 文本。
 */
export class PageActions {
  constructor({ cdp, webContents, screenshotDir }) {
    this.cdp = cdp
    this.webContents = webContents
    this.screenshotDir = screenshotDir
    this.snapshot = null
    this.generation = 0
    this.enabled = false
    this.consoleErrors = []
    this.bindInvalidation()
  }

  bindInvalidation() {
    // 主 frame 导航、执行上下文重建 → 旧 ref 一律作废（世代 +1）。
    this.cdp.on('Page.frameNavigated', (params) => {
      if (params?.frame?.parentId) return
      this.invalidateSnapshot()
    })
    this.cdp.on('Runtime.executionContextsCleared', () => this.invalidateSnapshot())
    this.cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params?.type !== 'error' && params?.type !== 'assert') return
      const text = (params.args || [])
        .map((arg) => arg?.value ?? arg?.description ?? '')
        .filter(Boolean)
        .join(' ')
      if (!text) return
      this.consoleErrors.push(truncate(text, 400))
      if (this.consoleErrors.length > CONSOLE_ERROR_BUFFER) this.consoleErrors.shift()
    })
  }

  invalidateSnapshot() {
    this.generation += 1
    this.snapshot = null
  }

  async ensureEnabled() {
    if (this.enabled) return
    await this.cdp.send('Page.enable')
    await this.cdp.send('Runtime.enable')
    await this.cdp.send('DOM.enable')
    this.enabled = true
  }

  recentConsoleErrors() {
    return [...this.consoleErrors]
  }

  state() {
    const url = this.webContents?.isDestroyed?.() ? '' : (this.webContents?.getURL?.() || '')
    const title = this.webContents?.isDestroyed?.() ? '' : (this.webContents?.getTitle?.() || '')
    return { url, title, generation: this.generation, hasSnapshot: Boolean(this.snapshot) }
  }

  async docInfo() {
    const info = await this.evaluateRaw('({ url: location.href, title: document.title, readyState: document.readyState })')
    return info && typeof info === 'object' ? info : { url: this.state().url, title: this.state().title, readyState: 'unknown' }
  }

  async evaluateRaw(expression, { awaitPromise = false } = {}) {
    const result = await this.cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: false,
    })
    if (result?.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'evaluation failed'
      throw new Error(truncate(detail, 800))
    }
    return result?.result?.value
  }

  async navigate(url) {
    await this.ensureEnabled()
    const loaded = this.cdp.waitForEvent('Page.loadEventFired', { timeoutMs: LOAD_TIMEOUT_MS })
    const result = await this.cdp.send('Page.navigate', { url })
    if (result?.errorText) {
      return { ok: false, message: `Navigation failed: ${result.errorText}` }
    }
    const event = await loaded
    this.invalidateSnapshot()
    const info = await this.docInfo().catch(() => ({ url, title: '', readyState: 'unknown' }))
    return {
      ok: true,
      url: info?.url || url,
      title: info?.title || '',
      readyState: info?.readyState || 'unknown',
      loadTimedOut: event === null,
    }
  }

  async captureSnapshot({ maxChars } = {}) {
    await this.ensureEnabled()
    const tree = await this.cdp.send('Accessibility.getFullAXTree')
    this.generation += 1
    const snapshot = buildSnapshot(tree?.nodes || [], { generation: this.generation, maxChars })
    this.snapshot = snapshot
    return snapshot
  }

  async resolveClickPoint(ref) {
    const resolved = resolveRef(ref, this.snapshot)
    if (!resolved.ok) return resolved
    const backendNodeId = resolved.backendNodeId
    try {
      await this.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId })
    } catch {
      // 元素可能已脱离文档；交给下面 getContentQuads 给出更准确的错误。
    }
    // 元素可能已脱离文档；拿不到布局盒就明确报错，绝不猜坐标。
    const quads = await this.cdp.send('DOM.getContentQuads', { backendNodeId })
      .then((result) => result?.quads || [])
      .catch(() => [])
    const center = quadCenter(quads)
    if (!center) {
      return { ok: false, message: `Ref ${ref} is not visible on the page (no layout box). Take a new snapshot.` }
    }
    return { ok: true, point: center }
  }

  async click({ ref, button = 'left', clickCount = 1 }) {
    await this.ensureEnabled()
    const target = await this.resolveClickPoint(ref)
    if (!target.ok) return target
    const { x, y } = target.point
    const buttons = MOUSE_BUTTON_BITS[button] ?? MOUSE_BUTTON_BITS.left
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount })
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount })
    await sleep(TYPE_SETTLE_MS)
    return { ok: true, message: `Clicked ${ref} (${button}) at ${Math.round(x)},${Math.round(y)}.` }
  }

  async typeText({ ref, text, submit = false }) {
    await this.ensureEnabled()
    if (ref) {
      const clicked = await this.click({ ref })
      if (!clicked.ok) return clicked
    }
    const value = typeof text === 'string' ? text : ''
    if (value) await this.cdp.send('Input.insertText', { text: value })
    await sleep(TYPE_SETTLE_MS)
    if (submit) await this.pressKey({ key: 'Enter' })
    return { ok: true, message: `Typed ${value.length} characters${submit ? ' and pressed Enter' : ''}.` }
  }

  async pressKey({ key, modifiers = [] }) {
    await this.ensureEnabled()
    const spec = KEY_TABLE[key] || (key?.length === 1 ? { key, code: key, keyCode: key.toUpperCase().charCodeAt(0), text: key } : null)
    if (!spec) return { ok: false, message: `Unsupported key: ${key}` }
    const bits = (Array.isArray(modifiers) ? modifiers : [])
      .map((name) => MODIFIER_BITS[name])
      .filter((value) => Number.isInteger(value))
      .reduce((acc, value) => acc | value, 0)
    const base = {
      key: spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.keyCode,
      nativeVirtualKeyCode: spec.keyCode,
      modifiers: bits,
    }
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: spec.text && !bits ? 'keyDown' : 'rawKeyDown',
      ...base,
      ...(spec.text && !bits ? { text: spec.text, unmodifiedText: spec.text } : {}),
    })
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    await sleep(TYPE_SETTLE_MS)
    return { ok: true, message: `Pressed ${modifiers.length ? `${modifiers.join('+')}+` : ''}${key}.` }
  }

  async scroll({ deltaY = 600 }) {
    await this.ensureEnabled()
    const metrics = await this.cdp.send('Page.getLayoutMetrics')
    const viewport = metrics?.cssVisualViewport || metrics?.layoutViewport || { clientWidth: 800, clientHeight: 600 }
    const x = Math.max(1, Math.floor((viewport.clientWidth || 800) / 2))
    const y = Math.max(1, Math.floor((viewport.clientHeight || 600) / 2))
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY })
    await sleep(120)
    const offset = await this.evaluateRaw('({ x: window.scrollX, y: window.scrollY })').catch(() => null)
    return { ok: true, message: `Scrolled ${deltaY}px.`, scrollY: offset?.y ?? null }
  }

  async waitFor({ text, timeoutMs = 10_000 }) {
    await this.ensureEnabled()
    const needle = typeof text === 'string' ? text.trim() : ''
    if (!needle) return { ok: false, message: 'wait_for requires non-empty text' }
    const deadline = Date.now() + Math.min(Math.max(timeoutMs, 250), 60_000)
    const expression = `(() => { const body = document.body ? document.body.innerText : ''; return body.includes(${JSON.stringify(needle)}); })()`
    while (Date.now() < deadline) {
      const found = await this.evaluateRaw(expression).catch(() => false)
      if (found === true) return { ok: true, message: `Found "${needle}" on the page.` }
      await sleep(250)
    }
    return { ok: false, message: `Timed out after ${timeoutMs}ms waiting for "${needle}".` }
  }

  async screenshot({ fullPage = false } = {}) {
    await this.ensureEnabled()
    const shot = await this.cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: Boolean(fullPage),
    })
    const data = shot?.data
    if (typeof data !== 'string' || !data) {
      return { ok: false, message: 'Screenshot capture returned no data. Make sure the browser panel is open.' }
    }
    await fs.mkdir(this.screenshotDir, { recursive: true })
    const filePath = path.join(this.screenshotDir, `browser-${Date.now()}.png`)
    const buffer = Buffer.from(data, 'base64')
    await fs.writeFile(filePath, buffer)
    return { ok: true, message: `Saved screenshot (${buffer.length} bytes).`, path: filePath }
  }

  async evaluate({ expression, awaitPromise = false }) {
    await this.ensureEnabled()
    const value = await this.evaluateRaw(expression, { awaitPromise })
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    return { ok: true, message: truncate(serialized ?? String(value)) }
  }
}

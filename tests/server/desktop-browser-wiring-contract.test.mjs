import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath) => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')

const host = read('desktop/browser/browser-host.mjs')
const cdp = read('desktop/browser/cdp-client.mjs')
const mcpServer = read('desktop/browser/mcp-server.mjs')
const policy = read('desktop/browser/policy.mjs')
const electronMain = read('desktop/electron-main.mjs')
const preload = read('desktop/electron-preload.cjs')
const registry = read('server/mcp/registry.mjs')
const agentManager = read('server/agent-manager.mjs')

/**
 * 这些不变量没法在 CI 里跑真实 Electron，只能用源码契约锁住：
 * 一旦有人为了"方便"放开隔离、共享 cookie 或跳过引用校验，测试必须立刻红。
 */
describe('desktop browser security contract', () => {
  it('keeps the embedded page in an isolated, hardened session', () => {
    expect(host).toContain('BROWSER_SESSION_PARTITION')
    expect(host).toContain('sandbox: true')
    expect(host).toContain('contextIsolation: true')
    expect(host).toContain('nodeIntegration: false')
    expect(host).not.toContain('nodeIntegration: true')
    expect(host).not.toContain('webSecurity: false')
    expect(host).toContain('setPermissionRequestHandler')
    expect(host).toContain('callback(false)')
    expect(host).toContain('setPermissionCheckHandler(() => false)')
    expect(host).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))")
    expect(host).toContain("ses.on('will-download'")
  })

  it('enforces the navigation policy on links as well as on explicit navigation', () => {
    expect(host).toContain("wc.on('will-navigate'")
    expect(host).toContain('normalizeNavigableUrl')
    expect(policy).toContain("'localhost'")
    expect(policy).toContain('PRIVATE_IPV4_RANGES')
    expect(policy).toContain("new Set(['http:', 'https:'])")
  })

  it('owns CDP from a single place and re-attaches defensively', () => {
    expect(cdp).toContain('isAttached()')
    expect(cdp).toContain('attach(this.protocolVersion)')
    expect(cdp).toContain("this.bound = true")
    expect(host).toContain('cdp?.detach()')
    // 视图与宿主之外不允许出现第二个 attach 入口。
    expect(electronMain).not.toContain('debugger.attach')
  })

  it('keeps dead sessions from being reused: crashes, detaches and timeouts must discard the view', () => {
    // 渲染进程崩溃与外部 detach 都要整套作废，下次调用全新重建。
    expect(host).toContain('render-process-gone')
    expect(host).toMatch(/render-process-gone[\s\S]*discardView\(\)/)
    expect(host).toMatch(/cdp\.on\('detach'[\s\S]*discardView\(\)/)
    // CDP 命令超时必须主动断开调试器（熔断），且宿主对超时重建重试一次。
    expect(cdp).toContain('class CdpTimeoutError')
    expect(cdp).toMatch(/CdpTimeoutError[\s\S]*this\.detach\(\)/)
    expect(host).toContain('CdpTimeoutError')
    expect(host).toMatch(/discardView\(\)[\s\S]*retrying once/)
    // 新视图要过就绪门（等 dom-ready），消除冷启动命令进黑洞的竞态。
    expect(host).toContain("wc.on?.('dom-ready'")
    expect(host).toContain('VIEW_READINESS_TIMEOUT_MS')
  })

  it('keeps the renderer bridge narrow and frame-checked', () => {
    expect(preload).toContain("exposeInMainWorld('QuickForgeDesktopBrowser'")
    expect(preload).not.toContain('require(\'electron\').webContents')
    expect(electronMain).toContain('isMainWindowMainFrame(event.senderFrame)')
    expect(electronMain).toContain('parseBrowserRequest')
  })

  it('binds the MCP bridge to loopback with a bearer token', () => {
    expect(mcpServer).toContain("listen(0, '127.0.0.1'")
    expect(mcpServer).toContain('authorization') 
    expect(mcpServer).toContain('Bearer ${token}')
    expect(mcpServer).toContain('sessionIdGenerator: undefined')
  })

  it('publishes read-only hints so the approval layer can stay quiet', () => {
    expect(mcpServer).toContain('readOnlyHint: true')
    expect(mcpServer).toContain('destructiveHint: true')
    expect(registry).toContain('export function isReadOnlyMcpTool')
    expect(registry).toContain('readOnlyHint === true')
    expect(agentManager).toContain('isReadOnlyMcpTool(toolName)')
  })

  it('wires the bridge into the server child process before it starts', () => {
    const envIndex = electronMain.indexOf('QUICKFORGE_DESKTOP_BROWSER_URL')
    const startIndex = electronMain.indexOf('quickForgeInstance = await startQuickForge(')
    expect(envIndex).toBeGreaterThan(0)
    expect(startIndex).toBeGreaterThan(envIndex)
  })

  it('keeps the debugger API private to the CDP client across the whole desktop tree', () => {
    const offenders = []
    const walk = (relativeDir) => {
      for (const entry of readdirSync(new URL('../../' + relativeDir, import.meta.url), { withFileTypes: true })) {
        const child = relativeDir + entry.name
        if (entry.isDirectory()) {
          walk(child + '/')
        } else if (/\.(mjs|cjs|js)$/.test(entry.name) && read(child).includes('.debugger.')) {
          offenders.push(child)
        }
      }
    }
    walk('desktop/')
    // 只有 CDP 客户端可以碰调试器；换人就得改这里的期望值。
    expect(offenders).toEqual(['desktop/browser/cdp-client.mjs'])
  })
})

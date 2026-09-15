// network-proxy.mjs 的纯函数（normalize/validate）已由 network-proxy.test.mjs 覆盖；
// 本文件覆盖状态机部分：initialize/get/update/refresh/status 与 fetch 补丁。
// 通过 registerHostNetworkRuntime 注入 mock 运行时，避免触碰真实 undici
// dispatcher 与 @vscode/os-proxy-resolver 原生系统代理解析。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/storage.mjs', () => ({
  readStore: vi.fn(async () => null),
  atomicUpdate: vi.fn(async (storeName, updateFn) => updateFn({})),
}))

const FETCH_PATCH_MARKER = Symbol.for('quickforge.networkProxy.fetchPatched')
const ORIGINAL_FETCH_REF = globalThis.fetch

function makeRuntime(overrides = {}) {
  return {
    apply: vi.fn(async () => {}),
    getStatus: vi.fn(async () => ({ supported: true, features: { pac: false, pacUrl: false, wpad: false, httpProxy: true, httpsProxy: true, socks: true } })),
    refresh: vi.fn(async () => {}),
    ...overrides,
  }
}

/**
 * 重置模块状态并加载新实例。settings 为 readStore 返回的 settings store 内容；
 * runtime 为 null 时不注册 hostRuntime（保持 node 原生路径）。
 * mockFetch 非 null 时在模块加载前替换 globalThis.fetch（模块的 ORIGINAL_FETCH
 * 将绑定到该 mock，从而可以无网络验证 fetch 补丁分支）。
 */
async function loadModule({ settings = null, runtime = makeRuntime(), mockFetch = null } = {}) {
  vi.resetModules()
  delete globalThis[FETCH_PATCH_MARKER]
  if (mockFetch) globalThis.fetch = mockFetch

  const { readStore } = await import('../../server/storage.mjs')
  readStore.mockImplementation(async () => settings)

  const mod = await import('../../server/network-proxy.mjs')
  if (runtime) mod.registerHostNetworkRuntime(runtime)
  return { mod, runtime }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH_REF
  delete globalThis[FETCH_PATCH_MARKER]
})

describe('network proxy runtime state', () => {
  it('initializes from persisted settings and applies them once', async () => {
    const { mod, runtime } = await loadModule({
      settings: { 'network-proxy': { mode: 'manual', proxyUrl: ' http://127.0.0.1:7890 ' } },
    })

    const result = await mod.initializeNetworkProxy()

    expect(runtime.apply).toHaveBeenCalledTimes(1)
    expect(runtime.apply).toHaveBeenCalledWith({ mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' })
    expect(result.config).toEqual({ mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' })
    expect(result.status.configuredMode).toBe('manual')
    expect(result.status.effectiveMode).toBe('manual')

    // 幂等：二次初始化不再读取配置或应用
    await mod.initializeNetworkProxy()
    expect(runtime.apply).toHaveBeenCalledTimes(1)
  })

  it('initializes to direct mode when no settings exist', async () => {
    const { mod, runtime } = await loadModule({ settings: null })

    const result = await mod.initializeNetworkProxy()

    expect(runtime.apply).toHaveBeenCalledWith({ mode: 'direct', proxyUrl: '' })
    expect(result.config).toEqual({ mode: 'direct', proxyUrl: '' })
  })

  it('lazily initializes when reading the config', async () => {
    const { mod, runtime } = await loadModule()

    const result = await mod.getNetworkProxyConfig()

    expect(runtime.apply).toHaveBeenCalledTimes(1)
    expect(result.config.mode).toBe('direct')
  })

  it('rejects invalid manual proxy URLs with a 400 status code', async () => {
    const { mod, runtime } = await loadModule()

    await expect(mod.updateNetworkProxyConfig({ mode: 'manual', proxyUrl: 'socks5://127.0.0.1:1080' }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(runtime.apply).toHaveBeenCalledTimes(1) // 仅初始化 direct，未应用非法配置
  })

  it('rejects PAC mode when the runtime lacks custom PAC URL support', async () => {
    const { mod, runtime } = await loadModule()

    await expect(mod.updateNetworkProxyConfig({ mode: 'pac', proxyUrl: 'http://example.com/proxy.pac' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Custom PAC URLs are not supported by this runtime' })
    expect(runtime.apply).toHaveBeenCalledTimes(1) // 仅初始化 direct
  })

  it('applies and persists a valid manual proxy update', async () => {
    const { mod, runtime, } = await loadModule()
    const { atomicUpdate } = await import('../../server/storage.mjs')

    const result = await mod.updateNetworkProxyConfig({ mode: 'manual', proxyUrl: 'http://127.0.0.1:8080' })

    expect(runtime.apply).toHaveBeenLastCalledWith({ mode: 'manual', proxyUrl: 'http://127.0.0.1:8080' })
    expect(atomicUpdate).toHaveBeenCalledWith('settings', expect.any(Function))
    const [storeName, updateFn] = atomicUpdate.mock.calls.at(-1)
    expect(storeName).toBe('settings')
    expect(updateFn({})).toEqual({ 'network-proxy': { mode: 'manual', proxyUrl: 'http://127.0.0.1:8080' } })
    expect(result.config).toEqual({ mode: 'manual', proxyUrl: 'http://127.0.0.1:8080' })
    expect(result.status.lastAppliedAt).toBeTruthy()
  })

  it('rolls back to the previous config when persisting fails', async () => {
    const { mod, runtime } = await loadModule({ settings: { 'network-proxy': { mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' } } })
    const { atomicUpdate } = await import('../../server/storage.mjs')
    await mod.initializeNetworkProxy()
    atomicUpdate.mockRejectedValueOnce(new Error('disk full'))

    await expect(mod.updateNetworkProxyConfig({ mode: 'direct' })).rejects.toThrow('disk full')

    // 应用序列：初始 manual → 更新 direct → 持久化失败回滚 manual
    expect(runtime.apply.mock.calls.map((call) => call[0])).toEqual([
      { mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' },
      { mode: 'direct', proxyUrl: '' },
      { mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' },
    ])
    const result = await mod.getNetworkProxyConfig()
    expect(result.config).toEqual({ mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' })
  })

  it('applies PAC mode when the runtime supports custom PAC URLs', async () => {
    const runtime = makeRuntime({
      getStatus: vi.fn(async () => ({ supported: true, features: { pac: true, pacUrl: true, wpad: true, httpProxy: true, httpsProxy: true, socks: true } })),
    })
    const { mod } = await loadModule({ runtime })

    const result = await mod.updateNetworkProxyConfig({ mode: 'pac', proxyUrl: 'http://example.com/proxy.pac' })

    expect(result.config).toEqual({ mode: 'pac', proxyUrl: 'http://example.com/proxy.pac' })
    expect(result.status.effectiveMode).toBe('pac')
  })

  it('marks the configured mode unsupported when the runtime lacks system proxy support', async () => {
    const runtime = makeRuntime({
      getStatus: vi.fn(async () => ({ supported: false, source: 'none', features: { pac: false, pacUrl: false, wpad: false, httpProxy: false, httpsProxy: false, socks: false } })),
    })
    const { mod } = await loadModule({ runtime })

    const result = await mod.updateNetworkProxyConfig({ mode: 'system' })

    expect(result.status.effectiveMode).toBe('unsupported')
    expect(result.status.configuredMode).toBe('system')
    expect(result.status.runtimeKind).toBe('electron-inline')
  })

  it('refreshes the system proxy through the host runtime', async () => {
    const { mod, runtime } = await loadModule({
      settings: { 'network-proxy': { mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' } },
    })
    await mod.initializeNetworkProxy()

    const result = await mod.refreshSystemProxy()

    expect(runtime.refresh).toHaveBeenCalledTimes(1)
    expect(result.config).toEqual({ mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' })
    expect(result.status.lastAppliedAt).toBeTruthy()
  })
})

describe('network proxy fetch patch', () => {
  it('bypasses the proxy for loopback requests', async () => {
    const originalFetch = vi.fn(async () => 'direct-response')
    const { mod } = await loadModule({ runtime: null, mockFetch: originalFetch })
    await mod.initializeNetworkProxy() // direct 模式 → undici Agent（惰性，不建连）

    const response = await fetch('http://localhost:9999/local')

    expect(response).toBe('direct-response')
    expect(originalFetch).toHaveBeenCalledTimes(1)
    expect(originalFetch).toHaveBeenCalledWith('http://localhost:9999/local', {})
  })

  it('routes non-loopback requests through the host runtime when configured', async () => {
    const originalFetch = vi.fn(async () => 'original')
    const runtimeFetch = vi.fn(async () => 'host-runtime-response')
    const runtime = makeRuntime({ fetch: runtimeFetch })
    const { mod } = await loadModule({
      runtime,
      mockFetch: originalFetch,
      settings: { 'network-proxy': { mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' } },
    })
    await mod.initializeNetworkProxy()

    const response = await fetch('http://example.com/api')

    expect(response).toBe('host-runtime-response')
    expect(runtimeFetch).toHaveBeenCalledWith('http://example.com/api', {})
    expect(originalFetch).not.toHaveBeenCalled()
  })

  it('falls back to the original fetch for loopback even with a host runtime configured', async () => {
    const originalFetch = vi.fn(async () => 'direct-response')
    const runtimeFetch = vi.fn(async () => 'host-runtime-response')
    const runtime = makeRuntime({ fetch: runtimeFetch })
    const { mod } = await loadModule({
      runtime,
      mockFetch: originalFetch,
      settings: { 'network-proxy': { mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' } },
    })
    await mod.initializeNetworkProxy()

    const response = await fetch('http://127.0.0.1:8080/api')

    expect(response).toBe('direct-response')
    expect(originalFetch).toHaveBeenCalledWith('http://127.0.0.1:8080/api', {})
    expect(runtimeFetch).not.toHaveBeenCalled()
  })

  it('dispatches through the network dispatcher for non-loopback requests without a host runtime', async () => {
    const originalFetch = vi.fn(async () => 'dispatched-response')
    const { mod } = await loadModule({ runtime: null, mockFetch: originalFetch })
    await mod.initializeNetworkProxy() // direct → 创建 undici Agent dispatcher

    const response = await fetch('http://example.com/api', { method: 'GET' })

    expect(response).toBe('dispatched-response')
    expect(originalFetch).toHaveBeenCalledTimes(1)
    const [input, init] = originalFetch.mock.calls[0]
    expect(input).toBe('http://example.com/api')
    expect(init.method).toBe('GET')
    expect(init.dispatcher).toBeTruthy()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  broadcastProviderKeysChanged,
  clearProviderKeysCache,
  forgetCachedProviderKey,
  getCachedProviderKey,
  rememberCachedProviderKey,
  resolveProviderKeyThroughCache,
} from '../../src/lib/provider-keys-cache'

type MessageListener = (event: { data: unknown }) => void

/** 最小 BroadcastChannel 替身：postMessage 投递到所有同频道实例（含发送者）。 */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  readonly name: string
  private readonly listeners = new Set<MessageListener>()

  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.instances.push(this)
  }

  addEventListener(type: 'message', listener: MessageListener) {
    if (type === 'message') this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: MessageListener) {
    this.listeners.delete(listener)
  }

  postMessage(data: unknown) {
    for (const instance of FakeBroadcastChannel.instances) {
      for (const listener of [...instance.listeners]) {
        listener({ data })
      }
    }
  }

  unref() {}

  close() {
    FakeBroadcastChannel.instances = FakeBroadcastChannel.instances.filter((instance) => instance !== this)
  }
}

describe('provider keys memory cache', () => {
  beforeEach(() => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    FakeBroadcastChannel.instances = []
    clearProviderKeysCache()
  })

  afterEach(() => {
    clearProviderKeysCache()
    vi.unstubAllGlobals()
  })

  it('caches the loaded value and skips load on the next resolve', async () => {
    expect(getCachedProviderKey('anthropic')).toBeUndefined()
    const load = vi.fn(async () => 'sk-first')
    await expect(resolveProviderKeyThroughCache('anthropic', load)).resolves.toBe('sk-first')
    expect(load).toHaveBeenCalledTimes(1)
    expect(getCachedProviderKey('anthropic')).toBe('sk-first')
    await expect(resolveProviderKeyThroughCache('anthropic', load)).resolves.toBe('sk-first')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('caches confirmed-missing keys as null', async () => {
    const load = vi.fn(async () => null)
    await expect(resolveProviderKeyThroughCache('openai', load)).resolves.toBeNull()
    expect(getCachedProviderKey('openai')).toBeNull()
    await expect(resolveProviderKeyThroughCache('openai', load)).resolves.toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent loads for the same provider', async () => {
    let release: ((value: string | null) => void) | undefined
    const load = vi.fn(() => new Promise<string | null>((resolve) => {
      release = resolve
    }))
    const first = resolveProviderKeyThroughCache('anthropic', load)
    const second = resolveProviderKeyThroughCache('anthropic', load)
    release?.('sk-dedup')
    await expect(first).resolves.toBe('sk-dedup')
    await expect(second).resolves.toBe('sk-dedup')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not cache failed loads and allows a retry', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('sk-retry')
    await expect(resolveProviderKeyThroughCache('anthropic', load)).rejects.toThrow('offline')
    expect(getCachedProviderKey('anthropic')).toBeUndefined()
    await expect(resolveProviderKeyThroughCache('anthropic', load)).resolves.toBe('sk-retry')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('forget marks the provider as confirmed-missing (delete write-through)', async () => {
    rememberCachedProviderKey('anthropic', 'sk-old')
    forgetCachedProviderKey('anthropic')
    expect(getCachedProviderKey('anthropic')).toBeNull()
    const load = vi.fn(async () => 'sk-should-not-run')
    await expect(resolveProviderKeyThroughCache('anthropic', load)).resolves.toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('clear drops all cached entries and resets the channel', () => {
    rememberCachedProviderKey('anthropic', 'sk-1')
    rememberCachedProviderKey('openai', null)
    clearProviderKeysCache()
    expect(getCachedProviderKey('anthropic')).toBeUndefined()
    expect(getCachedProviderKey('openai')).toBeUndefined()
    // 通道已关闭，下一次缓存操作重建
    rememberCachedProviderKey('anthropic', 'sk-2')
    expect(FakeBroadcastChannel.instances).toHaveLength(1)
  })

  it('broadcast posts provider-keys-changed with a sourceTabId', () => {
    rememberCachedProviderKey('anthropic', 'sk-1')
    expect(FakeBroadcastChannel.instances).toHaveLength(1)

    let posted: { type?: string; sourceTabId?: string } | undefined
    const otherTab = new FakeBroadcastChannel('quickforge-sync')
    otherTab.addEventListener('message', (event) => {
      posted = event.data as { type?: string; sourceTabId?: string }
    })
    broadcastProviderKeysChanged()

    expect(posted?.type).toBe('provider-keys-changed')
    expect(typeof posted?.sourceTabId).toBe('string')
  })

  it('clears the cache when another tab broadcasts a change', () => {
    rememberCachedProviderKey('anthropic', 'sk-1')
    expect(FakeBroadcastChannel.instances).toHaveLength(1)

    const otherTab = new FakeBroadcastChannel('quickforge-sync')
    otherTab.postMessage({
      type: 'provider-keys-changed',
      sourceTabId: 'other-tab-id',
      timestamp: Date.now(),
    })
    expect(getCachedProviderKey('anthropic')).toBeUndefined()
  })

  it('ignores broadcasts from the same tab', () => {
    rememberCachedProviderKey('anthropic', 'sk-1')
    broadcastProviderKeysChanged()
    expect(getCachedProviderKey('anthropic')).toBe('sk-1')
  })

  it('degrades silently when BroadcastChannel is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    clearProviderKeysCache()
    expect(() => {
      rememberCachedProviderKey('anthropic', 'sk-1')
      forgetCachedProviderKey('anthropic')
      broadcastProviderKeysChanged()
    }).not.toThrow()
    expect(getCachedProviderKey('anthropic')).toBeNull()
  })
})

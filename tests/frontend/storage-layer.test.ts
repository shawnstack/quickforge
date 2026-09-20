import { describe, expect, it, vi } from 'vitest'
import { AppStorage, getAppStorage, setAppStorage } from '../../src/storage/app-storage'
import type { AgentMessage, ArtifactMessage, Attachment, UserMessageWithAttachments } from '../../src/components/chat/surface/ChatTypes'
import { CustomProvidersStore } from '../../src/storage/stores/custom-providers-store'
import { ProviderKeysStore } from '../../src/storage/stores/provider-keys-store'
import { SessionsStore } from '../../src/storage/stores/sessions-store'
import { SettingsStore } from '../../src/storage/stores/settings-store'
import type { StorageBackend, StorageTransaction } from '../../src/storage/types'

/** 测试用内存 backend：完整实现 StorageBackend 契约，记录事务调用 */
class MemoryStorageBackend implements StorageBackend {
  private readonly stores = new Map<string, Map<string, unknown>>()
  readonly transactions: string[][] = []
  quota = { usage: 10, quota: 100, percent: 10 }

  private store(storeName: string): Map<string, unknown> {
    let values = this.stores.get(storeName)
    if (!values) {
      values = new Map()
      this.stores.set(storeName, values)
    }
    return values
  }

  async get<T = unknown>(storeName: string, key: string): Promise<T | null> {
    // 快照语义：真实 backend 经 HTTP/序列化返回新对象，调用方的就地修改
    // 不会直接泄漏进底层存储（事务失败不落盘断言依赖此语义）
    const value = this.store(storeName).get(key) ?? null
    return value === null ? null : (structuredClone(value) as T)
  }

  async set<T = unknown>(storeName: string, key: string, value: T): Promise<void> {
    this.store(storeName).set(key, value)
  }

  async delete(storeName: string, key: string): Promise<void> {
    this.store(storeName).delete(key)
  }

  async keys(storeName: string, prefix?: string): Promise<string[]> {
    return [...this.store(storeName).keys()].filter((key) => !prefix || key.startsWith(prefix))
  }

  async getAllFromIndex<T = unknown>(
    storeName: string,
    _indexName: string,
    direction: 'asc' | 'desc' = 'asc',
  ): Promise<T[]> {
    // 语义近似：按插入顺序返回（测试按时间升序写入），desc 反转
    const values = [...this.store(storeName).values()] as T[]
    return direction === 'desc' ? values.reverse() : values
  }

  async clear(storeName: string): Promise<void> {
    this.stores.set(storeName, new Map())
  }

  async has(storeName: string, key: string): Promise<boolean> {
    return this.store(storeName).has(key)
  }

  async transaction<T>(
    storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    operation: (tx: StorageTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactions.push([...storeNames])
    // 队列+整体提交：operation 失败则不落任何写（对齐服务端 batch 的原子语义）
    const pending: Array<() => void> = []
    const tx: StorageTransaction = {
      get: <Value = unknown>(storeName: string, key: string) => this.get<Value>(storeName, key),
      set: <Value = unknown>(storeName: string, key: string, value: Value) => {
        pending.push(() => {
          this.set(storeName, key, value)
        })
        return Promise.resolve()
      },
      delete: (storeName: string, key: string) => {
        pending.push(() => {
          this.delete(storeName, key)
        })
        return Promise.resolve()
      },
    }
    const result = await operation(tx)
    for (const apply of pending) apply()
    return result
  }

  async getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }> {
    return { ...this.quota }
  }

  async requestPersistence(): Promise<boolean> {
    return true
  }
}

function sessionData(id: string, lastModified: string) {
  return {
    id,
    title: `title-${id}`,
    model: { provider: 'mock', id: 'm1' },
    thinkingLevel: 'off' as const,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified,
  }
}

function sessionMetadata(id: string, lastModified: string) {
  return {
    id,
    title: `title-${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified,
    messageCount: 0,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    thinkingLevel: 'off' as const,
    preview: '',
  }
}

function createStoreBundle(backend: MemoryStorageBackend = new MemoryStorageBackend()) {
  const stores = {
    settings: new SettingsStore(),
    providerKeys: new ProviderKeysStore(),
    sessions: new SessionsStore(),
    customProviders: new CustomProvidersStore(),
  }
  for (const store of Object.values(stores)) store.setBackend(backend)
  return { backend, stores }
}

/** 失败注入 backend：读取 sessions store 时抛错，模拟事务中途故障 */
class FailingSessionsReadBackend extends MemoryStorageBackend {
  failSessionsReads = false

  async get<T = unknown>(storeName: string, key: string): Promise<T | null> {
    if (this.failSessionsReads && storeName === 'sessions') throw new Error('simulated storage failure')
    return super.get<T>(storeName, key)
  }
}

describe('SettingsStore', () => {
  it('round-trips get/set, lists keys, and deletes', async () => {
    const { stores } = createStoreBundle()
    expect(await stores.settings.get('theme')).toBeNull()

    await stores.settings.set('theme', 'dark')
    await stores.settings.set('font-size', 14)
    expect(await stores.settings.get<number>('font-size')).toBe(14)
    expect(await stores.settings.list()).toEqual(['theme', 'font-size'])

    await stores.settings.delete('theme')
    expect(await stores.settings.get('theme')).toBeNull()
    expect(await stores.settings.list()).toEqual(['font-size'])
  })
})

describe('ProviderKeysStore', () => {
  it('round-trips get/set/has, lists providers, and deletes', async () => {
    const { stores } = createStoreBundle()
    expect(await stores.providerKeys.get('anthropic')).toBeNull()
    expect(await stores.providerKeys.has('anthropic')).toBe(false)

    await stores.providerKeys.set('anthropic', 'sk-test')
    await stores.providerKeys.set('openai', 'sk-other')
    expect(await stores.providerKeys.get('anthropic')).toBe('sk-test')
    expect(await stores.providerKeys.has('openai')).toBe(true)
    expect(await stores.providerKeys.list()).toEqual(['anthropic', 'openai'])

    await stores.providerKeys.delete('anthropic')
    expect(await stores.providerKeys.get('anthropic')).toBeNull()
    expect(await stores.providerKeys.list()).toEqual(['openai'])
  })
})

describe('CustomProvidersStore', () => {
  it('round-trips get/set/has, getAll, and deletes', async () => {
    const { stores } = createStoreBundle()
    const provider = {
      id: 'p1',
      name: 'LiteLLM',
      type: 'openai-completions' as const,
      baseUrl: 'http://localhost:4000/v1',
    }
    expect(await stores.customProviders.get('p1')).toBeNull()
    expect(await stores.customProviders.has('p1')).toBe(false)

    await stores.customProviders.set(provider)
    await stores.customProviders.set({ ...provider, id: 'p2', name: 'Other' })
    expect(await stores.customProviders.get('p1')).toEqual(provider)
    expect(await stores.customProviders.has('p2')).toBe(true)
    expect((await stores.customProviders.getAll()).map((item) => item.id)).toEqual(['p1', 'p2'])

    await stores.customProviders.delete('p1')
    expect(await stores.customProviders.get('p1')).toBeNull()
    expect((await stores.customProviders.getAll()).map((item) => item.id)).toEqual(['p2'])
  })
})

describe('SessionsStore', () => {
  it('save() commits data and metadata in one dual-store transaction', async () => {
    const { backend, stores } = createStoreBundle()
    const data = sessionData('s1', '2026-01-01T00:00:01.000Z')
    const metadata = sessionMetadata('s1', '2026-01-01T00:00:01.000Z')

    await stores.sessions.save(data, metadata)

    expect(backend.transactions).toHaveLength(1)
    expect(backend.transactions[0]).toEqual(['sessions', 'sessions-metadata'])
    expect(await stores.sessions.get('s1')).toEqual(data)
    expect(await stores.sessions.getMetadata('s1')).toEqual(metadata)
  })

  it('delete() removes both stores in one transaction; metadata queries order desc', async () => {
    const { backend, stores } = createStoreBundle()
    await stores.sessions.save(sessionData('s1', '2026-01-01T00:00:01.000Z'), sessionMetadata('s1', '2026-01-01T00:00:01.000Z'))
    await stores.sessions.save(sessionData('s2', '2026-01-02T00:00:00.000Z'), sessionMetadata('s2', '2026-01-02T00:00:00.000Z'))
    backend.transactions.length = 0

    await stores.sessions.delete('s1')

    expect(backend.transactions).toHaveLength(1)
    expect(backend.transactions[0]).toEqual(['sessions', 'sessions-metadata'])
    expect(await stores.sessions.get('s1')).toBeNull()
    expect(await stores.sessions.getMetadata('s1')).toBeNull()

    expect((await stores.sessions.getAllMetadata()).map((meta) => meta.id)).toEqual(['s2'])
    expect(await stores.sessions.getLatestSessionId()).toBe('s2')
  })

  it('saveSession()/loadSession() aliases persist and restore full session data', async () => {
    const { stores } = createStoreBundle()
    const state = {
      model: { provider: 'mock', id: 'm1' },
      thinkingLevel: 'medium' as const,
      messages: [],
    }
    await stores.sessions.saveSession('s3', state, undefined, 'Manual title')

    const loaded = await stores.sessions.loadSession('s3')
    expect(loaded?.title).toBe('Manual title')
    expect(loaded?.thinkingLevel).toBe('medium')
    expect(await stores.sessions.getMetadata('s3')).toMatchObject({ id: 's3', title: 'Manual title' })
  })

  it('updateTitle() writes through to metadata and full data in one dual-store transaction', async () => {
    const { backend, stores } = createStoreBundle()
    await stores.sessions.save(sessionData('s4', '2026-01-01T00:00:00.000Z'), sessionMetadata('s4', '2026-01-01T00:00:00.000Z'))
    backend.transactions.length = 0

    await stores.sessions.updateTitle('s4', 'Renamed')

    // 复用 save()/delete() 的 batch 事务路径：两处写必须在同一事务内
    expect(backend.transactions).toHaveLength(1)
    expect(backend.transactions[0]).toEqual(['sessions', 'sessions-metadata'])
    expect(await stores.sessions.getMetadata('s4')).toMatchObject({ title: 'Renamed' })
    expect(await stores.sessions.get('s4')).toMatchObject({ title: 'Renamed' })
  })

  it('updateTitle() persists nothing when the transaction fails mid-flight', async () => {
    const backend = new FailingSessionsReadBackend()
    const { stores } = createStoreBundle(backend)
    await stores.sessions.save(sessionData('s5', '2026-01-01T00:00:00.000Z'), sessionMetadata('s5', '2026-01-01T00:00:00.000Z'))

    // 事务中途故障：metadata 写已排队，sessions 读失败 → 整体不落盘
    backend.failSessionsReads = true
    await expect(stores.sessions.updateTitle('s5', 'Should Not Land')).rejects.toThrow('simulated storage failure')

    backend.failSessionsReads = false
    expect(await stores.sessions.getMetadata('s5')).toMatchObject({ title: 'title-s5' })
    expect(await stores.sessions.get('s5')).toMatchObject({ title: 'title-s5' })
  })
})

describe('AppStorage singleton', () => {
  const restoreSingleton = () => {
    // 单例为模块级状态；测试间保持原值
    const previous = singletonOrNull()
    return () => {
      if (previous) setAppStorage(previous)
      else setAppStorage(null as never)
    }
  }

  function singletonOrNull(): AppStorage | null {
    try {
      return getAppStorage()
    } catch {
      return null
    }
  }

  it('throws before initialization', () => {
    const restore = restoreSingleton()
    setAppStorage(null as never)

    expect(() => getAppStorage()).toThrow(/not initialized/i)
    restore()
  })

  it('setAppStorage/getAppStorage register and return the same instance', () => {
    const restore = restoreSingleton()
    const { stores, backend } = createStoreBundle()
    const storage = new AppStorage(stores.settings, stores.providerKeys, stores.sessions, stores.customProviders, backend)

    setAppStorage(storage)
    expect(getAppStorage()).toBe(storage)

    const replacement = new AppStorage(stores.settings, stores.providerKeys, stores.sessions, stores.customProviders, backend)
    setAppStorage(replacement)
    expect(getAppStorage()).toBe(replacement)

    restore()
  })
})

describe('historical custom messages', () => {
  it('round-trips document originals, extracted text, previews and string artifact timestamps', async () => {
    const { stores } = createStoreBundle()
    const attachment: Attachment = {
      id: 'legacy-pdf', type: 'document', fileName: 'report.pdf', mimeType: 'application/pdf',
      size: 12, content: 'JVBERi0xLjQ=',
      extractedText: '<pdf filename="report.pdf"><page number="1">历史正文</page></pdf>',
      preview: 'iVBORw0KGgo=',
    }
    const user: UserMessageWithAttachments = {
      role: 'user-with-attachments', timestamp: 1700000000000,
      content: [{ type: 'text', text: 'Review this document' }], attachments: [attachment],
    }
    const artifact: ArtifactMessage = {
      role: 'artifact', action: 'create', filename: 'report.md', content: '# Report',
      title: '历史报告', timestamp: '2023-11-14T22:13:20.000Z',
    }
    const messages: AgentMessage[] = [
      user, { role: 'user-with-attachments', content: 'No attachments', timestamp: 1700000000001 },
      artifact, { ...artifact, action: 'update' },
      { role: 'artifact', action: 'delete', filename: 'report.md', timestamp: artifact.timestamp },
    ]
    const data = { ...sessionData('history', artifact.timestamp), messages }
    // Simulate a historical JSON payload, not in-memory object identity.
    await stores.sessions.save(JSON.parse(JSON.stringify(data)), sessionMetadata('history', artifact.timestamp))
    const restored = await stores.sessions.loadSession('history')
    expect(restored?.messages).toEqual(messages)
    expect(restored?.messages[0]).toMatchObject({ attachments: [{
      content: attachment.content, extractedText: attachment.extractedText, preview: attachment.preview,
    }] })
    expect(restored?.messages[2].timestamp).toBe(artifact.timestamp)
  })
})

describe('initializePiStorage 幂等守卫', () => {
  /**
   * pi-chat 的幂等守卫是模块级状态（initializedStorage / in-flight promise），
   * 静态 import 会让缓存跨用例存活：前一条用例 restore() 清空全局单例后，
   * 后续用例命中模块缓存短路，不再 setAppStorage，getAppStorage() 随即抛错。
   * 因此每条用例先 vi.resetModules() 再动态 import，取到带独立模块状态的
   * 实现；getAppStorage / setAppStorage / logger 也取自同一轮 reset 后的
   * 注册表，确保断言与实现共享同一份模块状态。
   * 注意：必须在 installServiceMock() 之前 import——window stub 会改变模块
   * 评估时的全局环境（model-list-cache 的顶层 storage 监听注册依赖真实
   * windowless 环境跳过）。
   */
  async function importFreshPiStorage() {
    vi.resetModules()
    const [piChat, appStorageModule, loggerModule] = await Promise.all([
      import('../../src/lib/pi-chat'),
      import('../../src/storage/app-storage'),
      import('../../src/lib/logger'),
    ])
    return {
      initializePiStorage: piChat.initializePiStorage,
      getAppStorage: appStorageModule.getAppStorage,
      setAppStorage: appStorageModule.setAppStorage,
      logger: loggerModule.logger,
    }
  }

  /** 模拟本地服务可用：/api/health 与存储请求一律返回 ok */
  function installServiceMock() {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })))
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('repeated calls return the same instance without rebuilding or re-installing the global', async () => {
    const { initializePiStorage, getAppStorage } = await importFreshPiStorage()
    installServiceMock()

    const first = await initializePiStorage()
    expect(getAppStorage()).toBe(first)

    const second = await initializePiStorage()
    expect(second).toBe(first)
    expect(getAppStorage()).toBe(first)
  })

  it('concurrent calls initialize only one instance', async () => {
    const { initializePiStorage, getAppStorage } = await importFreshPiStorage()
    installServiceMock()

    const [a, b] = await Promise.all([initializePiStorage(), initializePiStorage()])
    expect(a).toBe(b)
    expect(getAppStorage()).toBe(a)
  })

  it('does not clobber an externally installed specialized instance (SharedConversationPage semantics)', async () => {
    const { initializePiStorage, getAppStorage, setAppStorage } = await importFreshPiStorage()
    installServiceMock()

    const first = await initializePiStorage()

    // 模拟 SharedConversationPage 的 installSharedPageStorage：外部安装特化实例
    const stores = {
      settings: new SettingsStore(),
      providerKeys: new ProviderKeysStore(),
      sessions: new SessionsStore(),
      customProviders: new CustomProvidersStore(),
    }
    const specialized = new AppStorage(stores.settings, stores.providerKeys, stores.sessions, stores.customProviders, {
    } as StorageBackend)
    setAppStorage(specialized)

    // 后续懒加载调用点只能拿到首个实例，且不得再 setAppStorage 覆盖特化实例
    const again = await initializePiStorage()
    expect(again).toBe(first)
    expect(getAppStorage()).toBe(specialized)
  })

  it('warns and returns the first instance when called again with different options', async () => {
    const { initializePiStorage, logger: freshLogger } = await importFreshPiStorage()
    installServiceMock()

    const first = await initializePiStorage()

    const warnSpy = vi.spyOn(freshLogger, 'warn').mockImplementation(() => {})
    const result = await initializePiStorage({ blockedStores: ['sessions'] })
    expect(result).toBe(first)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

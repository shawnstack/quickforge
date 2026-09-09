/**
 * Provider keys 前端内存缓存（消除发送消息路径上的 HTTP 往返）。
 *
 * pi 库 AgentInterface.sendMessage 在乐观上屏前 await providerKeys.get(provider)，
 * HttpStorageBackend 每次都发无缓存 GET /api/storage/provider-keys/key/:provider，
 * 服务端忙时往返被拉长到可感知。本模块维护 provider→key 的模块级内存缓存：
 * null 表示「已确认无 key」（服务端 miss 语义为 200 { value: null }）。
 *
 * 缓存必须是模块级单例：全局 AppStorage 会被多处 initializePiStorage 重建，
 * backend 实例字段会随替换丢失。
 *
 * 失效路径：set/delete/clear 写穿（backend 内）、备份导入（绕过 backend 直写
 * 服务端）、跨标签 BroadcastChannel('quickforge-sync') 'provider-keys-changed'
 * 广播（与 useCrossTabSync 共用频道，未知消息类型互相忽略）。
 *
 * BroadcastChannel 惰性建立（首次产生缓存项或广播时）而非 import 期：
 * Node 测试环境下未关闭的通道会挂住事件循环（建立时 unref 兜底），
 * 且缓存为空时不存在跨标签过期窗口。BroadcastChannel 不可用/监听器异常
 * 均静默降级（风格对齐 app-settings-cache）。
 */
import { getCrossTabSyncSourceId } from '@/lib/cross-tab-events'

const SYNC_CHANNEL_NAME = 'quickforge-sync'
const PROVIDER_KEYS_CHANGED_MESSAGE = 'provider-keys-changed'

type ProviderKeysSyncMessage = {
  type: typeof PROVIDER_KEYS_CHANGED_MESSAGE
  sourceTabId: string
  timestamp: number
}

/** Node 的 BroadcastChannel 额外提供 unref（浏览器无此方法）。 */
type UnrefableBroadcastChannel = BroadcastChannel & { unref?: () => void }

const providerKeysCache = new Map<string, string | null>()
const providerKeysInFlight = new Map<string, Promise<string | null>>()
let syncChannel: UnrefableBroadcastChannel | null | undefined

function handleSyncMessage(event: MessageEvent<ProviderKeysSyncMessage>) {
  try {
    const message = event.data
    // 忽略本标签自己的广播（与 useCrossTabSync 同模式）
    if (!message || message.sourceTabId === getCrossTabSyncSourceId()) return
    if (message.type === PROVIDER_KEYS_CHANGED_MESSAGE) clearProviderKeysCache()
  } catch {
    // 监听器异常静默，不影响通道
  }
}

/** 惰性建立 quickforge-sync 监听；BroadcastChannel 不可用返回 null 静默降级。 */
function getSyncChannel(): UnrefableBroadcastChannel | null {
  if (syncChannel !== undefined) return syncChannel
  try {
    if (typeof BroadcastChannel === 'undefined') {
      syncChannel = null
      return null
    }
    const channel = new BroadcastChannel(SYNC_CHANNEL_NAME) as UnrefableBroadcastChannel
    channel.addEventListener('message', handleSyncMessage)
    try {
      channel.unref?.()
    } catch {
      // unref 失败不影响广播语义
    }
    syncChannel = channel
  } catch {
    syncChannel = null
  }
  return syncChannel
}

/** 读取缓存值：undefined=未缓存，null=已确认无 key。 */
export function getCachedProviderKey(provider: string): string | null | undefined {
  return providerKeysCache.get(provider)
}

/** 写入缓存值（含 null=确认无 key）；同时确保跨标签监听已建立。 */
export function rememberCachedProviderKey(provider: string, value: string | null): void {
  providerKeysCache.set(provider, value)
  getSyncChannel()
}

/** delete 写穿：把 provider 标记为已确认无 key。 */
export function forgetCachedProviderKey(provider: string): void {
  providerKeysCache.set(provider, null)
  getSyncChannel()
}

/**
 * 查缓存→并发去重→load→回填。同 provider 并发 miss 只发一次 load；
 * load 抛错不缓存（in-flight 表在 finally 清理，允许重试）。
 */
export async function resolveProviderKeyThroughCache(
  provider: string,
  load: () => Promise<string | null>,
): Promise<string | null> {
  const cached = providerKeysCache.get(provider)
  if (cached !== undefined) return cached
  const inFlight = providerKeysInFlight.get(provider)
  if (inFlight) return inFlight
  const pending = (async () => {
    try {
      const value = await load()
      rememberCachedProviderKey(provider, value)
      return value
    } finally {
      providerKeysInFlight.delete(provider)
    }
  })()
  providerKeysInFlight.set(provider, pending)
  return pending
}

/** 清空缓存（含 in-flight 表与同步通道）；备份导入/跨标签失效/整表 clear 用。 */
export function clearProviderKeysCache(): void {
  providerKeysCache.clear()
  providerKeysInFlight.clear()
  if (syncChannel) {
    try {
      syncChannel.close()
    } catch {
      // 关闭失败静默
    }
  }
  syncChannel = undefined
}

/** 广播 provider keys 变更；通道不可用/发送失败静默降级。 */
export function broadcastProviderKeysChanged(): void {
  try {
    getSyncChannel()?.postMessage({
      type: PROVIDER_KEYS_CHANGED_MESSAGE,
      sourceTabId: getCrossTabSyncSourceId(),
      timestamp: Date.now(),
    } satisfies ProviderKeysSyncMessage)
  } catch {
    // 广播失败不影响调用方语义
  }
}

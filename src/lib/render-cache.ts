/**
 * 内容寻址渲染缓存（进程内 LRU）。
 *
 * 用途：Markdown 预处理、代码高亮、KaTeX/ Mermaid 渲染的产物只取决于输入
 * 内容本身，与组件挂载生命周期无关。聊天面板切换会话时会整树 remount，
 * 组件级 `useMemo` 全部失效，历史消息因此被重复解析/重复着色。本模块把
 * 「同一段内容只计算一次」提升到模块级，跨 mount、跨会话复用。
 *
 * 正确性约束：
 * - 缓存 key 用 FNV-1a 摘要定位桶，**命中时再用原字符串严格比较**，因此
 *   摘要碰撞只会退化为 miss，绝不会返回另一段内容的渲染结果。
 * - 缓存值必须是只读产物。调用方不得原地修改返回值（本模块不做深拷贝，
 *   拷贝会把收益抹平）。
 * - 纯加速层：任何异常或超预算都静默跳过缓存，不影响渲染结果。
 */

/** FNV-1a 32 位摘要，用于把长内容压成短 key。 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/** 复合 key 的分隔符：不会出现在正常代码/文本片段中的控制字符。 */
const KEY_SEPARATOR = '\u0000'

type CacheEntry<T> = {
  /** 原始 key 片段，用于命中时的严格比较（消除摘要碰撞）。 */
  parts: string[]
  value: T
}

/**
 * 有界内容缓存。按插入顺序淘汰（Map 迭代序即 LRU 序：命中会先删除再插入）。
 */
export class ContentCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly maxEntries: number

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries))
  }

  get size(): number {
    return this.entries.size
  }

  /** 读取缓存；key 片段不完全一致时按 miss 处理。 */
  get(parts: string[]): T | undefined {
    const digest = parts.map(fnv1a).join(KEY_SEPARATOR)
    const entry = this.entries.get(digest)
    if (!entry) return undefined
    if (entry.parts.length !== parts.length) return undefined
    for (let i = 0; i < parts.length; i += 1) {
      if (entry.parts[i] !== parts[i]) return undefined
    }
    // 提升为最近使用：Map 的迭代序即淘汰序。
    this.entries.delete(digest)
    this.entries.set(digest, entry)
    return entry.value
  }

  set(parts: string[], value: T): void {
    const digest = parts.map(fnv1a).join(KEY_SEPARATOR)
    this.entries.delete(digest)
    this.entries.set(digest, { parts: [...parts], value })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

/**
 * 读取或计算并写入缓存。`compute` 抛错时不写入缓存，异常照常上抛——
 * 缓存只负责复用，不负责吞掉渲染错误。
 */
export function memoizeContent<T>(cache: ContentCache<T>, parts: string[], compute: () => T): T {
  const cached = cache.get(parts)
  if (cached !== undefined) return cached
  const value = compute()
  cache.set(parts, value)
  return value
}

/**
 * 读取或计算并写入缓存的 Promise 版本，用于异步产物（如 Mermaid SVG）。
 * 并发调用共享同一个 in-flight promise，避免同一张图被渲染多次。
 */
export function memoizeContentAsync<T>(
  cache: ContentCache<T>,
  inflight: Map<string, Promise<T>>,
  parts: string[],
  compute: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(parts)
  if (cached !== undefined) return Promise.resolve(cached)
  const digest = parts.map(fnv1a).join(KEY_SEPARATOR)
  const pending = inflight.get(digest)
  if (pending) return pending
  const promise = compute().then((value) => {
    cache.set(parts, value)
    return value
  }).finally(() => {
    inflight.delete(digest)
  })
  inflight.set(digest, promise)
  return promise
}

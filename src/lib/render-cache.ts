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

/** key 片段的估算字节数（UTF-16：每字符 2 字节）。 */
function entryBytes(parts: string[]): number {
  let bytes = 0
  for (const part of parts) bytes += part.length * 2
  return bytes
}

/** 严格相等的 key 片段（字符串按引用比较，通常 O(1)）。 */
function sameParts(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

/**
 * 有界内容缓存。按插入顺序淘汰（Map 迭代序即 LRU 序：命中会先删除再插入）。
 *
 * 两个上限同时生效：条目数（防小对象无限增长）与估算字节数（防「300 条」这种
 * 按条数计的预算被几条 200KB 的代码块吃光）。字节按 key 片段估算——缓存值
 * （React 元素树 / 高亮 segment）的体积与输入内容同阶，用输入长度做代理既便宜
 * 又不需要遍历产物。
 */
export class ContentCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly maxEntries: number
  private readonly maxBytes: number
  private bytes = 0
  /**
   * 单槽最近命中。
   *
   * 历史消息每次重渲染都会用**同一个字符串引用**再查一次缓存，而按摘要查表要
   * 对整段内容重算 FNV-1a（大代码块是 O(n)）。字符串引用相等时直接返回上次
   * 结果，把这条最常见路径降到 O(1)。
   */
  private lastParts: string[] | null = null
  private lastValue: T | undefined

  constructor(maxEntries: number, maxBytes = Number.POSITIVE_INFINITY) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries))
    this.maxBytes = maxBytes > 0 ? maxBytes : Number.POSITIVE_INFINITY
  }

  get size(): number {
    return this.entries.size
  }

  /** 读取缓存；key 片段不完全一致时按 miss 处理。 */
  get(parts: string[]): T | undefined {
    if (this.lastParts && sameParts(this.lastParts, parts)) return this.lastValue
    const digest = parts.map(fnv1a).join(KEY_SEPARATOR)
    const entry = this.entries.get(digest)
    if (!entry) return undefined
    if (!sameParts(entry.parts, parts)) return undefined
    // 提升为最近使用：Map 的迭代序即淘汰序。
    this.entries.delete(digest)
    this.entries.set(digest, entry)
    this.remember(entry.parts, entry.value)
    return entry.value
  }

  set(parts: string[], value: T): void {
    const digest = parts.map(fnv1a).join(KEY_SEPARATOR)
    const existing = this.entries.get(digest)
    if (existing) {
      this.bytes -= entryBytes(existing.parts)
      this.entries.delete(digest)
    }
    const entry: CacheEntry<T> = { parts: [...parts], value }
    this.entries.set(digest, entry)
    this.bytes += entryBytes(entry.parts)
    this.remember(entry.parts, value)
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      const evicted = this.entries.get(oldest.value)
      if (evicted) this.bytes -= entryBytes(evicted.parts)
      this.entries.delete(oldest.value)
      // 被淘汰的条目不能继续从单槽快路径命中（否则等于没淘汰）。
      if (evicted && this.lastParts && sameParts(this.lastParts, evicted.parts)) {
        this.lastParts = null
        this.lastValue = undefined
      }
    }
  }

  clear(): void {
    this.entries.clear()
    this.bytes = 0
    this.lastParts = null
    this.lastValue = undefined
  }

  private remember(parts: string[], value: T): void {
    this.lastParts = parts
    this.lastValue = value
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
  inflight: Map<string, { parts: string[]; promise: Promise<T> }>,
  parts: string[],
  compute: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(parts)
  if (cached !== undefined) return Promise.resolve(cached)
  const digest = parts.map(fnv1a).join(KEY_SEPARATOR)
  const pending = inflight.get(digest)
  // in-flight 去重也必须做严格比较：摘要碰撞时复用另一段内容的渲染结果
  // 就是「画错图」，而缓存本身的约束是「碰撞只能退化为 miss」。
  if (pending && sameParts(pending.parts, parts)) return pending.promise
  const entry = {
    parts: [...parts],
    promise: undefined as unknown as Promise<T>,
  }
  entry.promise = compute().then((value) => {
    cache.set(parts, value)
    return value
  }).finally(() => {
    if (inflight.get(digest) === entry) inflight.delete(digest)
  })
  inflight.set(digest, entry)
  return entry.promise
}

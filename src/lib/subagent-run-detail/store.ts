import { MAX_SUBAGENT_RUN_SNAPSHOTS, type SubagentRunListener, type SubagentRunPayload } from './types'

/**
 * 轻量实时 store：发布 payload、按 runId 获取最新快照、订阅更新、指纹去重。
 * 纯内存实现、不依赖 DOM/React，便于单元测试；不做轮询，事件到达即发布。
 * 订阅方抛错不会中断发布链或影响其他订阅者。
 */
export class SubagentRunStore {
  private readonly snapshots = new Map<string, SubagentRunPayload>()
  private readonly listeners = new Set<SubagentRunListener>()

  /** 发布最新快照；与现有快照指纹相同时去重返回 false。 */
  publish(payload: SubagentRunPayload): boolean {
    if (!payload.runId) return false
    const existing = this.snapshots.get(payload.runId)
    if (existing && existing.fingerprint === payload.fingerprint) return false
    if (!existing && this.snapshots.size >= MAX_SUBAGENT_RUN_SNAPSHOTS) {
      const oldestKey = this.snapshots.keys().next().value
      if (oldestKey !== undefined) this.snapshots.delete(oldestKey)
    }
    // 已存在 key 的重复发布不改变 Map 插入顺序：淘汰顺序按首次插入有界即可。
    this.snapshots.set(payload.runId, payload)
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(payload)
      } catch {
        // 订阅方异常不应破坏发布链，也不应阻止其他订阅者收到更新。
      }
    }
    return true
  }

  get(runId: string): SubagentRunPayload | undefined {
    return this.snapshots.get(runId)
  }

  /** 按首次插入顺序返回全部快照；供会话级指示器枚举嵌套运行（如 workflow agent）。 */
  list(): SubagentRunPayload[] {
    return Array.from(this.snapshots.values())
  }

  /** 订阅全部更新，返回取消订阅函数。 */
  subscribe(listener: SubagentRunListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 仅清空快照缓存；订阅者集合保持不变（订阅关系与数据生命周期分离）。 */
  clear(): void {
    this.snapshots.clear()
  }

  get size(): number {
    return this.snapshots.size
  }
}

/**
 * 全局单例：ServerAgent 的 SSE 事件路径与 tool-renderers/subagent-tool-renderer
 * 的聊天渲染回填路径共用，Workspace Inspector 订阅它实现实时更新。
 */
export const subagentRunStore = new SubagentRunStore()

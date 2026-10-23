/**
 * run_workflow 运行详情载荷与实时 store（不依赖 DOM/React/i18n 运行时，便于单测）。
 *
 * 与 subagent-run-detail 同构：
 * - 聊天里的工作流卡只渲染一行摘要，点击派发 `quickforge:open-workflow-run`；
 * - App 监听事件后经 `requestWorkspaceInspector({ kind: 'workflow' })` 打开右侧 Tab；
 * - Workspace Inspector 订阅本 store，按 `runId` 就地更新已打开的 Tab；
 * - 渲染器在聊天重渲染时也回填 store，历史会话首帧即可打开详情。
 *
 * 载荷只带视图模型与脚本原文（不含 React 元素），因此可安全跨 store / localStorage
 * 之外的边界传递，也便于断言。
 */

import type { WorkflowRunView } from '@/lib/workflow-run-detail'

/** 点击工作流摘要卡时派发的桥接事件 detail。 */
export type WorkflowRunOpenRequest = {
  runId: string
  payload?: WorkflowRunPayload
}

export const OPEN_WORKFLOW_RUN_EVENT = 'quickforge:open-workflow-run'

export type WorkflowRunPayload = {
  /** 服务端 `details.runId`；缺省时回退到工具调用 id，保证 Tab 去重稳定。 */
  runId: string
  /** 归一化后的运行视图（阶段 / Agent / 工具 / 日志 / 结果）。 */
  view: WorkflowRunView
  /** `params.script` 原文，供底部「脚本」抽屉展示；空表示不可用。 */
  script: string
  /** 聊天工具显示模式，用于「详情」抽屉门控。 */
  detailed: boolean
  /** 内容指纹，用于去重实时更新事件。 */
  fingerprint: string
}

type WorkflowRunListener = (payload: WorkflowRunPayload) => void

/** 实时快照上限：超过后按插入顺序淘汰最旧运行。 */
export const MAX_WORKFLOW_RUN_SNAPSHOTS = 50

/**
 * 指纹只取「会改变面板外观」的字段，避免每次 SSE 帧都因对象身份变化触发重渲染。
 * 日志只取条数与最后一条，足以反映新增；文本内容变化由条数变化覆盖（环形上限 200）。
 */
function workflowRunFingerprint(view: WorkflowRunView, script: string, detailed: boolean) {
  const lastLog = view.logs[view.logs.length - 1]
  return [
    view.runId,
    view.status,
    view.durationMs,
    view.agentCount,
    view.completedAgentCount,
    view.failedAgentCount,
    view.toolCount,
    view.failedToolCount,
    view.resultPreview.length,
    view.error.length,
    lastLog ? `${lastLog.at}:${lastLog.level}:${lastLog.message.length}` : '',
    view.agents.map((agent) => `${agent.id}:${agent.status}:${agent.durationMs}:${agent.toolCalls}`).join(','),
    view.tools.map((tool) => `${tool.id}:${tool.status}:${tool.durationMs}`).join(','),
    script.length,
    detailed ? 'd' : 'c',
  ].join('|')
}

export function buildWorkflowRunPayload(input: {
  runId: string
  view: WorkflowRunView
  script?: string
  detailed?: boolean
}): WorkflowRunPayload {
  const script = input.script ?? ''
  const detailed = input.detailed === true
  return {
    runId: input.runId || input.view.runId,
    view: input.view,
    script,
    detailed,
    fingerprint: workflowRunFingerprint(input.view, script, detailed),
  }
}

export class WorkflowRunStore {
  private readonly snapshots = new Map<string, WorkflowRunPayload>()
  private readonly listeners = new Set<WorkflowRunListener>()

  /** 发布最新快照；runId 为空或指纹相同则去重返回 false。 */
  publish(payload: WorkflowRunPayload): boolean {
    if (!payload.runId) return false
    const existing = this.snapshots.get(payload.runId)
    if (existing && existing.fingerprint === payload.fingerprint) return false
    if (!existing && this.snapshots.size >= MAX_WORKFLOW_RUN_SNAPSHOTS) {
      const oldestKey = this.snapshots.keys().next().value
      if (oldestKey !== undefined) this.snapshots.delete(oldestKey)
    }
    this.snapshots.set(payload.runId, payload)
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(payload)
      } catch {
        // 订阅方异常不应破坏发布链。
      }
    }
    return true
  }

  get(runId: string): WorkflowRunPayload | undefined {
    return this.snapshots.get(runId)
  }

  list(): WorkflowRunPayload[] {
    return Array.from(this.snapshots.values())
  }

  subscribe(listener: WorkflowRunListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  clear(): void {
    this.snapshots.clear()
  }

  get size(): number {
    return this.snapshots.size
  }
}

export const workflowRunStore = new WorkflowRunStore()

/**
 * 「哪个工作流运行详情 Tab 当前处于激活状态」的极小广播器。
 * 聊天里的摘要卡据此显示「已打开」，不需要把 Inspector 的 tab 状态提升为全局 store。
 */
class ActiveWorkflowRunStore {
  private runId: string | undefined
  private readonly listeners = new Set<() => void>()

  get(): string | undefined {
    return this.runId
  }

  set(runId: string | undefined): void {
    if (this.runId === runId) return
    this.runId = runId
    for (const listener of Array.from(this.listeners)) {
      try {
        listener()
      } catch {
        // 订阅方异常不应破坏广播链。
      }
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const activeWorkflowRunStore = new ActiveWorkflowRunStore()

/**
 * 是否应当用新载荷覆盖 store 里的既有快照。
 * 已进入终态的快照不被运行中帧回退（SSE 断连重放时会出现旧帧）。
 */
export function shouldPublishWorkflowRunPayload(next: WorkflowRunPayload | undefined, existing: WorkflowRunPayload | undefined) {
  if (!next) return false
  if (!existing) return true
  if (existing.fingerprint === next.fingerprint) return false
  const terminal = (status: WorkflowRunView['status']) => status !== 'running'
  return !(terminal(existing.view.status) && !terminal(next.view.status))
}

/** 校验并归一化事件 detail；非法输入返回 undefined。 */
export function normalizeOpenWorkflowRunRequest(detail: unknown): WorkflowRunOpenRequest | undefined {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined
  const value = detail as Partial<WorkflowRunOpenRequest>
  if (typeof value.runId !== 'string' || !value.runId) return undefined
  const payload = value.payload
  if (payload && typeof payload === 'object' && payload.view && typeof payload.view === 'object') {
    return { runId: value.runId, payload: payload as WorkflowRunPayload }
  }
  return { runId: value.runId }
}

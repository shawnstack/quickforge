import { sendJson, decodeSegment } from '../utils/response.mjs'
import { getSessionState } from '../agent-manager.mjs'
import { readSessionStateTail } from '../session-state-service.mjs'
import { normalizeAccessMode, yoloModeFromAccessMode } from '../agent-access-mode.mjs'
import { logger } from '../utils/logger.mjs'

/**
 * 只读视图默认返回的尾部消息条数。
 *
 * 实测（本机 1179 条消息的会话）：全量视图单次响应 4.6MB / 57ms，而完整
 * restore 链路（restore 78KB + messages 4.5MB）共 151ms。也就是说全量视图省掉
 * 了一次串行往返，但字节数没降——大会话的瓶颈从「服务端重建运行时」变成了
 * 「单次响应过大 + 前端主线程解析」。
 *
 * 界面打开时本就贴底显示，尾部窗口足够首屏；`messagesSummary.count` 告知总数，
 * 需要更早历史时由现有 `/messages` 通道增量补齐。200 条约覆盖数个到十几个回合，
 * 与 `windowed-messages` 的窗口粒度同一量级。
 */
const DEFAULT_VIEW_TAIL_MESSAGES = 200

/**
 * 只读会话视图通道（`GET /api/sessions/:sessionId/view`）。
 *
 * 存在理由：`GET /api/agents/:id/state`、`/messages`、`POST /restore` 三条
 * 现有读路径在会话不在内存时都会 fallback 到 `restoreAgent`，而 `restoreAgent`
 * 走 `createAgent` 全套——重建 system prompt、扫描 skills、构建工具集、解析
 * 模型、连接 MCP。**只想显示一段历史消息，却要重建一个 Agent 运行时。**
 *
 * 本端点只做存储读取：内存命中原样返回，未命中直接读持久化状态，绝不调用
 * `restoreAgent`。响应形状与 `getSessionState` 对齐，让前端可以复用同一套
 * 解析与渲染逻辑，把「运行时 attach」留到后台单独完成。
 *
 * 边界（刻意不做的事）：
 * - 不返回 `tools`：存储里没有工具定义，而工具卡的图标/label/摘要来自静态
 *   渲染器注册表（按 `toolCall.name` 查），不依赖 `state.tools`；缺失的只是
 *   MCP 卡片的应用期动态注册，运行时 attach 后由现有面板 effect 补齐。
 * - 不返回 `pendingToolApproval` / `pendingAsk` / `pendingAutoCompactApproval`：
 *   这些是进程内状态，历史会话本就没有；一旦 attach 由 `GET /state` 提供。
 * - 不改任何现有端点：`/state`、`/messages`、`/restore` 行为完全不变。
 */

/**
 * 把持久化状态归一为与 `getSessionState` 同形的只读视图。
 * 只补齐渲染必需的字段，其余保持 `undefined` 而不是编造默认值。
 *
 * 注意 `readSessionStateValue` 返回的是 body_json（不含 `sessionId`——
 * `sessionId` 在记录主键上），所以这里显式回填。
 *
 * `messages` 是图窗口而不是全量：`totalMessageCount` 存在时同时下发
 * `messagesSummary`（与 split 会话的线上帧契约一致），前端据此知道后面还有多少，
 * 需要时再走 `/messages` 增量补齐。
 */
function readonlySessionView(sessionId, state, messages, totalMessageCount) {
  // Persisted bodies carry `accessMode` and/or legacy `yoloMode`; the live
  // session state always exposes both, so normalize here instead of letting the
  // renderer guess.
  const accessMode = normalizeAccessMode(state.accessMode, state.yoloMode ? 'full-access' : undefined)
  return {
    sessionId,
    scope: state.scope,
    // `null` (not `undefined`) so the field survives JSON serialization and the
    // response shape stays identical to `getSessionState`.
    projectId: state.projectId ?? null,
    source: state.source || null,
    accessMode,
    yoloMode: yoloModeFromAccessMode(accessMode),
    // 系统提示词不参与历史渲染，且体量大；只读视图不回传。
    systemPrompt: '',
    model: state.model ?? null,
    modelRef: state.modelRef || null,
    thinkingLevel: state.thinkingLevel ?? 'off',
    title: state.title ?? 'New chat',
    titleSource: state.titleSource ?? null,
    createdAt: state.createdAt ?? null,
    lastModified: state.lastModified ?? null,
    stateVersion: typeof state.stateVersion === 'number' ? state.stateVersion : 0,
    status: state.taskStatus ?? null,
    startedAt: state.taskStartedAt ?? null,
    finishedAt: state.taskFinishedAt ?? null,
    // 存储层不持有工具定义；工具卡渲染不依赖它（见文件头说明）。
    tools: [],
    messages,
    // Present only when the window is truncated, so the client can tell
    // "this is the whole conversation" from "there are older messages".
    messagesSummary: typeof totalMessageCount === 'number' ? { count: totalMessageCount } : undefined,
    pendingToolCalls: [],
    backgroundCommands: [],
    contextCompaction: state.contextCompaction ?? null,
    contextUsage: null,
    isStreaming: false,
    errorMessage: null,
    goal: state.goal ?? null,
    // 标记这是只读视图（未 attach 运行时），供前端与调试区分。
    readonly: true,
  }
}

export async function handleSessionViewApi(req, res, url) {
  if (req.method !== 'GET') {
    const error = new Error('Method not allowed')
    error.statusCode = 405
    throw error
  }

  const parts = url.pathname.split('/').filter(Boolean)
  // `filter(Boolean)` drops empty segments, so `/api/sessions//view` arrives as
  // ['api','sessions','view'] and `/api/sessions/abc` has no action at all.
  // A missing session id is therefore structurally unreachable here; the
  // remaining guards are about the suffix.
  const sessionId = decodeSegment(parts[2])
  const action = parts[3]

  if (action !== 'view') {
    const error = new Error('Not found')
    error.statusCode = 404
    throw error
  }
  if (!sessionId) {
    const error = new Error('Missing session ID')
    error.statusCode = 400
    throw error
  }

  // Memory hit: the live session is authoritative and already carries runtime
  // fields (pending approvals, streaming, tools) that the storage layer does not
  // have. But it also carries the FULL message list, so returning it wholesale
  // defeats the point of this endpoint — a 1200-message session serializes ~9MB
  // and the client renders every row before the first paint. Apply the same tail
  // window here so warm and cold sessions behave identically; the client fills
  // the rest through the existing `/messages` channel.
  const active = getSessionState(sessionId)
  if (active) {
    const totalMessages = Array.isArray(active.messages) ? active.messages.length : 0
    const tailParam = Number(new URLSearchParams(url.search).get('tail'))
    const tailCount = Number.isInteger(tailParam) && tailParam >= 1 ? tailParam : DEFAULT_VIEW_TAIL_MESSAGES
    const windowed = totalMessages > tailCount
    const view = windowed
      ? {
          ...active,
          messages: active.messages.slice(totalMessages - tailCount),
          messagesSummary: { count: totalMessages },
          readonly: true,
        }
      : { ...active, readonly: true }
    sendJson(res, 200, view)
    return
  }

  const startedAt = performance.now()
  // Tail window, not the full transcript: a long session's complete message list
  // is several MB in one response, which the client then parses on the main
  // thread. The surface opens at the tail, so the last N messages are enough for
  // the first screen; `messagesSummary` tells the client how many exist in total
  // and the existing `/messages` channel fills the rest on demand.
  const tailParam = Number(new URLSearchParams(url.search).get('tail'))
  const tailMessages = Number.isInteger(tailParam) && tailParam >= 1 ? tailParam : DEFAULT_VIEW_TAIL_MESSAGES
  let stored
  try {
    stored = await readSessionStateTail(sessionId, tailMessages)
  } catch (error) {
    logger.error(`Failed to read session view ${sessionId}:`, error)
    const wrapped = new Error('Failed to read session view')
    wrapped.statusCode = 500
    wrapped.errorCode = 'SESSION_VIEW_FAILED'
    throw wrapped
  }

  if (!stored) {
    const error = new Error('Session not found')
    error.statusCode = 404
    throw error
  }

  const view = readonlySessionView(sessionId, stored.state, stored.messages, stored.total)
  logger.debug(`Read session view ${sessionId} from storage`, {
    sessionId,
    messageCount: view.messages.length,
    totalMessageCount: stored.total,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  })
  sendJson(res, 200, view)
}

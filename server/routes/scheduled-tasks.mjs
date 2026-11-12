import { readJsonBody, sendJson, decodeSegment } from '../utils/response.mjs'
import { logger } from '../utils/logger.mjs'
import { resolveModelBinding } from '../model-catalog.mjs'
import { assertScheduledRunsAvailable } from '../scheduled-runs-maintenance.mjs'
import { parseScheduledTaskInstructionWithAi } from '../scheduled-task-instruction-parser.mjs'
import { executeTask, hasActiveTaskRuns } from '../scheduled-task-executor.mjs'
import {
  MAX_RUN_HISTORY_PER_TASK,
  calculateNextRun,
  createId,
  createTaskRecord,
  executionModeFor,
  getTask,
  getTaskRuns,
  getTasks,
  hydrateTaskRuns,
  hydrateTasksRuns,
  normalizeTaskInput,
  persistRun,
  removeTaskRecord,
  requestError,
  scheduleRuleFor,
  taskRunsService,
  updateTask,
} from '../scheduled-task-store.mjs'

// 定时任务 HTTP 路由（薄路由层）。领域逻辑自本文件拆出（god-module-decomposition ①）：
// - scheduled-task-store.mjs — 任务记录领域规则与存取、运行历史装配
// - scheduled-task-executor.mjs — executeTask 会话编排与进程内活跃 run 追踪
// - scheduled-task-runner.mjs — 常驻调度守护循环（start/stop/recover，由 server/index.mjs 使用）
// - scheduled-task-instruction-parser.mjs — 自然语言转任务 JSON 的 LLM 解析
// 对外 HTTP 行为与 API 契约不变。

// 只有 `agent` 是特殊值：标记这条任务是 AI 给自己排的班（标题 `[自约]` 开头），
// 因而允许 AI 用 DELETE 自己收掉。存量任务没有这个字段，一律按 `user` 处理——
// 也就是说「没写」= 「用户建的」= 「AI 不许删」，默认值站在保守那一边。
function normalizeCreatedBy(value) {
  return String(value ?? '').trim().toLowerCase() === 'agent' ? 'agent' : 'user'
}

export async function handleScheduledTasksApi(req, res, url, context = {}) {
  const parts = url.pathname.split('/').filter(Boolean)
  assertScheduledRunsAvailable()

  if (req.method === 'POST' && url.pathname === '/api/scheduled-tasks/parse') {
    const body = await readJsonBody(req)
    sendJson(res, 200, await parseScheduledTaskInstructionWithAi(body?.instruction, body?.modelRef ? body : body?.model, body?.thinkingLevel, context))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/scheduled-tasks') {
    sendJson(res, 200, { tasks: await hydrateTasksRuns(await getTasks()) })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/scheduled-tasks/runs') {
    sendJson(res, 200, await getTaskRuns(url))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/scheduled-tasks') {
    const body = await readJsonBody(req)
    const parsed = body?.task
    if (!parsed) throw requestError('Missing task')
    const now = new Date().toISOString()
    const normalized = normalizeTaskInput(parsed)
    const enabled = parsed.enabled !== false && parsed.status !== 'paused'
    const binding = await resolveModelBinding(body, { context, legacySnapshot: body?.model })
    const task = {
      id: createId(),
      ...normalized,
      scheduleRule: normalized.scheduleRule || scheduleRuleFor(normalized),
      executionMode: normalized.executionMode || 'serial',
      model: binding.model,
      modelRef: binding.modelRef,
      thinkingLevel: body?.thinkingLevel || (body?.model?.reasoning ? 'high' : 'off'),
      projectId: body?.projectId || null,
      projectName: body?.projectName || null,
      createdBy: normalizeCreatedBy(body?.createdBy),
      status: enabled ? 'enabled' : 'paused',
      createdAt: now,
      updatedAt: now,
    }
    await createTaskRecord(task)
    sendJson(res, 200, { task: await hydrateTaskRuns(task) })
    return
  }

  if (parts[0] === 'api' && parts[1] === 'scheduled-tasks' && parts[2]) {
    const taskId = decodeSegment(parts[2])
    const action = parts[3]

    if ((req.method === 'PUT' || req.method === 'PATCH') && !action) {
      const body = await readJsonBody(req)
      const existing = await getTask(taskId)
      if (!existing) throw requestError('Task not found', 404)
      if (existing.currentRunId) throw requestError('Cannot edit a running task', 409)
      const parsed = body?.task
      if (!parsed) throw requestError('Missing task')
      const normalized = normalizeTaskInput(parsed, existing)
      const binding = body?.modelRef || body?.model
        ? await resolveModelBinding(body, {
            context,
            currentModel: existing.model,
            allowCurrentHidden: true,
            legacySnapshot: body?.model,
          })
        : null
      const now = new Date().toISOString()
      const hasProject = Object.prototype.hasOwnProperty.call(body, 'projectId')
      const task = await updateTask(taskId, (current) => ({
        ...current,
        ...normalized,
        scheduleRule: normalized.scheduleRule || scheduleRuleFor(normalized),
        executionMode: normalized.executionMode || 'serial',
        model: binding?.model ?? current.model,
        modelRef: binding?.modelRef ?? current.modelRef,
        thinkingLevel: body?.thinkingLevel ?? current.thinkingLevel,
        projectId: hasProject ? (body.projectId || null) : current.projectId,
        projectName: hasProject ? (body.projectName || null) : current.projectName,
        status: parsed.enabled === false || parsed.status === 'paused' ? 'paused' : 'enabled',
        updatedAt: now,
      }))
      sendJson(res, 200, { task: await hydrateTaskRuns(task) })
      return
    }

    if (req.method === 'DELETE' && !action) {
      const existingForDelete = await getTask(taskId)
      // 界面删除不带 selfScheduledOnly，保持原有行为——用户永远能删自己排的日程。
      // agent 走脚本删除时会带这个参数，服务端据此只放行它自己 --self-scheduled 建的班。
      // 删除不可逆（会连带删运行历史），所以这条边界能由服务端判定的时候就别只靠文档自觉。
      const selfScheduledOnly = url.searchParams.get('selfScheduledOnly') === '1'
      if (selfScheduledOnly && existingForDelete && existingForDelete.createdBy !== 'agent') {
        throw requestError('Only self-scheduled tasks can be deleted', 403)
      }
      const before = existingForDelete ? await hydrateTaskRuns(existingForDelete, MAX_RUN_HISTORY_PER_TASK) : null
      await taskRunsService.deleteTaskRuns(taskId)
      try {
        await removeTaskRecord(taskId)
      } catch (error) {
        // Runs are deleted first, so a failed metadata delete must restore them.
        if (before) {
          const restoredRuns = Array.isArray(before.runs) ? before.runs : []
          for (const run of restoredRuns) await persistRun(taskId, run, 'delete-compensation')
        }
        throw error
      }
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && action === 'pause') {
      const current = await getTask(taskId)
      if (!current) throw requestError('Task not found', 404)
      const task = await updateTask(taskId, (latest) => ({ ...latest, status: 'paused', updatedAt: new Date().toISOString() }))
      sendJson(res, 200, { task: await hydrateTaskRuns(task) })
      return
    }

    if (req.method === 'POST' && action === 'resume') {
      const task = await updateTask(taskId, (current) => ({
        ...current,
        status: 'enabled',
        nextRunAt: current.nextRunAt && new Date(current.nextRunAt).getTime() > Date.now()
          ? current.nextRunAt
          : (calculateNextRun(current) ?? current.nextRunAt),
        updatedAt: new Date().toISOString(),
      }))
      if (!task) throw requestError('Task not found', 404)
      sendJson(res, 200, { task: await hydrateTaskRuns(task) })
      return
    }

    if (req.method === 'POST' && action === 'run') {
      const task = await getTask(taskId)
      if (!task) throw requestError('Task not found', 404)
      if (executionModeFor(task) === 'serial' && hasActiveTaskRuns(task)) throw requestError('Task is already running', 409)
      await new Promise((resolve, reject) => {
        executeTask(task, 'manual', resolve).catch((error) => {
          logger.error(`Manual scheduled task ${task.id} failed:`, error)
          reject(error)
        })
      })
      const updatedTask = (await getTask(taskId)) ?? task
      sendJson(res, 200, { ok: true, task: await hydrateTaskRuns(updatedTask) })
      return
    }
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

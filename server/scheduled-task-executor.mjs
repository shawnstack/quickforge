import { readStore } from './storage.mjs'
import { createAgent, getSessionEventBus, agentEvents, runPrompt, abortRun } from './agent-manager.mjs'
import { agentProfileSnapshot, getAgentProfile } from './agent-profiles.mjs'
import { parseInternalCommandInvocation } from './custom-commands.mjs'
import { sessionGoal, waitForGoalCompletion } from './goal/engine.mjs'
import { agentSessions } from './agent-session-store.mjs'
import { projectContextFromId, readProjectConfig } from './project-config.mjs'
import { logger } from './utils/logger.mjs'
import { resolveModelBinding } from './model-catalog.mjs'
import {
  appendCurrentRunId,
  calculateNextRun,
  createId,
  currentRunIdsFor,
  executionModeFor,
  getTask,
  isRecurringTask,
  persistRun,
  removeCurrentRunId,
  requestError,
  taskRunsService,
  updateTask,
} from './scheduled-task-store.mjs'

// 定时任务执行编排（从 routes/scheduled-tasks.mjs 拆出，god-module-decomposition ①）：
// executeTask 负责建 run 记录、解析模型/Agent Profile/项目绑定、创建 Agent 会话、
// 驱动 runPrompt、处理超时中止与终态落库，并通过 agentEvents 发 started/finished 通知。
// 进程内活跃 run 追踪（runningTaskRunIds）也在这里：executeTask 是唯一写入方，
// 路由（手动 run 的串行 409）与调度循环（tick 跳过、维护暂停 409）通过导出的
// 读取函数共享同一份状态。

const runningTaskRunIds = new Map()

function activeRunIdsFor(task) {
  const runningIds = [...(runningTaskRunIds.get(task?.id) || [])]
  return [...new Set([...runningIds, ...currentRunIdsFor(task)])]
}

export function hasActiveTaskRuns(task) {
  return activeRunIdsFor(task).length > 0
}

export function hasInFlightRuns() {
  return runningTaskRunIds.size > 0
}

function addActiveRun(taskId, runId) {
  const ids = runningTaskRunIds.get(taskId) || new Set()
  ids.add(runId)
  runningTaskRunIds.set(taskId, ids)
}

function removeActiveRun(taskId, runId) {
  const ids = runningTaskRunIds.get(taskId)
  if (!ids) return
  ids.delete(runId)
  if (ids.size === 0) runningTaskRunIds.delete(taskId)
}

function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
}

function latestAssistantText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      return contentToText(messages[index].content).trim()
    }
  }
  return ''
}

function truncateText(text, limit = 500) {
  const value = String(text || '').trim()
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}…`
}

function emitScheduledTaskNotification({ task, runId, sessionId, status, result, errorMessage }) {
  const ok = status === 'success'
  const message = ok ? truncateText(result || 'AI 已返回结果。', 500) : truncateText(errorMessage || '任务执行失败。', 500)
  agentEvents.emit('agent_event', {
    type: 'scheduled_task_notification',
    sessionId,
    taskId: task.id,
    runId,
    title: ok ? `定时任务「${task.title}」已完成` : `定时任务「${task.title}」执行失败`,
    status: ok ? 'idle' : 'error',
    taskStatus: status,
    message,
    result: ok ? result : undefined,
    errorMessage: ok ? undefined : errorMessage,
  })
}

async function resolveExecutionProject(task) {
  if (!task.projectId) return null
  const config = await readProjectConfig()
  const selectedProject = config.projects.find((project) => project.id === task.projectId)
  if (!selectedProject) throw requestError(`绑定项目不存在或已被删除：${task.projectName || task.projectId}`, 409)

  await projectContextFromId(selectedProject.id)
  return selectedProject
}

export async function executeTask(task, trigger = 'schedule', onStarted) {
  const mode = executionModeFor(task)
  const advanceNextRunAtAtStart = trigger === 'schedule' && mode === 'parallel'
  if (mode === 'serial' && hasActiveTaskRuns(task)) return
  const runId = createId()
  addActiveRun(task.id, runId)
  const startedAt = new Date().toISOString()
  const scheduledAt = task.nextRunAt
  let sessionId = `scheduled-${task.id}-${Date.now().toString(36)}`
  let executionAgent = null
  let agentWarning = null
  let agentSnapshot = null

  const createdRun = {
    id: runId,
    status: 'running',
    trigger,
    inputContent: task.instruction,
    sessionId,
    agentId: executionAgent?.id || task.agentId || null,
    agentLabel: executionAgent?.label || null,
    agentSnapshot,
    warning: agentWarning || undefined,
    scheduledAt,
    startedAt,
  }
  let currentRun = createdRun
  let started = false
  await persistRun(task.id, createdRun, 'created')
  try {
    await updateTask(task.id, (current) => {
      const otherRunIds = activeRunIdsFor(current).filter((id) => id !== runId)
      if (mode === 'serial' && otherRunIds.length > 0) return current
      started = true
      const nextRunAt = advanceNextRunAtAtStart
        ? calculateNextRun(current, new Date(startedAt))
        : current.nextRunAt
      const activeRunIds = appendCurrentRunId(current, runId)
      return {
        ...current,
        currentRunId: activeRunIds[activeRunIds.length - 1] || null,
        currentRunIds: activeRunIds,
        lastSessionId: sessionId,
        nextRunAt,
      }
    })
  } catch (error) {
    try {
      await taskRunsService.deleteRun(task.id, runId)
    } catch (compensationError) {
      throw new Error(`Scheduled run create metadata failed and SQLite compensation failed: ${compensationError?.message || compensationError}`, { cause: compensationError })
    } finally {
      removeActiveRun(task.id, runId)
    }
    throw error
  }
  if (!started) {
    await taskRunsService.deleteRun(task.id, runId)
    removeActiveRun(task.id, runId)
    return
  }

  let settled = false

  try {
    const executionProject = await resolveExecutionProject(task)
    const binding = task.modelRef || task.model
      ? await resolveModelBinding(
          task.modelRef ? { modelRef: task.modelRef } : { model: task.model },
          {
            context: { source: 'scheduled' },
            currentModel: task.model,
            allowCurrentHidden: true,
            forExecution: true,
            legacySnapshot: task.model,
          },
        )
      : null
    if (task.agentId) {
      executionAgent = await getAgentProfile(task.agentId, { projectId: executionProject?.id || null, workspaceRoot: executionProject?.path })
      if (!executionAgent) agentWarning = `Configured agent not found: ${task.agentId}`
    }
    agentSnapshot = executionAgent ? agentProfileSnapshot(executionAgent) : null
    const settings = await readStore('settings')
    const yoloMode = settings?.['yolo-mode'] === true || settings?.['yolo-mode'] === 'true'

    const session = await createAgent(sessionId, {
      scope: executionProject ? 'project' : 'global',
      projectId: executionProject?.id || null,
      yoloMode,
      model: binding?.model || task.model,
      modelRef: binding?.modelRef || task.modelRef || null,
      modelAccessContext: { source: 'scheduled' },
      thinkingLevel: task.thinkingLevel,
      title: `[定时任务] ${task.title}`,
      agentProfile: executionAgent,
    })

    const userMessage = {
      role: 'user',
      content: [{ type: 'text', text: task.instruction }],
      timestamp: Date.now(),
    }
    session.status = 'running'
    session.startedAt = startedAt
    session.finishedAt = null
    agentEvents.emit('agent_event', {
      sessionId,
      type: 'scheduled_task_started',
      taskId: task.id,
      runId,
      title: `[定时任务] ${task.title}`,
      scope: session.scope,
      projectId: session.projectId,
      createdAt: session.createdAt,
      message: truncateText(task.instruction, 500),
    })

    currentRun = {
      ...currentRun,
      sessionId,
      agentId: executionAgent?.id || task.agentId || null,
      agentLabel: executionAgent?.label || null,
      agentSnapshot,
      warning: agentWarning || currentRun.warning,
    }
    await updateTask(task.id, (current) => ({
      ...current,
      lastSessionId: sessionId,
    }))
    await persistRun(task.id, currentRun, 'resolved')
    onStarted?.({ taskId: task.id, runId, sessionId })

    const goalRequested = parseInternalCommandInvocation(userMessage)?.type === 'goal'
    const eventBus = getSessionEventBus(sessionId)
    const runtimeLimitMs = Math.max(1000, Math.min(Number(executionAgent?.maxRuntimeMs || 60 * 60 * 1000), 60 * 60 * 1000))
    let timeout = null
    let handler = null
    let timedOut = false
    let resolveFinished
    const finished = new Promise((resolve) => {
      resolveFinished = resolve
      handler = (event) => {
        if (goalRequested || event.type !== 'agent_end') return
        const errorMessage = event.errorMessage || session.agent.state.errorMessage
        const aborted = session.status === 'aborted' || session.agent.state.messages.some((message) => message?.role === 'assistant' && message?.stopReason === 'aborted')
        resolve({
          ok: !errorMessage && !aborted,
          aborted,
          error: aborted ? '已暂停执行' : errorMessage,
          messages: event.messages ?? session.agent.state.messages,
        })
      }
      if (!goalRequested) eventBus?.on('agent_event', handler)
    })

    const runPromise = (async () => {
      try {
        await runPrompt(sessionId, userMessage, [], null, null, { source: 'scheduled' })
      } catch (promptError) {
        if (promptError?.message !== 'Request was aborted' && promptError?.message !== 'Scheduled task aborted') {
          throw promptError
        }
      }
      if (goalRequested) {
        // runPrompt returns after admission, not after its first model turn. Use
        // the current session: command admission/storage sync owns its goal.
        const goal = sessionGoal(agentSessions.get(sessionId))
        if (!goal) throw new Error('定时任务未能创建 Goal，请查看关联会话中的提示。')
        const completion = await waitForGoalCompletion(sessionId, goal.id)
        return {
          ok: completion.goal.status === 'completed',
          aborted: completion.goal.status === 'cancelled',
          error: completion.goal.status === 'completed' ? undefined : (completion.goal.blocker || `Goal ${completion.goal.status}`),
          messages: completion.messages,
        }
      }
      return finished
    })()
    const timeoutPromise = new Promise((resolve) => {
      // Goals retain their own iteration/safety budgets and per-tool timeouts,
      // not the ordinary scheduled task/Profile total wall-clock limit.
      if (!goalRequested) timeout = setTimeout(() => resolve({ timedOut: true }), runtimeLimitMs)
    })

    let result
    try {
      const outcome = await Promise.race([
        runPromise.then((value) => ({ result: value })),
        timeoutPromise,
      ])
      if (outcome.timedOut) {
        timedOut = true
        const abortPromise = Promise.resolve()
          .then(() => abortRun(sessionId))
          .catch((error) => {
            logger.warn(`Failed to abort timed out scheduled task ${task.id}:`, error)
          })
        await Promise.race([
          abortPromise,
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ])
        await Promise.race([
          runPromise.catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ])
        result = { ok: false, aborted: true, error: '执行超时', messages: session.agent.state.messages }
      } else {
        result = outcome.result
      }
    } finally {
      clearTimeout(timeout)
      eventBus?.removeListener('agent_event', handler)
      if (timedOut) resolveFinished?.({ ok: false, aborted: true, error: '执行超时', messages: session.agent.state.messages })
    }
    settled = true
    const finishedAt = new Date().toISOString()
    const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    const aiResult = result.ok ? latestAssistantText(result.messages) : ''
    const latestTask = (await getTask(task.id)) ?? task
    removeActiveRun(task.id, runId)

    const terminalRun = {
      ...currentRun,
      status: result.aborted ? 'failed' : (result.ok ? 'success' : 'failed'),
      inputContent: currentRun.inputContent ?? latestTask.instruction,
      aiResult: result.ok ? aiResult : undefined,
      result: result.ok ? (aiResult || `已完成，结果保存在会话 ${sessionId}`) : undefined,
      errorMessage: result.error,
      sessionId,
      agentId: executionAgent?.id || latestTask.agentId || null,
      agentLabel: executionAgent?.label || null,
      agentSnapshot,
      warning: agentWarning || currentRun.warning,
      finishedAt,
      durationMs,
    }
    await persistRun(task.id, terminalRun, 'terminal')
    let terminalMetadataError = null
    try {
      await updateTask(task.id, (current) => {
        const remainingRunIds = removeCurrentRunId(current, runId)
        const stillRunning = remainingRunIds.length > 0
        const recurring = isRecurringTask(current)
        const nextRunAt = stillRunning ? current.nextRunAt : (advanceNextRunAtAtStart ? current.nextRunAt : calculateNextRun(current, new Date(finishedAt)))
        const nextStatus = stillRunning
          ? current.status
          : current.status === 'paused'
            ? 'paused'
            : result.aborted
              ? (recurring && nextRunAt ? 'paused' : 'failed')
              : result.ok
                ? (nextRunAt ? 'enabled' : 'completed')
                : (recurring && nextRunAt ? 'enabled' : 'failed')
        return {
          ...current,
          status: nextStatus,
          currentRunId: stillRunning ? remainingRunIds[remainingRunIds.length - 1] : null,
          currentRunIds: remainingRunIds,
          lastRunAt: finishedAt,
          nextRunAt: nextRunAt ?? current.nextRunAt,
          lastSessionId: sessionId,
        }
      })
    } catch (error) {
      // The terminal run row is already committed, so a metadata failure must
      // not turn a finished run into an execution failure.
      terminalMetadataError = error
      logger.warn('Scheduled task terminal metadata persistence failed', { taskId: task.id, runId, errorName: error?.name || 'Error' })
    }
    if (terminalMetadataError) settled = true

    emitScheduledTaskNotification({
      task: latestTask,
      runId,
      sessionId,
      status: result.aborted ? 'failed' : (result.ok ? 'success' : 'failed'),
      result: aiResult,
      errorMessage: result.error,
    })
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    removeActiveRun(task.id, runId)
    const failureMessage = error?.message || String(error)
    const failedRun = {
      ...currentRun,
      status: 'failed',
      errorMessage: failureMessage,
      sessionId,
      agentId: executionAgent?.id || task.agentId || null,
      agentLabel: executionAgent?.label || null,
      agentSnapshot,
      warning: agentWarning || currentRun.warning,
      finishedAt,
      durationMs,
    }
    let persistenceError = null
    try {
      await persistRun(task.id, failedRun, 'exception-terminal')
    } catch (terminalError) {
      persistenceError = terminalError
    }
    if (persistenceError) {
      logger.error('Scheduled task terminal SQLite persistence failed', { taskId: task.id, runId, errorName: persistenceError?.name || 'Error' })
      return
    }
    await updateTask(task.id, (current) => {
      const remainingRunIds = removeCurrentRunId(current, runId)
      const stillRunning = remainingRunIds.length > 0
      return {
        ...current,
        status: stillRunning ? current.status : (current.status === 'paused' ? 'paused' : (isRecurringTask(current) ? 'enabled' : 'failed')),
        currentRunId: stillRunning ? remainingRunIds[remainingRunIds.length - 1] : null,
        currentRunIds: remainingRunIds,
        lastRunAt: finishedAt,
        lastSessionId: sessionId,
        nextRunAt: stillRunning || advanceNextRunAtAtStart ? current.nextRunAt : (isRecurringTask(current) ? (calculateNextRun(current, new Date(finishedAt)) ?? current.nextRunAt) : current.nextRunAt),
      }
    })
    emitScheduledTaskNotification({
      task,
      runId,
      sessionId,
      status: 'failed',
      result: '',
      errorMessage: error?.message || String(error),
    })
  } finally {
    if (!settled) logger.warn(`Scheduled task ${task.id} finished without normal agent_end`)
  }
}

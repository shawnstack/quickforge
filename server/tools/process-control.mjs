/**
 * Child-process control shared by the tool modules.
 *
 * killProcessTree terminates a spawned process tree (Windows taskkill /T /F,
 * process-group signaling elsewhere). It is used by both file-search (the
 * ripgrep child) and run-command (user commands).
 *
 * The two registries track per-toolCallId stop callbacks for running
 * commands and bounded records for background tasks, so agent-manager can
 * abort a running command and stop a session's background tasks on teardown.
 */
import { spawn } from 'node:child_process'

export function killProcessTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => {
      try { child.kill(signal) } catch { /* ignore */ }
    })
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch {
    try { child.kill(signal) } catch { /* ignore */ }
  }
}

// --- running command registry (abort by toolCallId) ---
const runningCommands = new Map()

export function registerRunningCommand(toolCallId, stop) {
  if (!toolCallId) return
  runningCommands.set(toolCallId, stop)
}

export function unregisterRunningCommand(toolCallId) {
  if (!toolCallId) return
  runningCommands.delete(toolCallId)
}

export function abortRunningCommand(toolCallId) {
  if (!toolCallId) return false
  const stop = runningCommands.get(toolCallId)
  if (!stop) return false
  stop('abort')
  return true
}

// --- background task registry ---
const backgroundTasks = new Map()
const MAX_TRACKED_BACKGROUND_TASKS = 200

export function getBackgroundTaskRecord(taskId) {
  return backgroundTasks.get(taskId)
}

export function rememberBackgroundTask(record) {
  backgroundTasks.set(record.taskId, record)
  while (backgroundTasks.size > MAX_TRACKED_BACKGROUND_TASKS) {
    const oldest = backgroundTasks.keys().next().value
    if (oldest === undefined) break
    backgroundTasks.delete(oldest)
  }
}

function publicBackgroundCommandTask(task) {
  return {
    taskId: task.taskId,
    toolCallId: task.toolCallId,
    sessionId: task.sessionId,
    command: task.command,
    description: task.description,
    outputFile: task.outputFile,
    pid: task.pid,
    startedAt: task.startedAt,
    status: task.status,
  }
}

export function listBackgroundCommandTasks(sessionId) {
  const tasks = []
  for (const task of backgroundTasks.values()) {
    if (task.status !== 'running') continue
    if (sessionId && task.sessionId !== sessionId) continue
    tasks.push(publicBackgroundCommandTask(task))
  }
  return tasks
}

export function stopBackgroundCommandTasksForSession(sessionId) {
  if (!sessionId) return 0
  let stopped = 0
  for (const task of backgroundTasks.values()) {
    if (task.sessionId !== sessionId || task.status !== 'running') continue
    abortRunningCommand(task.toolCallId)
    stopped += 1
  }
  return stopped
}

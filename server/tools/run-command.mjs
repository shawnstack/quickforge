/**
 * run_command tool: shell command execution in the workspace directory.
 *
 * Streams stdout/stderr as bounded tail previews (200 lines / 10k chars
 * shared budget), persists full output to ~/.quickforge/logs/commands/,
 * supports timeouts and aborts, and can detach long-running commands into
 * background tasks (taskId + <task-notification> on exit). Process-tree
 * termination and the running/background registries live in
 * process-control.mjs; this module only formats, logs and runs.
 */
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { truncateText, getToolWorkspaceRoot } from '../utils/workspace.mjs'
import { logsDir } from '../storage.mjs'
import { buildChildProcessEnv } from '../runtime-info.mjs'
import { killProcessTree, registerRunningCommand, unregisterRunningCommand, getBackgroundTaskRecord, rememberBackgroundTask, listBackgroundCommandTasks } from './process-control.mjs'
import { clampNumber } from './params.mjs'

// --- run_command ---
const DEFAULT_RUN_COMMAND_TIMEOUT_MS = 60 * 60 * 1000
const MIN_RUN_COMMAND_TIMEOUT_MS = 1000
const MAX_RUN_COMMAND_TIMEOUT_MS = 60 * 60 * 1000
const COMMAND_PREVIEW_LINES = 200
const COMMAND_PREVIEW_TOTAL_CHARS = 10000

function formatDurationMs(durationMs = 0) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m ${seconds}s (${durationMs}ms)`
  return `${seconds}s (${durationMs}ms)`
}

function tailText(current, chunk, maxLines = COMMAND_PREVIEW_LINES, maxChars = COMMAND_PREVIEW_TOTAL_CHARS) {
  const lines = (current + chunk).split(/\r?\n/)
  const truncatedByLines = lines.length > maxLines
  const lineLimitedText = truncatedByLines ? lines.slice(lines.length - maxLines).join('\n') : lines.join('\n')
  const charLimitedText = tailChars(lineLimitedText, maxChars)
  return {
    text: charLimitedText.text,
    truncated: truncatedByLines || charLimitedText.truncated,
  }
}

function tailChars(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false }
  return { text: text.slice(text.length - maxChars), truncated: true }
}

function balanceCommandPreviews(stdout, stderr, maxChars = COMMAND_PREVIEW_TOTAL_CHARS) {
  if (stdout.length + stderr.length <= maxChars) {
    return { stdout, stderr, stdoutTruncated: false, stderrTruncated: false }
  }

  const half = Math.floor(maxChars / 2)
  let stdoutBudget = Math.min(stdout.length, half)
  let stderrBudget = Math.min(stderr.length, half)
  const remaining = maxChars - stdoutBudget - stderrBudget

  if (remaining > 0) {
    const stdoutNeed = Math.max(0, stdout.length - stdoutBudget)
    const stderrNeed = Math.max(0, stderr.length - stderrBudget)
    if (stderrNeed >= stdoutNeed) stderrBudget += Math.min(remaining, stderrNeed)
    else stdoutBudget += Math.min(remaining, stdoutNeed)
  }

  const nextStdout = tailChars(stdout, stdoutBudget)
  const nextStderr = tailChars(stderr, stderrBudget)
  return {
    stdout: nextStdout.text,
    stderr: nextStderr.text,
    stdoutTruncated: nextStdout.truncated,
    stderrTruncated: nextStderr.truncated,
  }
}

function tailLabel(name, truncated) {
  return truncated ? `${name} preview (last ${COMMAND_PREVIEW_LINES} lines, shared ${COMMAND_PREVIEW_TOTAL_CHARS} chars):` : `${name} preview:`
}

function commandStatus(meta = {}) {
  if (meta.background) return 'Status: running in background'
  if (meta.running) return 'Status: running'
  const flags = [
    meta.timedOut ? 'timed out' : null,
    meta.aborted ? 'aborted' : null,
  ].filter(Boolean)
  const suffix = flags.length ? ` (${flags.join(', ')})` : ''
  return `Exit code: ${meta.code ?? 'unknown'}${meta.signal ? `, signal: ${meta.signal}` : ''}${suffix}`
}

function formatCommandOutput(command, stdout, stderr, meta = {}) {
  const lines = [
    `Command: ${command}`,
  ]
  if (meta.description) lines.push(`Description: ${meta.description}`)
  lines.push(commandStatus(meta))
  if (typeof meta.durationMs === 'number') lines.push(`Duration: ${formatDurationMs(meta.durationMs)}`)
  if (typeof meta.timeoutMs === 'number') lines.push(`Timeout: ${formatDurationMs(meta.timeoutMs)}`)
  if (meta.cwd) lines.push(`CWD: ${meta.cwd}`)
  if (meta.outputFile) lines.push(`Full output: ${meta.outputFile}`)
  if (meta.background && meta.taskId) lines.push(`Background task: ${meta.taskId}`)
  if (meta.truncated) lines.push(`Output mode: showing stdout/stderr previews; each stream is limited to the last ${COMMAND_PREVIEW_LINES} lines and both streams share ${COMMAND_PREVIEW_TOTAL_CHARS} characters. Full output is saved to the log file.`)
  if (meta.logError) lines.push(`Log warning: ${meta.logError}`)
  lines.push('', tailLabel('STDOUT', meta.stdoutTruncated), stdout || '(empty)', '', tailLabel('STDERR', meta.stderrTruncated), stderr || '(empty)')
  return lines.join('\n')
}

function safeLogFilePart(value, fallback) {
  const text = String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80)
  return text || fallback
}

async function createCommandLogStream(command, { cwd, description, toolCallId } = {}) {
  const dir = path.join(logsDir, 'commands')
  await fs.mkdir(dir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `${timestamp}_${safeLogFilePart(toolCallId, 'command')}.log`
  const outputFile = path.join(dir, fileName)
  const stream = createWriteStream(outputFile, { flags: 'wx' })
  stream.write([
    `Command: ${command}`,
    description ? `Description: ${description}` : null,
    `CWD: ${cwd}`,
    `Started at: ${new Date().toISOString()}`,
    '',
  ].filter(Boolean).join('\n'))
  return { stream, outputFile }
}

function writeCommandLog(stream, source, chunk) {
  stream.write(`\n[${source} ${new Date().toISOString()}]\n`)
  stream.write(chunk)
}

export async function toolRunCommand(params, context, runtime = {}) {
  const command = String(params?.command || '')
  if (!command.trim()) {
    const error = new Error('command is required')
    error.statusCode = 400
    throw error
  }

  const description = String(params?.description || '').trim().slice(0, 500)
  const runInBackground = params?.run_in_background === true
  const timeoutMs = runInBackground
    ? null
    : clampNumber(params?.timeoutMs, DEFAULT_RUN_COMMAND_TIMEOUT_MS, MIN_RUN_COMMAND_TIMEOUT_MS, MAX_RUN_COMMAND_TIMEOUT_MS)
  const cwd = getToolWorkspaceRoot(context)
  const startedAt = Date.now()

  if (runtime.signal?.aborted) {
    const details = {
      command,
      description,
      project: context?.project,
      cwd,
      timeoutMs,
      runInBackground,
      outputFile: null,
      stdout: '',
      stderr: 'Command aborted before start.',
      stdout_preview: '',
      stderr_preview: 'Command aborted before start.',
      stdoutTruncated: false,
      stderrTruncated: false,
      stdout_truncated: false,
      stderr_truncated: false,
      outputTruncated: false,
      truncated: false,
      previewLineLimit: COMMAND_PREVIEW_LINES,
      previewCharLimit: COMMAND_PREVIEW_TOTAL_CHARS,
      previewMode: 'tail',
      durationMs: 0,
      aborted: true,
    }
    const content = formatCommandOutput(command, details.stdout, details.stderr, details)
    return { content: truncateText(content), details }
  }

  let logStream = null
  let outputFile = null
  let logError = null
  try {
    const log = await createCommandLogStream(command, { cwd, description, toolCallId: runtime.toolCallId })
    logStream = log.stream
    outputFile = log.outputFile
    logStream.on('error', (error) => {
      logError = error?.message || 'Failed to write command log.'
    })
  } catch (error) {
    logError = error?.message || 'Failed to create command log.'
  }

  return new Promise((resolve) => {
    // Windows: DETACHED_PROCESS makes CREATE_NO_WINDOW (windowsHide) a no-op, so
    // cmd.exe allocates a fresh console and the default terminal app shows a
    // visible window. Keep detached off on Windows and let unref() provide the
    // "call returned, process keeps running" semantics; taskkill /T handles the
    // process tree without needing a process group. Non-Windows keeps detached
    // because killProcessTree signals the whole group via process.kill(-pid).
    const spawnDetached = process.platform !== 'win32'
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: spawnDetached,
      // 让子进程知道本地 API 地址和当前会话身份，skill 脚本据此调用
      // QuickForge 自己（见 skills/quickforge-api）。没有 listen 时只是
      // 不注入这两个变量，不会覆盖用户已有的环境变量。
      env: buildChildProcessEnv(context),
    })
    if (runInBackground) child.unref?.()

    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    let aborted = false
    let settled = false
    let backgroundDetached = false
    let updateTimer = null
    let updatePending = false
    let forceKillTimer = null
    const taskId = runInBackground ? `task_${randomUUID()}` : null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      if (updateTimer) clearTimeout(updateTimer)
      if (runtime.toolCallId) unregisterRunningCommand(runtime.toolCallId)
      runtime.signal?.removeEventListener?.('abort', onAbort)
    }

    const commonDetails = (extra = {}) => {
      const now = Date.now()
      const previews = balanceCommandPreviews(stdout, stderr)
      const stdoutPreview = previews.stdout
      const stderrPreview = previews.stderr
      const stdoutPreviewTruncated = stdoutTruncated || previews.stdoutTruncated
      const stderrPreviewTruncated = stderrTruncated || previews.stderrTruncated
      const truncated = stdoutPreviewTruncated || stderrPreviewTruncated
      return {
        command,
        description,
        project: context?.project,
        cwd,
        timeoutMs,
        runInBackground,
        background: runInBackground && !settled,
        taskId,
        outputFile,
        stdout: stdoutPreview,
        stderr: stderrPreview,
        stdout_preview: stdoutPreview,
        stderr_preview: stderrPreview,
        stdoutTruncated: stdoutPreviewTruncated,
        stderrTruncated: stderrPreviewTruncated,
        stdout_truncated: stdoutPreviewTruncated,
        stderr_truncated: stderrPreviewTruncated,
        outputTruncated: truncated,
        truncated,
        previewLineLimit: COMMAND_PREVIEW_LINES,
        previewCharLimit: COMMAND_PREVIEW_TOTAL_CHARS,
        previewMode: 'tail',
        durationMs: now - startedAt,
        toolCallId: runtime.toolCallId,
        logError,
        ...extra,
      }
    }

    const closeCommandLog = (result, afterClose) => {
      if (!logStream) {
        afterClose(result)
        return
      }
      const details = result.details || {}
      logStream.write([
        '',
        '',
        `[quickforge ${new Date().toISOString()}]`,
        `Exit code: ${details.code ?? 'unknown'}${details.signal ? `, signal: ${details.signal}` : ''}`,
        `Duration: ${formatDurationMs(details.durationMs)}`,
        `Timed out: ${Boolean(details.timedOut)}`,
        `Aborted: ${Boolean(details.aborted)}`,
        taskId ? `Background task: ${taskId}` : null,
        'Command finished.',
        '',
      ].filter((line) => line !== null).join('\n'))
      logStream.end(() => afterClose(result))
    }

    const finish = ({ code = null, signal = null, error = null } = {}) => {
      if (settled) return null
      flushUpdate()
      settled = true
      cleanup()
      // One timestamp for both durationMs and finishedAt so they never disagree.
      const finishedAt = Date.now()
      const durationMs = finishedAt - startedAt
      const pid = child.pid ?? null
      let result
      if (error) {
        const details = commonDetails({ error: error.message, aborted, timedOut, durationMs, startedAt, finishedAt, pid, running: false, background: false })
        result = {
          isError: true,
          content: truncateText(formatCommandOutput(command, details.stdout, `Error running command: ${error.message}\n${details.stderr}`.trim(), details)),
          details,
        }
      } else {
        const details = commonDetails({ code, signal, timedOut, aborted, durationMs, startedAt, finishedAt, pid, running: false, background: false })
        result = { content: truncateText(formatCommandOutput(command, details.stdout, details.stderr, details)), details }
      }
      closeCommandLog(result, (closed) => {
        if (backgroundDetached) notifyBackgroundExit(closed)
        else resolve(closed)
      })
      return result
    }

    const notifyBackgroundExit = (result) => {
      if (!taskId) return
      const existing = getBackgroundTaskRecord(taskId)
      const record = {
        taskId,
        toolCallId: runtime.toolCallId || null,
        sessionId: context?.sessionId || null,
        command,
        description,
        cwd,
        outputFile,
        pid: child.pid ?? null,
        startedAt,
        finishedAt: Date.now(),
        status: result.details?.aborted ? 'aborted' : result.details?.timedOut ? 'timed_out' : result.details?.code === 0 ? 'completed' : 'failed',
        code: result.details?.code ?? null,
        signal: result.details?.signal ?? null,
      }
      rememberBackgroundTask({ ...existing, ...record })
      const text = [
        '<task-notification>',
        `Task ${taskId} exited.`,
        `Command: ${command}`,
        `Status: ${record.status}`,
        `Exit code: ${record.code ?? 'unknown'}${record.signal ? `, signal: ${record.signal}` : ''}`,
        outputFile ? `Output file: ${outputFile}` : null,
        'Read the output file for the complete stdout and stderr. The process is no longer running.',
        '</task-notification>',
      ].filter(Boolean).join('\n')
      try {
        runtime.onBackgroundExit?.({
          taskId,
          sessionId: record.sessionId,
          toolCallId: record.toolCallId,
          outputFile,
          text,
          phase: 'exit',
          tasks: listBackgroundCommandTasks(record.sessionId),
          result,
          details: record,
        })
      } catch {
        // A late notification must not change the command result.
      }
    }

    const stopChild = (reason) => {
      if (reason === 'timeout') timedOut = true
      if (reason === 'abort') aborted = true
      killProcessTree(child, 'SIGTERM')
      forceKillTimer = setTimeout(() => {
        killProcessTree(child, 'SIGKILL')
      }, 1500)
    }

    if (runtime.toolCallId) registerRunningCommand(runtime.toolCallId, stopChild)
    if (taskId) {
      rememberBackgroundTask({
        taskId,
        toolCallId: runtime.toolCallId || null,
        sessionId: context?.sessionId || null,
        command,
        description,
        cwd,
        outputFile,
        pid: child.pid ?? null,
        startedAt,
        finishedAt: null,
        status: 'running',
        code: null,
        signal: null,
      })
    }

    function onAbort() {
      stopChild('abort')
      finish({ signal: 'SIGTERM' })
    }

    const runningDetails = () => commonDetails({ running: true })

    const emitUpdate = () => {
      updateTimer = null
      if (settled || !updatePending) return
      updatePending = false
      const details = runningDetails()
      runtime.onUpdate?.({
        content: [{ type: 'text', text: truncateText(formatCommandOutput(command, details.stdout, details.stderr, details)) }],
        details,
      })
    }
    const flushUpdate = () => {
      if (updateTimer) {
        clearTimeout(updateTimer)
        updateTimer = null
      }
      if (!updatePending) return
      updatePending = false
      const details = runningDetails()
      runtime.onUpdate?.({
        content: [{ type: 'text', text: truncateText(formatCommandOutput(command, details.stdout, details.stderr, details)) }],
        details,
      })
    }
    const scheduleUpdate = () => {
      if (settled) return
      updatePending = true
      if (!updateTimer) updateTimer = setTimeout(emitUpdate, 150)
    }
    const timer = timeoutMs == null ? null : setTimeout(() => {
      stopChild('timeout')
      finish({ signal: 'SIGTERM' })
    }, timeoutMs)

    runtime.signal?.addEventListener?.('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk) => {
      if (settled) return
      const text = chunk.toString()
      const nextStdout = tailText(stdout, text)
      stdoutTruncated = stdoutTruncated || nextStdout.truncated
      stdout = nextStdout.text
      if (logStream && !logError) writeCommandLog(logStream, 'stdout', text)
      scheduleUpdate()
    })
    child.stderr.on('data', (chunk) => {
      if (settled) return
      const text = chunk.toString()
      const nextStderr = tailText(stderr, text)
      stderrTruncated = stderrTruncated || nextStderr.truncated
      stderr = nextStderr.text
      if (logStream && !logError) writeCommandLog(logStream, 'stderr', text)
      scheduleUpdate()
    })
    child.on('close', (code, signal) => {
      finish({ code, signal })
    })
    child.on('error', (err) => {
      finish({ error: err })
    })

    if (!runInBackground) return

    backgroundDetached = true
    const started = commonDetails({
      running: true,
      background: true,
      detached: spawnDetached,
      pid: child.pid ?? null,
    })
    try {
      runtime.onBackgroundExit?.({
        taskId,
        sessionId: context?.sessionId || null,
        toolCallId: runtime.toolCallId || null,
        outputFile,
        phase: 'start',
        tasks: listBackgroundCommandTasks(context?.sessionId),
        details: started,
      })
    } catch {
      // The detached command is already running; a start notice is optional.
    }
    resolve({
      content: truncateText([
        formatCommandOutput(command, '', '', started),
        '',
        'The command is detached and this call has returned. Keep working in this turn.',
        'The process continues across turns until it exits or you stop it.',
        'stdout and stderr are appended to the output file.',
        'A task-notification is delivered when the process exits; read the output file for the complete output.',
      ].join('\n')),
      details: started,
    })
  })
}

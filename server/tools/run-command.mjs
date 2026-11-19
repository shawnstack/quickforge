/**
 * run_command tool: shell command execution in the workspace directory.
 *
 * Streams stdout/stderr as bounded tail previews (200 lines / 10k chars
 * shared budget), persists full output to ~/.quickforge/logs/commands/,
 * supports timeouts and aborts, and can detach long-running commands into
 * background tasks (taskId + <task-notification> on exit). Termination goes
 * through utils/process-tree.mjs (SIGTERM → grace → SIGKILL, taskkill /T on
 * Windows); the running/background registries live in process-control.mjs.
 * This module only formats, logs and runs.
 */
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { truncateText, getToolWorkspaceRoot } from '../utils/workspace.mjs'
import { logsDir } from '../storage.mjs'
import { buildChildProcessEnv } from '../runtime-info.mjs'
import { registerRunningCommand, unregisterRunningCommand, getBackgroundTaskRecord, rememberBackgroundTask, listBackgroundCommandTasks } from './process-control.mjs'
import { terminateProcessTree } from '../utils/process-tree.mjs'
import { clampNumber } from './params.mjs'

// --- run_command ---
const DEFAULT_RUN_COMMAND_TIMEOUT_MS = 60 * 60 * 1000
const MIN_RUN_COMMAND_TIMEOUT_MS = 1000
const MAX_RUN_COMMAND_TIMEOUT_MS = 60 * 60 * 1000
const COMMAND_PREVIEW_LINES = 200
const COMMAND_PREVIEW_TOTAL_CHARS = 10000
// 单个命令日志文件的写入上限（字节）。预览（尾窗 10k 字）不受影响；超过上限后
// 输出文件停止追加，收尾时写一行截断标记。历史上一条跑飞的命令写出过 1.8GB
// 的日志文件（2026-10-30），这个上限把它钉死在可诊断、不可失控的量级。
const COMMAND_LOG_MAX_BYTES = 8 * 1024 * 1024

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

/**
 * 有字节上限的命令日志写入器：超过 COMMAND_LOG_MAX_BYTES 后静默丢弃后续输出，
 * close() 时在文件末尾补一行截断标记；收尾块（Exit code 等）作为
 * close(afterClose, footer) 传入，与截断标记一样经底层 stream 直写，因此截断
 * 后仍完整落在文件末尾（标记在前、footer 在后）。写盘失败由原始流的 error
 * 监听兜住，不影响命令执行本身。
 */
// Exported for tests：命令日志 8MB 上限的行为契约（见 tests/server/run-command-log-cap.test.mjs）。
export function createBoundedCommandLog(stream, maxBytes = COMMAND_LOG_MAX_BYTES) {
  let written = 0
  let truncated = false
  return {
    get truncated() {
      return truncated
    },
    write(chunk) {
      if (truncated) return
      const text = String(chunk)
      // 预算按 UTF-8 字节计，不是 code unit：上限名义上是 8MB 字节，历史上按
      // String.length 累计时中文日志（1 汉字 = 3 字节 UTF-8）实测写到 18MB 仍
      // 未截断，名不副实。
      const size = Buffer.byteLength(text, 'utf8')
      if (written + size > maxBytes) {
        truncated = true
        return
      }
      written += size
      stream.write(text)
    },
    close(afterClose, footer) {
      const finish = () => {
        if (footer) stream.write(footer)
        stream.end(() => afterClose())
      }
      if (!truncated) {
        finish()
        return
      }
      stream.write('\n[quickforge] Log truncated: output capped at ' + maxBytes + ' bytes, further output discarded.\n')
      finish()
    },
  }
}

async function createCommandLogStream(command, { cwd, description, toolCallId } = {}) {
  const dir = path.join(logsDir, 'commands')
  await fs.mkdir(dir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `${timestamp}_${safeLogFilePart(toolCallId, 'command')}.log`
  const outputFile = path.join(dir, fileName)
  const rawStream = createWriteStream(outputFile, { flags: 'wx' })
  rawStream.on('error', () => {
    // 写盘失败只影响日志完整性；命令结果不受影响（写超限由 wrapper 兜住）。
  })
  const stream = createBoundedCommandLog(rawStream)
  stream.write([
    `Command: ${command}`,
    description ? `Description: ${description}` : null,
    `CWD: ${cwd}`,
    `Started at: ${new Date().toISOString()}`,
    '',
  ].filter(Boolean).join('\n'))
  return { stream, outputFile }
}

// 兼容旧调用形态：写日志只经 wrapper（带 8MB 上限）。

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
    // 超时定时器提前声明（不是在使用处 const）：同 tick 的 abort 可以在赋值
    // 语句执行前就走到 finish() → cleanup() 读 timer，TDZ 会把 promise 永久
    // 挂死；timeoutMs == null（后台模式）时保持 null，语义与原 const 写法一致。
    let timer = null
    const taskId = runInBackground ? `task_${randomUUID()}` : null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
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
      // 收尾块不走 wrapper.write（truncated 后会被整块丢弃），而是作为 close 的
      // footer 参数经底层 stream 直写：截断标记在前、收尾块在后，读者在文件
      // 末尾仍能看到 Exit code，不会只留一句「output discarded」。
      const footer = [
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
      ].filter((line) => line !== null).join('\n')
      logStream.close(() => afterClose(result), footer)
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
      // 两阶段终止（SIGTERM → 宽限期 → SIGKILL）交给 process-tree 统一负责：
      // 它的升级定时器活在这次调用之外，不会被同 tick 里紧随其后的
      // finish()→cleanup() 清掉。历史上这里自维护 forceKillTimer，正好在那条
      // 路径上被 clearTimeout，POSIX 上 SIGKILL 兜底永不执行。
      // 不等待结果：命令结果由 child 的 close/error 决定，升级在后台完成。
      void terminateProcessTree(child).catch(() => {})
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
    timer = timeoutMs == null ? null : setTimeout(() => {
      stopChild('timeout')
      finish({ signal: 'SIGTERM' })
    }, timeoutMs)

    // Node 不会给「已 abort 之后才 add 的监听器」补发事件：toolRunCommand 在
    // 创建日志流的 await 期间挂起，这个窗口里到达的 abort 会整个丢失（命令照
    // 跑完、aborted=false）。注册前复查一次，已中止就直接走 abort 收尾——
    // finish()/cleanup() 会同步执行，timer 已提前声明，不会踩 TDZ。
    if (runtime.signal?.aborted) onAbort()
    else runtime.signal?.addEventListener?.('abort', onAbort, { once: true })

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

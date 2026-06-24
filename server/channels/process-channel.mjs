import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const DEFAULT_LOG_LIMIT = 300
const STOP_TIMEOUT_MS = 5000

function nowIso() {
  return new Date().toISOString()
}

function normalizeChunk(chunk) {
  return Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
}

function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function appendLineBuffer(buffer, text, onLine) {
  const combined = buffer + text
  const lines = combined.split(/\r?\n/)
  const nextBuffer = lines.pop() || ''
  for (const line of lines) onLine(line)
  return nextBuffer
}

function runDetachedCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
  })
}

async function terminateProcess(child, signal = 'SIGTERM') {
  if (!child?.pid) return false
  if (process.platform === 'win32') {
    return runDetachedCommand('taskkill.exe', ['/PID', String(child.pid), '/T', signal === 'SIGKILL' ? '/F' : undefined].filter(Boolean))
  }
  try {
    return process.kill(-child.pid, signal)
  } catch {
    try {
      return child.kill(signal)
    } catch {
      return false
    }
  }
}

export class ProcessChannelProvider extends EventEmitter {
  constructor(definition, options = {}) {
    super()
    this.definition = definition
    this.logLimit = options.logLimit || DEFAULT_LOG_LIMIT
    this.status = 'stopped'
    this.process = null
    this.pid = null
    this.startedAt = null
    this.stoppedAt = null
    this.exitCode = null
    this.exitSignal = null
    this.error = null
    this.logs = []
    this.qrCodeUrl = null
    this.qrCodeText = ''
    this.activeAction = null
    this.stopRequested = false
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    this.startPromise = null
    this.stopPromise = null
  }

  snapshot() {
    return {
      id: this.definition.id,
      name: this.definition.name,
      description: this.definition.description,
      kind: this.definition.kind || 'process',
      provider: this.definition.provider,
      icon: this.definition.icon,
      commandLabel: this.definition.commandLabel,
      supportsWorkspaceSelection: this.definition.supportsWorkspaceSelection === true,
      status: this.status,
      pid: this.pid,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      exitCode: this.exitCode,
      exitSignal: this.exitSignal,
      error: this.error,
      logs: this.logs,
      qrCodeUrl: this.qrCodeUrl,
      qrCodeText: this.qrCodeText,
      actions: this.definition.actions || [],
      requirements: this.definition.requirements || [],
      activeAction: this.activeAction,
    }
  }

  emitEvent(type, payload = {}) {
    const event = {
      type,
      channelId: this.definition.id,
      timestamp: nowIso(),
      ...payload,
    }
    this.emit('event', event)
  }

  setStatus(status, extra = {}) {
    this.status = status
    if (Object.prototype.hasOwnProperty.call(extra, 'error')) {
      this.error = extra.error
    }
    this.emitEvent('status', { status, snapshot: this.snapshot() })
  }

  addLog(stream, text) {
    if (!text) return
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      time: nowIso(),
      stream,
      text,
    }
    this.logs.push(entry)
    if (this.logs.length > this.logLimit) {
      this.logs.splice(0, this.logs.length - this.logLimit)
    }
    this.emitEvent('log', { log: entry })
  }

  addProcessText(stream, text) {
    const cleanText = stripAnsi(text).replace(/\r/g, '\n')
    if (!cleanText) return
    this.addLog(stream, cleanText)
    this.inspectOutput(cleanText, stream)

    const lineHandler = (line) => this.inspectOutputLine(line, stream)
    if (stream === 'stderr') {
      this.stderrBuffer = appendLineBuffer(this.stderrBuffer, cleanText, lineHandler)
    } else {
      this.stdoutBuffer = appendLineBuffer(this.stdoutBuffer, cleanText, lineHandler)
    }
  }

  inspectOutput(_text, _stream) {
  }

  inspectOutputLine(_line, _stream) {
  }

  buildStartCommand() {
    throw new Error('buildStartCommand() is not implemented')
  }

  async beforeStart(_options = {}) {}

  async start(options = {}) {
    if (this.process) return this.snapshot()
    if (this.startPromise) return this.startPromise
    if (this.status === 'stopping') return this.snapshot()

    this.startPromise = this.#startProcess(options)
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async #startProcess(options = {}) {
    this.stopRequested = false
    this.exitCode = null
    this.exitSignal = null
    this.error = null
    this.qrCodeUrl = null
    this.qrCodeText = ''
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    this.startedAt = nowIso()
    this.stoppedAt = null
    this.setStatus('starting')

    await this.beforeStart(options)
    if (this.process) return this.snapshot()

    const commandSpec = this.buildStartCommand(options)

    const child = spawn(commandSpec.command, commandSpec.args || [], {
      cwd: commandSpec.cwd,
      env: commandSpec.env || process.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      shell: commandSpec.shell === true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.process = child
    this.pid = child.pid || null
    this.emitEvent('status', { status: this.status, snapshot: this.snapshot() })

    child.stdout?.on('data', (chunk) => this.addProcessText('stdout', normalizeChunk(chunk)))
    child.stderr?.on('data', (chunk) => this.addProcessText('stderr', normalizeChunk(chunk)))

    child.once('error', (error) => {
      this.error = error.message || String(error)
      this.addLog('stderr', this.error)
      this.process = null
      this.pid = null
      this.stoppedAt = nowIso()
      this.setStatus('error', { error: this.error })
    })

    child.once('exit', (code, signal) => {
      this.process = null
      this.pid = null
      this.exitCode = code
      this.exitSignal = signal
      this.stoppedAt = nowIso()
      if (this.stopRequested || code === 0) {
        this.setStatus('stopped')
      } else {
        const reason = `Channel process exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}`
        this.error = reason
        this.setStatus('error', { error: reason })
      }
    })

    return this.snapshot()
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise
    this.stopPromise = this.#stopProcess()
    try {
      return await this.stopPromise
    } finally {
      this.stopPromise = null
    }
  }

  async #stopProcess() {
    if (!this.process) {
      this.setStatus('stopped')
      return this.snapshot()
    }

    this.stopRequested = true
    this.setStatus('stopping')
    const child = this.process
    await terminateProcess(child, 'SIGTERM')

    const exited = await Promise.race([
      new Promise((resolve) => child.once('exit', () => resolve(true))),
      delay(STOP_TIMEOUT_MS).then(() => false),
    ])

    if (!exited && this.process === child) {
      await terminateProcess(child, 'SIGKILL')
    }

    return this.snapshot()
  }

  async restart(options = {}) {
    await this.stop()
    return this.start(options)
  }

  async runAction(_action, _options = {}) {
    const error = new Error('Unsupported channel action')
    error.statusCode = 404
    throw error
  }
}

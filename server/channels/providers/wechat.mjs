import { spawn } from 'node:child_process'
import path from 'node:path'
import { ProcessChannelProvider } from '../process-channel.mjs'

const WEIXIN_ACP_PACKAGE = 'weixin-acp'
const MIN_NODE_MAJOR = 22
const ACTION_TIMEOUT_MS = 120_000

function npxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

function shouldUseShellForNpx() {
  return process.platform === 'win32'
}

function nodeMajor() {
  return Number(process.versions.node.split('.')[0] || 0)
}

function qfAcpCommand(projectRoot) {
  const nodeCommand = process.platform === 'win32' ? 'node' : process.execPath
  return [nodeCommand, path.join(projectRoot, 'bin', 'quickforge.mjs'), 'acp']
}

function extractUrl(text) {
  const matches = String(text).match(/https?:\/\/[^\s\u001b]+/g)
  if (!matches?.length) return null
  return matches[matches.length - 1].replace(/[),，。]+$/u, '')
}

function looksLikeTerminalQr(text) {
  return /[█▀▄]{6,}/u.test(text) || /[▄▀]{6,}/u.test(text)
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      shell: options.shell === true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGTERM')
      settled = true
      const error = new Error(`Command timed out after ${options.timeoutMs || ACTION_TIMEOUT_MS}ms`)
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    }, options.timeoutMs || ACTION_TIMEOUT_MS)

    child.stdout?.on('data', (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      stdout += text
      options.onStdout?.(text)
    })
    child.stderr?.on('data', (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      stderr += text
      options.onStderr?.(text)
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr, code, signal })
      } else {
        const error = new Error(`Command exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}`)
        error.stdout = stdout
        error.stderr = stderr
        error.code = code
        error.signal = signal
        reject(error)
      }
    })
  })
}

export class WechatChannelProvider extends ProcessChannelProvider {
  constructor({ projectRoot }) {
    super({
      id: 'wechat',
      name: '微信',
      description: '通过 weixin-acp 将微信消息接入 QuickForge ACP Agent。',
      kind: 'process',
      provider: 'weixin-acp',
      icon: 'wechat',
      commandLabel: 'npx weixin-acp start -- qf acp',
      actions: [
        { id: 'logout', label: '退出登录', destructive: true },
        { id: 'relogin', label: '重新登录' },
      ],
      requirements: [`Node.js >= ${MIN_NODE_MAJOR}`, 'npm/npx 可用', '首次启动需要微信扫码登录'],
    })
    this.projectRoot = projectRoot
  }

  async beforeStart() {
    if (nodeMajor() < MIN_NODE_MAJOR) {
      const message = `微信渠道需要 Node.js >= ${MIN_NODE_MAJOR}，当前版本是 ${process.versions.node}。请升级 Node 后重试。`
      this.error = message
      this.setStatus('error', { error: message })
      const error = new Error(message)
      error.statusCode = 409
      throw error
    }
  }

  buildStartCommand() {
    const [acpCommand, ...acpArgs] = qfAcpCommand(this.projectRoot)
    return {
      command: npxCommand(),
      args: ['-y', WEIXIN_ACP_PACKAGE, 'start', '--', acpCommand, ...acpArgs],
      cwd: this.projectRoot,
      env: process.env,
      shell: shouldUseShellForNpx(),
    }
  }

  inspectOutput(text) {
    const url = extractUrl(text)
    if (url) {
      this.qrCodeUrl = url
      if (this.status === 'starting') this.setStatus('waiting_scan')
      this.emitEvent('qrcode', { qrCodeUrl: this.qrCodeUrl, qrCodeText: this.qrCodeText, snapshot: this.snapshot() })
    }

    if (looksLikeTerminalQr(text)) {
      const nextText = `${this.qrCodeText}\n${text}`.trim()
      this.qrCodeText = nextText.length > 8000 ? nextText.slice(-8000) : nextText
      if (this.status === 'starting') this.setStatus('waiting_scan')
      this.emitEvent('qrcode', { qrCodeUrl: this.qrCodeUrl, qrCodeText: this.qrCodeText, snapshot: this.snapshot() })
    }

    if (/扫码|二维码|等待扫码|scan/i.test(text) && this.status === 'starting') {
      this.setStatus('waiting_scan')
    }

    if (/与微信连接成功|启动 bot|\[weixin\] 启动 bot|connected|login success/i.test(text)) {
      this.qrCodeText = ''
      this.setStatus('running')
    }
  }

  inspectOutputLine(line) {
    if (/与微信连接成功|启动 bot|\[weixin\] 启动 bot|connected|login success/i.test(line)) {
      this.qrCodeText = ''
      this.setStatus('running')
    }
  }

  async runAction(action) {
    if (action === 'logout') return this.logout()
    if (action === 'relogin') return this.relogin()
    return super.runAction(action)
  }

  async logout({ preserveActiveAction = false } = {}) {
    if (this.activeAction && !preserveActiveAction) return this.snapshot()
    if (!preserveActiveAction) this.activeAction = 'logout'
    this.emitEvent('status', { status: this.status, snapshot: this.snapshot() })
    try {
      if (this.process) await this.stop()
      this.addLog('system', 'Running: npx weixin-acp logout')
      await runCommand(npxCommand(), ['-y', WEIXIN_ACP_PACKAGE, 'logout'], {
        cwd: this.projectRoot,
        env: process.env,
        shell: shouldUseShellForNpx(),
        onStdout: (text) => this.addProcessText('stdout', text),
        onStderr: (text) => this.addProcessText('stderr', text),
      })
      this.qrCodeUrl = null
      this.qrCodeText = ''
      this.error = null
      this.setStatus('stopped')
      return this.snapshot()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.error = message
      this.addLog('stderr', message)
      this.setStatus('error', { error: message })
      throw error
    } finally {
      if (!preserveActiveAction) this.activeAction = null
      this.emitEvent('status', { status: this.status, snapshot: this.snapshot() })
    }
  }

  async relogin() {
    if (this.activeAction) return this.snapshot()
    this.activeAction = 'relogin'
    this.emitEvent('status', { status: this.status, snapshot: this.snapshot() })
    try {
      await this.logout({ preserveActiveAction: true })
      return await this.start()
    } finally {
      this.activeAction = null
      this.emitEvent('status', { status: this.status, snapshot: this.snapshot() })
    }
  }
}

export function createWechatChannelProvider(options) {
  return new WechatChannelProvider(options)
}

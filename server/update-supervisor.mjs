#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [oldPidArg, packageName, latestVersion, serverScript, serverCwd, logFile, ...serverArgs] = process.argv.slice(2)
const oldPid = Number(oldPidArg)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isProcessRunning(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function ensureLogDir(filePath) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }) } catch { /* ignore */ }
}

function timestamp() {
  return new Date().toISOString()
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

ensureLogDir(logFile)
const logStream = fs.createWriteStream(logFile, { flags: 'a' })

function log(message) {
  logStream.write(`${timestamp()} ${message}\n`)
}

function pipeOutput(stream, prefix) {
  stream?.on('data', (chunk) => {
    const text = String(chunk)
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) log(`${prefix} ${line}`)
    }
  })
}

function spawnAndWait(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    pipeOutput(child.stdout, '[stdout]')
    pipeOutput(child.stderr, '[stderr]')
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

async function main() {
  const target = `${packageName}@latest`
  log(`QuickForge external updater started. target=${target} latest=${latestVersion || 'unknown'} oldPid=${oldPid || 'unknown'}`)
  log(`Updater cwd=${process.cwd()}`)
  log(`Server script=${serverScript}`)

  for (let i = 0; i < 600 && isProcessRunning(oldPid); i += 1) {
    if (i === 0) log(`Waiting for old QuickForge process ${oldPid} to exit...`)
    await sleep(100)
  }

  if (isProcessRunning(oldPid)) {
    log(`Old QuickForge process ${oldPid} is still running after timeout; continuing with npm install.`)
  } else {
    log('Old QuickForge process has exited.')
  }

  const npmCommand = getNpmCommand()
  const npmArgs = ['install', '-g', target]
  log(`Running: ${npmCommand} ${npmArgs.join(' ')}`)
  const installResult = await spawnAndWait(npmCommand, npmArgs, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true,
    env: process.env,
  })

  if (installResult.code !== 0) {
    log(`npm install failed. code=${installResult.code} signal=${installResult.signal || ''}`)
    process.exitCode = installResult.code || 1
    return
  }

  log('npm install completed successfully.')
  log(`Starting QuickForge server: ${process.execPath} ${[serverScript, ...serverArgs].join(' ')}`)
  const child = spawn(process.execPath, [serverScript, ...serverArgs], {
    cwd: serverCwd || undefined,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      QUICKFORGE_NO_OPEN: '1',
      QUICKFORGE_RESTARTED_FROM_UPDATE: '1',
    },
  })

  child.unref()
  log(`QuickForge server spawned. pid=${child.pid || 'unknown'}`)
}

try {
  await main()
} catch (error) {
  log(`Updater failed: ${error?.stack || error?.message || error}`)
  process.exitCode = 1
} finally {
  await new Promise((resolve) => logStream.end(resolve))
}

#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const serverScript = path.resolve(__dirname, '..', 'server', 'index.mjs')

function getDataDir() {
  if (process.env.QUICKFORGE_DATA_DIR) return path.resolve(process.env.QUICKFORGE_DATA_DIR)
  return path.join(os.homedir(), '.quickforge')
}

function getPidFile() {
  return path.join(getDataDir(), 'quickforge.pid')
}

async function readPid() {
  try {
    const text = await fs.readFile(getPidFile(), 'utf8')
    return Number(text.trim()) || null
  } catch {
    return null
  }
}

async function writePid(pid) {
  const pidFile = getPidFile()
  await fs.mkdir(path.dirname(pidFile), { recursive: true })
  await fs.writeFile(pidFile, String(pid), 'utf8')
}

async function removePid() {
  try {
    await fs.unlink(getPidFile())
  } catch {
    // ignore
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function cmdStop() {
  const pid = await readPid()
  if (!pid) {
    console.log('QuickForge is not running (no PID file found).')
    return
  }

  if (!isProcessRunning(pid)) {
    console.log(`QuickForge PID ${pid} is not running. Cleaning up PID file.`)
    await removePid()
    return
  }

  console.log(`Stopping QuickForge (PID ${pid})...`)
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // force kill on Windows
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // ignore
    }
  }

  await removePid()
  console.log('QuickForge stopped.')
}

function getServiceUrl() {
  const host = process.env.QUICKFORGE_HOST || '127.0.0.1'
  const port = process.env.QUICKFORGE_PORT || '5176'
  return `http://${host}:${port}`
}

async function cmdStart() {
  const existingPid = await readPid()
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`QuickForge is already running (PID ${existingPid}).`)
    console.log('Use "quickforge stop" to stop it first, or "quickforge restart".')
    return
  }

  // Clean up stale PID file
  if (existingPid) await removePid()

  const child = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env },
  })

  await writePid(child.pid)
  child.unref()

  const serviceUrl = getServiceUrl()
  const dataDir = getDataDir()
  console.log(`QuickForge started (PID ${child.pid}).`)
  console.log(`Open: ${serviceUrl}`)
  console.log(`Data: ${dataDir}`)
  console.log(`Config: ${path.join(dataDir, 'config', 'config.json')}`)
  console.log(`Storage: ${path.join(dataDir, 'storage')}`)
  console.log(`Cache: ${path.join(dataDir, 'cache')}`)
  console.log(`Logs: ${path.join(dataDir, 'logs')}`)
  console.log('')
  console.log('Commands:')
  console.log('  quickforge stop     Stop the background service')
  console.log('  quickforge restart  Restart the background service')
  console.log('  quickforge status   Check if the service is running')
}

async function cmdRestart() {
  await cmdStop()
  // Small delay to let the port free up
  await new Promise((resolve) => setTimeout(resolve, 500))
  await cmdStart()
}

async function cmdStatus() {
  const pid = await readPid()
  if (!pid) {
    console.log('QuickForge is not running.')
    return
  }

  if (isProcessRunning(pid)) {
    console.log(`QuickForge is running (PID ${pid}).`)
    console.log(`URL: ${getServiceUrl()}`)
  } else {
    console.log(`QuickForge PID ${pid} is stale (not running).`)
    await removePid()
  }
}

async function main() {
  const command = process.argv[2] || 'start'

  switch (command) {
    case 'start':
      await cmdStart()
      break
    case 'stop':
      await cmdStop()
      break
    case 'restart':
      await cmdRestart()
      break
    case 'status':
      await cmdStatus()
      break
    case '--help':
    case '-h':
    case 'help':
      console.log('QuickForge CLI')
      console.log('')
      console.log('Usage:')
      console.log('  quickforge              Start as background service (default)')
      console.log('  quickforge start        Start as background service')
      console.log('  quickforge stop         Stop the background service')
      console.log('  quickforge restart      Restart the background service')
      console.log('  quickforge status       Check if the service is running')
      console.log('')
      console.log('Config:')
      console.log('  QUICKFORGE_PORT=5176         Server port')
      console.log('  QUICKFORGE_HOST=127.0.0.1    Bind address')
      console.log('  QUICKFORGE_DATA_DIR=/path    Data storage directory')
      console.log('  QUICKFORGE_NO_OPEN=1         Don\'t auto-open browser')
      break
    default:
      console.log(`Unknown command: ${command}`)
      console.log('Use "quickforge --help" for usage.')
      break
  }
}

main().catch((err) => {
  console.error('QuickForge error:', err.message)
  process.exit(1)
})

#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const serverScript = path.resolve(__dirname, '..', 'server', 'index.mjs')
const packageJsonPath = path.resolve(__dirname, '..', 'package.json')

async function getPackageInfo() {
  try {
    const text = await fs.readFile(packageJsonPath, 'utf8')
    const pkg = JSON.parse(text)
    return {
      name: pkg.name || 'quickforge',
      version: pkg.version || '0.0.0',
    }
  } catch (err) {
    throw new Error(`Unable to read package metadata: ${err.message}`)
  }
}

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '')
}

function parseVersion(version) {
  const [main, prerelease = ''] = normalizeVersion(version).split('-', 2)
  const numbers = main.split('.').slice(0, 3).map((part) => {
    const value = Number(part)
    return Number.isFinite(value) ? value : 0
  })

  while (numbers.length < 3) numbers.push(0)
  return { numbers, prerelease }
}

function comparePrerelease(left, right) {
  if (left === right) return 0
  if (!left) return 1
  if (!right) return -1

  const leftParts = left.split('.')
  const rightParts = right.split('.')
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let i = 0; i < maxLength; i += 1) {
    const leftPart = leftParts[i]
    const rightPart = rightParts[i]
    if (leftPart === rightPart) continue
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null

    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1

    return leftPart > rightPart ? 1 : -1
  }

  return 0
}

function compareVersions(left, right) {
  const parsedLeft = parseVersion(left)
  const parsedRight = parseVersion(right)

  for (let i = 0; i < 3; i += 1) {
    if (parsedLeft.numbers[i] > parsedRight.numbers[i]) return 1
    if (parsedLeft.numbers[i] < parsedRight.numbers[i]) return -1
  }

  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease)
}

function getRegistryPackageUrl(packageName) {
  const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org/').replace(/\/+$/, '')
  return `${registry}/${encodeURIComponent(packageName)}`
}

async function fetchLatestVersion(packageName) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(getRegistryPackageUrl(packageName), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`)

    const metadata = await response.json()
    const latest = metadata?.['dist-tags']?.latest
    if (!latest || typeof latest !== 'string') throw new Error('latest version not found in registry response')
    return latest
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('request timeout')
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function cmdVersion() {
  const pkg = await getPackageInfo()
  console.log(`QuickForge ${pkg.version}`)
  console.log(`Package: ${pkg.name}`)
  console.log(`Node: ${process.version}`)
}

async function cmdCheckUpdate() {
  const pkg = await getPackageInfo()

  try {
    const latest = await fetchLatestVersion(pkg.name)

    const versionComparison = compareVersions(pkg.version, latest)

    if (versionComparison > 0) {
      console.log('QuickForge local version is newer than npm latest.')
      console.log(`Current: ${pkg.version}`)
      console.log(`Latest:  ${latest}`)
      return
    }

    if (versionComparison === 0) {
      console.log('QuickForge is up to date.')
      console.log(`Current: ${pkg.version}`)
      console.log(`Latest:  ${latest}`)
      return
    }

    console.log('A new QuickForge version is available.')
    console.log('')
    console.log(`Current: ${pkg.version}`)
    console.log(`Latest:  ${latest}`)
    console.log('')
    console.log('Upgrade:')
    console.log(`  npm install -g ${pkg.name}@latest`)
  } catch (err) {
    console.log('Unable to check for updates.')
    console.log(`Current: ${pkg.version}`)
    console.log(`Reason: ${err.message}`)
    console.log('')
    console.log('You can check manually:')
    console.log(`  npm view ${pkg.name} version`)
  }
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function installLatestVersion(packageName) {
  const target = `${packageName}@latest`
  const child = spawn(getNpmCommand(), ['install', '-g', target], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: false,
  })

  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`npm install exited with code ${code}`))
    })
  })
}

async function cmdUpdate() {
  const pkg = await getPackageInfo()

  try {
    const latest = await fetchLatestVersion(pkg.name)
    const versionComparison = compareVersions(pkg.version, latest)

    if (versionComparison > 0) {
      console.log('QuickForge local version is newer than npm latest.')
      console.log(`Current: ${pkg.version}`)
      console.log(`Latest:  ${latest}`)
      return
    }

    if (versionComparison === 0) {
      console.log('QuickForge is already up to date.')
      console.log(`Current: ${pkg.version}`)
      console.log(`Latest:  ${latest}`)
      return
    }

    console.log('A new QuickForge version is available.')
    console.log(`Current: ${pkg.version}`)
    console.log(`Latest:  ${latest}`)
    console.log('')
    console.log(`Installing ${pkg.name}@latest ...`)
    await installLatestVersion(pkg.name)
    console.log('')
    console.log('QuickForge update completed.')
    console.log('Run "qf --version" in a new terminal to verify the installed version.')
  } catch (err) {
    console.log('Unable to update QuickForge.')
    console.log(`Current: ${pkg.version}`)
    console.log(`Reason: ${err.message}`)
    console.log('')
    console.log('You can update manually:')
    console.log(`  npm install -g ${pkg.name}@latest`)
    process.exitCode = 1
  }
}

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

function getLogFile() {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(getDataDir(), 'logs', `server-${date}.log`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getPort() {
  return String(process.env.QUICKFORGE_PORT || '5176')
}

function getDisplayHost() {
  const host = process.env.QUICKFORGE_HOST || '0.0.0.0'
  return host === '0.0.0.0' ? '<LAN-IP>' : host
}

function getProbeHost() {
  const host = process.env.QUICKFORGE_HOST || '127.0.0.1'
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1'
  return host
}

function getHealthUrl() {
  return `http://${getProbeHost()}:${getPort()}/api/health`
}

function getServiceUrl() {
  return `http://${getDisplayHost()}:${getPort()}`
}

function formatHealth(health) {
  if (!health) return 'unavailable'
  const parts = []
  if (health.pid) parts.push(`PID ${health.pid}`)
  if (health.bootId) parts.push(`bootId ${health.bootId}`)
  if (health.startedAt) parts.push(`started ${health.startedAt}`)
  if (health.mode) parts.push(`mode ${health.mode}`)
  return parts.join(', ') || 'available'
}

async function fetchHealth(timeoutMs = 800) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  timeout.unref?.()

  try {
    const response = await fetch(getHealthUrl(), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const payload = await response.json()
    if (!payload || payload.ok !== true || !payload.pid) return null
    return payload
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForHealth({ expectedPid = null, previousBootId = null, requireChanged = false, timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await fetchHealth()
    if (health) {
      const pidMatches = !expectedPid || Number(health.pid) === Number(expectedPid)
      const bootChanged = !requireChanged || !previousBootId || health.bootId !== previousBootId
      if (pidMatches && bootChanged) return health
    }
    await sleep(300)
  }
  return null
}

async function waitForProcessExit(pid, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true
    await sleep(250)
  }
  return !isProcessRunning(pid)
}

async function resolveRunningService() {
  const pidFilePid = await readPid()
  const pidFileAlive = pidFilePid ? isProcessRunning(pidFilePid) : false
  if (pidFilePid && !pidFileAlive) {
    console.log(`Found stale PID file (${pidFilePid}); cleaning it up.`)
    await removePid()
  }

  const health = await fetchHealth()
  if (health?.pid && isProcessRunning(Number(health.pid))) {
    return {
      pid: Number(health.pid),
      source: 'health',
      health,
      pidFilePid,
      pidFileAlive,
    }
  }

  if (pidFileAlive) {
    return {
      pid: pidFilePid,
      source: 'pid-file',
      health: null,
      pidFilePid,
      pidFileAlive,
    }
  }

  return {
    pid: null,
    source: 'none',
    health: null,
    pidFilePid,
    pidFileAlive,
  }
}

async function terminateProcess(pid) {
  if (!pid || !isProcessRunning(pid)) return true

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // The process may have already exited.
  }

  if (await waitForProcessExit(pid, 10000)) return true

  console.log(`PID ${pid} did not exit after SIGTERM; forcing stop...`)
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The process may have already exited.
  }

  return waitForProcessExit(pid, 5000)
}

async function stopResolvedService(service) {
  if (!service?.pid) {
    console.log('QuickForge is not running.')
    return false
  }

  console.log(`Stopping QuickForge (PID ${service.pid}, source: ${service.source})...`)
  if (service.health) console.log(`Current service: ${formatHealth(service.health)}`)
  if (service.pidFilePid && service.pidFilePid !== service.pid) {
    console.log(`PID file points to ${service.pidFilePid}, but active service is PID ${service.pid}; using active service.`)
  }

  const stopped = await terminateProcess(service.pid)
  await removePid()

  if (!stopped) {
    throw new Error(`Timed out stopping QuickForge PID ${service.pid}.`)
  }

  const remaining = await fetchHealth()
  if (remaining?.pid) {
    console.log(`Warning: /api/health still responds after stop: ${formatHealth(remaining)}`)
  } else {
    console.log('QuickForge stopped.')
  }

  return true
}

async function cmdStop() {
  const service = await resolveRunningService()
  await stopResolvedService(service)
}

function lanModeEnabled() {
  return process.env.QUICKFORGE_SHARE_LAN !== '0'
}

function prepareEnvForCommand() {
  const env = { ...process.env }
  if (lanModeEnabled()) {
    env.QUICKFORGE_SHARE_LAN = '1'
    env.QUICKFORGE_ALLOW_REMOTE = '1'
    env.QUICKFORGE_HOST = env.QUICKFORGE_HOST || '0.0.0.0'
  }
  return env
}

async function startService({ previousBootId = null } = {}) {
  const existing = await resolveRunningService()
  if (existing.pid) {
    console.log(`QuickForge is already running (PID ${existing.pid}).`)
    if (existing.health) console.log(`Current service: ${formatHealth(existing.health)}`)
    if (existing.health?.pid && existing.pidFilePid !== existing.health.pid) {
      await writePid(existing.health.pid)
      console.log(`PID file updated: ${getPidFile()}`)
    }
    console.log('Use "quickforge stop" to stop it first, or "quickforge restart".')
    return existing.health
  }

  const serviceUrl = getServiceUrl()
  const healthUrl = getHealthUrl()
  const dataDir = getDataDir()
  const logFile = getLogFile()

  console.log(`Starting QuickForge on ${serviceUrl}...`)
  console.log(`Health check: ${healthUrl}`)

  const child = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: prepareEnvForCommand(),
  })

  let exitInfo = null
  child.once('exit', (code, signal) => {
    exitInfo = { code, signal }
  })

  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })

  console.log(`Spawned server process (PID ${child.pid}). Waiting for service readiness...`)
  const health = await waitForHealth({ expectedPid: child.pid, previousBootId, requireChanged: Boolean(previousBootId) })

  if (!health) {
    const exitReason = exitInfo
      ? `process exited early (code ${exitInfo.code ?? 'null'}, signal ${exitInfo.signal ?? 'null'})`
      : 'health check timed out'

    if (!exitInfo && isProcessRunning(child.pid)) {
      console.log(`Startup ${exitReason}; stopping spawned PID ${child.pid}...`)
      await terminateProcess(child.pid)
    }

    await removePid()
    throw new Error(`QuickForge failed to start: ${exitReason}. Check log: ${logFile}`)
  }

  await writePid(health.pid)
  child.unref()

  console.log(`QuickForge started and verified (${formatHealth(health)}).`)
  console.log(`Open: ${serviceUrl}`)
  console.log(`Data: ${dataDir}`)
  console.log(`Config: ${path.join(dataDir, 'config', 'config.json')}`)
  console.log(`Storage: ${path.join(dataDir, 'storage')}`)
  console.log(`Cache: ${path.join(dataDir, 'cache')}`)
  console.log(`Logs: ${path.join(dataDir, 'logs')}`)
  console.log(`Current log: ${logFile}`)
  console.log('')
  console.log('Commands:')
  console.log('  quickforge stop     Stop the background service')
  console.log('  quickforge restart  Restart the background service')
  console.log('  quickforge status   Check if the service is running')
  console.log('  quickforge logs     Watch today\'s server log')

  return health
}

async function cmdStart() {
  await startService()
}

async function cmdRestart() {
  console.log('Restarting QuickForge...')
  const before = await fetchHealth()
  if (before) {
    console.log(`Before restart: ${formatHealth(before)}`)
  } else {
    console.log('Before restart: no healthy service responded.')
  }

  const service = await resolveRunningService()
  if (service.pid) {
    await stopResolvedService(service)
    await sleep(500)
  } else {
    console.log('No running QuickForge service found; starting a new one.')
  }

  const after = await startService({ previousBootId: before?.bootId || null })
  if (!after) return

  const pidChanged = !before?.pid || Number(after.pid) !== Number(before.pid)
  const bootChanged = !before?.bootId || after.bootId !== before.bootId

  if (pidChanged || bootChanged) {
    console.log(`Restart verified: ${formatHealth(after)}`)
  } else {
    console.log('Warning: service responded after restart, but PID/bootId did not change.')
    process.exitCode = 1
  }
}

async function cmdStatus() {
  const service = await resolveRunningService()
  if (service.health) {
    console.log(`QuickForge is running (${formatHealth(service.health)}).`)
    console.log(`URL: ${getServiceUrl()}`)
    console.log(`Health: ${getHealthUrl()}`)
    console.log(`Log: ${getLogFile()}`)
    if (service.pidFilePid !== service.health.pid) {
      await writePid(service.health.pid)
      console.log(`PID file repaired: ${getPidFile()}`)
    }
    console.log('Watch: quickforge logs')
    return
  }

  if (service.pid) {
    console.log(`QuickForge process is running (PID ${service.pid}), but /api/health is not reachable.`)
    console.log(`Health: ${getHealthUrl()}`)
    console.log(`Log: ${getLogFile()}`)
    return
  }

  console.log('QuickForge is not running.')
}

async function cmdLogs() {
  const args = process.argv.slice(3)
  const jsonMode = args.includes('--json')
  const levelFilter = (() => {
    const idx = args.indexOf('--level')
    if (idx >= 0 && args[idx + 1]) return args[idx + 1].toUpperCase()
    return null
  })()
  const grepFilter = (() => {
    const idx = args.indexOf('--grep')
    if (idx >= 0 && args[idx + 1]) return args[idx + 1]
    return null
  })()

  const logFile = getLogFile()
  await fs.mkdir(path.dirname(logFile), { recursive: true })
  await fs.appendFile(logFile, '', 'utf8')

  console.log(`Watching QuickForge log: ${logFile}`)
  if (levelFilter) console.log(`Filter: level >= ${levelFilter}`)
  if (grepFilter) console.log(`Filter: grep "${grepFilter}"`)
  if (jsonMode) console.log('Format: JSON Lines')

  const escapedLogFile = logFile.replace(/'/g, process.platform === 'win32' ? "''" : "'\\''")
  const tailCmd = process.platform === 'win32'
    ? `powershell.exe -NoProfile -Command "Get-Content -Path '${escapedLogFile}' -Wait -Tail 80"`
    : `tail -n 80 -f '${escapedLogFile}'`

  const transformScript = jsonMode || levelFilter || grepFilter
    ? `
      const LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
      const minLevel = ${levelFilter ? `LEVELS['${levelFilter}'] ?? 0` : '0'};
      const grep = ${grepFilter ? `'${grepFilter}'` : 'null'};
      process.stdin.setEncoding('utf8');
      let buf = '';
      process.stdin.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (LEVELS[obj.level] > minLevel) continue;
            if (grep && !line.includes(grep)) continue;
            ${jsonMode
              ? 'console.log(line);'
              : 'const extra = Object.entries(obj).filter(([k]) => ![\"ts\",\"level\",\"msg\"].includes(k)).map(([k,v]) => k+\"=\"+v).join(\" \"); console.log(obj.ts + \" [\" + obj.level + \"] \" + (obj.msg||\"\") + (extra ? \" \" + extra : \"\"));'
            }
          } catch {
            console.log(line);
          }
        }
      });
    `
    : ''

  if (transformScript) {
    const { spawn: spawn2 } = await import('node:child_process')
    const child = spawn2(process.platform === 'win32' ? 'cmd.exe' : 'sh', [
      process.platform === 'win32' ? '/c' : '-c',
      `${tailCmd} | node -e ${JSON.stringify(transformScript)}`
    ], { stdio: 'inherit', shell: false, windowsVerbatimArguments: true })
    child.on('exit', (code) => process.exit(code || 0))
  } else {
    const { spawn: spawn2 } = await import('node:child_process')
    const tail = spawn2(
      process.platform === 'win32' ? 'powershell.exe' : 'tail',
      process.platform === 'win32'
        ? ['-NoProfile', '-Command', `Get-Content -Path '${logFile.replace(/'/g, "''")}' -Wait -Tail 80`]
        : ['-n', '80', '-f', logFile],
      { stdio: 'inherit', shell: false }
    )
    tail.on('exit', (code) => process.exit(code || 0))
  }
}

async function main() {
  const command = process.argv[2] || 'start'

  switch (command) {
    case 'start':
      await cmdStart()
      break
    case 'lan':
    case '--lan':
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
    case 'logs':
      await cmdLogs()
      break
    case '--version':
    case '-v':
    case 'version':
      await cmdVersion()
      break
    case 'check-update':
      await cmdCheckUpdate()
      break
    case 'update':
      await cmdUpdate()
      break
    case '--help':
    case '-h':
    case 'help':
      console.log('QuickForge CLI')
      console.log('')
      console.log('Usage:')
      console.log('  quickforge              Start as background service (default)')
      console.log('  quickforge start        Start as background service')
      console.log('  quickforge lan          Start LAN sharing mode (binds 0.0.0.0, restricts remote APIs)')
      console.log('  quickforge stop         Stop the background service')
      console.log('  quickforge restart      Restart the background service')
      console.log('  quickforge status       Check if the service is running')
      console.log('  quickforge logs         Watch today\'s server log')
      console.log('  quickforge version      Show installed version')
      console.log('  quickforge --version    Show installed version')
      console.log('  quickforge check-update Check npm for newer version')
      console.log('  quickforge update       Install the latest version from npm')
      console.log('')
      console.log('Config:')
      console.log('  QUICKFORGE_PORT=5176         Server port')
      console.log('  QUICKFORGE_HOST=0.0.0.0      Bind address; set QUICKFORGE_HOST=127.0.0.1 and QUICKFORGE_SHARE_LAN=0 for local-only mode')
      console.log('  QUICKFORGE_SHARE_LAN=1       Enable LAN sharing mode and restrict remote non-share APIs (default)')
      console.log('  QUICKFORGE_ALLOW_REMOTE=1    Allow explicit remote binding')
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

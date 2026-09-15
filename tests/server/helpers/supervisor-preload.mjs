// Only loaded in the controlled test child, before the production entry point.
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

const config = JSON.parse(readFileSync(process.env.QF_SUPERVISOR_FIXTURE, 'utf8'))
const blocked = () => { throw new Error('Real child process execution is forbidden in supervisor tests') }

// No alternate child_process API may escape the fixture, including direct use
// of ChildProcess. Never retain/call the original spawn, even for unknown commands.
for (const name of ['exec', 'execFile', 'execSync', 'execFileSync', 'spawnSync', 'fork']) {
  childProcess[name] = blocked
}
childProcess.ChildProcess.prototype.spawn = blocked
childProcess.spawn = (command, args, options = {}) => {
  const isNpm = command === (process.platform === 'win32' ? 'npm.cmd' : 'npm')
  const isServer = command === process.execPath && args[0] === config.serverScript
  if (!isNpm && !isServer) return blocked()

  appendFileSync(config.callsFile, `${JSON.stringify({
    command, args, cwd: options.cwd || process.cwd(),
    detached: options.detached, stdio: options.stdio,
    shell: options.shell, windowsHide: options.windowsHide,
  })}\n`)
  const child = new EventEmitter()
  child.pid = 123456
  child.unref = () => {
    appendFileSync(config.unrefFile, 'unref\n')
  }
  if (isNpm) {
    // Async emission lets production install its error/exit listeners first.
    queueMicrotask(() => {
      if (config.npmError) child.emit('error', new Error('Simulated npm spawn failure'))
      else child.emit('exit', config.npmExitCode, null)
    })
  } else {
    writeFileSync(config.outputFile, JSON.stringify({
      noOpen: options.env?.QUICKFORGE_NO_OPEN,
      restartedFromUi: options.env?.QUICKFORGE_RESTARTED_FROM_UI,
      restartedFromUpdate: options.env?.QUICKFORGE_RESTARTED_FROM_UPDATE,
      args: args.slice(1),
      cwd: options.cwd || process.cwd(),
    }))
  }
  return child
}
syncBuiltinESMExports()

// Exercise the actual polling loop without probing/signalling a real user PID.
process.kill = (pid, signal) => {
  if (pid !== config.oldPid || signal !== 0) return blocked()
  writeFileSync(config.probeFile, 'probed')
  if (existsSync(config.aliveFile)) return true
  throw Object.assign(new Error('Simulated old process exit'), { code: 'ESRCH' })
}

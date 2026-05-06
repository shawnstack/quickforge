#!/usr/bin/env node
import { spawn } from 'node:child_process'

const [oldPidArg, serverScript, cwd, ...serverArgs] = process.argv.slice(2)
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

for (let i = 0; i < 600 && isProcessRunning(oldPid); i += 1) {
  await sleep(100)
}

const child = spawn(process.execPath, [serverScript, ...serverArgs], {
  cwd: cwd || undefined,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  shell: false,
  env: {
    ...process.env,
    QUICKFORGE_NO_OPEN: '1',
    QUICKFORGE_RESTARTED_FROM_UI: '1',
  },
})

child.unref()

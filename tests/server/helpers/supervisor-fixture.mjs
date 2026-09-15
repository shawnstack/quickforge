import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const helpersDir = path.dirname(fileURLToPath(import.meta.url))
const preload = path.join(helpersDir, 'supervisor-preload.mjs')

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout(promise, timeoutMs = 4000) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for test child')), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function waitForFile(file) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    try {
      return await readFile(file, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await sleep(25)
    }
  }
  throw new Error(`Timed out waiting for fixture file: ${file}`)
}

// Each test owns its directory and every real child it starts. The only real
// process is an absolute Node executable with a mandatory preload; neither
// npm, recorder/server nor old-PID helper processes are ever executed.
export async function withSupervisorFixture(run) {
  const tmpDir = await mkdtemp(path.join(helpersDir, '.supervisor-fixture-'))
  const children = []
  const config = {
    oldPid: 424242,
    npmExitCode: 0,
    serverScript: path.join(tmpDir, 'never-executed-server.mjs'),
    outputFile: path.join(tmpDir, 'server.json'),
    callsFile: path.join(tmpDir, 'calls.jsonl'),
    unrefFile: path.join(tmpDir, 'unref.log'),
    probeFile: path.join(tmpDir, 'old-pid-probed'),
    aliveFile: path.join(tmpDir, 'old-pid-alive'),
  }
  const configFile = path.join(tmpDir, 'fixture.json')
  const fixture = {
    tmpDir,
    ...config,
    logFile: path.join(tmpDir, 'logs', 'update.log'),
    keepOldAlive: () => writeFile(config.aliveFile, 'alive'),
    exitOld: () => rm(config.aliveFile, { force: true }),
    readCalls: async () => (await readFile(config.callsFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)),
    readRecord: async () => JSON.parse(await readFile(config.outputFile, 'utf8')),
    async start(scriptName, args, options = {}) {
      await writeFile(configFile, JSON.stringify({ ...config, ...options.mock }))
      // Deliberately do not inherit PATH, NODE_OPTIONS, NODE_PATH or other user
      // environment hooks. Missing/broken preload makes Node fail before entry.
      const child = spawn(process.execPath, [
        '--import', pathToFileURL(preload).href,
        path.resolve(helpersDir, '../../../server', scriptName), ...args,
      ], {
        cwd: options.cwd || tmpDir,
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: false,
        shell: false,
        windowsHide: true,
        env: {
          ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
          PATH: '',
          QF_SUPERVISOR_FIXTURE: configFile,
        },
      })
      let stderr = ''
      let spawnError
      child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
      // Register immediately, including spawn errors; resolve rather than reject
      // so an early failure cannot create an unhandled rejection before wait().
      const exited = new Promise((resolve) => {
        child.once('error', (error) => {
          spawnError = error
          resolve({ error })
        })
        child.once('exit', (code, signal) => resolve({ code, signal }))
      })
      const closed = new Promise((resolve) => child.once('close', resolve))
      const managed = {
        async wait() {
          const result = await withTimeout(exited)
          await withTimeout(closed)
          if (result.error) throw result.error
          return { ...result, stderr }
        },
        async stop() {
          if (!spawnError && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
          await withTimeout(closed)
        },
      }
      children.push(managed)
      return managed
    },
  }
  try {
    return await run(fixture)
  } finally {
    // Stop ALL children even if one cleanup fails. Do not remove the fixture
    // unless every child has closed; no detached grandchildren exist in this model.
    const results = await Promise.allSettled(children.map((child) => child.stop()))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure) throw failure.reason
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

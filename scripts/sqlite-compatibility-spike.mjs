import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const BUSY_TIMEOUT_MS = 5_000
const LOCK_HOLD_MS = 600
const HARD_TIMEOUT_MS = 20_000
const WORKER_TIMEOUT_MS = 12_000

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function writeSignal(signal, details = {}) {
  process.stdout.write(`${JSON.stringify({ signal, ...details })}\n`)
}

function waitForInputLine(expected, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for worker input: ${expected}`))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      process.stdin.off('data', onData)
      process.stdin.off('end', onEnd)
    }

    function onData(chunk) {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      if (lines.includes(expected)) {
        cleanup()
        resolve()
      }
    }

    function onEnd() {
      cleanup()
      reject(new Error(`Worker input ended before receiving: ${expected}`))
    }

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', onData)
    process.stdin.once('end', onEnd)
    process.stdin.resume()
  })
}

function runLockWorker(databasePath) {
  const database = new DatabaseSync(databasePath)
  let transactionOpen = false
  return (async () => {
    try {
      database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
      database.exec('BEGIN IMMEDIATE')
      transactionOpen = true
      database.prepare('INSERT INTO concurrency_events (actor) VALUES (?)').run('A')
      writeSignal('locked')
      await waitForInputLine('release', WORKER_TIMEOUT_MS)
      database.exec('COMMIT')
      transactionOpen = false
      writeSignal('released')
    } catch (error) {
      if (transactionOpen) {
        try {
          database.exec('ROLLBACK')
        } catch {
          // Preserve the original worker failure.
        }
      }
      throw error
    } finally {
      database.close()
    }
  })()
}

function runWriterWorker(databasePath) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
    writeSignal('ready')
    const startedAt = Date.now()
    database.prepare('INSERT INTO concurrency_events (actor) VALUES (?)').run('B')
    writeSignal('written', { elapsedMs: Date.now() - startedAt })
  } finally {
    database.close()
  }
}

function createWorker(databasePath, role) {
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, 'sqlite-compatibility-spike.mjs'), '--worker', role, databasePath], {
    cwd: process.cwd(),
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
  })
  const signals = []
  const waiters = new Set()
  let stderr = ''
  let stdoutBuffer = ''

  function notify() {
    for (const waiter of waiters) waiter()
  }

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        signals.push(JSON.parse(line))
      } catch {
        signals.push({ signal: 'invalid-output', line })
      }
    }
    notify()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
    notify()
  })
  child.on('error', notify)
  child.on('close', notify)

  function diagnostics() {
    return `role=${role}, exitCode=${child.exitCode}, signals=${JSON.stringify(signals)}, stderr=${stderr.trim()}`
  }

  function waitForSignal(signal, timeoutMs = WORKER_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for worker signal "${signal}" (${diagnostics()})`))
      }, timeoutMs)

      function cleanup() {
        clearTimeout(timer)
        waiters.delete(check)
      }

      function check() {
        const match = signals.find((entry) => entry.signal === signal)
        if (match) {
          cleanup()
          resolve(match)
          return
        }
        if (child.exitCode !== null) {
          cleanup()
          reject(new Error(`Worker exited before signal "${signal}" (${diagnostics()})`))
        }
      }

      waiters.add(check)
      check()
    })
  }

  function waitForSuccess(timeoutMs = WORKER_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for worker exit (${diagnostics()})`))
      }, timeoutMs)

      function cleanup() {
        clearTimeout(timer)
        child.off('close', onClose)
        child.off('error', onError)
      }

      function onClose(code) {
        cleanup()
        if (code === 0) resolve()
        else reject(new Error(`Worker exited with code ${code} (${diagnostics()})`))
      }

      function onError(error) {
        cleanup()
        reject(new Error(`Worker failed to start: ${error.message} (${diagnostics()})`))
      }

      if (child.exitCode !== null) onClose(child.exitCode)
      else {
        child.once('close', onClose)
        child.once('error', onError)
      }
    })
  }

  return { child, signals, waitForSignal, waitForSuccess }
}

async function stopWorker(worker) {
  if (!worker || worker.child.exitCode !== null) return
  const child = worker.child
  child.stdin.destroy()
  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 1_000)
    child.once('close', () => {
      clearTimeout(forceTimer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

async function runTwoProcessConcurrency(databasePath, workers) {
  const locker = createWorker(databasePath, 'locker')
  workers.add(locker)
  await locker.waitForSignal('locked')

  const writer = createWorker(databasePath, 'writer')
  workers.add(writer)
  await writer.waitForSignal('ready')
  await delay(LOCK_HOLD_MS)
  locker.child.stdin.end('release\n')

  const [released, written] = await Promise.all([
    locker.waitForSignal('released'),
    writer.waitForSignal('written'),
  ])
  await Promise.all([locker.waitForSuccess(), writer.waitForSuccess()])
  workers.delete(locker)
  workers.delete(writer)

  const database = new DatabaseSync(databasePath)
  try {
    const actors = database.prepare('SELECT actor FROM concurrency_events ORDER BY id').all().map((row) => row.actor)
    const waitedForLock = written.elapsedMs >= Math.floor(LOCK_HOLD_MS / 2)
    if (!waitedForLock) {
      throw new Error(`Concurrent writer did not wait for the held lock (${written.elapsedMs}ms)`)
    }
    if (actors.join(',') !== 'A,B') {
      throw new Error(`Unexpected concurrent write order: ${actors.join(',')}`)
    }
    return {
      passed: true,
      signals: ['locked', 'ready', released.signal, written.signal],
      writerElapsedMs: written.elapsedMs,
      waitedForLock,
      actors,
    }
  } finally {
    database.close()
  }
}

async function executeProbe(databasePath, workers) {
  const database = new DatabaseSync(databasePath)
  let sqliteVersion
  let crud
  let rollback
  let wal
  let busyTimeout
  try {
    sqliteVersion = database.prepare('SELECT sqlite_version() AS version').get().version
    database.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    const inserted = database.prepare('INSERT INTO items (name) VALUES (?)').run('alpha')
    database.prepare('UPDATE items SET name = ? WHERE id = ?').run('beta', inserted.lastInsertRowid)
    const updated = database.prepare('SELECT id, name FROM items WHERE id = ?').get(inserted.lastInsertRowid)
    database.prepare('DELETE FROM items WHERE id = ?').run(inserted.lastInsertRowid)
    const remaining = database.prepare('SELECT COUNT(*) AS count FROM items').get().count
    crud = {
      passed: updated?.name === 'beta' && remaining === 0,
      insertedId: Number(inserted.lastInsertRowid),
      updatedName: updated?.name,
      remainingRows: Number(remaining),
    }
    if (!crud.passed) throw new Error(`CRUD verification failed: ${JSON.stringify(crud)}`)

    database.exec('BEGIN')
    database.prepare('INSERT INTO items (name) VALUES (?)').run('rolled-back')
    database.exec('ROLLBACK')
    const rolledBackRows = database.prepare("SELECT COUNT(*) AS count FROM items WHERE name = 'rolled-back'").get().count
    rollback = { passed: rolledBackRows === 0, remainingRows: Number(rolledBackRows) }
    if (!rollback.passed) throw new Error(`Rollback verification failed: ${JSON.stringify(rollback)}`)

    const journalMode = String(database.prepare('PRAGMA journal_mode = WAL').get().journal_mode).toLowerCase()
    wal = { passed: journalMode === 'wal', journalMode }
    if (!wal.passed) throw new Error(`WAL verification failed: ${JSON.stringify(wal)}`)

    database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
    const configuredBusyTimeout = Number(database.prepare('PRAGMA busy_timeout').get().timeout)
    busyTimeout = { passed: configuredBusyTimeout === BUSY_TIMEOUT_MS, milliseconds: configuredBusyTimeout }
    if (!busyTimeout.passed) throw new Error(`busy_timeout verification failed: ${JSON.stringify(busyTimeout)}`)

    database.exec('CREATE TABLE concurrency_events (id INTEGER PRIMARY KEY, actor TEXT NOT NULL)')
  } finally {
    database.close()
  }

  const twoProcessConcurrency = await runTwoProcessConcurrency(databasePath, workers)
  return {
    runtime: {
      node: process.versions.node,
      electron: process.versions.electron ?? null,
      sqlite: sqliteVersion,
    },
    crud,
    rollback,
    wal,
    busyTimeout,
    twoProcessConcurrency,
  }
}

export async function runSqliteCompatibilitySpike({ hardTimeoutMs = HARD_TIMEOUT_MS } = {}) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-sqlite-spike-'))
  const databasePath = path.join(temporaryDirectory, 'compatibility.sqlite')
  const workers = new Set()
  let timeout
  let summary
  try {
    summary = await Promise.race([
      executeProbe(databasePath, workers),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`SQLite compatibility spike exceeded ${hardTimeoutMs}ms hard timeout`)), hardTimeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
    await Promise.all([...workers].map((worker) => stopWorker(worker)))
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
  return {
    ok: true,
    ...summary,
    temporaryDatabase: {
      path: databasePath,
      fileBacked: true,
      cleanedUp: true,
    },
  }
}

async function runWorkerFromCli(role, databasePath) {
  if (!databasePath) throw new Error('Worker database path is required')
  if (role === 'locker') await runLockWorker(databasePath)
  else if (role === 'writer') runWriterWorker(databasePath)
  else throw new Error(`Unknown worker role: ${role}`)
}

function isDirectRun() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
}

if (isDirectRun()) {
  const [, , mode, role, databasePath] = process.argv
  try {
    if (mode === '--worker') await runWorkerFromCli(role, databasePath)
    else process.stdout.write(`${JSON.stringify(await runSqliteCompatibilitySpike())}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  }
}

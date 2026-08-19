#!/usr/bin/env node
/**
 * synchronous=NORMAL vs FULL benchmark — session save hot path.
 *
 * Decision-first: the design review (§3.3) flagged that WAL+synchronous=NORMAL
 * trades an OS-crash/power-loss durability window for speed, but the actual
 * cost of FULL was never measured. This script measures both settings against
 * the session save hot path so the PRAGMA decision in
 * docs/architecture/sqlite-storage-foundation.zh-CN.md is evidence-based.
 *
 * It runs against an isolated mkdtemp directory ONLY and never touches the
 * real ~/.quickforge. It is a developer tool; it does not enter runtime or
 * regular CI.
 *
 * Workloads (both against a table shaped like session_states):
 *  a. small-tx:   N single-row upserts, each in its own transaction
 *                 (simulates one save per message, state_json ~50KB)
 *  b. bulk-tx:    N upserts inside ONE transaction (simulates cutover import)
 *
 * Usage:
 *   node scripts/sqlite-synchronous-benchmark.mjs [--ops N] [--runs N] [--stateKb N]
 *
 * Output: a readable table on stdout with per-config totals, per-op averages,
 * and the FULL/NORMAL ratio per workload.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const BUSY_TIMEOUT_MS = 5_000
const DEFAULT_OPS = 2_000
const DEFAULT_RUNS = 3
const DEFAULT_STATE_KB = 50
const WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation',
]

function parseArgs() {
  let ops = DEFAULT_OPS
  let runs = DEFAULT_RUNS
  let stateKb = DEFAULT_STATE_KB
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--ops') ops = Number(args[++index]) || DEFAULT_OPS
    else if (arg === '--runs') runs = Number(args[++index]) || DEFAULT_RUNS
    else if (arg === '--stateKb' || arg === '--state-kb') stateKb = Number(args[++index]) || DEFAULT_STATE_KB
  }
  return { ops, runs, stateKb }
}

function elapsedMs(start) {
  return Number(process.hrtime.bigint() - start) / 1_000_000
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function fillerState(index, bytes) {
  let text = `{"session":"bench-${index}","messages":"`
  while (text.length < bytes) text += `${WORDS[(text.length + index) % WORDS.length]} `
  return `${text.slice(0, bytes - 2)}"}`
}

function openDatabase(databasePath, synchronous) {
  const database = new DatabaseSync(databasePath)
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  database.exec('PRAGMA journal_mode = WAL')
  database.exec(`PRAGMA synchronous = ${synchronous}`)
  database.exec(`
    CREATE TABLE IF NOT EXISTS session_states (
      scope TEXT NOT NULL,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      PRIMARY KEY (scope, project_id, session_id)
    )
  `)
  return database
}

// Workload a: N independent single-row upsert transactions.
function measureSmallTransactions(database, upsert, ops, stateBytes) {
  const start = process.hrtime.bigint()
  for (let index = 0; index < ops; index += 1) {
    database.exec('BEGIN IMMEDIATE')
    upsert.run('global', '-', `small-${index}`, fillerState(index, stateBytes))
    database.exec('COMMIT')
  }
  return elapsedMs(start)
}

// Workload b: N upserts inside a single transaction.
function measureBulkTransaction(database, upsert, ops, stateBytes) {
  const start = process.hrtime.bigint()
  database.exec('BEGIN IMMEDIATE')
  for (let index = 0; index < ops; index += 1) {
    upsert.run('global', '-', `bulk-${index}`, fillerState(index, stateBytes))
  }
  database.exec('COMMIT')
  return elapsedMs(start)
}

function measureConfig(directory, synchronous, { ops, runs, stateKb }) {
  const stateBytes = stateKb * 1024
  const smallTx = []
  const bulkTx = []
  for (let run = 0; run < runs; run += 1) {
    // Fresh database file per run so WAL/checkpoint state does not skew runs.
    const databasePath = path.join(directory, `bench-${synchronous.toLowerCase()}-${run}.db`)
    const database = openDatabase(databasePath, synchronous)
    const upsert = database.prepare(`
      INSERT INTO session_states (scope, project_id, session_id, state_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (scope, project_id, session_id)
      DO UPDATE SET state_json = excluded.state_json
    `)
    try {
      smallTx.push(measureSmallTransactions(database, upsert, ops, stateBytes))
      bulkTx.push(measureBulkTransaction(database, upsert, ops, stateBytes))
    } finally {
      database.close()
    }
  }
  return { smallTx: median(smallTx), bulkTx: median(bulkTx) }
}

function formatRow(cells, widths) {
  return `| ${cells.map((cell, index) => String(cell).padEnd(widths[index])).join(' | ')} |`
}

async function main() {
  const options = parseArgs()
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-sync-bench-'))
  try {
    console.log(`synchronous benchmark: ops=${options.ops}, runs=${options.runs}, state_json≈${options.stateKb}KB`)
    console.log(`node=${process.version} sqlite=${new DatabaseSync(':memory:').prepare('SELECT sqlite_version() AS v').get().v} os=${os.platform()} ${os.release()} (${os.arch()})`)
    console.log('')

    const results = {}
    for (const synchronous of ['NORMAL', 'FULL']) {
      results[synchronous] = measureConfig(directory, synchronous, options)
    }

    const rows = []
    for (const [workload, label] of [['smallTx', 'small-tx (per-message save)'], ['bulkTx', 'bulk-tx (cutover import)']]) {
      const normal = results.NORMAL[workload]
      const full = results.FULL[workload]
      rows.push([label, 'NORMAL', normal.toFixed(1), (normal / options.ops).toFixed(3), '1.00x'])
      rows.push([label, 'FULL', full.toFixed(1), (full / options.ops).toFixed(3), `${(full / normal).toFixed(2)}x`])
    }

    const header = ['workload', 'synchronous', 'total ms', 'avg ms/op', 'ratio vs NORMAL']
    const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => String(row[column]).length)))
    console.log(formatRow(header, widths))
    console.log(`| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`)
    for (const row of rows) console.log(formatRow(row, widths))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

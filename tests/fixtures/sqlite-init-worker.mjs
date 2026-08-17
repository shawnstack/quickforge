import { initializeSqliteStorage, closeSqliteStorage } from '../../server/sqlite/database.mjs'

const databasePath = process.argv[2]
if (!databasePath) throw new Error('database path is required')

try {
  const storage = await initializeSqliteStorage({ databasePath })
  process.stdout.write(`${JSON.stringify(storage.health())}\n`)
} finally {
  await closeSqliteStorage()
}

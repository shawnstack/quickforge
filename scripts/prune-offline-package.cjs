const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const targetDir = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(root, 'package-offline', 'node_modules')

const removableExtensions = new Set([
  '.map',
  '.ts',
  '.mts',
  '.cts',
  '.tsbuildinfo',
])

let removedFiles = 0
let removedBytes = 0

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

function pruneDirectory(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      pruneDirectory(fullPath)
      continue
    }

    if (!entry.isFile()) continue
    if (!removableExtensions.has(path.extname(entry.name))) continue

    const { size } = fs.statSync(fullPath)
    fs.rmSync(fullPath, { force: true })
    removedFiles += 1
    removedBytes += size
  }
}

if (!fs.existsSync(targetDir)) {
  console.error(`Cannot prune offline package: ${targetDir} does not exist.`)
  process.exit(1)
}

pruneDirectory(targetDir)

const displayPath = path.relative(root, targetDir) || targetDir
console.log(`Pruned ${removedFiles} non-runtime files (${formatMiB(removedBytes)}) from ${displayPath}.`)

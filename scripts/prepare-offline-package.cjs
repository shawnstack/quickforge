const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'package-offline')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const copyEntries = ['bin', 'server', 'skills', 'plugins', 'dist', 'README.md', 'LICENSE']
for (const entry of copyEntries) {
  const source = path.join(root, entry)
  if (!fs.existsSync(source)) continue
  fs.cpSync(source, path.join(outDir, entry), { recursive: true })
}

const offlineOptionalDependencies = new Set([
  '@vscode/ripgrep',
])

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
delete pkg.devDependencies
delete pkg.scripts

pkg.optionalDependencies = { ...(pkg.optionalDependencies || {}) }
for (const name of offlineOptionalDependencies) {
  if (!pkg.dependencies?.[name]) continue
  pkg.optionalDependencies[name] = pkg.dependencies[name]
  delete pkg.dependencies[name]
}

delete pkg.bundledDependencies
fs.writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

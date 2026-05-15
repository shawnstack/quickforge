const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const distDir = path.join(root, 'package-dist')
fs.rmSync(distDir, { recursive: true, force: true })
fs.mkdirSync(distDir, { recursive: true })

const copyEntries = ['bin', 'server', 'skills', 'dist', 'README.md', 'LICENSE']
for (const entry of copyEntries) {
  const source = path.join(root, entry)
  if (!fs.existsSync(source)) continue
  fs.cpSync(source, path.join(distDir, entry), { recursive: true })
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
delete pkg.devDependencies
delete pkg.scripts
fs.writeFileSync(path.join(distDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

const fs = require('fs')
const path = require('path')

const distDir = path.join(__dirname, '..', 'package-dist')
fs.rmSync(distDir, { recursive: true, force: true })
fs.mkdirSync(distDir, { recursive: true })

const copyEntries = ['bin', 'server', 'skills', 'dist', 'README.md', 'LICENSE']
for (const entry of copyEntries) {
  fs.cpSync(path.join(__dirname, '..', entry), path.join(distDir, entry), { recursive: true })
}

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
delete pkg.devDependencies
delete pkg.scripts
fs.writeFileSync(path.join(distDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

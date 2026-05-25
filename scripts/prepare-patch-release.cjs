#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const nodeCmd = process.execPath
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const gitCmd = process.platform === 'win32' ? 'git.exe' : 'git'

function usage() {
  console.log(`Prepare a QuickForge patch release.

Usage:
  npm run release:patch:prepare -- [options]
  node scripts/prepare-patch-release.cjs [options]

Options:
  --notes <markdown>       Use explicit CHANGELOG markdown before the Released section.
  --notes-file <path>      Read explicit CHANGELOG markdown from a UTF-8 file.
  --skip-version           Do not run npm version patch; use the current package.json version.
                           Useful when resuming after a failed release-prep command.
  --no-build               Skip npm run build.
  --no-lint                Skip npm run lint.
  --no-pack                Skip runtime/offline package generation.
  --dry-run                Print the planned actions without changing files or running checks.
  -h, --help               Show this help.

The script updates package.json/package-lock.json, README.md and CHANGELOG.md,
runs build/lint, prepares package-dist and package-offline, and creates the
offline tarball. It does not commit, tag, push, or publish to npm.
`)
}

function parseArgs(argv) {
  const options = {
    build: true,
    lint: true,
    pack: true,
    skipVersion: false,
    dryRun: false,
    notes: '',
    notesFile: '',
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      options.help = true
    } else if (arg === '--no-build') {
      options.build = false
    } else if (arg === '--no-lint') {
      options.lint = false
    } else if (arg === '--no-pack') {
      options.pack = false
    } else if (arg === '--skip-version') {
      options.skipVersion = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--notes') {
      i += 1
      if (i >= argv.length) throw new Error('--notes requires a value')
      options.notes = argv[i]
    } else if (arg === '--notes-file') {
      i += 1
      if (i >= argv.length) throw new Error('--notes-file requires a value')
      options.notesFile = argv[i]
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  if (options.notes && options.notesFile) {
    throw new Error('Use only one of --notes or --notes-file')
  }
  return options
}

function commandText(command, args) {
  return [command, ...args].map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

function run(command, args, options = {}) {
  const cwd = options.cwd || root
  console.log(`\n$ ${commandText(command, args)}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${commandText(command, args)}`)
  }
}

function capture(command, args, options = {}) {
  const cwd = options.cwd || root
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false })
  if (result.error) return ''
  if (result.status !== 0) return ''
  return result.stdout.trim()
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`Unsupported version format for patch bump: ${version}`)
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

function today() {
  const date = new Date()
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractReadmeVersion() {
  const readmePath = path.join(root, 'README.md')
  if (!fs.existsSync(readmePath)) return ''
  const text = fs.readFileSync(readmePath, 'utf8')
  const badge = /badge\/version-(\d+\.\d+\.\d+)-blue/.exec(text)
  if (badge) return badge[1]
  const install = /@shawnstack\/quickforge@(\d+\.\d+\.\d+)/.exec(text)
  return install ? install[1] : ''
}

function replaceKnownVersionRefs(text, oldVersion, newVersion) {
  if (!oldVersion || oldVersion === newVersion) return text
  let updated = text.replace(new RegExp(escapeRegExp(oldVersion), 'g'), newVersion)
  updated = updated.replace(new RegExp(`v${escapeRegExp(oldVersion)}`, 'g'), `v${newVersion}`)
  return updated
}

function updateReadme(oldVersion, newVersion) {
  const readmePath = path.join(root, 'README.md')
  let text = fs.readFileSync(readmePath, 'utf8')
  const before = text
  text = replaceKnownVersionRefs(text, oldVersion, newVersion)
  text = text.replace(/badge\/version-\d+\.\d+\.\d+-blue/g, `badge/version-${newVersion}-blue`)
  text = text.replace(/@shawnstack\/quickforge@\d+\.\d+\.\d+/g, `@shawnstack/quickforge@${newVersion}`)
  text = text.replace(/shawnstack-quickforge-\d+\.\d+\.\d+\.tgz/g, `shawnstack-quickforge-${newVersion}.tgz`)
  if (text !== before) fs.writeFileSync(readmePath, text.replace(/\r\n/g, '\n'))
}

function statusFiles(statusText) {
  return statusText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^.* -> /, ''))
}

function cleanSubject(subject) {
  const conventional = /^(\w+)(?:\([^)]+\))?!?:\s*(.+)$/.exec(subject)
  const text = conventional ? conventional[2] : subject
  return text.trim().replace(/^./, (char) => char.toUpperCase())
}

function categorizeSubject(subject) {
  const conventional = /^(\w+)(?:\([^)]+\))?!?:/.exec(subject)
  const type = conventional ? conventional[1] : ''
  if (type === 'feat') return 'Added'
  if (type === 'fix') return 'Fixed'
  return 'Changed'
}

function formatFileList(files) {
  const generatedPrefixes = ['package-offline/', 'package-dist/', 'dist/']
  const ignoredFiles = new Set([
    'CHANGELOG.md',
    'README.md',
    'package.json',
    'package-lock.json',
    'package-offline',
    'package-dist',
    'dist',
  ])
  const unique = [...new Set(files)].filter((file) => {
    if (ignoredFiles.has(file)) return false
    return !generatedPrefixes.some((prefix) => file.startsWith(prefix))
  })
  if (unique.length === 0) return ''
  const shown = unique.slice(0, 6).map((file) => `\`${file}\``).join(', ')
  return unique.length > 6 ? `${shown}, and ${unique.length - 6} more files` : shown
}

function generatedNotes(lastTag, initialStatus) {
  const sections = {
    Added: [],
    Changed: [],
    Fixed: [],
  }

  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
  const log = capture(gitCmd, ['log', '--format=%s', range])
  for (const subject of log.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    if (/^chore\(release\):/.test(subject)) continue
    sections[categorizeSubject(subject)].push(`- ${cleanSubject(subject)}.`)
  }

  const files = formatFileList(statusFiles(initialStatus))
  if (files) sections.Changed.push(`- Included working tree updates in ${files}.`)
  if (!sections.Added.length && !sections.Changed.length && !sections.Fixed.length) {
    sections.Changed.push('- Prepared patch release maintenance updates.')
  }

  return ['Added', 'Changed', 'Fixed']
    .filter((section) => sections[section].length)
    .map((section) => `### ${section}\n\n${sections[section].join('\n')}`)
    .join('\n\n')
}

function releaseBlock(version) {
  return `### Released\n\n- Prepared \`@shawnstack/quickforge@${version}\` for npm publishing with the \`latest\` tag.\n- Built offline installation tarball: \`package-offline/shawnstack-quickforge-${version}.tgz\`.\n- The offline tarball bundles runtime dependencies and can be installed with:\n\n  \`\`\`bash\n  npm install -g ./package-offline/shawnstack-quickforge-${version}.tgz\n  \`\`\``
}

function updateChangelog(version, date, notes) {
  const changelogPath = path.join(root, 'CHANGELOG.md')
  let text = fs.readFileSync(changelogPath, 'utf8')
  if (new RegExp(`^## \\[${escapeRegExp(version)}\\]`, 'm').test(text)) {
    console.log(`CHANGELOG.md already contains ${version}; leaving it unchanged.`)
    return
  }

  const marker = /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/m.exec(text)
  if (!marker) throw new Error('Could not find the first version heading in CHANGELOG.md')

  const body = `${notes.trim()}\n\n${releaseBlock(version)}`
  const entry = `## [${version}] - ${date}\n\n${body}\n\n`
  text = `${text.slice(0, marker.index)}${entry}${text.slice(marker.index)}`
  fs.writeFileSync(changelogPath, text.replace(/\r\n/g, '\n'))
}

function readNotes(options, lastTag, initialStatus) {
  if (options.notes) return options.notes
  if (options.notesFile) {
    const notesPath = path.isAbsolute(options.notesFile) ? options.notesFile : path.join(root, options.notesFile)
    return fs.readFileSync(notesPath, 'utf8')
  }
  return generatedNotes(lastTag, initialStatus)
}

function printSummary(version, branch) {
  const tarball = path.join(root, 'package-offline', `shawnstack-quickforge-${version}.tgz`)
  const relativeTarball = `package-offline/shawnstack-quickforge-${version}.tgz`

  console.log('\nPatch release preparation complete.')
  console.log(`Version: ${version}`)
  console.log(`Branch: ${branch || '(unknown)'}`)
  if (fs.existsSync(tarball)) {
    const sizeMb = fs.statSync(tarball).size / 1024 / 1024
    console.log(`Offline tarball: ${relativeTarball} (${sizeMb.toFixed(1)} MiB)`)
  } else {
    console.log(`Offline tarball: ${relativeTarball} (not generated)`)
  }

  console.log('\nReview before committing:')
  console.log('  git diff -- CHANGELOG.md README.md package.json package-lock.json')
  console.log('  git status --short')
  console.log('\nGit release commands:')
  console.log('  git add package.json package-lock.json CHANGELOG.md README.md <release-content-files>')
  console.log(`  git commit -m "chore(release): v${version}"`)
  console.log(`  git tag v${version}`)
  console.log(`  git push origin ${branch || '<branch>'} --tags`)
  console.log('\nManual npm publish command after Git push:')
  console.log('  cd package-offline')
  console.log('  npm publish --access public')
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    usage()
    return
  }

  const initialStatus = capture(gitCmd, ['status', '--short'])
  const branch = capture(gitCmd, ['branch', '--show-current'])
  const lastTag = capture(gitCmd, ['describe', '--tags', '--abbrev=0'])
  const packageJson = readJson('package.json')
  const oldVersion = options.skipVersion ? (extractReadmeVersion() || packageJson.version) : packageJson.version
  const plannedVersion = options.skipVersion ? packageJson.version : bumpPatch(packageJson.version)
  const notes = readNotes(options, lastTag, initialStatus)

  console.log('Patch release preflight:')
  console.log(`  branch: ${branch || '(unknown)'}`)
  console.log(`  last tag: ${lastTag || '(none)'}`)
  console.log(`  current package version: ${packageJson.version}`)
  console.log(`  target version: ${plannedVersion}`)
  console.log(`  build: ${options.build ? 'yes' : 'no'}`)
  console.log(`  lint: ${options.lint ? 'yes' : 'no'}`)
  console.log(`  package: ${options.pack ? 'yes' : 'no'}`)
  if (initialStatus) {
    console.log('\nCurrent working tree changes will be included in the release if you commit them:')
    console.log(initialStatus)
  }

  if (capture(gitCmd, ['tag', '--list', `v${plannedVersion}`])) {
    throw new Error(`Tag v${plannedVersion} already exists; refusing to continue.`)
  }

  if (options.dryRun) {
    console.log('\nDry run only. No files changed and no checks were run.')
    return
  }

  let version = plannedVersion
  if (!options.skipVersion) {
    run(npmCmd, ['version', 'patch', '--no-git-tag-version'])
    version = readJson('package.json').version
  }

  if (version !== plannedVersion) {
    throw new Error(`Expected version ${plannedVersion}, got ${version}`)
  }

  updateReadme(oldVersion, version)
  updateChangelog(version, today(), notes)

  if (options.build) run(npmCmd, ['run', 'build'])
  if (options.lint) run(npmCmd, ['run', 'lint'])

  if (options.pack) {
    run(nodeCmd, ['scripts/prepare-runtime-package.cjs'])
    run(nodeCmd, ['scripts/prepare-offline-package.cjs'])
    run(npmCmd, ['install', '--omit=dev', '--ignore-scripts'], { cwd: path.join(root, 'package-offline') })
    run(nodeCmd, ['scripts/prune-offline-package.cjs'])
    run(npmCmd, ['pack'], { cwd: path.join(root, 'package-offline') })
  }

  printSummary(version, branch)
}

try {
  main()
} catch (error) {
  console.error(`\nRelease preparation failed: ${error.message}`)
  process.exitCode = 1
}

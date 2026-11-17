#!/usr/bin/env node
// 发版一致性体检（只读，不改任何文件）。用法：
//   npm run check:release
//   node scripts/check-release-consistency.mjs
//
// 三项检查：
//   1. 版本三处一致：package.json 的 version ↔ CHANGELOG.md 最新的 ## [X.Y.Z]（只认
//      X.Y.Z 形状的标题，[Unreleased] 天然被跳过）↔ README.md 顶部的「当前版本 **X.Y.Z**」；
//   2. CHANGELOG 小节存在：package.json 的版本号必须能在 CHANGELOG.md 找到对应标题；
//   3. 工作树交代：git status --porcelain 有未提交项就逐条打印——不算错，
//      只提醒「发版前确认每一项是谁的」（v2.5.0 收尾时工作树里就有别人改到一半的文件）。
//
// 输出照 check:wiki 风格：先打计数，逐条细节，末行 bad=N；
// 退出码与 check:wiki 一致：发现不一致（bad>0）退出码 1，干净则 0。

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO = path.resolve(import.meta.dirname, '..')
const gitCmd = process.platform === 'win32' ? 'git.exe' : 'git'

function readText(relativePath) {
  return fs.readFileSync(path.join(REPO, relativePath), 'utf8')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const packageVersion = JSON.parse(readText('package.json')).version
const changelogText = readText('CHANGELOG.md')
const readmeText = readText('README.md')

// CHANGELOG 最新版本：文档顺序第一个 X.Y.Z 形状标题（[Unreleased] 不匹配该正则，即被跳过）。
const changelogVersion = (/^## \[(\d+\.\d+\.\d+)\]/m.exec(changelogText) || [])[1] || ''
// README 顶部明文版本号：shields.io 动态徽章化后仅存这一处（** 是正文里的加粗星号）。
const readmeVersion = (/当前版本[ \t]*\*\*(\d+\.\d+\.\d+)\*\*/.exec(readmeText) || [])[1] || ''

const problems = []

if (changelogVersion !== packageVersion) {
  problems.push(`CHANGELOG.md 最新版本 [${changelogVersion || '(未找到)'}] 与 package.json ${packageVersion} 不一致`)
}
if (readmeVersion !== packageVersion) {
  problems.push(`README.md 当前版本 ${readmeVersion || '(未找到)'} 与 package.json ${packageVersion} 不一致`)
}
if (!new RegExp(`^## \\[${escapeRegExp(packageVersion)}\\]`, 'm').test(changelogText)) {
  problems.push(`CHANGELOG.md 缺少 [${packageVersion}] 小节标题`)
}

// git 不可用或不在仓库里时按无未提交项处理（spawn 失败/非零退出都返回空）。
const gitStatus = spawnSync(gitCmd, ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' })
const dirtyLines = (gitStatus.status === 0 ? gitStatus.stdout : '')
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter(Boolean)

console.log(
  `release consistency: package=${packageVersion} changelog=${changelogVersion || '(none)'} ` +
  `readme=${readmeVersion || '(none)'} dirty=${dirtyLines.length}`
)
for (const problem of problems) console.log(`  MISMATCH ${problem}`)
for (const line of dirtyLines) console.log(`  DIRTY    ${line}`)
if (dirtyLines.length > 0) console.log('  (dirty 不算错；发版前确认每一项是谁的)')
console.log(`bad=${problems.length}`)

if (problems.length > 0) process.exit(1)

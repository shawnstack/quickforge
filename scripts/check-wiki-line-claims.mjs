#!/usr/bin/env node
// 校验 docs/wiki 下的「某文件 N 行」声明与文件真实行数是否一致（wc 口径：数换行符）。
//
// 用法：
//   node scripts/check-wiki-line-claims.mjs            # 只报漂移，退出码 1 表示有漂移
//   node scripts/check-wiki-line-claims.mjs --verbose  # 另打印每条被核对声明的来源位置
//
// 目录感知：wiki 的目录结构与仓库镜像（docs/wiki/src/lib/README.md ↔ src/lib/），
// 所以每个 README 只在自己的对应目录里找同名文件，避免 a/index.mjs 与 b/index.mjs 歧义。
//
// 覆盖三种声明形态：paren「名 … (N 行)」、表格行「| [名](…) | … | N |」、目录树注释（同 paren）。
// 跳过：历史性叙述（数字前紧邻「原」，或整行含「→」迁移箭头）、文件不存在、同名多处无法消歧。
// 注意：只做校验不改文件——要改请人工逐条确认（行数漂移常常是「文档本来就该改」或「叙述是历史」）。

import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const WIKI = path.join(REPO, 'docs', 'wiki')
const verbose = process.argv.includes('--verbose')
const EXT = '(?:tsx|mjs|cjs|ts)'
const PAREN = new RegExp('([A-Za-z0-9._/-]+?\\.' + EXT + ')[^()\\n]{0,60}?[（(]\\s*(\\d{2,5})\\s*行', 'g')
const CELL = new RegExp('^\\|\\s*\\[([A-Za-z0-9._/-]+?\\.' + EXT + ')\\]\\([^)]*\\)\\s*\\|[^|]*\\|\\s*(\\d{2,5})\\s*\\|', 'g')

function wc(file) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}

function listWikiReadmes(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listWikiReadmes(full, acc)
    else if (entry.name === 'README.md') acc.push(full)
  }
  return acc
}

if (!fs.existsSync(WIKI)) {
  console.error('wiki directory not found: ' + WIKI)
  process.exit(1)
}

let checked = 0
let bad = 0
const details = []

for (const file of listWikiReadmes(WIKI)) {
  const rel = path.relative(WIKI, file).replace(/\\/g, '/')
  const rootRel = path.dirname(rel)
  const root = rootRel === '.' ? REPO : path.join(REPO, rootRel)
  const lines = fs.readFileSync(file, 'utf8').split('\n')

  lines.forEach((line, index) => {
    const verify = (name, docStr) => {
      const candidates = Array.from(new Set([path.join(root, name), path.join(root, path.basename(name))]))
        .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      if (candidates.length !== 1) return
      checked += 1
      const actual = wc(candidates[0])
      if (verbose) console.log('ok  ' + rel + ':' + (index + 1) + '  ' + name + '  ' + docStr)
      if (actual === Number(docStr)) return
      if (line.includes('→')) return
      const at = line.indexOf(docStr + ' 行')
      const before = at > 3 ? line.slice(at - 3, at) : ''
      if (/原\s*$/.test(before)) return
      bad += 1
      details.push(rel + ':' + (index + 1) + '  ' + name + '  doc=' + docStr + ' actual=' + actual)
    }
    for (const match of line.matchAll(PAREN)) verify(match[1], match[2])
    for (const match of line.matchAll(CELL)) verify(match[1], match[2])
  })
}

console.log('checked=' + checked + ' bad=' + bad)
for (const detail of details) console.log('  DRIFT ' + detail)
process.exit(bad > 0 ? 1 : 0)

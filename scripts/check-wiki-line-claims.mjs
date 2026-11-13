#!/usr/bin/env node
// 校验 docs/wiki 下的「某文件 N 行」声明与文件真实行数是否一致（wc 口径：数换行符）。
//
// 用法：
//   node scripts/check-wiki-line-claims.mjs             # 报漂移与解析缺口；有漂移退出码 1
//   node scripts/check-wiki-line-claims.mjs --strict    # 另外：unresolved > 0 也失败（退出码 2）
//   node scripts/check-wiki-line-claims.mjs --verbose   # 另打印每条被核对声明与缺口位置
//
// 目录感知：wiki 的目录结构与仓库镜像（docs/wiki/src/lib/README.md ↔ src/lib/），
// 每个 README 只在自己的对应目录里解析文件名，避免 a/index.mjs 与 b/index.mjs 歧义。
//
// 文件名解析三级（缺一级就会「静默跳过」——曾因此漏检 24 条子目录引用）：
//   1. 显式相对路径：`chat/scroll-sync.ts`、`src/components/chat/x.ts` 直接拼路径；
//   2. 路径后缀匹配：README 目录内递归索引，命中唯一后缀；
//   3. 裸 basename：只剩唯一同名文件时才认（**多义即跳过，绝不取第一个**——三份
//      message-queue.ts 让一处 593 vs 640 的漂移藏了很久）。
//
// 覆盖三种声明形态：paren「名 … (N 行)」、表格行「| [名](…) | … | N |」、目录树注释（同 paren）。
// 历史叙述（数字前紧邻「原」，或整行含「→」迁移箭头）解析到但不比对，单列 historical。
//
// 计数口径（这是护栏，别拆）：matched = resolved + historical + unresolved + nonRepo
// - matched：去重后进入判定的声明总数（同一个名字+数字在同一行重复出现只算一次）
// - resolved：解析成功且数字相符（真正被核对的部分）
// - historical：解析成功但属于历史叙述
// - unresolved：仓库内解析不到（not-found）或同名多义（ambiguous）
// - nonRepo：第三方库/非仓库文件名的显式白名单，只打印不判定
// `matched` 掉下 MIN_MATCHED 说明正则失配（文档换了写法），此时退出码 3——否则会一片绿。

import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const WIKI = path.join(REPO, 'docs', 'wiki')
const verbose = process.argv.includes('--verbose')
const strict = process.argv.includes('--strict')
const EXT = '(?:tsx|mjs|cjs|ts)'
const PAREN = new RegExp('([A-Za-z0-9._/-]+?\\.' + EXT + ')[^()\\n]{0,60}?[（(]\\s*(\\d{2,5})\\s*行', 'g')
const CELL = new RegExp('^\\|\\s*\\[([A-Za-z0-9._/-]+?\\.' + EXT + ')\\]\\([^)]*\\)\\s*\\|[^|]*\\|\\s*(\\d{2,5})\\s*\\|', 'g')
// 反引号式表格行「| `名.ext` | N | …」——本仓库 wiki 的主流写法，2026-11-13 前一直无校验
// （文档bot 用 backtick-claims.mjs 扫出 77 条隐身声明、2 条漂移后收编为第四形态）。
const BACKTICK = new RegExp('^\\|\\s*`([A-Za-z0-9._/-]+?\\.' + EXT + ')`\\s*\\|\\s*(\\d{2,5})\\s*\\|', 'g')
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git'])
// 出现在 wiki 里但不是本仓库文件的第三方库名：只打印，不计入 unresolved。
// 在途 WIP 的行数漂移不设豁免表：等改动落地后按当刻实测改声明即可（2026-11-13 机制随最后一批 WIP 落地移除）。
const NON_REPO_FILES = new Set(['xterm.js', 'highlight.js', 'jszip.min.js', 'index.html'])
const MIN_MATCHED = 100

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

// 递归索引目录：basename -> 全部命中路径，以及相对 root 的斜杠路径（供后缀匹配）。
function indexDirectory(root) {
  const byBasename = new Map()
  const relativePaths = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!byBasename.has(entry.name)) byBasename.set(entry.name, [])
      byBasename.get(entry.name).push(full)
      relativePaths.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walk(root)
  return { byBasename, relativePaths }
}

if (!fs.existsSync(WIKI)) {
  console.error('wiki directory not found: ' + WIKI)
  process.exit(1)
}

let matched = 0
let resolved = 0
let historical = 0
let unresolved = 0
let nonRepo = 0
let bad = 0
const driftDetails = []
const unresolvedDetails = []
const nonRepoDetails = []

for (const file of listWikiReadmes(WIKI)) {
  const rel = path.relative(WIKI, file).replace(/\\/g, '/')
  const rootRel = path.dirname(rel)
  const root = rootRel === '.' ? REPO : path.join(REPO, rootRel)
  if (!fs.existsSync(root)) continue
  const index = indexDirectory(root)
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const seen = new Set()

  lines.forEach((line, lineIndex) => {
    const verify = (name, docStr) => {
      // 同一行里同一个名字+数字可能被 paren 与 cell 两种形态重复命中，去重后再计数。
      const key = lineIndex + '|' + name + '@' + docStr
      if (seen.has(key)) return
      seen.add(key)
      matched += 1

      const explicit = Array.from(new Set([path.join(root, name), path.join(REPO, name)]))
        .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      let candidates = explicit
      if (!candidates.length) {
        const suffixMatches = index.relativePaths.filter((entry) => entry === name || entry.endsWith('/' + name))
        if (suffixMatches.length === 1) candidates = [path.join(root, suffixMatches[0])]
        else if (suffixMatches.length === 0) candidates = index.byBasename.get(path.basename(name)) ?? []
      }
      if (candidates.length !== 1) {
        const base = path.basename(name)
        if (NON_REPO_FILES.has(base)) {
          nonRepo += 1
          nonRepoDetails.push(rel + ':' + (lineIndex + 1) + '  ' + name)
          return
        }
        unresolved += 1
        unresolvedDetails.push(
          rel + ':' + (lineIndex + 1) + '  ' + name + '  (' +
            (candidates.length === 0 ? 'not-found' : 'ambiguous: ' + candidates.length + ' candidates') + ')'
        )
        return
      }

      const actual = wc(candidates[0])
      const at = line.indexOf(docStr + ' 行')
      const before = at > 3 ? line.slice(at - 3, at) : ''
      const isHistorical = line.includes('→') || /原\s*$/.test(before)
      if (verbose) console.log('check ' + rel + ':' + (lineIndex + 1) + '  ' + name + '  doc=' + docStr + ' actual=' + actual)
      if (actual === Number(docStr)) {
        resolved += 1
        return
      }
      if (isHistorical) {
        historical += 1
        return
      }
      bad += 1
      driftDetails.push(rel + ':' + (lineIndex + 1) + '  ' + name + '  doc=' + docStr + ' actual=' + actual)
    }
    for (const match of line.matchAll(PAREN)) verify(match[1], match[2])
    for (const match of line.matchAll(CELL)) verify(match[1], match[2])
    for (const match of line.matchAll(BACKTICK)) verify(match[1], match[2])
  })
}

console.log(
  'wiki line claims: matched=' + matched + ' resolved=' + resolved + ' historical=' + historical +
  ' unresolved=' + unresolved + ' nonRepo=' + nonRepo + ' bad=' + bad
)
for (const detail of driftDetails) console.log('  DRIFT ' + detail)
for (const detail of unresolvedDetails) console.log('  SKIP  ' + detail)
if (verbose) for (const detail of nonRepoDetails) console.log('  LIB   ' + detail)

// 护栏 1：各分桶必须刚好把 matched 分完（漏桶 = 有声明没被任何分支处理）。
const bucketed = resolved + historical + unresolved + nonRepo + bad
if (bucketed !== matched) {
  console.error('  COUNT MISMATCH: matched=' + matched + ' but resolved+historical+unresolved+nonRepo=' + bucketed)
  process.exit(3)
}
// 护栏 2：规模哨兵——matched 掉下来通常意味着正则被文档写法变化打穿了。
if (matched < MIN_MATCHED) {
  console.error('  TOO FEW CLAIMS PARSED: ' + matched + ' < ' + MIN_MATCHED + '，疑似正则失配（文档换了写法？）')
  process.exit(3)
}

if (bad > 0) process.exit(1)
if (unresolved > 0) {
  console.log('  (' + unresolved + ' 处声明解析不到；给 --strict 会让这种情况失败)')
  if (strict) process.exit(2)
}

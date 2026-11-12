import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// 结构守门：模块图的两类循环依赖都盯着。
// 背景：`types.ts ↔ server-agent`、`ui-store ↔ settings-tabs ↔ react-settings-tabs`、
// `server-agent/agent.ts ↔ factories.ts` 三个反哺环此前都是靠人肉扫描发现的（见 .bot/scan3-report.md），
// 这里把它们固化成回归断言。server/ 侧另有一组 11 文件互引团（见 KNOWN_SERVER_CYCLES），
// 是 agent-manager 拆分后遗留，登记为已知项；新长出来的环会直接红。
//
// 前端（src）两类图：
// - value 图（运行时）：`import type` 会被 esbuild 擦除，所以只看 value 边；**不允许任何环**。
// - 混合图（value + type）：类型反哺环就是「A 运行时依赖 B、B 只用 type 依赖 A」，
//   运行时无害但会让模块边界模糊。**当前为零**，一旦出现即视为回归。
//
// 后端（server）只扫 .mjs/.cjs 的相对 import：ESM 循环导入在顶层求值时可能拿到未初始化的绑定，
// 所以只允许白名单里的已知团（同样要求「白名单项必须仍然存在」，避免清单变摆设）。

const REPO = process.cwd()
const SRC_ROOT = path.resolve(REPO, 'src')
const SERVER_ROOT = path.resolve(REPO, 'server')
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git'])

// 已知的前端类型反哺环白名单（当前为空）。
const KNOWN_TYPE_ONLY_CYCLES = []

// 已知的后端互引团：agent-manager 2335 → 133 行那次拆分后遗留的 11 文件闭环。
const KNOWN_SERVER_CYCLES = [
  [
    'server/agent-background-commands.mjs',
    'server/agent-compaction.mjs',
    'server/agent-idle-recycler.mjs',
    'server/agent-manager.mjs',
    'server/agent-rollback.mjs',
    'server/agent-run-events.mjs',
    'server/agent-run-orchestration.mjs',
    'server/agent-session-lifecycle.mjs',
    'server/agent-session-updaters.mjs',
    'server/agent-subagent-runner.mjs',
    'server/agent-tool-assembly.mjs',
    'server/agent-workflow-runner.mjs',
    'server/agent-workflow-tools.mjs',
  ],
]

function listFiles(dir, pattern, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, pattern, acc)
    else if (pattern.test(entry.name) && !entry.name.endsWith('.d.ts')) acc.push(full)
  }
  return acc
}

function resolveSourceSpecifier(fromFile, specifier) {
  let base
  if (specifier.startsWith('@/')) base = path.join(SRC_ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier)
  else return null
  for (const suffix of ['', '.ts', '.tsx', path.join('index.ts'), path.join('index.tsx')]) {
    const candidate = base + suffix
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

function resolveServerSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  for (const suffix of ['', '.mjs', '.js', path.join('index.mjs')]) {
    const candidate = base + suffix
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

function collectSourceEdges() {
  const valueEdges = new Map()
  const typeEdges = new Map()
  const add = (map, from, to) => {
    if (!map.has(from)) map.set(from, new Set())
    map.get(from).add(to)
  }
  const rel = (file) => path.relative(REPO, file).replace(/\\/g, '/')
  const importPattern = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[\s\S]*?)\sfrom\s+['"]([^'"]+)['"]/g
  for (const file of listFiles(SRC_ROOT, /\.(ts|tsx)$/)) {
    const source = fs.readFileSync(file, 'utf8')
    let match
    while ((match = importPattern.exec(source)) !== null) {
      const target = resolveSourceSpecifier(file, match[2])
      if (!target) continue
      add(match[1] ? typeEdges : valueEdges, rel(file), rel(target))
    }
  }
  return { valueEdges, typeEdges }
}

function collectServerEdges() {
  const edges = new Map()
  const rel = (file) => path.relative(REPO, file).replace(/\\/g, '/')
  const importPattern = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)\sfrom\s+['"]([^'"]+)['"]/g
  for (const file of listFiles(SERVER_ROOT, /\.(mjs|cjs)$/)) {
    const source = fs.readFileSync(file, 'utf8')
    let match
    while ((match = importPattern.exec(source)) !== null) {
      const target = resolveServerSpecifier(file, match[1])
      if (!target) continue
      if (!edges.has(rel(file))) edges.set(rel(file), new Set())
      edges.get(rel(file)).add(rel(target))
    }
  }
  return edges
}

function mergeGraphs(...graphs) {
  const merged = new Map()
  for (const graph of graphs) {
    for (const [from, targets] of graph) {
      if (!merged.has(from)) merged.set(from, new Set())
      for (const target of targets) merged.get(from).add(target)
    }
  }
  return merged
}

function countEdges(graph) {
  let total = 0
  for (const targets of graph.values()) total += targets.size
  return total
}

// Tarjan：返回所有 size > 1 的强连通分量（自环单列）。
function findCycles(edges) {
  const nodes = new Set()
  for (const [from, targets] of edges) {
    nodes.add(from)
    for (const target of targets) nodes.add(target)
  }
  let index = 0
  const indices = new Map()
  const low = new Map()
  const stack = []
  const onStack = new Set()
  const cycles = []
  function strongConnect(node) {
    indices.set(node, index)
    low.set(node, index)
    index += 1
    stack.push(node)
    onStack.add(node)
    for (const next of edges.get(node) ?? []) {
      if (!indices.has(next)) {
        strongConnect(next)
        low.set(node, Math.min(low.get(node), low.get(next)))
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), indices.get(next)))
      }
    }
    if (low.get(node) !== indices.get(node)) return
    const component = []
    let popped
    do {
      popped = stack.pop()
      onStack.delete(popped)
      component.push(popped)
    } while (popped !== node)
    if (component.length > 1) cycles.push(component.sort())
    else if ((edges.get(node) ?? new Set()).has(node)) cycles.push(component)
  }
  for (const node of nodes) if (!indices.has(node)) strongConnect(node)
  return cycles.map((component) => component.sort()).sort((a, b) => a.join('>').localeCompare(b.join('>')))
}

function matchesWhitelist(cycle, whitelist) {
  const set = new Set(cycle)
  return whitelist.some((group) => group.length === set.size && group.every((file) => set.has(file)))
}


// 环内「在模块顶层用到其它成员导入」的检查：ESM 循环导入只在顶层求值时可能拿到
// 未初始化绑定；函数体内的调用都是延迟调用，安全。所以白名单里放行的环必须证明
// 自己没有任何顶层跨模块使用，否则白名单就是在掩盖真 bug。
function topLevelClusterUses(cycle) {
  const members = new Set(cycle)
  const findings = []
  for (const file of cycle) {
    const abs = path.join(REPO, file)
    const source = fs.readFileSync(abs, 'utf8')
    const names = new Map()
    const importRe = /import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|([\w$]+))?\s*from\s+['"]([^'"]+)['"]/g
    let match
    while ((match = importRe.exec(source)) !== null) {
      const spec = match[5]
      if (!spec.startsWith('.')) continue
      const target = path.relative(REPO, path.resolve(path.dirname(abs), spec)).replace(/\\/g, '/')
      if (!members.has(target)) continue
      if (match[1] || match[4]) names.set((match[1] || match[4]).trim(), target)
      if (match[3]) names.set(match[3], target)
      if (match[2]) {
        for (const part of match[2].split(',')) {
          const trimmed = part.trim()
          if (!trimmed) continue
          const alias = trimmed.split(/\s+as\s+/)
          names.set((alias[1] || alias[0]).trim(), target)
        }
      }
    }
    if (names.size === 0) continue
    const lines = source.split('\n')
    let inImport = false
    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('import ')) {
        inImport = trimmed.endsWith('{') && !trimmed.includes(' from ')
        return
      }
      if (inImport) {
        if (trimmed.includes(' from ')) inImport = false
        return
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      if (!/^\S/.test(line)) return
      for (const [name, from] of names) {
        const re = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b')
        if (re.test(line)) findings.push(file + ':' + (lineIndex + 1) + ' ' + name + ' (from ' + from + ')')
      }
    })
  }
  return findings
}

describe('frontend module graph', () => {
  it('sanity: parses a non-trivial graph', () => {
    const { valueEdges, typeEdges } = collectSourceEdges()
    // 防假绿：解析器一旦失灵（正则失效 / 目录改名），环检测会静默通过，所以先钉住图的规模。
    expect(valueEdges.size).toBeGreaterThan(200)
    expect(countEdges(valueEdges)).toBeGreaterThan(800)
    expect(countEdges(typeEdges)).toBeGreaterThan(100)
  })

  it('has no runtime (value) import cycles', () => {
    const { valueEdges } = collectSourceEdges()
    expect(findCycles(valueEdges).map((cycle) => cycle.join(' -> '))).toEqual([])
  })

  it('keeps type-only cycles within the known whitelist', () => {
    const { valueEdges, typeEdges } = collectSourceEdges()
    const cycles = findCycles(mergeGraphs(valueEdges, typeEdges))
    const unexpected = cycles.filter((cycle) => !matchesWhitelist(cycle, KNOWN_TYPE_ONLY_CYCLES))
    expect(unexpected.map((cycle) => cycle.join(' -> '))).toEqual([])
    const stillPresent = KNOWN_TYPE_ONLY_CYCLES.filter((group) => cycles.some((cycle) => matchesWhitelist(cycle, [group])))
    expect(stillPresent.length).toBe(KNOWN_TYPE_ONLY_CYCLES.length)
  })
})

describe('server module graph', () => {
  it('sanity: parses the server import graph', () => {
    const edges = collectServerEdges()
    expect(edges.size).toBeGreaterThan(100)
    expect(countEdges(edges)).toBeGreaterThan(400)
  })

  it('keeps cyclic clusters within the known whitelist', () => {
    const cycles = findCycles(collectServerEdges())
    const unexpected = cycles.filter((cycle) => !matchesWhitelist(cycle, KNOWN_SERVER_CYCLES))
    expect(unexpected.map((cycle) => cycle.join(' -> '))).toEqual([])
    const stillPresent = KNOWN_SERVER_CYCLES.filter((group) => cycles.some((cycle) => matchesWhitelist(cycle, [group])))
    expect(stillPresent.length).toBe(KNOWN_SERVER_CYCLES.length)
  })
  it('has no top-level use of imports inside a cyclic cluster', () => {
    const findings = []
    for (const cycle of findCycles(collectServerEdges())) findings.push(...topLevelClusterUses(cycle))
    expect(findings).toEqual([])
  })
})


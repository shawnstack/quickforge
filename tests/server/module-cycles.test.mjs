import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// 结构守门：前端模块图的两类循环依赖都盯着。
// 背景：`types.ts ↔ server-agent`、`ui-store ↔ settings-tabs ↔ react-settings-tabs`
// 这两个反哺环都是靠人肉扫描发现的（见 .bot/scan3-report.md），这里把它们固化成回归断言。
//
// 两类图：
// - value 图（运行时）：`import type` 会被 esbuild 擦除，所以只看 value 边；**不允许任何环**。
// - 混合图（value + type）：类型反哺环就是「A 运行时依赖 B、B 只用 type 依赖 A」，
//   这类环运行时无害但会让模块边界模糊；只允许白名单里的已知项。
//
// 口径：只扫 `src/**/*.ts(x)`（跳过 .d.ts）；`@/x` 解析为 `src/x`，相对路径按所在目录解析，
// 依次尝试 `.ts` / `.tsx` / `index.ts` / `index.tsx`；裸包（react 等）直接忽略。

const SRC_ROOT = path.resolve(process.cwd(), 'src')

// 已知的类型反哺环白名单。修好后请一并删除对应条目。
const KNOWN_TYPE_ONLY_CYCLES = [
  // factories 只用 `import type { ServerAgent }`，agent.ts 运行时 import factories 的会话工厂。
  ['src/lib/server-agent/agent.ts', 'src/lib/server-agent/factories.ts'],
]

function listSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listSourceFiles(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) acc.push(full)
  }
  return acc
}

function resolveSpecifier(fromFile, specifier) {
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

function collectEdges() {
  const valueEdges = new Map()
  const typeEdges = new Map()
  const add = (map, from, to) => {
    if (!map.has(from)) map.set(from, new Set())
    map.get(from).add(to)
  }
  const rel = (file) => path.relative(process.cwd(), file).replace(/\\/g, '/')
  const importPattern = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[\s\S]*?)\sfrom\s+['"]([^'"]+)['"]/g
  for (const file of listSourceFiles(SRC_ROOT)) {
    const source = fs.readFileSync(file, 'utf8')
    let match
    while ((match = importPattern.exec(source)) !== null) {
      const target = resolveSpecifier(file, match[2])
      if (!target) continue
      add(match[1] ? typeEdges : valueEdges, rel(file), rel(target))
    }
  }
  return { valueEdges, typeEdges }
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

  const strongConnect = (node) => {
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

describe('frontend module graph', () => {
  it('sanity: parses a non-trivial graph', () => {
    const { valueEdges, typeEdges } = collectEdges()
    // 防假绿：解析器一旦失灵（正则失效 / 目录改名），环检测会静默通过，所以先钉住图的规模。
    expect(valueEdges.size).toBeGreaterThan(200)
    expect(countEdges(valueEdges)).toBeGreaterThan(800)
    expect(countEdges(typeEdges)).toBeGreaterThan(100)
  })

  it('has no runtime (value) import cycles', () => {
    const { valueEdges } = collectEdges()
    const cycles = findCycles(valueEdges)
    expect(cycles.map((cycle) => cycle.join(' -> '))).toEqual([])
  })

  it('keeps type-only cycles within the known whitelist', () => {
    const { valueEdges, typeEdges } = collectEdges()
    const cycles = findCycles(mergeGraphs(valueEdges, typeEdges))
    const unexpected = cycles.filter((cycle) => !matchesWhitelist(cycle, KNOWN_TYPE_ONLY_CYCLES))
    expect(unexpected.map((cycle) => cycle.join(' -> '))).toEqual([])
    // 白名单里每一项都应该还在（修好了就删掉，别让清单变成摆设）。
    const stillPresent = KNOWN_TYPE_ONLY_CYCLES.filter((group) => cycles.some((cycle) => matchesWhitelist(cycle, [group])))
    expect(stillPresent.length).toBe(KNOWN_TYPE_ONLY_CYCLES.length)
  })
})

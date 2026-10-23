import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { styleFiles, stylesRoot } from '../helpers/app-css'

const entry = join(stylesRoot, 'index.css')

function listCssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name)
    if (item.isDirectory()) return listCssFiles(path)
    return item.name.endsWith('.css') ? [path] : []
  })
}

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function splitSelectorList(head: string): string[] {
  const selectors: string[] = []
  let depth = 0
  let current = ''

  for (const char of head) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1

    if (char === ',' && depth === 0) {
      selectors.push(current)
      current = ''
    } else {
      current += char
    }
  }

  selectors.push(current)
  return selectors.map((selector) => selector.trim().replace(/\s+/g, ' ')).filter(Boolean)
}

function topLevelSelectors(css: string): string[] {
  const source = withoutComments(css)
  const selectors: string[] = []
  let depth = 0
  let buffer = ''

  for (const char of source) {
    if (char === '{') {
      const head = buffer.trim()
      if (depth === 0 && head && !head.startsWith('@')) {
        selectors.push(...splitSelectorList(head))
      }
      depth += 1
      buffer = ''
    } else if (char === '}') {
      depth = Math.max(0, depth - 1)
      buffer = ''
    } else if (char === ';' && depth === 0) {
      buffer = ''
    } else {
      buffer += char
    }
  }

  return selectors
}

describe('CSS architecture', () => {
  // Each pair sets disjoint properties, so the cascade does not depend on
  // module order. Keep this list explicit: a new cross-module selector means a
  // new contract that must be reviewed instead of silently relying on order.
  const crossModuleSelectors = {
    ':root': 'foundation theme tokens + highlight palette',
    '.dark': 'foundation dark tokens + dark highlight palette',
    '.quickforge-subagent-tool > .quickforge-tool-summary': 'summary typography + interactive row states',
    '.quickforge-tool-summary-detail': 'inline label + reduced-motion typography',
  }

  it('imports Tailwind before every local module', () => {
    const source = withoutComments(readFileSync(entry, 'utf8')).trimStart()
    expect(source.startsWith('@import "tailwindcss";')).toBe(true)
  })

  it('reaches every style module exactly once from the entry', () => {
    const all = listCssFiles(stylesRoot).map((file) => relative(stylesRoot, file)).sort()
    const reached = styleFiles.map((file) => relative(stylesRoot, file)).sort()
    expect(reached).toEqual(all)
  })

  it('keeps import order centralized in the entry', () => {
    for (const file of styleFiles) {
      if (file === entry) continue
      expect(withoutComments(readFileSync(file, 'utf8'))).not.toMatch(/@import\s/)
    }
  })

  it('limits cross-module selector overrides to the documented cascade cases', () => {
    const owners = new Map<string, Set<string>>()
    for (const file of styleFiles) {
      if (file === entry) continue
      for (const selector of topLevelSelectors(readFileSync(file, 'utf8'))) {
        const modules = owners.get(selector) ?? new Set<string>()
        modules.add(relative(stylesRoot, file))
        owners.set(selector, modules)
      }
    }

    const crossModule = [...owners]
      .filter(([, modules]) => modules.size > 1)
      .map(([selector]) => selector)
      .sort()

    expect(crossModule).toEqual(Object.keys(crossModuleSelectors).sort())
  })

  it('loads the global entry from main.tsx', () => {
    const main = readFileSync('src/main.tsx', 'utf8')
    expect(main).toContain("import './styles/index.css'")
    expect(main).not.toContain("import './index.css'")
  })
})

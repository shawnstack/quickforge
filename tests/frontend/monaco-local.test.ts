import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const monacoLocalSource = readFileSync(new URL('../../src/components/workspace/monaco-local.ts', import.meta.url), 'utf8')
const basicLanguagesSource = readFileSync(new URL('../../src/components/workspace/monaco-basic-languages.ts', import.meta.url), 'utf8')
const codeViewerSource = readFileSync(new URL('../../src/components/workspace/MonacoCodeViewer.tsx', import.meta.url), 'utf8')
const diffViewerSource = readFileSync(new URL('../../src/components/workspace/MonacoDiffViewer.tsx', import.meta.url), 'utf8')
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

describe('monaco local bundling (no CDN)', () => {
  it('loads monaco-editor through a dynamic import', () => {
    expect(monacoLocalSource).toContain("import('monaco-editor/esm/vs/editor/editor.api')")
    expect(monacoLocalSource).toContain('export function ensureLocalMonaco(): Promise<void>')
    // 顶层只 import loader；monaco-editor 与 worker 必须留在函数内动态 import
    expect(monacoLocalSource).toContain("import { loader } from '@monaco-editor/react'")
  })

  it('contains no CDN urls in the monaco runtime module', () => {
    expect(monacoLocalSource).not.toContain('cdn.jsdelivr')
    expect(monacoLocalSource).not.toContain('jsdelivr')
  })

  it('registers the local worker and loader config without language-service workers', () => {
    expect(monacoLocalSource).toContain("import('monaco-editor/esm/vs/editor/editor.api')")
    expect(monacoLocalSource).toContain("import('monaco-editor/esm/vs/editor/editor.all')")
    expect(monacoLocalSource).toContain("import('monaco-editor/esm/vs/editor/editor.worker?worker')")
    // 只读查看器不需要语言服务 worker（json / css / html / ts），不引入 vs/language 贡献
    expect(monacoLocalSource).not.toContain("import('monaco-editor/esm/vs/language/")
    expect(monacoLocalSource).toContain('MonacoEnvironment')
    expect(monacoLocalSource).toContain('loader.config({ monaco: monacoModule })')
  })

  it('loads monarch basic languages through the aggregator module', () => {
    expect(monacoLocalSource).toContain("import('./monaco-basic-languages')")
    expect(basicLanguagesSource).toContain("import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'")
    expect(basicLanguagesSource).toContain("import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js'")
    expect(basicLanguagesSource).toContain("import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js'")
    // basic-languages 无 json Monarch：JSON 以纯文本呈现，且不引入语言服务贡献
    expect(basicLanguagesSource).not.toContain("import 'monaco-editor/esm/vs/language/")
    expect(basicLanguagesSource).not.toContain('/json/')
  })

  it('gates both monaco viewers behind ensureLocalMonaco before mounting', () => {
    for (const [name, source] of [
      ['MonacoCodeViewer', codeViewerSource],
      ['MonacoDiffViewer', diffViewerSource],
    ] as const) {
      expect(source, name).toContain("import { ensureLocalMonaco } from './monaco-local'")
      expect(source, name).toContain('void ensureLocalMonaco().then(')
      expect(source, name).toContain('cancelled = true')
      expect(source, name).toContain('if (!monacoReady)')
      expect(source, name).toContain('return null')
    }
  })

  it('keeps monaco-editor and @monaco-editor/react as local package dependencies', () => {
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies }

    expect(dependencies['monaco-editor']).toMatch(/^(?:\^|~)?\d+\.\d+\.\d+/)
    expect(dependencies['@monaco-editor/react']).toMatch(/^(?:\^|~)?\d+\.\d+\.\d+/)
  })
})

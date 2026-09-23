import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const inspector = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

describe('Workspace Inspector tab strip', () => {
  it('drops the divider and fades overflowing labels when more than one tab is open', () => {
    expect(inspector).not.toContain('mx-0.5 h-3 w-px')
    expect(inspector).toContain("compact ? 'min-w-24 max-w-32 flex-1' : 'shrink-0'")
    expect(inspector).toContain("compactTabs ? 'w-full min-w-0 px-2' : 'max-w-40 px-3'")
    expect(inspector).not.toContain('absolute right-1 top-1/2')
    expect(inspector).toContain("compactTabs && 'is-faded'")
    expect(inspector).toContain('quickforge-inspector-tab-label')
    expect(css).toContain('.quickforge-inspector-tab-label.is-faded')
    expect(css).toContain('text-overflow: clip')
    expect(css).toContain('mask-image: linear-gradient(to right, #000 calc(100% - 16px), transparent)')
  })
})

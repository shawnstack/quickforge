import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const menuSource = readFileSync(new URL('../../src/components/chat/panel-decoration/agent-access-menu.ts', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

describe('Agent access menu trigger border contract', () => {
  it('keeps the inline trigger borderless without changing its compact control classes', () => {
    const buttonClass = menuSource.match(/const buttonClass = `([^`]+)`/)?.[1]

    expect(buttonClass).toBeDefined()
    expect(buttonClass).not.toContain('border border-transparent')
    expect(buttonClass).toContain('rounded-md')
    expect(buttonClass).toContain('h-8')
    expect(buttonClass).toContain('gap-1.5')
  })

  it('keeps the dropdown menu border', () => {
    const menuRule = cssSource.match(/\.quickforge-agent-access-menu,\n\.quickforge-thinking-menu \{([\s\S]*?)\n\}/)?.[1]

    expect(menuRule).toBeDefined()
    expect(menuRule).toMatch(/border:\s*1px solid/)
  })
})

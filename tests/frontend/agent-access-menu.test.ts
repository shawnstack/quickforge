import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The agent-access trigger used to be injected by
 * `panel-decoration/agent-access-menu.ts`; React renders it now
 * (`surface/ComposerAccessControls.tsx`). These are the visual contracts the
 * decoration owned, asserted against the component that renders the button:
 * the inline trigger stays borderless (it is a composer control, not a framed
 * button) while the dropdown menu keeps its border.
 */
const controlsSource = readFileSync(new URL('../../src/components/chat/surface/ComposerAccessControls.tsx', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

describe('Agent access menu trigger border contract', () => {
  it('keeps the inline trigger borderless without changing its compact control classes', () => {
    // The rendered trigger's className template literal.
    const buttonClass = controlsSource.match(/className=\{`quickforge-agent-access-inline ([^`]+)`\}/)?.[1]

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

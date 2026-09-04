import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

function ruleFor(selector: string) {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]
      .split(',')
      .map((item) => item.trim())
    if (selectors.includes(selector)) return { selectors, body: match[2] }
  }
  throw new Error(`missing CSS rule: ${selector}`)
}

describe('composer control hover feedback', () => {
  it('keeps the global composer hover rule while overriding only the target neutral controls', () => {
    expect(ruleFor('.quickforge-composer button:hover:not(:disabled)').body).toMatch(/transform:\s*translateY\(-1px\)/)

    const neutralHover = ruleFor('.quickforge-composer .quickforge-plus-inline:hover:not(:disabled)')
    expect(neutralHover.selectors).toEqual([
      '.quickforge-composer .quickforge-plus-inline:hover:not(:disabled)',
      '.quickforge-composer .quickforge-agent-access-inline:hover:not(:disabled)',
      '.quickforge-composer .quickforge-subagent-running-trigger:hover:not(:disabled)',
      '.quickforge-composer .quickforge-thinking-inline:hover:not(:disabled)',
      '.quickforge-composer .quickforge-model-trigger:hover:not(:disabled)',
    ])
    expect(neutralHover.body).toMatch(/background:\s*var\(--quickforge-sidebar-hover-bg\)\s*!important/)
    expect(neutralHover.body).toMatch(/color:\s*var\(--foreground\)\s*!important/)
    expect(neutralHover.body).toMatch(/transform:\s*none\s*!important/)
  })

  it('keeps the running Subagent trigger hover feedback', () => {
    const triggerHover = ruleFor('.quickforge-composer .quickforge-subagent-running-trigger:hover:not(:disabled)').body

    expect(triggerHover).toMatch(/background:\s*var\(--quickforge-sidebar-hover-bg\)\s*!important/)
    expect(triggerHover).toMatch(/transform:\s*none\s*!important/)
  })

  it('keeps send hover primary and stationary', () => {
    const sendHover = ruleFor('.quickforge-composer .quickforge-send-button:hover:not(:disabled)').body

    expect(sendHover).toMatch(/background:\s*color-mix\(in oklab,\s*var\(--primary\)\s+\d+%,\s*var\(--quickforge-sidebar-hover-bg\)\)\s*!important/)
    expect(sendHover).toMatch(/color:\s*var\(--primary-foreground\)\s*!important/)
    expect(sendHover).toMatch(/transform:\s*none\s*!important/)
  })

  it('keeps the existing stop hover background and removes movement', () => {
    const stopHover = ruleFor('.quickforge-composer .quickforge-stop-button:hover').body

    expect(stopHover).toMatch(/background:\s*color-mix\(in oklab,\s*var\(--foreground\)\s+88%,\s*var\(--background\)\)\s*!important/)
    expect(stopHover).toMatch(/transform:\s*none\s*!important/)
  })
})

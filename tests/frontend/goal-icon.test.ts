import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoalIcon } from '../../src/components/goal-icon'

describe('Goal identity icon markup', () => {
  it('draws a circular target with an arrow ending at its center in the existing line-icon style', () => {
    const html = renderToStaticMarkup(createElement(GoalIcon))
    expect(html).toContain('viewBox="0 0 24 24"')
    expect(html).toContain('width="24" height="24"')
    expect(html).toContain('fill="none" stroke="currentColor" stroke-width="2"')
    expect(html).toContain('stroke-linecap="round" stroke-linejoin="round"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('<circle cx="10" cy="14" r="8"></circle>')
    expect(html).toContain('<circle cx="10" cy="14" r="4"></circle>')
    expect(html).toContain('<path d="M21 3 10 14"></path>')
    expect(html).toContain('<path d="M10 10v4h4"></path>')
  })

  it('retains caller sizing, color classes and SVG accessibility overrides', () => {
    const html = renderToStaticMarkup(createElement(GoalIcon, {
      className: 'size-3.5 text-muted-foreground',
      width: 16,
      height: 16,
      'aria-hidden': false,
      'aria-label': 'Goal',
    }))
    expect(html).toContain('class="quickforge-goal-icon size-3.5 text-muted-foreground"')
    expect(html).toContain('width="16" height="16"')
    expect(html).toContain('aria-hidden="false"')
    expect(html).toContain('aria-label="Goal"')
  })
})

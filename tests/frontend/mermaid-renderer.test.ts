import { describe, expect, it } from 'vitest'
import {
  createMermaidSvgDataUrl,
  isMermaidLanguage,
  isSafeMermaidSvg,
} from '../../src/lib/mermaid-renderer'

describe('Mermaid renderer helpers', () => {
  it('recognizes Mermaid fenced code languages', () => {
    expect(isMermaidLanguage('mermaid')).toBe(true)
    expect(isMermaidLanguage(' Mermaid ')).toBe(true)
    expect(isMermaidLanguage('svg')).toBe(false)
    expect(isMermaidLanguage(undefined)).toBe(false)
  })

  it('accepts isolated SVG output and rejects active or external content', () => {
    expect(isSafeMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toBe(true)
    expect(isSafeMermaidSvg('<svg><script>alert(1)</script></svg>')).toBe(false)
    expect(isSafeMermaidSvg('<svg><foreignObject><div>html</div></foreignObject></svg>')).toBe(false)
    expect(isSafeMermaidSvg('<svg><path onclick="alert(1)" /></svg>')).toBe(false)
    expect(isSafeMermaidSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toBe(false)
    expect(isSafeMermaidSvg('<svg><image href="https://example.com/image.png" /></svg>')).toBe(false)
    expect(isSafeMermaidSvg('<svg><style>.node{fill:url(//example.com/a)}</style></svg>')).toBe(false)
    expect(isSafeMermaidSvg('<svg><style>@import "https://example.com/a.css";</style></svg>')).toBe(false)
  })

  it('creates an encoded image data URL only for safe SVG', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>开始 &amp; 结束</text></svg>'
    const url = createMermaidSvgDataUrl(svg)
    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(url.split(',')[1])).toBe(svg)
    expect(() => createMermaidSvgDataUrl('<svg onload="alert(1)"></svg>')).toThrow('Unsafe Mermaid SVG output')
  })
})

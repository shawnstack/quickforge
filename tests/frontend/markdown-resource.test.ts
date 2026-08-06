import { describe, expect, it } from 'vitest'
import { resolveMarkdownImageSource } from '../../src/components/workspace/markdown-resource'

describe('resolveMarkdownImageSource', () => {
  it('resolves images relative to the Markdown file directory', () => {
    expect(resolveMarkdownImageSource('project 1', 'docs/guide.md', 'docs_flow.svg'))
      .toBe('/api/workspace/preview/project%201/docs/docs_flow.svg')
  })

  it('normalizes parent segments without escaping the workspace', () => {
    expect(resolveMarkdownImageSource('project', 'docs/guides/guide.md', '../assets/flow chart.svg'))
      .toBe('/api/workspace/preview/project/docs/assets/flow%20chart.svg')
    expect(resolveMarkdownImageSource('project', 'guide.md', '../secret.svg')).toBeUndefined()
  })

  it('rejects paths that escape the workspace after decoding', () => {
    expect(resolveMarkdownImageSource('project', 'guide.md', '%2e%2e/secret.svg')).toBeUndefined()
    expect(resolveMarkdownImageSource('project', 'guide.md', '..%5csecret.svg')).toBeUndefined()
  })

  it('supports workspace-root paths and preserves query or fragment suffixes', () => {
    expect(resolveMarkdownImageSource('project', 'docs/guide.md', '/assets/flow.svg#diagram'))
      .toBe('/api/workspace/preview/project/assets/flow.svg#diagram')
  })

  it('preserves remote HTTP images', () => {
    expect(resolveMarkdownImageSource('project', 'docs/guide.md', 'https://example.com/flow.svg'))
      .toBe('https://example.com/flow.svg')
    expect(resolveMarkdownImageSource('project', 'docs/guide.md', '//example.com/flow.svg'))
      .toBe('//example.com/flow.svg')
  })

  it('rejects unsafe or unsupported schemes', () => {
    expect(resolveMarkdownImageSource('project', 'docs/guide.md', 'javascript:alert(1)')).toBeUndefined()
    expect(resolveMarkdownImageSource('project', 'docs/guide.md', 'data:image/svg+xml,test')).toBeUndefined()
    expect(resolveMarkdownImageSource('project', 'docs/guide.md', 'file:///tmp/flow.svg')).toBeUndefined()
  })
})

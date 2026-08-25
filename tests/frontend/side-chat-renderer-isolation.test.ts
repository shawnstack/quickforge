import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const renderers = new Map<string, unknown>()

vi.mock('@earendil-works/pi-web-ui', () => ({
  getToolRenderer: (name: string) => renderers.get(name),
  registerToolRenderer: (name: string, renderer: unknown) => { renderers.set(name, renderer) },
}))

import { withPreservedArtifactsRenderer } from '../../src/components/chat/side-chat-renderer-isolation'

beforeEach(() => {
  renderers.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Side Chat artifacts renderer isolation', () => {
  it('restores the existing main renderer after ChatPanel initialization overwrites it', () => {
    const mainRenderer = { owner: 'main' }
    const sideRenderer = { owner: 'side' }
    renderers.set('artifacts', mainRenderer)

    const result = withPreservedArtifactsRenderer(() => {
      renderers.set('artifacts', sideRenderer)
      return Promise.resolve('initialized')
    })

    expect(result).toBeInstanceOf(Promise)
    expect(renderers.get('artifacts')).toBe(mainRenderer)
  })

  it('fails closed rather than leaving Side Chat as the first global renderer owner', () => {
    expect(() => withPreservedArtifactsRenderer(() => {
      renderers.set('artifacts', { owner: 'side' })
    })).toThrow('main artifacts renderer')
    expect(renderers.has('artifacts')).toBe(false)
  })
})

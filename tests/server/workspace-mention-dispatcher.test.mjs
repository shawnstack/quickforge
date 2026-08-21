import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('workspace mention dispatcher wiring', () => {
  it('registers mention-search in the real server dispatcher', async () => {
    const source = await readFile(new URL('../../server/index.mjs', import.meta.url), 'utf8')
    expect(source).toContain("pathname === '/api/workspace/mention-search'")
    expect(source).toContain('await handleWorkspaceApi(req, res, url, requestContext)')
  })
})

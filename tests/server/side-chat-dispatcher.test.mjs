import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../server/index.mjs', import.meta.url), 'utf8')

describe('side chat dispatcher', () => {
  it('registers the narrow route before Agent dispatch', () => {
    expect(source).toContain("import { handleSideChatApi } from './routes/side-chat.mjs'")
    const routeIndex = source.indexOf("if (pathname === '/api/side-chat/stream')")
    const agentIndex = source.indexOf("if (parts[0] === 'api' && parts[1] === 'agents')")
    expect(routeIndex).toBeGreaterThan(0)
    expect(routeIndex).toBeLessThan(agentIndex)
    expect(source.slice(routeIndex, agentIndex)).toContain('await handleSideChatApi(req, res, url, requestContext)')
  })
})

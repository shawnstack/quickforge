import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../../../server/routes/storage.mjs', import.meta.url), 'utf8')
const backupSource = await readFile(new URL('../../../server/routes/backup.mjs', import.meta.url), 'utf8')

describe('session destructive lifecycle guards', () => {
  it('destroys every active agent before clearing the sessions store', () => {
    const clear = source.indexOf("if (req.method === 'DELETE' && parts.length === 3)")
    const write = source.indexOf('await writeStore(store, {})', clear)
    const destroy = source.indexOf('await destroyAgentForSession(sessionId)', clear)
    expect(clear).toBeGreaterThanOrEqual(0)
    expect(destroy).toBeGreaterThan(clear)
    expect(destroy).toBeLessThan(write)
    expect(source.slice(clear, write)).toContain("if (store === 'sessions')")
    expect(source.slice(clear, write)).toContain('for (const { sessionId } of listSessions())')
  })

  it('serves session keys and has through SQL-only facade methods', () => {
    const keys = source.indexOf("if (req.method === 'GET' && parts[3] === 'keys')")
    const has = source.indexOf("if (req.method === 'GET' && parts[3] === 'has')")
    expect(keys).toBeGreaterThanOrEqual(0)
    const keysEnd = source.indexOf("if (req.method === 'GET' && parts[3] === 'index')", keys)
    const hasEnd = source.indexOf("if (parts[3] === 'key')", has)
    expect(source.slice(keys, keysEnd)).toContain('readSessionKeys')
    expect(source.slice(keys, keysEnd)).not.toContain('const data = await readStore(store)')
    expect(has).toBeGreaterThan(keys)
    expect(source.slice(has, hasEnd)).toContain('hasSession(key)')
    expect(source.slice(has, hasEnd)).not.toContain('const data = await readStore(store)')
  })

  it('destroys active agents before conversation restore', () => {
    const restore = backupSource.indexOf('if (sections.sessions !== undefined || sections.sessionsMetadata !== undefined)')
    const destroy = backupSource.indexOf('await destroyActiveSessionsBeforeConversationRestore()', restore)
    const authoritative = backupSource.indexOf('if (isSessionStateAuthoritative())', restore)
    expect(restore).toBeGreaterThanOrEqual(0)
    expect(destroy).toBeGreaterThan(restore)
    expect(destroy).toBeLessThan(authoritative)
    expect(backupSource).toContain('for (const { sessionId } of listSessions())')
    expect(backupSource).toContain('await destroyAgent(sessionId)')
  })
})

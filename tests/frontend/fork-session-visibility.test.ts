import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Regression tests for "forked conversation does not appear in the sidebar".
 *
 * Two independent contracts must hold:
 *
 * 1. Server: creating a session with a preseeded transcript (fork / seeded
 *    conversation) writes it to the session index during create. Otherwise the
 *    ordinary first-user-message `session_created` path never runs — that path
 *    is skipped when messages were passed in — and the fork exists only in
 *    memory, invisible to the sidebar until the user sends another message.
 *
 * 2. Client: forkFromMessage must refresh the session list after creating the
 *    fork, and must not gate that refresh on the local storage handle.
 *
 * These are source contracts because the behaviours are ordering guarantees
 * across the client/server boundary, not pure functions.
 */

const agentManagerSource = readFileSync(new URL('../../server/agent-manager.mjs', import.meta.url), 'utf8')
const useChatActionsSource = readFileSync(new URL('../../src/hooks/useChatActions.ts', import.meta.url), 'utf8')

function forkBlock() {
  const start = useChatActionsSource.indexOf('const forkFromMessage = useCallback')
  expect(start, 'forkFromMessage must exist').toBeGreaterThan(-1)
  return useChatActionsSource.slice(start, useChatActionsSource.indexOf('const retryFromMessage = useCallback'))
}

/** The end of createAgent: from in-memory registration to the return. Comment
 *  lines are dropped so prose about events can neither satisfy nor violate the
 *  assertions below. */
function createAgentTailCode() {
  const start = agentManagerSource.indexOf('agentSessions.set(sessionId, session)')
  expect(start, 'createAgent must register the session').toBeGreaterThan(-1)
  const tail = agentManagerSource
    .slice(start, start + 2500)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
  return tail.slice(0, tail.indexOf('return session'))
}

describe('forked session visibility', () => {
  it('persists a preseeded session during create so it reaches the session index', () => {
    const tail = createAgentTailCode()

    expect(tail).toContain('messages.length > 0')
    // Restored rows already exist; re-entering create must not rewrite them.
    expect(tail).toContain("typeof config.persistedStateJson !== 'string'")
    expect(tail).toContain('await persistSession(session)')
  })

  it('does not consume a stateVersion or emit an event at creation time', () => {
    // Creation is not a state transition: the client already refreshes from the
    // index, so emitting here would bump stateVersion for no reason and could
    // race the first SSE frame.
    expect(createAgentTailCode()).not.toContain('emitSessionEvent')
  })

  it('refreshes the session list after forking, not gated on local storage', () => {
    const block = forkBlock()

    expect(block).toContain('generateForkTitle(messages)')
    expect(block).toContain('refreshSessions({ broadcast: true })')

    // The old shape only refreshed when the client's local storage handle was
    // ready, so a fork could be created without ever appearing in the list.
    expect(block).not.toContain('if (storage)')
    expect(block).not.toContain('storageRef.current')
  })

  it('lets createAgent own the refresh instead of duplicating it in fork', () => {
    // createAgent refreshes once for a preseeded session; a second explicit
    // round here would just re-read the same index.
    expect(forkBlock()).toContain('refreshSessions: false')
  })
})

import { describe, expect, it } from 'vitest'
import { appendAssistantErrorMessageOnce, normalizeAgentHarness, validateAgentHarness } from '../../server/agent-manager.mjs'

// These helpers define the persistence/API compatibility boundary without
// starting either runtime.
describe('agent Harness selection', () => {
  it('falls back persisted missing and unknown values to QuickForge', () => {
    expect(normalizeAgentHarness(undefined)).toBe('quickforge')
    expect(normalizeAgentHarness('claude-code')).toBe('quickforge')
    expect(normalizeAgentHarness('unknown')).toBe('quickforge')
    expect(normalizeAgentHarness('opencode')).toBe('opencode')
  })

  it('rejects explicitly unsupported API values', () => {
    expect(validateAgentHarness('quickforge')).toBe('quickforge')
    expect(validateAgentHarness('opencode')).toBe('opencode')
    expect(() => validateAgentHarness('claude-code')).toThrow('not available')
    expect(() => validateAgentHarness('unknown')).toThrow('Unsupported Harness')
  })

  it('keeps OpenCode independent from QuickForge model input', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../server/agent-manager.mjs', import.meta.url), 'utf8'))
    expect(source).toContain("if (!resolvedModel && harness === AGENT_HARNESS_QUICKFORGE)")
    expect(source).toContain("const resolvedBinding = harness === AGENT_HARNESS_QUICKFORGE && resolvedModel")
  })

  it('validates resolved OpenCode prompts before title or prompt side effects', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../server/agent-manager.mjs', import.meta.url), 'utf8'))
    const validation = 'session.agent.validatePrompt(resolvedUserMessage)'
    expect(source).toContain(validation)
    expect(source.indexOf(validation)).toBeLessThan(source.indexOf("if (session.titleSource === 'default' && session.title === 'New chat')"))
    expect(source.indexOf(validation)).toBeLessThan(source.indexOf('session.agent.prompt(userMessage)'))
  })

  it('does not append a duplicate assistant error message', () => {
    const existing = [{ role: 'assistant', stopReason: 'error', errorMessage: 'failed' }]
    expect(appendAssistantErrorMessageOnce(existing, 'failed', null)).toBe(existing)
    expect(appendAssistantErrorMessageOnce([], 'failed', null)).toEqual([
      expect.objectContaining({ role: 'assistant', stopReason: 'error', errorMessage: 'failed' }),
    ])
  })

  it('persists only the OpenCode usage snapshot and restores it through the create path', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../server/agent-manager.mjs', import.meta.url), 'utf8'))
    // openCodeUsage is the only acpSession-derived field written to session data.
    expect(source).toContain("openCodeUsage: harness === AGENT_HARNESS_OPENCODE && agent.state.acpSession?.usage ? agent.state.acpSession.usage : undefined")
    expect(source).toContain('openCodeUsage: sessionData.openCodeUsage || null')
    // Dynamic config/modes are runtime-authoritative and never persisted.
    expect(source).not.toContain('acpSession: sessionData.acpSession')
    expect(source).toContain('restoredUsage: openCodeUsage')
  })

  it('forks the whole OpenCode session with sourceHarnessSessionId and persists immediately', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../server/agent-manager.mjs', import.meta.url), 'utf8'))
    expect(source).toContain('const sourceHarnessSessionId = session.agent.harnessSessionId')
    expect(source).toContain('sourceHarnessSessionId,')
    expect(source).toContain('await persistSession(forkedSession)')
    expect(source).toContain("type: 'session_forked'")
    expect(source).toContain("statusCode: 409")
    // OpenCode history still requires a persisted ACP session or fork source.
    expect(source).toContain('OpenCode history requires a persisted ACP session ID or an ACP fork source.')
  })
})

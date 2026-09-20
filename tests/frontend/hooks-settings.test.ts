import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOOKS_SETTINGS,
  HOOKS_SETTINGS_KEY,
  clampHookTimeoutSeconds,
  isValidHttpUrl,
  loadHooksSettings,
  normalizeHooksSettings,
  saveHooksSettings,
} from '../../src/lib/hooks-settings'

type FakeStorage = {
  settings: {
    get: <T>(key: string) => Promise<T | undefined>
    set: (key: string, value: unknown) => Promise<void>
  }
}

function createStorage(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial))
  const storage: FakeStorage = {
    settings: {
      get: async <T,>(key: string) => values.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        values.set(key, value)
      },
    },
  }
  return { storage, values }
}

describe('hooks settings normalizer', () => {
  it('falls back to defaults for missing or invalid values', () => {
    expect(normalizeHooksSettings(undefined)).toEqual(DEFAULT_HOOKS_SETTINGS)
    expect(normalizeHooksSettings(null)).toEqual(DEFAULT_HOOKS_SETTINGS)
    expect(normalizeHooksSettings('nope')).toEqual(DEFAULT_HOOKS_SETTINGS)
    expect(normalizeHooksSettings({})).toEqual(DEFAULT_HOOKS_SETTINGS)
    expect(normalizeHooksSettings({ hooks: 'nope', enabled: 'true' })).toEqual({ enabled: false, hooks: [] })
    expect(normalizeHooksSettings({ enabled: false })).toEqual({ enabled: false, hooks: [] })
  })

  it('drops hooks whose action is invalid (missing type, empty command, bad webhook url)', () => {
    const valid = {
      id: 'keep',
      name: 'Keep',
      enabled: true,
      events: ['error'],
      action: { type: 'command', command: 'echo hi' },
      timeoutSeconds: 10,
      silentOnFailure: false,
    }
    const result = normalizeHooksSettings({
      enabled: true,
      hooks: [
        valid,
        { id: 'no-action', name: 'No action', action: undefined, events: ['error'] },
        { id: 'bad-type', name: 'Bad type', action: { type: 'bananas' }, events: ['error'] },
        { id: 'empty-command', name: 'Empty command', action: { type: 'command', command: '   ' }, events: ['error'] },
        { id: 'bad-url', name: 'Bad url', action: { type: 'webhook', url: 'ftp://example.com/x' }, events: ['error'] },
        { id: 'no-url', name: 'No url', action: { type: 'webhook', method: 'POST' }, events: ['error'] },
        'not-even-an-object',
      ],
    })
    expect(result.hooks).toHaveLength(1)
    expect(result.hooks[0]).toEqual(valid)
  })

  it('filters and dedupes events while preserving order', () => {
    const result = normalizeHooksSettings({
      hooks: [{
        id: 'h',
        name: 'H',
        action: { type: 'command', command: 'x' },
        events: ['error', 'nope', 'error', 'agent_start', 42, 'agent_start', 'tool_execution_end'],
      }],
    })
    expect(result.hooks[0].events).toEqual(['error', 'agent_start', 'tool_execution_end'])
  })

  it('clamps and rounds timeout seconds with a default fallback', () => {
    expect(clampHookTimeoutSeconds(0)).toBe(1)
    expect(clampHookTimeoutSeconds(-5)).toBe(1)
    expect(clampHookTimeoutSeconds(300)).toBe(300)
    expect(clampHookTimeoutSeconds(301)).toBe(300)
    expect(clampHookTimeoutSeconds(999)).toBe(300)
    expect(clampHookTimeoutSeconds(2.6)).toBe(3)
    expect(clampHookTimeoutSeconds('8.4')).toBe(8)
    expect(clampHookTimeoutSeconds('bad')).toBe(10)
    expect(clampHookTimeoutSeconds(undefined)).toBe(10)
    const result = normalizeHooksSettings({
      hooks: [{ name: 'A', action: { type: 'command', command: 'x' }, timeoutSeconds: 0 }],
    })
    expect(result.hooks[0].timeoutSeconds).toBe(1)
  })

  it('normalizes webhook actions: url check, method fallback, header filtering, body template', () => {
    expect(isValidHttpUrl('http://localhost:9800/audit')).toBe(true)
    expect(isValidHttpUrl('https://example.com/hook')).toBe(true)
    expect(isValidHttpUrl('ftp://example.com')).toBe(false)
    expect(isValidHttpUrl('not a url')).toBe(false)
    const result = normalizeHooksSettings({
      hooks: [
        {
          id: 'w1',
          name: 'W1',
          events: ['agent_end'],
          action: {
            type: 'webhook',
            url: 'https://example.com/hook',
            method: 'PUT',
            headers: [
              { name: 'X-Token', value: 'a' },
              { name: '   ', value: 'dropped' },
              { name: 3, value: 'dropped' },
              'nope',
            ],
            bodyTemplate: '{"event":"{{event}}"}',
          },
          timeoutSeconds: 30,
          silentOnFailure: true,
        },
        {
          id: 'w2',
          name: 'W2',
          events: ['tool_approval_required'],
          action: { type: 'webhook', url: 'http://localhost/hook', method: 'GET' },
        },
      ],
    })
    expect(result.hooks[0].action).toEqual({
      type: 'webhook',
      url: 'https://example.com/hook',
      method: 'POST',
      headers: [{ name: 'X-Token', value: 'a' }],
      bodyTemplate: '{"event":"{{event}}"}',
    })
    expect(result.hooks[0].silentOnFailure).toBe(true)
    expect(result.hooks[1].action).toEqual({ type: 'webhook', url: 'http://localhost/hook', method: 'GET' })
    expect(result.hooks[1].enabled).toBe(true)
    expect(result.hooks[1].timeoutSeconds).toBe(10)
  })

  it('generates ids for hooks without one', () => {
    const result = normalizeHooksSettings({
      hooks: [
        { name: 'A', action: { type: 'command', command: 'x' } },
        { name: 'B', action: { type: 'command', command: 'y' } },
      ],
    })
    expect(result.hooks.map((hook) => hook.id)).toEqual(['hook_0', 'hook_1'])
  })

  it('loads defaults when nothing is stored and saves normalized settings', async () => {
    const empty = createStorage()
    await expect(loadHooksSettings(empty.storage)).resolves.toEqual(DEFAULT_HOOKS_SETTINGS)

    const { storage, values } = createStorage({
      [HOOKS_SETTINGS_KEY]: { enabled: false, hooks: [{ id: 'h1', name: 'H', events: ['error', 'error'], action: { type: 'command', command: 'x' }, timeoutSeconds: 999 }] },
    })
    await expect(loadHooksSettings(storage)).resolves.toEqual({
      enabled: false,
      hooks: [{ id: 'h1', name: 'H', enabled: true, events: ['error'], action: { type: 'command', command: 'x' }, timeoutSeconds: 300, silentOnFailure: false }],
    })

    await saveHooksSettings(storage, {
      enabled: true,
      hooks: [{
        id: 'h2',
        name: '  W  ',
        enabled: false,
        events: ['agent_start', 'nope', 'agent_start'],
        action: { type: 'webhook', url: 'https://example.com/x', method: 'GET', headers: [{ name: 'A', value: '1' }, { name: '', value: '2' }] },
        timeoutSeconds: 0,
        silentOnFailure: true,
      }],
    })
    expect(values.get(HOOKS_SETTINGS_KEY)).toEqual({
      enabled: true,
      hooks: [{
        id: 'h2',
        name: '  W  ',
        enabled: false,
        events: ['agent_start'],
        action: { type: 'webhook', url: 'https://example.com/x', method: 'GET', headers: [{ name: 'A', value: '1' }] },
        timeoutSeconds: 1,
        silentOnFailure: true,
      }],
    })
  })
})

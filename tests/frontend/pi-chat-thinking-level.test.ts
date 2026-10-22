import { describe, expect, it } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import {
  loadActiveThinkingLevel,
  resolveNewSessionThinkingLevel,
  saveActiveThinkingLevel,
} from '../../src/lib/pi-chat'
import type { AppStorage } from '../../src/storage'

function storage(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial))
  return {
    storage: { settings: {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: unknown) => { values.set(key, value) },
    } } as unknown as AppStorage,
    values,
  }
}

const reasoningModel = {
  id: 'r1', name: 'R1', provider: 'p', api: 'openai-completions',
  baseUrl: 'https://example.test/v1', reasoning: true,
} as Model<Api>
const plainModel = { ...reasoningModel, id: 'p1', name: 'P1', reasoning: false } as Model<Api>

describe('active thinking level persistence', () => {
  it('round-trips the last picked level under active-thinking-level', async () => {
    const { storage: appStorage, values } = storage()
    await saveActiveThinkingLevel(appStorage, 'medium')
    expect(values.get('active-thinking-level')).toBe('medium')
    expect(await loadActiveThinkingLevel(appStorage)).toBe('medium')
  })

  it('normalizes unknown values to off and ignores them on read', async () => {
    const written = storage()
    await saveActiveThinkingLevel(written.storage, 'bogus' as never)
    expect(written.values.get('active-thinking-level')).toBe('off')

    const stored = storage({ 'active-thinking-level': 'bogus' })
    expect(await loadActiveThinkingLevel(stored.storage)).toBeNull()
  })
})

describe('resolveNewSessionThinkingLevel', () => {
  it('reuses the last picked level for reasoning models', () => {
    expect(resolveNewSessionThinkingLevel(reasoningModel, 'low')).toBe('low')
    expect(resolveNewSessionThinkingLevel(reasoningModel, 'off')).toBe('off')
  })

  it('falls back to high only when nothing was ever picked', () => {
    expect(resolveNewSessionThinkingLevel(reasoningModel, null)).toBe('high')
    expect(resolveNewSessionThinkingLevel(undefined, 'high')).toBe('off')
  })

  it('forces off for models without reasoning support', () => {
    expect(resolveNewSessionThinkingLevel(plainModel, 'xhigh')).toBe('off')
  })
})

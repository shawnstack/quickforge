import { describe, expect, it, vi } from 'vitest'

// i18n.ts 运行时只从 pi-web-ui 引入 translations；用最小桩替代完整 UI bundle。
vi.mock('@earendil-works/pi-web-ui', () => ({
  translations: { en: {}, zh: {} },
}))

import {
  getNewChatGreetingKeys,
  getNewChatGreetingSlot,
  NEW_CHAT_GREETING_FALLBACK_KEY,
  NEW_CHAT_GREETING_KEYS,
  pickNewChatGreetingKey,
  type NewChatGreetingSlot,
} from '../../src/lib/new-chat-greeting'
import { appTranslations } from '../../src/lib/i18n'

const ALL_SLOTS: NewChatGreetingSlot[] = ['morning', 'afternoon', 'evening', 'lateNight']

const SLOT_HOURS: Record<NewChatGreetingSlot, number> = {
  morning: 9,
  afternoon: 14,
  evening: 20,
  lateNight: 2,
}

function dateAtHour(hour: number): Date {
  return new Date(2024, 0, 1, hour, 0, 0, 0)
}

describe('getNewChatGreetingSlot', () => {
  it.each([
    [5, 'lateNight'],
    [6, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [22, 'evening'],
    [23, 'lateNight'],
    [0, 'lateNight'],
    [-1, 'lateNight'],
    [24, 'lateNight'],
    [Number.NaN, 'lateNight'],
  ] as const)('maps hour %s to %s', (hour, slot) => {
    expect(getNewChatGreetingSlot(hour)).toBe(slot)
  })
})

describe('NEW_CHAT_GREETING_KEYS', () => {
  it('returns exactly three keys per slot', () => {
    for (const slot of ALL_SLOTS) {
      const keys = getNewChatGreetingKeys(slot)
      expect(keys).toHaveLength(3)
      expect(keys).toEqual([...NEW_CHAT_GREETING_KEYS[slot]])
    }
  })

  it('only references keys that exist as non-empty text in both languages', () => {
    for (const slot of ALL_SLOTS) {
      for (const key of getNewChatGreetingKeys(slot)) {
        for (const language of ['en', 'zh'] as const) {
          const text = appTranslations[language][key]
          expect(typeof text).toBe('string')
          expect(text.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('covers twelve unique keys across all slots', () => {
    const merged = ALL_SLOTS.flatMap((slot) => [...getNewChatGreetingKeys(slot)])
    expect(merged).toHaveLength(12)
    expect(new Set(merged).size).toBe(12)
  })
})

describe('pickNewChatGreetingKey', () => {
  it('picks the first key of the slot for random() === 0', () => {
    for (const slot of ALL_SLOTS) {
      const keys = getNewChatGreetingKeys(slot)
      const picked = pickNewChatGreetingKey(dateAtHour(SLOT_HOURS[slot]), () => 0)
      expect(picked).toBe(keys[0])
      expect(keys).toContain(picked)
    }
  })

  it('picks the last key of the slot for random() === 0.99', () => {
    for (const slot of ALL_SLOTS) {
      const keys = getNewChatGreetingKeys(slot)
      const picked = pickNewChatGreetingKey(dateAtHour(SLOT_HOURS[slot]), () => 0.99)
      expect(picked).toBe(keys[2])
      expect(keys).toContain(picked)
    }
  })

  it('never escapes the slot keys for out-of-range random values', () => {
    for (const slot of ALL_SLOTS) {
      const keys = getNewChatGreetingKeys(slot)
      for (const random of [() => -1, () => 1, () => 5]) {
        const picked = pickNewChatGreetingKey(dateAtHour(SLOT_HOURS[slot]), random)
        expect(keys).toContain(picked)
      }
    }
  })

  it('uses the fallback key when the slot key list is empty', () => {
    const keys = NEW_CHAT_GREETING_KEYS.lateNight as unknown as string[]
    const original = [...keys]
    keys.length = 0
    try {
      expect(pickNewChatGreetingKey(dateAtHour(2), () => 0)).toBe(NEW_CHAT_GREETING_FALLBACK_KEY)
    } finally {
      keys.push(...original)
    }
  })
})

describe('NEW_CHAT_GREETING_FALLBACK_KEY', () => {
  it('is newChatEmptyTitle and non-empty in both languages', () => {
    expect(NEW_CHAT_GREETING_FALLBACK_KEY).toBe('newChatEmptyTitle')
    for (const language of ['en', 'zh'] as const) {
      expect(appTranslations[language][NEW_CHAT_GREETING_FALLBACK_KEY].trim().length).toBeGreaterThan(0)
    }
  })
})

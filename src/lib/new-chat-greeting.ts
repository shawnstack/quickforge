import type { AppTextKey } from '@/lib/i18n'

export type NewChatGreetingSlot = 'morning' | 'afternoon' | 'evening' | 'lateNight'

export const NEW_CHAT_GREETING_KEYS: Record<NewChatGreetingSlot, readonly AppTextKey[]> = {
  morning: ['newChatGreetingMorning1', 'newChatGreetingMorning2', 'newChatGreetingMorning3'],
  afternoon: ['newChatGreetingAfternoon1', 'newChatGreetingAfternoon2', 'newChatGreetingAfternoon3'],
  evening: ['newChatGreetingEvening1', 'newChatGreetingEvening2', 'newChatGreetingEvening3'],
  lateNight: ['newChatGreetingLateNight1', 'newChatGreetingLateNight2', 'newChatGreetingLateNight3'],
}

export const NEW_CHAT_GREETING_FALLBACK_KEY: AppTextKey = 'newChatEmptyTitle'

export function getNewChatGreetingSlot(hour: number): NewChatGreetingSlot {
  const normalized = Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 0
  if (normalized >= 6 && normalized < 12) return 'morning'
  if (normalized >= 12 && normalized < 18) return 'afternoon'
  if (normalized >= 18 && normalized < 23) return 'evening'
  return 'lateNight'
}

export function getNewChatGreetingKeys(slot: NewChatGreetingSlot): readonly AppTextKey[] {
  return NEW_CHAT_GREETING_KEYS[slot]
}

export function pickNewChatGreetingKey(date: Date = new Date(), random: () => number = Math.random): AppTextKey {
  const keys = getNewChatGreetingKeys(getNewChatGreetingSlot(date.getHours()))
  const index = Math.floor(random() * keys.length)
  const safeIndex = Math.min(Math.max(index, 0), keys.length - 1)
  return keys[safeIndex] ?? NEW_CHAT_GREETING_FALLBACK_KEY
}

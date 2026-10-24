import { t } from '@/lib/i18n'
import type { SidebarSectionId } from '@/lib/sidebar-section-order'

const minuteMs = 60 * 1000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs
const weekMs = 7 * dayMs
const yearMs = 365 * dayMs

export const sidebarDefaultWidth = 304
export const sidebarMinWidth = 304
export const sidebarMaxWidth = 520
export const sidebarMaxViewportRatio = 0.5

export const projectMenuWidth = 192
export const projectMenuHeight = 120
export const viewSortMenuWidth = 224
export const viewSortMenuHeight = 244

const sidebarSectionDndIdPrefix = 'sidebar-section:'

export type SidebarSectionDndId = `${typeof sidebarSectionDndIdPrefix}${SidebarSectionId}`

export function sidebarSectionDndId(sectionId: SidebarSectionId): SidebarSectionDndId {
  return `${sidebarSectionDndIdPrefix}${sectionId}`
}

export function sidebarSectionIdFromDndId(value: string | number): SidebarSectionId | undefined {
  const id = String(value)
  if (!id.startsWith(sidebarSectionDndIdPrefix)) return undefined
  const sectionId = id.slice(sidebarSectionDndIdPrefix.length)
  return sectionId === 'projects' || sectionId === 'tasks' ? sectionId : undefined
}

export function getSidebarMaxWidth() {
  if (typeof window === 'undefined') return sidebarMaxWidth
  return Math.max(sidebarMinWidth, Math.min(sidebarMaxWidth, window.innerWidth * sidebarMaxViewportRatio))
}

export function clampSidebarWidth(width: number) {
  return Math.min(getSidebarMaxWidth(), Math.max(sidebarMinWidth, width))
}

export function formatSessionTime(value?: string) {
  if (!value) return ''
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return ''

  const elapsedMs = Math.max(0, Date.now() - timestamp)
  if (elapsedMs < hourMs) return t('relativeMinuteShort', { count: Math.max(1, Math.floor(elapsedMs / minuteMs)) })
  if (elapsedMs < dayMs) return t('relativeHourShort', { count: Math.floor(elapsedMs / hourMs) })
  if (elapsedMs < weekMs) return t('relativeDayShort', { count: Math.floor(elapsedMs / dayMs) })
  if (elapsedMs < yearMs) return t('relativeWeekShort', { count: Math.floor(elapsedMs / weekMs) })
  return t('relativeYearShort', { count: Math.floor(elapsedMs / yearMs) })
}

export function isValidPinnedAt(value?: string) {
  if (!value) return false
  const normalized = value.trim()
  if (!normalized || normalized === 'undefined' || normalized === 'null' || normalized === 'false') return false
  return !Number.isNaN(Date.parse(normalized))
}

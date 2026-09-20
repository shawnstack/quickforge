export type SettingsSelectOption = {
  value: string
  label: string
  disabled?: boolean
}

export function visibleSelectIndexes(options: SettingsSelectOption[], query: string) {
  const normalized = query.trim().toLowerCase()
  return options.flatMap((option, index) => option.label.toLowerCase().includes(normalized) ? [index] : [])
}

export function moveSelectFocus(indexes: number[], focusedIndex: number, key: string) {
  if (key === 'Home') return indexes[0] ?? -1
  if (key === 'End') return indexes.at(-1) ?? -1
  const delta = key === 'ArrowUp' ? -1 : 1
  const position = indexes.indexOf(focusedIndex)
  // Unfocused: land on the edge the arrow points at (ArrowUp → last option),
  // mirroring how `openMenu` maps ArrowUp/ArrowDown to End/Home.
  if (position < 0) return delta > 0 ? (indexes[0] ?? -1) : (indexes.at(-1) ?? -1)
  return indexes[Math.max(0, Math.min(indexes.length - 1, position + delta))] ?? -1
}

export function positionSettingsSelect(menu: HTMLElement, trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect()
  const margin = 8
  const gap = 6
  const maxHeight = 300
  const menuHeight = Math.min(maxHeight, menu.offsetHeight || maxHeight)
  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top
  const showAbove = spaceBelow - gap < menuHeight && spaceAbove > spaceBelow
  const available = Math.max(0, (showAbove ? spaceAbove : spaceBelow) - gap - margin)
  menu.style.top = showAbove ? 'auto' : `${Math.round(rect.bottom + gap)}px`
  menu.style.bottom = showAbove ? `${Math.round(window.innerHeight - rect.top + gap)}px` : 'auto'
  menu.style.maxHeight = `${Math.max(120, Math.min(maxHeight, available))}px`
  menu.style.minWidth = `max(12rem, ${Math.round(rect.width)}px)`
  menu.style.left = `${Math.round(Math.max(margin, Math.min(rect.left, window.innerWidth - menu.offsetWidth - margin)))}px`
}

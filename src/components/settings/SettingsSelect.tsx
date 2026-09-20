import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { moveSelectFocus, positionSettingsSelect, visibleSelectIndexes, type SettingsSelectOption } from './settings-select-state'

export type SettingsSelectProps = {
  value: string
  options: SettingsSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  label?: string
  placeholder?: string
  searchable?: boolean
  searchPlaceholder?: string
  noResultsLabel?: string
}

export function SettingsSelect({
  value, options, onChange, disabled = false, label = '', placeholder = '',
  searchable = false, searchPlaceholder = '', noResultsLabel = '',
}: SettingsSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listboxId = `quickforge-settings-select-${useId()}`
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const open = expanded && !disabled
  const visible = visibleSelectIndexes(options, searchable ? query : '')
  const selectable = visible.filter((index) => !options[index].disabled)
  const focused = selectable.includes(focusedIndex) ? focusedIndex : (selectable[0] ?? -1)
  const activeId = open && focused >= 0 ? `${listboxId}-option-${focused}` : undefined
  const selected = options.find((option) => option.value === value)

  // A disabled control must not reopen its old menu when enabled again.
  if (disabled && expanded) {
    setExpanded(false)
    setQuery('')
    setFocusedIndex(-1)
  }

  function close(restoreFocus = true) {
    setExpanded(false)
    setQuery('')
    setFocusedIndex(-1)
    if (restoreFocus) triggerRef.current?.focus()
  }

  function openMenu(key?: string) {
    if (disabled) return
    const indexes = options.flatMap((option, index) => option.disabled ? [] : [index])
    const current = options.findIndex((option) => option.value === value && !option.disabled)
    setQuery('')
    setFocusedIndex(key
      ? moveSelectFocus(indexes, -1, key === 'ArrowUp' ? 'End' : key === 'ArrowDown' ? 'Home' : key)
      : current >= 0 ? current : (indexes[0] ?? -1))
    setExpanded(true)
  }

  function select(index: number) {
    const option = options[index]
    if (disabled || !option || option.disabled || !visible.includes(index)) return
    close()
    onChange(option.value)
  }

  useLayoutEffect(() => {
    if (!open) return
    if (searchable) searchRef.current?.focus()
    else triggerRef.current?.focus()
  }, [open, searchable])

  useLayoutEffect(() => {
    const menu = menuRef.current
    const trigger = triggerRef.current
    if (!open || !menu || !trigger) return
    positionSettingsSelect(menu, trigger)
    const list = menu.querySelector<HTMLElement>('[role="listbox"]')
    const option = activeId ? document.getElementById(activeId) : null
    if (!list || !option) return
    const listRect = list.getBoundingClientRect()
    const optionRect = option.getBoundingClientRect()
    if (optionRect.top < listRect.top) list.scrollTop -= listRect.top - optionRect.top
    else if (optionRect.bottom > listRect.bottom) list.scrollTop += optionRect.bottom - listRect.bottom
  })

  useEffect(() => {
    if (!open) return
    const reposition = () => {
      if (menuRef.current && triggerRef.current) positionSettingsSelect(menuRef.current, triggerRef.current)
    }
    const pointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && !triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close()
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'Home':
        case 'End':
          event.preventDefault()
          setFocusedIndex(moveSelectFocus(selectable, focused, event.key))
          break
        case 'Enter':
        case ' ':
          if (event.key === ' ' && document.activeElement === searchRef.current) return
          event.preventDefault()
          select(focused)
          break
        case 'Escape':
          event.preventDefault()
          close()
          break
        case 'Tab':
          // Restore the trigger before the browser advances its normal tab order.
          close()
          break
      }
    }
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('keydown', keyDown)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('keydown', keyDown)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  })

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="quickforge-settings-select quickforge-settings-select-button quickforge-settings-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-label={label || undefined}
        disabled={disabled}
        onClick={() => open ? close() : openMenu()}
        onKeyDown={(event) => {
          if (open || event.nativeEvent.isComposing) return
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            // Do not let the opening key reach the newly attached document listener.
            event.stopPropagation()
            openMenu(event.key)
          }
        }}
      >
        <span className="quickforge-settings-select-trigger-label">{selected ? selected.label : placeholder}</span>
        <span className="quickforge-settings-select-chevron" aria-hidden="true">▾</span>
      </button>
      {open && createPortal(
        <div ref={menuRef} className="quickforge-settings-select-menu">
          {searchable && <div className="quickforge-settings-select-search">
            <input
              ref={searchRef}
              className="quickforge-settings-select-search-input"
              type="text"
              role="searchbox"
              placeholder={searchPlaceholder}
              aria-label={label || searchPlaceholder || undefined}
              aria-controls={listboxId}
              aria-activedescendant={activeId}
              value={query}
              onChange={(event) => {
                const nextQuery = event.currentTarget.value
                const indexes = visibleSelectIndexes(options, nextQuery).filter((index) => !options[index].disabled)
                setQuery(nextQuery)
                setFocusedIndex(indexes.includes(focused) ? focused : (indexes[0] ?? -1))
              }}
            />
          </div>}
          <div id={listboxId} className="quickforge-settings-select-listbox" role="listbox" aria-label={label || undefined}>
            {visible.map((index) => {
              const option = options[index]
              const isSelected = option.value === value
              return <div
                key={index}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={Boolean(option.disabled)}
                className={`quickforge-settings-select-option${focused === index ? ' quickforge-settings-select-option-focused' : ''}${isSelected ? ' quickforge-settings-select-option-selected' : ''}${option.disabled ? ' quickforge-settings-select-option-disabled' : ''}`}
                onMouseMove={() => { if (!option.disabled) setFocusedIndex(index) }}
                onClick={() => select(index)}
              >
                <span className="quickforge-settings-select-option-label">{option.label}</span>
                {isSelected && <svg className="quickforge-settings-select-option-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>}
              </div>
            })}
          </div>
          {searchable && visible.length === 0 && <div className="quickforge-settings-select-no-results" role="status">{noResultsLabel}</div>}
        </div>, document.body,
      )}
    </>
  )
}

import { useId, useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

export { SettingsSelect } from '../SettingsSelect'
export type { SettingsSelectProps } from '../SettingsSelect'

/** Reuse the existing row title when migrated callers have no explicit label yet. */
export function SettingsSwitch({
  checked,
  onChange,
  disabled = false,
  label,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = `quickforge-settings-switch-label-${useId()}`
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    if (label || ariaLabel || ariaLabelledBy) {
      // Effect cleanup may have removed the previous inferred relationship after commit.
      if (ariaLabelledBy) input.setAttribute('aria-labelledby', ariaLabelledBy)
      return
    }
    const title = input.closest('.quickforge-settings-row')?.querySelector<HTMLElement>('.quickforge-settings-row-title')
    if (!title) return
    // Associate the visible label rather than duplicating text that may change language.
    if (!title.id) title.id = titleId
    input.setAttribute('aria-labelledby', title.id)
    return () => input.removeAttribute('aria-labelledby')
  }, [label, ariaLabel, ariaLabelledBy, titleId])

  return (
    <label className="quickforge-settings-switch" aria-disabled={disabled ? 'true' : 'false'}>
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel || label}
        aria-labelledby={ariaLabelledBy}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span aria-hidden="true"></span>
    </label>
  )
}

/** 滑杆进度条 CSS 变量（appearance 字号滑杆共用）。 */
// eslint-disable-next-line react-refresh/only-export-components -- existing shared tab helper
export function sliderProgressStyle(progressPercent: number): CSSProperties {
  return { '--quickforge-font-size-slider-progress': `${progressPercent}%` } as CSSProperties
}

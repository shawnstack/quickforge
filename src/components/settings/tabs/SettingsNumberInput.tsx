import { useEffect, useRef, type ComponentProps } from 'react'

type Props = Omit<ComponentProps<'input'>, 'type' | 'onChange' | 'onInput'> & {
  onInput: (value: string) => void
  onCommit: (value: string) => void
}

/** Native change commits typing on blur and steppers immediately, unlike React onChange. */
export function SettingsNumberInput({ onInput, onCommit, ...props }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef<string | null>(null)
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const commit = () => {
      if (committedRef.current === input.value) return
      committedRef.current = input.value
      onCommit(input.value)
    }
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  }, [onCommit])
  return <input
    {...props}
    ref={inputRef}
    type="number"
    onInput={(event) => {
      committedRef.current = null
      onInput(event.currentTarget.value)
    }}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
      event.preventDefault()
      if (committedRef.current === event.currentTarget.value) return
      committedRef.current = event.currentTarget.value
      onCommit(event.currentTarget.value)
    }}
  />
}

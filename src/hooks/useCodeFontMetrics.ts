import { useEffect, useState } from 'react'
import { FONT_SIZE_SETTINGS_CHANGED_EVENT, getCodeFontMetrics } from '@/lib/font-size-settings'

export function useCodeFontMetrics() {
  const [metrics, setMetrics] = useState(() => getCodeFontMetrics())

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncMetrics = () => setMetrics(getCodeFontMetrics())
    window.addEventListener(FONT_SIZE_SETTINGS_CHANGED_EVENT, syncMetrics)
    return () => window.removeEventListener(FONT_SIZE_SETTINGS_CHANGED_EVENT, syncMetrics)
  }, [])

  return metrics
}

import { useEffect, useState } from 'react'
import { getCurrentTheme, type AppTheme } from '@/lib/appearance-settings'

export function useAppTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(() => getCurrentTheme())

  useEffect(() => {
    if (typeof document === 'undefined') return

    const root = document.documentElement
    const syncTheme = () => setTheme(getCurrentTheme())

    syncTheme()

    const observer = new MutationObserver(syncTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })

    return () => observer.disconnect()
  }, [])

  return theme
}

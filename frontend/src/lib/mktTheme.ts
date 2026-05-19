import { useState, useEffect } from 'react'

export type MktTheme = 'dark' | 'light'
const KEY = 'mkt-theme'

export function useMktTheme(): [MktTheme, () => void] {
  const [theme, setTheme] = useState<MktTheme>(() => {
    try { return (localStorage.getItem(KEY) as MktTheme) || 'dark' } catch { return 'dark' }
  })

  const toggle = () =>
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem(KEY, next) } catch { /* ignore */ }
      return next
    })

  return [theme, toggle]
}

export function getMktTheme(): MktTheme {
  try { return (localStorage.getItem(KEY) as MktTheme) || 'dark' } catch { return 'dark' }
}

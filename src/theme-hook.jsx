import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  applyTheme,
  getThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeSystemTheme,
} from './theme.js'

const ThemeContext = createContext({
  preference: 'system',
  resolved: 'light',
  setPreference: () => {},
  toggleQuickTheme: () => {},
})

export const useTheme = () => useContext(ThemeContext)

export function ThemeProvider({ children }) {
  const [preference, setPrefState] = useState(() => getThemePreference())
  const [systemDark, setSystemDark] = useState(() => resolveTheme('system') === 'dark')

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  useEffect(() => subscribeSystemTheme(isDark => setSystemDark(isDark)), [])

  const setPreference = useCallback(next => {
    const clean = setThemePreference(next)
    setPrefState(clean)
    const nextResolved = resolveTheme(clean)
    applyTheme(nextResolved)
    return clean
  }, [])

  const toggleQuickTheme = useCallback(() => {
    const next = resolved === 'dark' ? 'light' : 'dark'
    return setPreference(next)
  }, [resolved, setPreference])

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggleQuickTheme }),
    [preference, resolved, setPreference, toggleQuickTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const THEME_STORAGE_KEY = 'polaris-theme'
export const VALID_THEME_PREFERENCES = ['system', 'light', 'dark']
export const THEME_COLORS = { light: '#f8fafc', dark: '#0b1220' }

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

function defaultMediaQuery() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
  } catch {
    return null
  }
}

function defaultDocument() {
  try {
    return typeof document !== 'undefined' ? document : null
  } catch {
    return null
  }
}

export function normalizeThemePreference(pref) {
  return VALID_THEME_PREFERENCES.includes(pref) ? pref : 'system'
}

export function getThemePreference(storage = defaultStorage()) {
  if (!storage) return 'system'
  try {
    return normalizeThemePreference(storage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function setThemePreference(pref, storage = defaultStorage()) {
  const normalized = normalizeThemePreference(pref)
  if (!storage) return normalized
  try {
    storage.setItem(THEME_STORAGE_KEY, normalized)
  } catch {
    // Keep operating cleanly if storage is unavailable or full.
  }
  return normalized
}

export function resolveTheme(pref = 'system', mql = defaultMediaQuery()) {
  const normalized = normalizeThemePreference(pref)
  if (normalized === 'dark') return 'dark'
  if (normalized === 'light') return 'light'
  return mql?.matches ? 'dark' : 'light'
}

export function applyTheme(resolved = 'light', doc = defaultDocument()) {
  const theme = resolved === 'dark' ? 'dark' : 'light'
  if (!doc?.documentElement) return theme
  doc.documentElement.dataset.theme = theme
  doc.documentElement.style.colorScheme = theme
  const meta = doc.querySelector?.('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLORS[theme])
  return theme
}

export function subscribeSystemTheme(cb, mql = defaultMediaQuery()) {
  if (!mql || typeof cb !== 'function') return () => {}
  const handler = event => cb(Boolean(event?.matches))
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }
  if (typeof mql.addListener === 'function') {
    mql.addListener(handler)
    return () => mql.removeListener(handler)
  }
  return () => {}
}

export function initTheme({ storage = defaultStorage(), mql = defaultMediaQuery(), doc = defaultDocument() } = {}) {
  const preference = getThemePreference(storage)
  const resolved = resolveTheme(preference, mql)
  applyTheme(resolved, doc)
  return { preference, resolved }
}

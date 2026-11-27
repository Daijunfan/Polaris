import test from 'node:test'
import assert from 'node:assert/strict'
import {
  THEME_COLORS,
  THEME_STORAGE_KEY,
  applyTheme,
  getThemePreference,
  initTheme,
  resolveTheme,
  setThemePreference,
  subscribeSystemTheme,
} from '../src/theme.js'

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
  }
}

test('resolveTheme handles system/light/dark across media queries', () => {
  const lightMql = { matches: false }
  const darkMql = { matches: true }

  assert.equal(resolveTheme('system', lightMql), 'light')
  assert.equal(resolveTheme('system', darkMql), 'dark')
  assert.equal(resolveTheme('light', darkMql), 'light')
  assert.equal(resolveTheme('light', lightMql), 'light')
  assert.equal(resolveTheme('dark', lightMql), 'dark')
  assert.equal(resolveTheme('dark', darkMql), 'dark')
  assert.equal(resolveTheme('invalid-value', darkMql), 'dark')
})

test('getThemePreference and setThemePreference normalize invalid values and persist', () => {
  const empty = createStorage()
  assert.equal(getThemePreference(empty), 'system')

  const invalid = createStorage({ [THEME_STORAGE_KEY]: 'sepia' })
  assert.equal(getThemePreference(invalid), 'system')

  assert.equal(setThemePreference('dark', empty), 'dark')
  assert.equal(getThemePreference(empty), 'dark')

  assert.equal(setThemePreference('unknown', empty), 'system')
  assert.equal(getThemePreference(empty), 'system')
})

test('storage errors fall back safely without throwing', () => {
  const brokenStorage = {
    getItem() { throw new Error('SecurityError') },
    setItem() { throw new Error('QuotaExceededError') },
  }
  assert.equal(getThemePreference(brokenStorage), 'system')
  assert.equal(setThemePreference('dark', brokenStorage), 'dark')
})

test('applyTheme, initTheme, and subscribeSystemTheme update document attributes and meta color', () => {
  let metaContent = '#f8fafc'
  const doc = {
    documentElement: { dataset: {}, style: {} },
    querySelector: sel => (sel === 'meta[name="theme-color"]'
      ? { setAttribute: (k, v) => { if (k === 'content') metaContent = v } }
      : null),
  }

  let listener = null
  const mql = {
    matches: true,
    addEventListener: (event, fn) => { if (event === 'change') listener = fn },
    removeEventListener: (event, fn) => { if (event === 'change' && listener === fn) listener = null },
  }

  const storage = createStorage({ [THEME_STORAGE_KEY]: 'system' })
  const initial = initTheme({ storage, mql, doc })
  assert.deepEqual(initial, { preference: 'system', resolved: 'dark' })
  assert.equal(doc.documentElement.dataset.theme, 'dark')
  assert.equal(doc.documentElement.style.colorScheme, 'dark')
  assert.equal(metaContent, THEME_COLORS.dark)

  applyTheme('light', doc)
  assert.equal(doc.documentElement.dataset.theme, 'light')
  assert.equal(metaContent, THEME_COLORS.light)

  const seen = []
  const unsub = subscribeSystemTheme(matches => seen.push(matches), mql)
  listener?.({ matches: false })
  listener?.({ matches: true })
  assert.deepEqual(seen, [false, true])
  unsub()
  assert.equal(listener, null)
})

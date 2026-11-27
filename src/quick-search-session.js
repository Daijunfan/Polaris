import { MENTOR_FILTER_MAP } from '../lib/mentor-filters.js'

export const QS_FILTERS_STORAGE_KEY = 'polaris-qs-filters'

function defaultStorage() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch {
    return null
  }
}

export function loadQuickSearchSessionFilters(storage = defaultStorage(), filterMap = MENTOR_FILTER_MAP) {
  if (!storage) return { selectedColleges: [], selectedFilters: [], directionMode: 'and' }
  try {
    const raw = storage.getItem(QS_FILTERS_STORAGE_KEY)
    if (!raw) return { selectedColleges: [], selectedFilters: [], directionMode: 'and' }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { selectedColleges: [], selectedFilters: [], directionMode: 'and' }
    const selectedColleges = Array.isArray(parsed.selectedColleges)
      ? [...new Set(parsed.selectedColleges.filter(item => typeof item === 'string' && item.trim()))]
      : []
    const selectedFilters = Array.isArray(parsed.selectedFilters)
      ? [...new Set(parsed.selectedFilters.filter(item => typeof item === 'string' && (!filterMap || filterMap.has(item))))]
      : []
    const directionMode = parsed.directionMode === 'or' ? 'or' : 'and'
    return { selectedColleges, selectedFilters, directionMode }
  } catch {
    return { selectedColleges: [], selectedFilters: [], directionMode: 'and' }
  }
}

export function saveQuickSearchSessionFilters({ selectedColleges = [], selectedFilters = [], directionMode = 'and' } = {}, storage = defaultStorage()) {
  if (!storage) return
  try {
    const cleanColleges = [...new Set((selectedColleges || []).filter(item => typeof item === 'string' && item.trim()))]
    const cleanFilters = [...new Set((selectedFilters || []).filter(item => typeof item === 'string' && item.trim()))]
    const cleanMode = directionMode === 'or' ? 'or' : 'and'
    if (!cleanColleges.length && !cleanFilters.length && cleanMode === 'and') {
      storage.removeItem(QS_FILTERS_STORAGE_KEY)
      return
    }
    storage.setItem(
      QS_FILTERS_STORAGE_KEY,
      JSON.stringify({ selectedColleges: cleanColleges, selectedFilters: cleanFilters, directionMode: cleanMode })
    )
  } catch {
    // Ignore storage quota or security restrictions.
  }
}

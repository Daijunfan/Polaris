import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDirectionLine } from '../src/presentation.js'
import {
  QS_FILTERS_STORAGE_KEY,
  loadQuickSearchSessionFilters,
  saveQuickSearchSessionFilters,
} from '../src/quick-search-session.js'

function createFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
    snapshot: () => Object.fromEntries(map.entries()),
  }
}

test('formatDirectionLine normalizes commas, ampersands, and trailing punctuation', () => {
  assert.equal(formatDirectionLine(null), '')
  assert.equal(formatDirectionLine(''), '')
  assert.equal(
    formatDirectionLine('机器学习&深度学习,自然语言处理,计算机视觉'),
    '机器学习 / 深度学习、自然语言处理、计算机视觉'
  )
  assert.equal(
    formatDirectionLine('大数据分析,移动与互联网软件,'),
    '大数据分析、移动与互联网软件'
  )
  assert.equal(
    formatDirectionLine('人工智能|机器学习|大模型;'),
    '人工智能 · 机器学习 · 大模型'
  )
})

test('loadQuickSearchSessionFilters handles invalid JSON, drops unknown filter ids, and validates directionMode', () => {
  const badJson = createFakeStorage({ [QS_FILTERS_STORAGE_KEY]: '{broken-json' })
  assert.deepEqual(loadQuickSearchSessionFilters(badJson), {
    selectedColleges: [],
    selectedFilters: [],
    directionMode: 'and',
  })

  const filtered = createFakeStorage({
    [QS_FILTERS_STORAGE_KEY]: JSON.stringify({
      selectedColleges: ['网络空间安全学院', '', 42, '网络空间安全学院'],
      selectedFilters: ['internship_ok', 'nonexistent_filter_id', 'doctoral'],
      directionMode: 'or',
    }),
  })
  assert.deepEqual(loadQuickSearchSessionFilters(filtered), {
    selectedColleges: ['网络空间安全学院'],
    selectedFilters: ['internship_ok', 'doctoral'],
    directionMode: 'or',
  })

  const badMode = createFakeStorage({
    [QS_FILTERS_STORAGE_KEY]: JSON.stringify({
      selectedColleges: [],
      selectedFilters: ['no_clock'],
      directionMode: 'xor',
    }),
  })
  assert.equal(loadQuickSearchSessionFilters(badMode).directionMode, 'and')
})

test('saveQuickSearchSessionFilters persists state and removes storage key when cleared', () => {
  const storage = createFakeStorage()
  saveQuickSearchSessionFilters({
    selectedColleges: ['计算机学院'],
    selectedFilters: ['internship_ok', 'dir_llm'],
    directionMode: 'or',
  }, storage)

  assert.deepEqual(loadQuickSearchSessionFilters(storage), {
    selectedColleges: ['计算机学院'],
    selectedFilters: ['internship_ok', 'dir_llm'],
    directionMode: 'or',
  })

  saveQuickSearchSessionFilters({
    selectedColleges: [],
    selectedFilters: [],
    directionMode: 'and',
  }, storage)
  assert.equal(storage.getItem(QS_FILTERS_STORAGE_KEY), null)
})

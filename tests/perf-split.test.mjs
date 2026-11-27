import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('App 懒加载 Message 渲染器与弹窗栈且不存在静态导入', () => {
  const src = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  assert.match(src, /lazy\s*\(/)
  for (const mod of [
    './components/Message.jsx',
    './components/Dialogs.jsx',
    './components/QuickSearch.jsx',
    './components/MentorInsight.jsx',
  ]) {
    assert.ok(src.includes(`import('${mod}')`) || src.includes(`import("${mod}")`), `缺少懒加载导入: ${mod}`)
    const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.doesNotMatch(src, new RegExp(`from\\s+['"]${escaped}['"]`), `不应静态导入: ${mod}`)
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('App 懒加载 Message 渲染器与 Markdown 栈且不存在静态导入', () => {
  const src = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  assert.match(src, /lazy\s*\(/)
  assert.match(src, /import\(['"]\.\/components\/Message\.jsx['"]\)/)
  assert.doesNotMatch(src, /import\s+Message\s+from\s+['"]\.\/components\/Message\.jsx['"]/)
})

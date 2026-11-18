import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'

test('表格、正文、查询记录、复制和导出均隐藏底层信息，来源仍可阅读', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedAnswer = value } } }))
  const streams = []
  page.on('response', response => { if (response.url().endsWith('/messages')) streams.push(response.text()) })
  await page.goto('/')
  await page.getByRole('textbox', { name: '向北极星提问' }).fill('展示边界验收：这两条原文评价怎么写的？')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible()
  const forbidden = /source_locator|review_id|原文位置|导师评价\.md|:L90|"filters"|"select"|"args"/
  await expect(page.getByTestId('artifact')).toHaveCount(2)
  const artifact = page.getByTestId('artifact').first()
  await expect(artifact.locator('tbody tr')).toHaveCount(2)
  await expect(artifact.locator('thead th')).toHaveCount(3)
  await expect(artifact).toContainText('尚煜茗')
  await expect(page.locator('.markdown table thead th')).toHaveCount(2)
  await page.locator('.tool-trace>summary').click()
  await expect(page.locator('.tool-list')).toBeVisible()
  await expect(page.locator('.tool-list code,.tool-list pre,.tool-detail')).toHaveCount(0)
  expect(await page.locator('.assistant-message').innerText()).not.toMatch(forbidden)
  const wire = (await Promise.all(streams)).join('\n')
  expect(wire).not.toMatch(forbidden)
  await page.getByRole('button', { name: '复制回答' }).click()
  expect(await page.evaluate(() => window.copiedAnswer)).not.toMatch(forbidden)
  expect(await page.evaluate(() => window.copiedAnswer)).toContain('尚煜茗')

  const download = async action => {
    const pending = page.waitForEvent('download'); await action()
    const file = await pending
    return fs.readFile(await file.path(), 'utf8')
  }
  const csv = await download(() => artifact.getByRole('button', { name: /CSV/ }).click())
  expect(csv).not.toMatch(forbidden); expect(csv).toContain('尚煜茗')
  const svg = await download(() => page.getByRole('button', { name: '导出 SVG' }).click())
  expect(svg).not.toMatch(forbidden); expect(svg).toContain('第三方评价')
  const markdown = await download(() => page.getByRole('button', { name: '导出对话' }).click())
  expect(markdown).not.toMatch(forbidden); expect(markdown).toContain('2026 招生信息与导师评价'); expect(markdown).not.toContain('undefined')
  await page.getByRole('button', { name: '查看资料来源 1', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: '资料与来源' })).toContainText('2026 招生信息与导师评价')
  expect(await page.getByRole('dialog').innerText()).not.toMatch(forbidden)
})

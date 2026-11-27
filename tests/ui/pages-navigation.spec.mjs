import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

function attachErrorGate(page) {
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', err => pageErrors.push(err.message))
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  return {
    assertClean() {
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    },
  }
}

async function auditA11y(page, label) {
  await page.evaluate(() => Promise.all(
    document.getAnimations()
      .filter(a => Number.isFinite(a.effect?.getTiming().iterations))
      .map(a => a.finished.catch(() => {}))
  ))
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), `Axe WCAG 2A/2AA violations in ${label}`).toEqual([])
}

test.beforeEach(async ({ request }) => {
  await request.post('/__test__/reset')
})

test.afterAll(async ({ request }) => {
  await request.post('/__test__/reset')
})

test('三个并列页面导航、Hash 历史与重载、保活状态、⌘K 聚焦、档案返回及工作台跳转', async ({ page }) => {
  const errors = attachErrorGate(page)
  await page.goto('/')

  const topbar = page.locator('header.topbar')
  const navAgent = topbar.getByRole('button', { name: 'Agent 交互', exact: true })
  const navMentors = topbar.getByRole('button', { name: '查看导师', exact: true })
  const navLibrary = topbar.getByRole('button', { name: '候选库', exact: true })
  const mentorsRegion = page.getByRole('region', { name: '查看导师', exact: true })
  const libraryRegion = page.getByRole('region', { name: '候选库', exact: true })
  const h1 = topbar.locator('h1')

  // (a) Initial Agent page: no modals, clean URL, active tab aria-current="page"
  await expect(navAgent).toHaveAttribute('aria-current', 'page')
  await expect(navMentors).not.toHaveAttribute('aria-current', 'page')
  await expect(navLibrary).not.toHaveAttribute('aria-current', 'page')
  await expect(mentorsRegion).toBeHidden()
  await expect(libraryRegion).toBeHidden()
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0)
  await expect(h1).toHaveText('新对话')
  expect(new URL(page.url()).hash).toBe('')

  // Switch to 查看导师 page
  await navMentors.click()
  await expect(mentorsRegion).toBeVisible()
  await expect(libraryRegion).toBeHidden()
  await expect(navMentors).toHaveAttribute('aria-current', 'page')
  await expect(navAgent).not.toHaveAttribute('aria-current', 'page')
  await expect(h1).toHaveText('查看导师')
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0)
  expect(new URL(page.url()).hash).toBe('#/mentors')

  // Switch to 候选库 page
  await navLibrary.click()
  await expect(libraryRegion).toBeVisible()
  await expect(mentorsRegion).toBeHidden()
  await expect(navLibrary).toHaveAttribute('aria-current', 'page')
  await expect(navMentors).not.toHaveAttribute('aria-current', 'page')
  await expect(h1).toHaveText('候选库')
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0)
  expect(new URL(page.url()).hash).toBe('#/library')

  // (b) Browser back/forward & reload restore active page
  await page.goBack()
  await expect(mentorsRegion).toBeVisible()
  await expect(libraryRegion).toBeHidden()
  expect(new URL(page.url()).hash).toBe('#/mentors')

  await page.goBack()
  await expect(mentorsRegion).toBeHidden()
  await expect(libraryRegion).toBeHidden()
  await expect(navAgent).toHaveAttribute('aria-current', 'page')
  expect(new URL(page.url()).hash).toBe('')

  await page.goForward()
  await expect(mentorsRegion).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#/mentors')

  await page.reload()
  await expect(mentorsRegion).toBeVisible()
  await expect(navMentors).toHaveAttribute('aria-current', 'page')
  expect(new URL(page.url()).hash).toBe('#/mentors')

  // (c) & (g) Keep-alive filter state across 查看导师 <-> 候选库 & "多维查看导师" jump
  const internChip = mentorsRegion.getByRole('button', { name: '可以实习', exact: true })
  await internChip.click()
  await expect(internChip).toHaveAttribute('aria-pressed', 'true')
  const metaBefore = await mentorsRegion.locator('.quick-search-meta').innerText()

  await navLibrary.click()
  await expect(libraryRegion).toBeVisible()
  await libraryRegion.getByRole('button', { name: '多维查看导师', exact: true }).click()
  await expect(mentorsRegion).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#/mentors')
  await expect(internChip).toHaveAttribute('aria-pressed', 'true')
  await expect(mentorsRegion.locator('.quick-search-meta')).toHaveText(metaBefore)

  // (e) Dossier modal overlays without unmounting 查看导师; "返回查看导师" preserves filter
  await mentorsRegion.locator('.quick-search-list .qs-item-main').first().click()
  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await expect(dossier).toBeVisible()
  await dossier.getByRole('button', { name: '返回查看导师', exact: true }).click()
  await expect(dossier).toHaveCount(0)
  await expect(mentorsRegion).toBeVisible()
  await expect(internChip).toHaveAttribute('aria-pressed', 'true')

  // (d) ⌘K / Ctrl+K from Agent switches to 查看导师 and focuses search box
  await navAgent.click()
  await expect(mentorsRegion).toBeHidden()
  await page.keyboard.press('Control+k')
  await expect(mentorsRegion).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#/mentors')
  await expect(mentorsRegion.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' })).toBeFocused()

  errors.assertClean()
})

test('导师档案发起追问自动切回 Agent 交互页面并发送消息', async ({ page }) => {
  const errors = attachErrorGate(page)
  await page.goto('/#/mentors')

  const mentorsRegion = page.getByRole('region', { name: '查看导师', exact: true })
  await expect(mentorsRegion).toBeVisible()
  await mentorsRegion.locator('.quick-search-list .qs-item-main').first().click()

  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await expect(dossier).toBeVisible()
  await dossier.getByRole('button', { name: '有什么坑？', exact: true }).click()

  await expect(dossier).toHaveCount(0)
  await expect(mentorsRegion).toBeHidden()
  await expect(page.locator('header.topbar').getByRole('button', { name: 'Agent 交互', exact: true })).toHaveAttribute('aria-current', 'page')
  expect(new URL(page.url()).hash).toBe('')
  await expect(page.locator('.user-bubble').last()).toContainText('有哪些坑')
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })

  errors.assertClean()
})

test('三个并列页面在浅色、深色模式与移动端 390px 下无障碍与视口布局干净', async ({ page }) => {
  const errors = attachErrorGate(page)
  const topbar = page.locator('header.topbar')

  // (h) Light & dark WCAG 2A/2AA on 查看导师 & 候选库
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/#/mentors')
    await expect(page.getByRole('region', { name: '查看导师', exact: true })).toBeVisible()
    await auditA11y(page, `${scheme}-mentors`)

    await topbar.getByRole('button', { name: '候选库', exact: true }).click()
    await expect(page.getByRole('region', { name: '候选库', exact: true })).toBeVisible()
    await auditA11y(page, `${scheme}-library`)
  }

  // (i) 390px mobile layout: zero horizontal overflow & nav buttons reachable
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/mentors')

  const mentorsRegion = page.getByRole('region', { name: '查看导师', exact: true })
  await expect(mentorsRegion).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  for (const name of ['Agent 交互', '查看导师', '候选库']) {
    const btn = topbar.getByRole('button', { name, exact: true })
    await expect(btn).toBeVisible()
    const box = await btn.boundingBox()
    expect(box).not.toBeNull()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  }

  await topbar.getByRole('button', { name: '候选库', exact: true }).click()
  await expect(page.getByRole('region', { name: '候选库', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  errors.assertClean()
})

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.beforeEach(async ({ request }) => {
  await request.post('/__test__/reset')
})

test.afterEach(async ({ request }) => {
  const state = await request.get('/api/workbench')
  if (!state.ok()) return
  const { items = [] } = await state.json()
  for (const item of items) {
    await request.delete('/api/workbench/items/' + encodeURIComponent(item.key))
  }
})

async function auditA11y(page, label) {
  await page.evaluate(() => Promise.all(
    document.getAnimations()
      .filter(a => Number.isFinite(a.effect?.getTiming().iterations))
      .map(a => a.finished.catch(() => {}))
  ))
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(
    result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
    `Axe WCAG 2A/2AA violations in ${label}`
  ).toEqual([])
}

test('跟随系统深色模式首屏无闪烁生效，全部核心视图、弹窗与 390px 移动端通过 WCAG 2A/2AA 审计', async ({ page, request }) => {
  const errors = []
  page.on('pageerror', err => errors.push(err.message))

  await page.emulateMedia({ colorScheme: 'dark' })
  await request.post('/api/workbench/items', { data: { mentors: [{ name: '付俊松' }, { name: '郭燕慧' }] } })

  // (a) Dark mode applied immediately on initial load
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await auditA11y(page, 'dark-welcome-desktop')

  // (b) Shortcut dialog in dark mode
  await page.getByRole('button', { name: '快捷键', exact: true }).click()
  const shortcutDialog = page.getByRole('dialog', { name: '键盘快捷键', exact: true })
  await expect(shortcutDialog).toBeVisible()
  await auditA11y(page, 'dark-shortcuts-dialog')
  await page.keyboard.press('Escape')

  // Settings 外观 tab in dark mode
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: '外观', exact: true }).click()
  await expect(settings.getByRole('radiogroup', { name: '主题', exact: true })).toBeVisible()
  await auditA11y(page, 'dark-settings-appearance')
  await page.keyboard.press('Escape')

  // QuickSearch with filter & drawer open
  await page.getByRole('button', { name: '查看导师 · 速查导师档案', exact: true }).click()
  const quick = page.getByRole('dialog', { name: '查看导师', exact: true })
  await quick.getByRole('button', { name: '可以实习', exact: true }).click()
  await quick.getByRole('button', { name: /^所属学院/ }).click()
  await auditA11y(page, 'dark-quicksearch-drawer')

  // Dossier (付俊松) desktop
  await quick.getByRole('button', { name: '清空筛选', exact: true }).click()
  await quick.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' }).fill('付俊松')
  await quick.locator('.quick-search-list .qs-item-main').first().click()
  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await expect(dossier).toBeVisible()
  await auditA11y(page, 'dark-dossier-desktop')

  // (b & e) Mobile 390px dossier + welcome in dark mode with zero horizontal overflow
  await page.setViewportSize({ width: 390, height: 844 })
  await auditA11y(page, 'dark-dossier-mobile-390')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await auditA11y(page, 'dark-welcome-mobile-390')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // Back to desktop for Workbench (cards + table) and Ranking Chat
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '候选库 · 打开选导师工作台', exact: true }).click()
  const lib = page.getByRole('dialog', { name: '候选库', exact: true })
  await expect(lib.locator('.mentor-tile')).toHaveCount(2)
  await auditA11y(page, 'dark-workbench-cards')
  await lib.getByRole('button', { name: '候选表格视图', exact: true }).click()
  await auditA11y(page, 'dark-workbench-table')
  await page.keyboard.press('Escape')

  // Completed chat with 前30 ranking artifact
  await page.getByRole('textbox', { name: '向北极星提问' }).fill('把多个学院的老师放一起，来个你认为最好的导师的排名。只前30个最好的导师就够了。')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 20000 })
  await auditA11y(page, 'dark-chat-ranking')

  expect(errors).toEqual([])
})

test('设置外观主题切换与侧栏快捷开关可立即生效、持久化并在跟随系统时响应系统配色', async ({ page }) => {
  const errors = []
  page.on('pageerror', err => errors.push(err.message))

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  // (c) Settings 外观 -> select 浅色 while system is dark -> persists across reload
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByRole('button', { name: '外观', exact: true }).click()
  await settings.getByRole('radio', { name: '浅色', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // Switch back to 跟随系统 -> follows dark media again
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await settings.getByRole('button', { name: '外观', exact: true }).click()
  await settings.getByRole('radio', { name: '跟随系统', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.keyboard.press('Escape')

  // (d) Sidebar toggle flips theme (dark -> light -> dark) and persists across reload
  const toggleBtn = page.getByRole('button', { name: '切换深色模式', exact: true })
  await toggleBtn.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.getByRole('button', { name: '切换深色模式', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  expect(errors).toEqual([])
})

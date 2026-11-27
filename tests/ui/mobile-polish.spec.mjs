import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

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

async function expectNoOverflow(page, label) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth, `Horizontal overflow in ${label}`).toBeLessThanOrEqual(innerWidth)
}

test('390px 触屏移动端满足无缩放输入、触控优化、零横向溢出及双主题 WCAG 2AA 合规', async ({ page, request }) => {
  await request.post('/api/workbench/items', { data: { mentors: [{ name: '付俊松' }] } })

  // Light mode pass
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '选导师，先看清' })).toBeVisible()
  await expectNoOverflow(page, 'mobile-welcome-light')
  await auditA11y(page, 'mobile-welcome-light')

  // Touch action check
  const touchAction = await page.getByRole('button', { name: '查看导师', exact: true }).evaluate(
    el => getComputedStyle(el).touchAction
  )
  expect(touchAction).toBe('manipulation')

  // Composer font-size check (always >= 16px on <=760px)
  const composerFontSize = await page.getByRole('textbox', { name: '向北极星提问' }).evaluate(
    el => parseFloat(getComputedStyle(el).fontSize)
  )
  expect(composerFontSize).toBeGreaterThanOrEqual(16)

  // Quick search open + a11y + overflow + coarse pointer font-size check
  await page.getByRole('button', { name: '查看导师', exact: true }).click()
  const qs = page.getByRole('region', { name: '查看导师', exact: true })
  await expect(qs).toBeVisible()
  await expectNoOverflow(page, 'mobile-quicksearch-light')
  await auditA11y(page, 'mobile-quicksearch-light')

  const isCoarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)
  if (isCoarse) {
    const qsInputFontSize = await qs.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' }).evaluate(
      el => parseFloat(getComputedStyle(el).fontSize)
    )
    expect(qsInputFontSize).toBeGreaterThanOrEqual(16)
  }

  // Dossier mobile overflow check
  await qs.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' }).fill('付俊松')
  await qs.locator('.quick-search-list .qs-item-main').first().click()
  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await expect(dossier).toBeVisible()
  await expect(dossier.locator('.dossier-facts')).toBeVisible()
  await expectNoOverflow(page, 'mobile-dossier-light')

  await page.keyboard.press('Escape')

  // Workbench mobile overflow check
  await page.getByRole('button', { name: '候选库', exact: true }).click()
  const lib = page.getByRole('region', { name: '候选库', exact: true })
  await expect(lib).toBeVisible()
  await expectNoOverflow(page, 'mobile-workbench-light')
  await page.getByRole('button', { name: 'Agent 交互', exact: true }).click()

  // Dark mode pass on welcome + quick search
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expectNoOverflow(page, 'mobile-welcome-dark')
  await auditA11y(page, 'mobile-welcome-dark')

  await page.getByRole('button', { name: '查看导师', exact: true }).click()
  await expect(qs).toBeVisible()
  await expectNoOverflow(page, 'mobile-quicksearch-dark')
  await auditA11y(page, 'mobile-quicksearch-dark')
})

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.beforeEach(async ({ request }) => {
  await request.post('/__test__/reset')
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

test('快捷键弹窗支持 ? 与 Ctrl+/ 打开、不拦截输入框内的 ? 且通过 WCAG 2A/2AA 验证', async ({ page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  await page.goto('/')
  const composer = page.getByRole('textbox', { name: '向北极星提问' })
  await expect(composer).toBeEnabled()

  // Typing ? inside composer inserts ? and does NOT open shortcuts dialog
  await composer.focus()
  await page.keyboard.type('可以实习吗?')
  await expect(composer).toHaveValue('可以实习吗?')
  await expect(page.getByRole('dialog', { name: '键盘快捷键', exact: true })).toHaveCount(0)

  // Pressing ? outside inputs opens shortcut help dialog, Esc closes it
  await composer.blur()
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: '键盘快捷键', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('切换到查看导师并聚焦搜索')
  await auditA11y(page, 'shortcut-help-dialog')

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // Ctrl+/ opens and toggles it too
  await page.keyboard.press('Control+/')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Control+/')
  await expect(dialog).toHaveCount(0)

  // Sidebar shortcuts button opens the dialog as well
  await page.getByRole('button', { name: '快捷键', exact: true }).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  expect(errors).toEqual([])
})

test('速查筛选条件在当前会话内切换离开再切回后保持，清空后同步清除，390px 顶部工具不越界', async ({ page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const nav = page.getByRole('navigation', { name: '核心功能' })

  await page.goto('/')
  await page.keyboard.press('Control+k')
  const quick = page.getByRole('region', { name: '查看导师', exact: true })
  await expect(quick).toBeVisible()

  const intern = quick.getByRole('button', { name: '可以实习', exact: true })
  await intern.click()
  await expect(intern).toHaveAttribute('aria-pressed', 'true')
  await nav.getByRole('button', { name: 'Agent 交互', exact: true }).click()
  await expect(quick).toBeHidden()

  // Switch back via Ctrl+K: filter persists within session
  await page.keyboard.press('Control+k')
  await expect(quick).toBeVisible()
  await expect(quick.getByRole('button', { name: '可以实习', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(quick.locator('.qs-active-bar')).toContainText('已选 1 项筛选')

  // Clear filters and verify cleared state persists across switch
  await quick.getByRole('button', { name: '清空筛选', exact: true }).click()
  await expect(quick.getByRole('button', { name: '可以实习', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await nav.getByRole('button', { name: 'Agent 交互', exact: true }).click()
  await page.keyboard.press('Control+k')
  await expect(quick.getByRole('button', { name: '可以实习', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(quick.locator('.qs-active-bar')).toBeHidden()

  // Mobile 390px quick search header action & topbar nav button fully within viewport without clipping
  await page.setViewportSize({ width: 390, height: 844 })
  for (const btn of [
    quick.getByRole('button', { name: '导出当前筛选导师', exact: true }),
    nav.getByRole('button', { name: '候选库', exact: true }),
  ]) {
    await expect(btn).toBeVisible()
    const box = await btn.boundingBox()
    expect(box).toBeTruthy()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  }

  expect(errors).toEqual([])
})

test('档案复制邮箱触发全局提示，侧栏搜索清空按钮可清空关键词', async ({ page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  await page.addInitScript(() => {
    window.__copied = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => {
          window.__copied.push(text)
        },
      },
    })
  })

  await page.goto('/')

  // Sidebar search clear button
  const sidebarSearch = page.getByRole('searchbox', { name: '搜索对话', exact: true })
  await sidebarSearch.fill('关键词测试')
  const clearSearch = page.getByRole('button', { name: '清空搜索', exact: true })
  await expect(clearSearch).toBeVisible()
  await clearSearch.click()
  await expect(sidebarSearch).toHaveValue('')
  await expect(clearSearch).toHaveCount(0)

  // Copy email in Dossier triggers global .notice toast
  const nav = page.getByRole('navigation', { name: '核心功能' })
  await nav.getByRole('button', { name: '查看导师', exact: true }).click()
  const quick = page.getByRole('region', { name: '查看导师', exact: true })
  await quick.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' }).fill('付俊松')
  await quick.locator('.quick-search-list .qs-item-main').first().click()

  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await expect(dossier).toBeVisible()
  const copyEmailBtn = dossier.getByRole('button', { name: '复制邮箱', exact: true })
  await expect(copyEmailBtn).toBeVisible()
  await copyEmailBtn.click()

  const notice = page.locator('.notice[role="status"]')
  await expect(notice).toContainText('邮箱已复制')
  expect(await page.evaluate(() => window.__copied)).toEqual(['fujs@bupt.edu.cn'])
  await auditA11y(page, 'dossier-with-toast')
  await page.keyboard.press('Escape')
  await nav.getByRole('button', { name: 'Agent 交互', exact: true }).click()

  // Toast stays cleanly above the composer (no bottom overlap)
  const [noticeBox, composerBox] = await Promise.all([
    notice.boundingBox(),
    page.locator('.composer').boundingBox(),
  ])
  expect(noticeBox && composerBox).toBeTruthy()
  expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(composerBox.y)

  expect(errors).toEqual([])
})

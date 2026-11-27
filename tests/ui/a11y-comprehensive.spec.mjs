import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.beforeAll(async ({ request }) => {
  await request.post('/__test__/reset')
})

test.afterAll(async ({ request }) => {
  await request.post('/__test__/reset')
})

function attachRuntimeErrorGate(page) {
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
  expect(
    result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
    `Axe WCAG 2A/2AA violations in ${label}`
  ).toEqual([])
}

test('核心界面与系统弹窗（欢迎页、对话、设置、用量、来源、画像、重命名、回收站）通过 WCAG 2A/2AA 与焦点陷阱验证', async ({ page }) => {
  const errors = attachRuntimeErrorGate(page)

  // Create one completed chat + one deleted chat so Usage, Rename & Trash all render real data rows
  await page.goto('/')
  await auditA11y(page, 'welcome-desktop')

  await page.getByRole('textbox', { name: '向北极星提问' }).fill('比较付俊松和郭燕慧的培养条件')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })
  await auditA11y(page, 'chat-complete-desktop')

  // Settings: both tabs + Tab focus trap + Escape focus return
  const settingsBtn = page.getByRole('button', { name: '设置', exact: true })
  await settingsBtn.click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await expect(settings).toBeVisible()
  await auditA11y(page, 'settings-connection')
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.querySelector('[aria-modal="true"]')?.contains(document.activeElement))).toBe(true)
  await settings.getByRole('button', { name: '执行参数', exact: true }).click()
  await auditA11y(page, 'settings-execution')
  await page.keyboard.press('Escape')
  await expect(settingsBtn).toBeFocused()

  // Usage modal with populated .usage-records
  await page.getByRole('button', { name: /Token 用量/ }).click()
  const usageModal = page.getByRole('dialog', { name: 'Token 用量', exact: true })
  await expect(usageModal.locator('.usage-records tbody tr').first()).toBeVisible()
  await auditA11y(page, 'usage-populated')
  await page.keyboard.press('Escape')

  // Sources modal: list + focused entry
  await page.getByRole('button', { name: '资料与来源', exact: true }).click()
  const sourcesModal = page.getByRole('dialog', { name: '资料与来源', exact: true })
  await auditA11y(page, 'sources-list')
  await sourcesModal.locator('.source-title-button').first().click()
  await expect(sourcesModal.locator('.source-entry').first()).toBeVisible()
  await auditA11y(page, 'sources-detail')
  await page.keyboard.press('Escape')

  // ProfileEditor modal + focus trap
  const profileBtn = page.getByRole('button', { name: '设置我的择导画像', exact: true })
  await profileBtn.click()
  const profileModal = page.getByRole('dialog', { name: '我的择导画像', exact: true })
  await profileModal.getByRole('button', { name: '统考', exact: true }).click()
  await auditA11y(page, 'profile-editor')
  await page.keyboard.press('Escape')
  await expect(profileBtn).toBeFocused()

  // RenameConversation modal
  const firstItem = page.locator('.chat-history .history-item').first()
  await firstItem.hover()
  await firstItem.getByRole('button', { name: /^重命名对话 / }).click()
  await expect(page.getByRole('dialog', { name: '重命名对话', exact: true })).toBeVisible()
  await auditA11y(page, 'rename-conversation')
  await page.keyboard.press('Escape')

  // Create a second chat, delete it so Trash modal has an item, then audit Trash
  await page.getByRole('button', { name: '开启新对话', exact: true }).click()
  await page.getByRole('textbox', { name: '向北极星提问' }).fill('测试回收站无障碍')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })
  const latestItem = page.locator('.chat-history .history-item').first()
  await latestItem.hover()
  await latestItem.getByRole('button', { name: /^移到回收站 / }).click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  const trashModal = page.getByRole('dialog', { name: '回收站', exact: true })
  await expect(trashModal.locator('.trash-list li').first()).toBeVisible()
  await auditA11y(page, 'trash-populated')
  await page.keyboard.press('Escape')

  errors.assertClean()
})

test('工作台与速查/导师档案（卡片、表格、详情、空状态、390px 移动端）通过 WCAG 2A/2AA 验证', async ({ page, request }) => {
  const errors = attachRuntimeErrorGate(page)
  await request.post('/api/workbench/items', { data: { mentors: [{ name: '付俊松' }, { name: '郭燕慧' }] } })
  await page.goto('/')

  const nav = page.getByRole('navigation', { name: '核心功能' })
  // Workbench: cards, table, detail (desktop + 390px mobile)
  await nav.getByRole('button', { name: '候选库', exact: true }).click()
  const lib = page.getByRole('region', { name: '候选库', exact: true })
  await expect(lib.locator('.mentor-tile')).toHaveCount(2)
  await auditA11y(page, 'workbench-cards-desktop')
  await lib.getByRole('button', { name: '候选表格视图', exact: true }).click()
  await auditA11y(page, 'workbench-table-desktop')
  await lib.getByRole('button', { name: '候选卡片视图', exact: true }).click()
  await lib.getByRole('button', { name: '付俊松', exact: true }).click()
  await expect(lib.getByRole('textbox', { name: '导师备注', exact: true })).toBeVisible()
  await auditA11y(page, 'workbench-detail-desktop')

  await page.setViewportSize({ width: 390, height: 844 })
  await auditA11y(page, 'workbench-detail-mobile')

  // QuickSearch with empty-state + MentorDossier at mobile 390px
  await page.setViewportSize({ width: 1440, height: 1000 })
  await nav.getByRole('button', { name: '查看导师', exact: true }).click()
  const quick = page.getByRole('region', { name: '查看导师', exact: true })
  await quick.getByRole('button', { name: '可以实习', exact: true }).click()
  await quick.getByRole('button', { name: /^所属学院/ }).click()
  await auditA11y(page, 'quicksearch-drawer-desktop')
  await quick.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' }).fill('无匹配测试关键词xyz')
  await auditA11y(page, 'quicksearch-empty-desktop')

  await quick.getByRole('button', { name: '清空全部筛选与搜索词', exact: true }).click()
  await quick.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' }).fill('付俊松')
  await quick.locator('.quick-search-list .qs-item-main').first().click()
  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await expect(dossier).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await auditA11y(page, 'dossier-mobile-390')
  await page.keyboard.press('Escape')

  errors.assertClean()
})

test('全局快捷键、表格排序 aria-sort、图表键盘导航及剪贴板成功与失败降级反馈', async ({ page }) => {
  const errors = attachRuntimeErrorGate(page)
  await page.addInitScript(() => {
    window.__clipboardFail = false
    window.__copiedTexts = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => {
          if (window.__clipboardFail) throw new Error('clipboard denied')
          window.__copiedTexts.push(text)
        },
      },
    })
  })

  await page.goto('/')
  const composer = page.getByRole('textbox', { name: '向北极星提问' })
  await expect(composer).toBeEnabled()
  // Global '/' focuses composer when focus is on document.body
  await page.evaluate(() => document.body.focus())
  await page.keyboard.press('/')
  await expect(composer).toBeFocused()

  // Global Ctrl+K switches to 查看导师 and focuses search, then top nav returns to Agent
  await page.keyboard.press('Control+k')
  const quickPage = page.getByRole('region', { name: '查看导师', exact: true })
  await expect(quickPage).toBeVisible()
  await expect(quickPage.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' })).toBeFocused()
  await page.getByRole('navigation', { name: '核心功能' }).getByRole('button', { name: 'Agent 交互', exact: true }).click()
  await expect(quickPage).toBeHidden()

  // Chart keyboard navigation + DataTable aria-sort + Clipboard copy & failure fallback
  await page.getByRole('textbox', { name: '向北极星提问' }).fill('推荐导师并展示评分图表')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })

  const firstBar = page.locator('.artifact svg [data-point-index="0"]').first()
  await firstBar.focus()
  await expect(page.locator('.artifact .chart-tooltip')).toBeVisible()
  await firstBar.press('ArrowRight')
  await expect(page.locator('.artifact svg [data-point-index="1"]').first()).toBeFocused()
  await page.locator('.artifact svg [data-point-index="1"]').first().press('End')
  await expect(page.locator('.artifact svg [data-point-index="3"]').first()).toBeFocused()
  await page.locator('.artifact svg [data-point-index="3"]').first().press('Home')
  await expect(firstBar).toBeFocused()

  await page.getByRole('button', { name: '数据', exact: true }).click()
  const sortHeader = page.locator('.artifact thead th').first()
  await expect(sortHeader).toHaveAttribute('aria-sort', 'none')
  await sortHeader.locator('button').click()
  await expect(sortHeader).toHaveAttribute('aria-sort', 'ascending')
  await sortHeader.locator('button').click()
  await expect(sortHeader).toHaveAttribute('aria-sort', 'descending')

  // Clipboard success
  const copyBtn = page.getByRole('button', { name: '复制回答' })
  await copyBtn.click()
  await expect(page.locator('.message-meta [role="status"]')).toHaveText('回答已复制')
  await expect(copyBtn).toHaveClass(/is-copied/)
  const copyPill = copyBtn.locator('.copy-pill')
  await expect(copyPill).toBeVisible()
  await expect(copyPill).toHaveText('已复制')
  expect(await page.evaluate(() => window.__copiedTexts.length)).toBe(1)

  // Clipboard rejection fallback
  await page.evaluate(() => { window.__clipboardFail = true })
  await page.getByRole('button', { name: '复制回答' }).click()
  await expect(page.locator('.copy-feedback[role="status"]')).toHaveText('复制未成功，可在右上角导出对话。')
  errors.assertClean()
})

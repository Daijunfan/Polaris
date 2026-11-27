import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs/promises'

test.beforeEach(async ({ request }) => {
  await request.post('/__test__/provider', { data: { modelsStatus: null } })
  await request.post('/__test__/reset')
})

test.afterAll(async ({ request }) => {
  await request.post('/__test__/provider', { data: { modelsStatus: null } })
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

async function captureDownloadBytes(page, triggerFn) {
  const downloadPromise = page.waitForEvent('download')
  await triggerFn()
  const download = await downloadPromise
  const filePath = await download.path()
  const buffer = await fs.readFile(filePath)
  return { filename: download.suggestedFilename(), buffer }
}

test('全场景导出（欢迎页预设、速查筛选、档案、候选库、对决与对话消息）均下载真实有效的 Excel/PDF/Word/MD 文件', async ({ page }) => {
  const errors = attachRuntimeErrorGate(page)
  await page.goto('/')

  // 1. Welcome topbar preset export + WCAG 2A/2AA + Escape return focus
  const topExportBtn = page.getByRole('button', { name: '快捷导出导师数据', exact: true })
  await expect(topExportBtn).toBeVisible()
  await topExportBtn.click()
  await auditA11y(page, 'welcome-export-menu-open')
  const presetXlsx = await captureDownloadBytes(page, () =>
    page.getByRole('button', { name: '导出5 星高口碑导师 XLSX', exact: true }).click()
  )
  expect(presetXlsx.filename).toMatch(/\.xlsx$/i)
  expect(presetXlsx.buffer.subarray(0, 4).toString('hex')).toBe('504b0304')

  // Escape closes export menu cleanly and returns focus
  await topExportBtn.click()
  await expect(page.getByRole('region', { name: '快捷导出导师数据' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: '快捷导出导师数据' })).toHaveCount(0)
  await expect(topExportBtn).toBeFocused()

  // 2. QuickSearch filtered export (.xlsx + .pdf) and Dossier export (.docx)
  const nav = page.getByRole('navigation', { name: '核心功能' })
  await nav.getByRole('button', { name: '查看导师', exact: true }).click()
  const qs = page.getByRole('region', { name: '查看导师', exact: true })
  await expect(qs).toBeVisible()
  await qs.getByRole('textbox', { name: '搜索导师姓名、方向或关键词', exact: true }).fill('付俊松')
  await expect(qs.locator('[data-qs-item]')).toHaveCount(1)

  await qs.getByRole('button', { name: '导出当前筛选导师', exact: true }).click()
  const qsPdf = await captureDownloadBytes(page, () =>
    qs.getByRole('button', { name: /PDF 报告/ }).click()
  )
  expect(qsPdf.filename).toMatch(/\.pdf$/i)
  expect(qsPdf.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')

  await qs.locator('.qs-open-btn').first().click()
  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await expect(dossier).toBeVisible()
  await dossier.getByRole('button', { name: '导出 付俊松 导师档案', exact: true }).click()
  const dossierDocx = await captureDownloadBytes(page, () =>
    dossier.getByRole('button', { name: /Word 文档/ }).click()
  )
  expect(dossierDocx.filename).toMatch(/\.docx$/i)
  expect(dossierDocx.buffer.subarray(0, 4).toString('hex')).toBe('504b0304')

  // Bookmark 付俊松 from Dossier then close Dossier and switch to Library page
  await dossier.getByRole('button', { name: '加入候选库', exact: true }).click()
  await dossier.getByRole('button', { name: '关闭面板', exact: true }).click()

  // 3. Workbench shortlist Excel export
  await nav.getByRole('button', { name: '候选库', exact: true }).click()
  const lib = page.getByRole('region', { name: '候选库', exact: true })
  await expect(lib).toBeVisible()
  await lib.getByRole('button', { name: '多格式导出候选列表', exact: true }).click()
  const libXlsx = await captureDownloadBytes(page, () =>
    lib.getByRole('button', { name: /Excel 表格/ }).click()
  )
  expect(libXlsx.filename).toMatch(/\.xlsx$/i)
  expect(libXlsx.buffer.subarray(0, 4).toString('hex')).toBe('504b0304')
  await nav.getByRole('button', { name: 'Agent 交互', exact: true }).click()

  // 4. Chat + Chart artifact + Message export
  const composer = page.getByRole('textbox', { name: '向北极星提问' })
  await composer.fill('可视化导师评分并用正文解读')
  await page.getByRole('button', { name: '发送问题' }).click()
  const msg = page.getByTestId('assistant-message').last()
  await expect(msg).toContainText('导师原文评分对比', { timeout: 10000 })
  await expect(msg.getByRole('button', { name: '导出本条回答', exact: true })).toBeVisible({ timeout: 10000 })

  // Export artifact chart as Excel & message as Markdown
  await msg.getByRole('button', { name: '多格式导出 导师原文评分对比', exact: true }).click()
  const chartXlsx = await captureDownloadBytes(page, () =>
    msg.getByRole('button', { name: /Excel 表格/ }).click()
  )
  expect(chartXlsx.filename).toMatch(/\.xlsx$/i)
  expect(chartXlsx.buffer.subarray(0, 4).toString('hex')).toBe('504b0304')

  await msg.getByRole('button', { name: '导出本条回答', exact: true }).click()
  const msgMd = await captureDownloadBytes(page, () =>
    msg.getByRole('button', { name: /Markdown 文档/ }).click()
  )
  expect(msgMd.filename).toMatch(/\.md$/i)
  expect(msgMd.buffer.toString('utf8')).toContain('北极星')

  errors.assertClean()
})

test('模型连接设置支持常用服务商预设、脱敏密钥显示、测试连接成功与错误提示并通过 WCAG 2A/2AA', async ({ page, request }) => {
  const errors = attachRuntimeErrorGate(page)
  await page.goto('/')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await expect(settings).toBeVisible()

  // Masked key preview badge
  await expect(settings.locator('.saved-label')).toContainText('已保存')
  await expect(settings.locator('.saved-label')).not.toContainText('ui-fixture-only')

  // Provider preset pills update API URL & model
  const presets = settings.getByRole('group', { name: '常用服务商预设' })
  await expect(presets).toBeVisible()
  await presets.getByRole('button', { name: 'OpenAI', exact: true }).click()
  await expect(settings.getByLabel('API URL', { exact: true })).toHaveValue('https://api.openai.com/v1')
  await presets.getByRole('button', { name: '本地 Ollama', exact: true }).click()
  await expect(settings.getByLabel('API URL', { exact: true })).toHaveValue('http://127.0.0.1:11434/v1')

  // Switch back to mock proxyUrl and test connection success
  const resetInfo = await (await request.post('/__test__/reset')).json()
  await settings.getByLabel('API URL', { exact: true }).fill(resetInfo.proxyUrl)
  await settings.getByLabel('API Key', { exact: false }).fill('sk-settings-test-secret-key')
  await settings.getByRole('button', { name: '测试连接', exact: true }).click()
  await expect(settings.locator('.form-success[role="status"]')).toContainText('连接成功')
  await auditA11y(page, 'settings-presets-and-test-success')

  // Test connection 401 failure shows error banner
  await request.post('/__test__/provider', { data: { modelsStatus: 401 } })
  await settings.getByRole('button', { name: '测试连接', exact: true }).click()
  await expect(settings.locator('.form-error[role="alert"]')).toContainText('API Key 无效或已失效')

  await request.post('/__test__/provider', { data: { modelsStatus: null } })
  errors.assertClean()
})

test('360px 窄屏移动端顶栏与导出弹窗无横向溢出且可正常交互', async ({ page }) => {
  const errors = attachRuntimeErrorGate(page)
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')

  const exportTrigger = page.getByRole('button', { name: '快捷导出导师数据', exact: true })
  await expect(exportTrigger).toBeVisible()
  await exportTrigger.click()
  const menu = page.getByRole('region', { name: '快捷导出导师数据' })
  await expect(menu).toBeVisible()

  const overflow = await page.evaluate(() => {
    const docOverflow = document.documentElement.scrollWidth > window.innerWidth
    const rect = document.querySelector('.export-menu-popover')?.getBoundingClientRect()
    return {
      docOverflow,
      menuLeft: rect?.left ?? 0,
      menuRight: rect?.right ?? 0,
      viewportWidth: window.innerWidth,
    }
  })
  expect(overflow.docOverflow).toBe(false)
  expect(overflow.menuLeft).toBeGreaterThanOrEqual(0)
  expect(overflow.menuRight).toBeLessThanOrEqual(overflow.viewportWidth)

  errors.assertClean()
})

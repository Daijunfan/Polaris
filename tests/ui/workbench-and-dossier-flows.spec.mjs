import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'

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

test('工作台目录分页、收藏撤销、公式注入防卫 CSV 导出与 HTML/MD 报告', async ({ page, request }) => {
  const errors = attachRuntimeErrorGate(page)
  await page.goto('/')
  await page.getByRole('button', { name: '候选库', exact: true }).click()
  const lib = page.getByRole('region', { name: '候选库', exact: true })
  await expect(lib).toBeVisible()

  // Directory discovery & pagination
  await lib.getByRole('button', { name: '添加导师', exact: true }).click()
  await expect(lib.locator('.workspace-pagination')).toContainText('1–30 /')
  await lib.getByRole('button', { name: '下一页导师', exact: true }).click()
  await expect(lib.locator('.workspace-pagination')).toContainText('31–60 /')
  await lib.getByRole('button', { name: '上一页导师', exact: true }).click()
  await expect(lib.locator('.workspace-pagination')).toContainText('1–30 /')

  // Search & bookmark 付俊松
  await lib.getByRole('textbox', { name: '查找要添加的导师', exact: true }).fill('付俊松')
  await expect(lib.locator('.mentor-tile')).toHaveCount(1)
  await lib.getByRole('button', { name: '收藏 付俊松', exact: true }).click()
  await lib.getByRole('button', { name: '返回已收藏', exact: true }).click()
  await expect(lib.locator('.mentor-tile-name')).toHaveText(['付俊松'])

  // Formula-injection note auto-save & CSV neutralization
  await lib.getByRole('button', { name: '付俊松', exact: true }).click()
  const noteBox = lib.getByRole('textbox', { name: '导师备注', exact: true })
  const formulaNote = '=CMD("calc") + 重点核对实习时间'
  await noteBox.fill(formulaNote)
  await expect(lib.locator('.detail-note-actions small[role="status"]')).toHaveText('已保存 · 自动保存', { timeout: 5000 })
  await lib.getByRole('button', { name: '返回候选', exact: true }).click()

  const downloadPromise = page.waitForEvent('download')
  await lib.getByRole('button', { name: '导出当前结果', exact: true }).click()
  const download = await downloadPromise
  const csvContent = await fs.readFile(await download.path(), 'utf8')
  expect(csvContent).toContain('付俊松')
  expect(csvContent).toContain("'=CMD")

  // HTML & Markdown exports via API
  for (const format of ['html', 'md']) {
    const res = await request.post('/api/workbench/export', { data: { format, scope: 'library' } })
    expect(res.status()).toBe(200)
    expect(res.headers()['content-disposition']).toContain("filename*=UTF-8''")
    const text = await res.text()
    expect(text).toContain('付俊松')
  }

  // AnalysisRules filter -> empty state -> clear
  await lib.locator('.analysis-rules > summary').click()
  await lib.getByRole('button', { name: '添加条件', exact: true }).click()
  await lib.getByLabel('筛选字段 1', { exact: true }).selectOption('status')
  await lib.getByLabel('筛选值 1', { exact: true }).selectOption({ label: '已联系' })
  await lib.getByRole('button', { name: '应用联动', exact: true }).click()
  await expect(lib.locator('.workspace-empty')).toContainText('没有匹配的候选')
  await lib.getByRole('button', { name: '清除条件', exact: true }).click()
  await expect(lib.locator('.mentor-tile-name')).toHaveText(['付俊松'])

  // Remove item & undo via toast (restores item and note)
  await lib.getByRole('button', { name: '取消收藏 付俊松', exact: true }).click()
  await expect(lib.locator('.workspace-empty')).toContainText('候选库为空')
  const toast = lib.locator('.workspace-toast[role="status"]')
  await expect(toast).toContainText('已移出候选')
  await toast.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(toast).toContainText('已恢复候选及备注')
  await expect(lib.locator('.mentor-tile-name')).toHaveText(['付俊松'])
  await expect(lib.locator('.mentor-note-preview')).toContainText('=CMD')

  await page.getByRole('button', { name: 'Agent 交互', exact: true }).click()
  errors.assertClean()
})

test('导师档案嵌套返回栈（实际带教）、纯官网档案、六维雷达联动及速查空状态恢复', async ({ page, request }) => {
  const errors = attachRuntimeErrorGate(page)
  const { mentors } = await (await request.get('/api/insights')).json()
  const entries = Object.values(mentors)

  const supervisorMentor = entries.find(m =>
    m.supervisor?.name &&
    entries.some(other => other.name === m.supervisor.name && other.college === m.college)
  )
  const officialOnlyMentor = entries.find(m =>
    !m.evidence?.personal &&
    !m.evidence?.team &&
    (!m.flags || !m.flags.length) &&
    m.rating == null &&
    (m.biography || m.projects || m.achievements || m.admissions || m.doctoralPrograms)
  )
  expect(supervisorMentor, 'Expected at least one mentor with actual_supervisor').toBeTruthy()
  expect(officialOnlyMentor, 'Expected at least one official-only mentor').toBeTruthy()

  await page.goto('/')
  await page.getByRole('button', { name: '查看导师', exact: true }).click()
  const quick = page.getByRole('region', { name: '查看导师', exact: true })
  const searchBox = quick.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' })

  // XSS-safe query + incompatible filters recovery
  await searchBox.fill('<script>alert(1)</script>')
  await expect(quick.locator('.quick-search-empty')).toBeVisible()
  await quick.getByRole('button', { name: '清空全部筛选与搜索词', exact: true }).click()
  await expect(quick.locator('.quick-search-list .qs-item').first()).toBeVisible()

  // Nested Dossier stack: mentor -> actual_supervisor -> back to mentor
  await searchBox.fill(supervisorMentor.name)
  await quick.locator('.quick-search-list .qs-item-main').filter({ hasText: supervisorMentor.name }).first().click()
  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await expect(dossier).toBeVisible()
  await expect(dossier.locator('.dossier-supervisor')).toContainText(`实际带教：${supervisorMentor.supervisor.name}`)
  await dossier.locator('.dossier-supervisor button').click()

  await expect(dossier.locator('.dossier-identity h3').first()).toHaveText(supervisorMentor.supervisor.name)
  const backBtn = dossier.getByRole('button', { name: `返回${supervisorMentor.name}`, exact: true })
  await expect(backBtn).toBeVisible()
  await backBtn.click()
  await expect(dossier.locator('.dossier-identity h3').first()).toHaveText(supervisorMentor.name)
  await dossier.getByRole('button', { name: '返回查看导师', exact: true }).click()

  // Official-only Dossier renders academic card instead of empty radar
  await quick.getByRole('button', { name: '清空搜索词', exact: true }).click()
  await searchBox.fill(officialOnlyMentor.name)
  await quick.locator('.quick-search-list .qs-item-main').filter({ hasText: officialOnlyMentor.name }).first().click()
  await expect(dossier.locator('section.dossier-official')).toBeVisible()
  await expect(dossier.locator('.dossier-radar')).toHaveCount(0)
  await dossier.getByRole('button', { name: '返回查看导师', exact: true }).click()

  // Rich-review Dossier interactive 6-axis radar mini pills
  await quick.getByRole('button', { name: '清空搜索词', exact: true }).click()
  await searchBox.fill('付俊松')
  await quick.locator('.quick-search-list .qs-item-main').filter({ hasText: '付俊松' }).first().click()
  const pills = dossier.locator('.radar-mini-pill')
  await expect(pills).toHaveCount(6)
  await pills.first().click()
  await expect(dossier.locator('.radar-hint')).toContainText(/\/ 5|暂无评价记录/)

  await page.keyboard.press('Escape')
  errors.assertClean()
})

test('资料来源截断与反爬保护字段、5人雷达对决上限与图表校验', async ({ page, request }) => {
  const errors = attachRuntimeErrorGate(page)
  const dataPayload = await (await request.get('/api/data')).json()
  const reviewSources = dataPayload.sources.filter(s => s.kind === '第三方评价')
  let truncatedSource = null
  for (const src of reviewSources) {
    const detail = await (await request.get(`/api/sources/${src.id}`)).json()
    if (detail.truncated) {
      truncatedSource = { ...src, detail }
      break
    }
  }
  expect(truncatedSource, 'Expected a truncated 第三方评价 source').toBeTruthy()
  expect(truncatedSource.detail.entries.length).toBe(20)
  expect(truncatedSource.detail.total_entries).toBeGreaterThan(20)
  expect(truncatedSource.detail.protection_notice).toContain('20')

  await page.goto('/')
  await page.getByRole('button', { name: '资料与来源', exact: true }).click()
  const sourcesDialog = page.getByRole('dialog', { name: '资料与来源', exact: true })
  await expect(sourcesDialog).toBeVisible()
  await sourcesDialog.getByRole('button', { name: truncatedSource.title, exact: true }).first().click()
  await expect(sourcesDialog.locator('.source-entry')).toHaveCount(20)
  const protectionBanner = sourcesDialog.locator('.source-protection-banner')
  await expect(protectionBanner).toBeVisible()
  await expect(protectionBanner).toContainText(truncatedSource.detail.protection_notice)
  await expect(protectionBanner.locator('.source-truncation-badge')).toHaveText(`显示前 20 / 共 ${truncatedSource.detail.total_entries} 条`)

  const innerSearch = sourcesDialog.getByRole('textbox', { name: '在本资料内查找', exact: true })
  if (await innerSearch.count()) {
    await innerSearch.fill('不可能存在的评价关键词xyz')
    await expect(sourcesDialog.locator('.empty-state')).toHaveText('没有匹配的内容')
  }
  await page.keyboard.press('Escape')

  // 5-mentor DuelPanel comparison cap (4 radar series + 5 person cards)
  await page.getByRole('textbox', { name: '向北极星提问' }).fill('把多个学院的老师放一起，来个你认为最好的导师的排名。只前30个最好的导师就够了。')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })

  const checkboxes = page.locator('.rank-select input')
  for (let i = 0; i < 5; i++) await checkboxes.nth(i).check()
  await page.getByRole('button', { name: '对比这 5 位', exact: true }).click()

  const compareModal = page.getByRole('dialog', { name: '导师对比', exact: true })
  await expect(compareModal).toBeVisible()
  const duel = compareModal.getByRole('region', { name: '导师对决', exact: true })
  await expect(duel.locator('.duel-person')).toHaveCount(5)
  await expect(duel.locator('.duel-legend > span')).toHaveCount(4)
  await expect(duel.locator('.duel-cap-note')).toContainText('雷达图展示前 4 位')
  const labelHeaderWidth = await compareModal.locator('.comparison-table thead th').first().evaluate(el => el.getBoundingClientRect().width)
  const labelCellWidth = await compareModal.locator('.comparison-table tbody th').first().evaluate(el => el.getBoundingClientRect().width)
  expect(labelHeaderWidth).toBeGreaterThanOrEqual(130)
  expect(labelCellWidth).toBeGreaterThanOrEqual(130)

  await page.keyboard.press('Escape')
  await expect(compareModal).toHaveCount(0)

  // Single-value chart description renders "培养体验评分 5 / 5" without "/ 5 5" typo
  await page.getByRole('textbox', { name: '向北极星提问' }).fill('推荐导师并展示评分图表')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toHaveCount(2, { timeout: 15000 })
  const chartArtifact = page.getByTestId('artifact').last()
  await expect(chartArtifact.locator('.artifact-description')).toHaveText('培养体验评分 5 / 5')
  await expect(chartArtifact.locator('.artifact-description')).not.toContainText('/ 5 5')
  errors.assertClean()
})

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs/promises'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { startUiServer } from '../ui-server.mjs'

const execFileAsync = promisify(execFile)

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
    `Axe violations in ${label}`
  ).toEqual([])
}

async function runCli(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ['bin/mentor.mjs', ...args], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr })
    })
    if (input !== undefined) {
      child.stdin.write(input)
      child.stdin.end()
    }
  })
}

test('Tier4-01: 首次接入配置、画像设置、排名推荐与多图导出完整桌面旅程', async ({ page }) => {
  const srv = await startUiServer({ port: 0, configured: false, vaultLocked: false })
  const errors = attachRuntimeErrorGate(page)
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(srv.url)
    await auditA11y(page, 't4-01-welcome')

    // Complete connection onboarding
    await page.getByRole('button', { name: '连接模型' }).click()
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.getByLabel('API URL', { exact: true }).fill(srv.proxyUrl)
    await settings.getByLabel('API Key', { exact: false }).fill('journey-secret-key')
    await settings.getByRole('button', { name: '获取模型列表' }).click()
    await settings.getByRole('combobox', { name: '模型', exact: true }).selectOption('test-agent')
    await settings.getByRole('button', { name: '连接并保存' }).click()
    await expect(settings).toHaveCount(0)

    // Configure ProfileBar
    await page.getByRole('button', { name: '设置我的择导画像', exact: true }).click()
    const profileModal = page.getByRole('dialog', { name: '我的择导画像', exact: true })
    await profileModal.getByRole('button', { name: '统考', exact: true }).click()
    await profileModal.getByRole('button', { name: '毕业就业', exact: true }).click()
    await profileModal.getByRole('button', { name: '能实习', exact: true }).click()
    await profileModal.getByLabel('初试分数').fill('355')
    await profileModal.getByLabel('感兴趣的方向').fill('大模型安全')
    await profileModal.getByRole('button', { name: '保存画像', exact: true }).click()
    await expect(page.getByRole('button', { name: '编辑我的择导画像' })).toContainText('355分')

    // Ask ranking prompt
    const composer = page.getByRole('textbox', { name: '向北极星提问' })
    await composer.fill('把多个学院的老师放一起，来个你认为最好的导师的排名。只前30个最好的导师就够了。')
    await page.getByRole('button', { name: '发送问题' }).click()
    await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.funnel')).toContainText('最终名单')
    await auditA11y(page, 't4-01-ranking')

    // Export share card PNG
    const cardDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: /择导卡/ }).click()
    expect((await cardDownload).suggestedFilename()).toMatch(/北极星择导卡.*\.png$/)

    // Follow-up multi-chart + CSV & chat Markdown export
    await composer.fill('模拟多图：生成五类对比图')
    await page.getByRole('button', { name: '发送问题' }).click()
    await expect(page.getByRole('button', { name: '复制回答' })).toHaveCount(2, { timeout: 15000 })
    await expect(page.getByTestId('artifact')).toHaveCount(6)

    const chatMdPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出对话', exact: true }).click()
    const chatMd = await fs.readFile(await (await chatMdPromise).path(), 'utf8')
    expect(chatMd).toContain('## 我')
    expect(chatMd).toContain('## 北极星')
    expect(chatMd).not.toContain('PRIVATE_REASONING_TEST')

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    errors.assertClean()
  } finally {
    await srv.close()
  }
})

test('Tier4-02: 笔记本 1024px 速查多维筛选 -> 档案步进收藏 -> 候选库清单、快照与方案对照', async ({ page, request }) => {
  const errors = attachRuntimeErrorGate(page)
  await request.post('/__test__/reset')
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/')

  // Ctrl+K QuickSearch homophone & multi-filter
  await page.keyboard.press('Control+k')
  const quick = page.getByRole('region', { name: '查看导师', exact: true })
  await expect(quick).toBeVisible()
  const searchBox = quick.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' })
  await searchBox.fill('傅俊松')
  await expect(quick.locator('.quick-search-list')).toContainText('付俊松')
  await quick.getByRole('button', { name: '清空搜索词', exact: true }).click()

  await quick.getByRole('button', { name: '可以实习', exact: true }).click()
  await quick.getByRole('button', { name: '博导', exact: true }).click()
  await searchBox.press('ArrowDown')
  await searchBox.press('Enter')

  // Step to next mentor in Dossier & bookmark
  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await expect(dossier).toBeVisible()
  const firstName = await dossier.locator('.dossier-identity h3').first().innerText()
  await dossier.getByRole('button', { name: '加入候选库', exact: true }).click()
  await dossier.getByRole('button', { name: '下一位导师', exact: true }).click()
  const secondName = await dossier.locator('.dossier-identity h3').first().innerText()
  expect(secondName).not.toBe(firstName)
  await dossier.getByRole('button', { name: '加入候选库', exact: true }).click()
  await dossier.getByRole('button', { name: '返回查看导师', exact: true }).click()

  // Open Workbench, create list, set status & note
  await page.getByRole('button', { name: '候选库', exact: true }).click()
  const lib = page.getByRole('region', { name: '候选库', exact: true })
  await expect(lib.locator('.mentor-tile')).toHaveCount(2)
  await lib.getByRole('button', { name: '新建清单', exact: true }).click()
  await lib.getByRole('textbox', { name: '清单名称', exact: true }).fill('冲刺名单')
  await lib.getByRole('button', { name: '保存', exact: true }).click()
  await lib.getByLabel('将' + firstName + '加入清单').selectOption({ label: '冲刺名单' })

  await lib.getByRole('button', { name: firstName, exact: true }).click()
  await lib.getByLabel('联系进度', { exact: true }).selectOption('priority')
  await lib.getByRole('textbox', { name: '导师备注', exact: true }).fill('1024px 笔记本流程备注确认')
  await expect(lib.locator('.detail-note-actions small[role="status"]')).toHaveText('已保存 · 自动保存', { timeout: 5000 })
  await lib.getByRole('button', { name: '返回候选', exact: true }).click()
  await auditA11y(page, 't4-02-workbench-1024')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Agent 交互', exact: true }).click()

  // Workbench comparison snapshots & scenario compare + HTML export
  await request.put('/api/workbench/comparison', { data: { mentors: [{ name: firstName }, { name: secondName }] } })
  const snapA = await (await request.post('/api/workbench/snapshots', { data: { name: '方案A', conclusion: '偏实习优先' } })).json()
  await request.put('/api/workbench/comparison', { data: { mentors: [{ name: secondName }] } })
  const snapB = await (await request.post('/api/workbench/snapshots', { data: { name: '方案B', conclusion: '精简聚焦一位' } })).json()

  const cmpRes = await request.post('/api/workbench/scenarios/compare', {
    data: { ids: [snapA.snapshots[0].id, snapB.snapshots[1].id] },
  })
  expect(cmpRes.status()).toBe(200)
  const cmp = await cmpRes.json()
  expect(cmp.shared.length + cmp.onlyLeft.length + cmp.onlyRight.length).toBeGreaterThan(0)

  const htmlReport = await request.get(`/api/workbench/export?format=html&snapshot=${encodeURIComponent(snapA.snapshots[0].id)}`)
  expect(htmlReport.status()).toBe(200)
  expect(await htmlReport.text()).toContain('偏实习优先')
  errors.assertClean()
})

test('Tier4-03: 手机端 390px/360px 速查 -> 档案追问 -> 抽屉重命名回收撤销全旅程', async ({ page, request }) => {
  const errors = attachRuntimeErrorGate(page)
  await request.post('/__test__/reset')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await auditA11y(page, 't4-03-mobile-welcome')

  await page.getByRole('button', { name: '查看导师', exact: true }).click()
  const quick = page.getByRole('region', { name: '查看导师', exact: true })
  await quick.getByRole('button', { name: '6G', exact: true }).click()
  await quick.locator('.quick-search-list .qs-item-main').first().click()
  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await expect(dossier).toBeVisible()
  await auditA11y(page, 't4-03-mobile-dossier')

  await dossier.getByRole('button', { name: /有什么坑/ }).click()
  await expect(dossier).toHaveCount(0)
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })

  // Shrink further to 360x800 and check overflow + drawer rename/delete/undo
  await page.setViewportSize({ width: 360, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await auditA11y(page, 't4-03-mobile-chat-360')

  await page.getByRole('button', { name: '打开对话列表', exact: true }).click()
  await page.locator('.chat-history .history-item').first().getByRole('button', { name: /^移到回收站 / }).click()
  const notice = page.locator('.notice[role="status"]')
  await expect(notice).toContainText('已移到回收站')
  await notice.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.chat-history .history-item')).toHaveCount(1)
  errors.assertClean()
})

test('Tier4-04: CLI (bin/mentor.mjs) 与 Web UI 实时同步及管道/边界校验', async ({ page, request }) => {
  const errors = attachRuntimeErrorGate(page)
  await request.post('/__test__/reset')
  const baseUrl = 'http://127.0.0.1:3321'

  // CLI --version & schemas
  const ver = await runCli(['--version'])
  expect(ver.code).toBe(0)
  expect(JSON.parse(ver.stdout)).toMatchObject({ name: '北极星' })

  const schemas = await runCli(['schemas'])
  expect(schemas.code).toBe(0)
  expect(JSON.parse(schemas.stdout).tools.length).toBe(8)

  // CLI profile update -> reflected in Web UI ProfileBar
  const cliProfile = await runCli([
    'profile', '--action', 'update', '--score', '368', '--goal', 'research', '--musts', 'internship', '--server', baseUrl,
  ])
  expect(cliProfile.code, cliProfile.stderr).toBe(0)

  // CLI workspace save -> reflected in Web UI 候选库
  const cliSave = await runCli([
    'workspace', '--action', 'save', '--json', JSON.stringify({ mentors: [{ name: '付俊松' }] }), '--server', baseUrl,
  ])
  expect(cliSave.code, cliSave.stderr).toBe(0)

  await page.goto('/')
  const profileBtn = page.getByRole('button', { name: '编辑我的择导画像', exact: true })
  await expect(profileBtn).toContainText('368分')
  await expect(profileBtn).toContainText('读博深造')
  await expect(profileBtn).toContainText('能实习')
  await expect(page.getByRole('button', { name: '候选库', exact: true })).toContainText('1')

  // CLI query | visualize stdin pipeline
  const qRes = await runCli([
    'query', '--from', 'mentors',
    '--where', JSON.stringify([{ field: 'name', op: 'in', value: ['付俊松', '郭燕慧', '杨文川'] }]),
    '--select', 'name,college,rating',
  ])
  expect(qRes.code, qRes.stderr).toBe(0)
  const qPayload = JSON.parse(qRes.stdout)
  expect(qPayload.rows.length).toBeGreaterThanOrEqual(3)
  const vRes = await runCli(['visualize', '--from', '-', '--type', 'table', '--title', 'CLI管道表'], { input: qRes.stdout })
  expect(vRes.code, vRes.stderr).toBe(0)
  expect(JSON.parse(vRes.stdout).artifact.rows.length).toBe(qPayload.rows.length)

  // CLI boundary errors exit 1 with JSON error on stderr
  const badLimit = await runCli(['query', '--from', 'mentors', '--limit', 'abc'])
  expect(badLimit.code).toBe(1)
  expect(badLimit.stderr).toContain('必须是整数')

  const badServer = await runCli(['profile', '--action', 'read', '--server', 'http://127.0.0.1:59999'])
  expect(badServer.code).toBe(1)
  expect(badServer.stderr).toContain('无法连接')

  const truncatedStdin = await runCli(['workspace', '--action', 'save', '--from', '-', '--server', baseUrl], {
    input: JSON.stringify({ total: 10, rows: [{ name: '付俊松', college: '网络空间安全学院' }] }),
  })
  expect(truncatedStdin.code).toBe(1)
  expect(truncatedStdin.stderr).toContain('避免把分页样本当成全部')

  errors.assertClean()
})

test('Tier4-05: 安全响应头、反爬限流、输入边界校验与 DSML/路径/推理脱敏门禁', async ({ page, request }) => {
  const errors = attachRuntimeErrorGate(page)
  await request.post('/__test__/reset')

  // Anti-scrape limit > 100 blocked; limit 100 allowed; limit 0 rejected
  const blocked = await request.post('/api/tools/query', { data: { from: 'mentors', limit: 101 } })
  expect(blocked.status()).toBe(403)
  expect((await blocked.json()).code).toBe('BULK_EXPORT_BLOCKED')

  const allowed = await request.post('/api/tools/query', { data: { from: 'mentors', limit: 100 } })
  expect(allowed.status()).toBe(200)
  const allowedBody = await allowed.json()
  expect(allowedBody.columns.some(c => /^(mentor_id|source_locator|sha256)$/.test(c.key))).toBe(false)
  expect(allowedBody.rows.every(r => !('mentor_id' in r) && !('source_locator' in r))).toBe(true)

  const zeroLimit = await request.post('/api/tools/query', { data: { from: 'mentors', limit: 0 } })
  expect(zeroLimit.status()).toBe(400)

  // Security headers, origin guard & path traversal rejection
  const health = await request.get('/api/health')
  expect(health.headers()['x-content-type-options']).toBe('nosniff')
  expect(health.headers()['referrer-policy']).toBe('no-referrer')

  const evilOrigin = await request.post('/api/tools/query', {
    headers: { Origin: 'http://evil.example' },
    data: { from: 'mentors', limit: 1 },
  })
  expect(evilOrigin.status()).toBe(403)

  const traversalStatus = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 3321, path: '/..%2fpackage.json', method: 'GET' }, res => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
  expect(traversalStatus).toBe(404)

  const nullByte = await request.get('/%00')
  expect(nullByte.status()).toBe(404)

  for (const sensitivePath of ['/data/dataset.vault', '/.env', '/.local/vault.key']) {
    const res = await request.get(sensitivePath)
    const text = await res.text()
    expect(text.startsWith('PVLT')).toBe(false)
    expect(text).not.toContain('MENTOR_VAULT_KEY')
  }

  // Input length & legacy endpoint guards
  const chat = await (await request.post('/api/chats', { data: {} })).json()
  const tooLongMsg = await request.post(`/api/chats/${chat.id}/messages`, { data: { text: '字'.repeat(20001) } })
  expect(tooLongMsg.status()).toBe(400)
  const legacyGoal = await request.post(`/api/chats/${chat.id}/goal/resume`, { data: {} })
  expect(legacyGoal.status()).toBe(410)

  await request.post('/api/workbench/items', { data: { mentors: [{ name: '付俊松' }] } })
  const wb = await (await request.get('/api/workbench')).json()
  const badNote = await request.patch(`/api/workbench/items/${wb.items[0].key}`, { data: { note: '注'.repeat(2001) } })
  expect(badNote.status()).toBe(400)

  // Enable high reasoning + run 协议恢复验收 & 展示边界验收 in Browser -> verify zero internal leaks
  await request.put('/api/config/execution', { data: { reasoningEffort: 'high', compressionThresholdTokens: null } })
  await page.goto('/')
  const composer = page.getByRole('textbox', { name: '向北极星提问' })
  await composer.fill('协议恢复验收：比较三位导师')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })

  await composer.fill('展示边界验收：核对脱敏与来源')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toHaveCount(2, { timeout: 15000 })

  const pageText = await page.locator('.messages').innerText()
  expect(pageText).not.toMatch(/DSML|PRIVATE_REASONING_TEST|mentor_id|source_locator|\/Users\/|导师评价\.md/)

  const mdPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出对话', exact: true }).click()
  const mdText = await fs.readFile(await (await mdPromise).path(), 'utf8')
  expect(mdText).not.toMatch(/DSML|PRIVATE_REASONING_TEST|mentor_id|source_locator|\/Users\/|导师评价\.md/)
  errors.assertClean()
})

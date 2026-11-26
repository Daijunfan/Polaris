import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { resetRuntimeVaultState } from '../../lib/vault.js'
import { startUiServer } from '../ui-server.mjs'

async function auditA11y(page) {
  await page.evaluate(() => Promise.all(
    document.getAnimations()
      .filter(a => Number.isFinite(a.effect?.getTiming().iterations))
      .map(a => a.finished.catch(() => {}))
  ))
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])
}

function attachRuntimeErrorGate(page) {
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', err => pageErrors.push(err.message))
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  return {
    consumeExpectedHttpErrors(expectedStatuses) {
      expect(pageErrors).toEqual([])
      expect(consoleErrors.length).toBe(expectedStatuses.length)
      expectedStatuses.forEach((status, i) => {
        expect(consoleErrors[i]).toContain(`status of ${status}`)
      })
      consoleErrors.length = 0
    },
    assertClean() {
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    },
  }
}

function readLocalVaultKeyIfPresent() {
  if (process.env.MENTOR_VAULT_KEY?.trim()) return process.env.MENTOR_VAULT_KEY.trim()
  const keyPath = path.resolve('.local/vault.key')
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf8').trim()
  const envPath = path.resolve('.env')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*MENTOR_VAULT_KEY\s*=\s*(.+?)\s*$/)
      if (m && m[1].replace(/^['"]|['"]$/g, '').trim()) {
        return m[1].replace(/^['"]|['"]$/g, '').trim()
      }
    }
  }
  return null
}

test('锁定状态下的保险库端点、零结果保护与无报错前端展示', async ({ page, request }) => {
  const srv = await startUiServer({ port: 0, configured: true, vaultLocked: true })
  const errors = attachRuntimeErrorGate(page)
  try {
    const healthRes = await request.get(`${srv.url}/api/health`)
    expect(healthRes.status()).toBe(200)
    const health = await healthRes.json()
    expect(health.ok).toBe(true)
    expect(health.vault_locked).toBe(true)
    expect(health.mentor_count).toBe(0)
    expect(typeof health.data_revision).toBe('string')

    const statusRes = await request.get(`${srv.url}/api/vault/status`)
    expect(statusRes.status()).toBe(200)
    const status = await statusRes.json()
    expect(status.locked).toBe(true)
    expect(status.mode).toBe('locked')
    expect(Array.isArray(status.datasets)).toBe(true)
    expect(status.datasets).toHaveLength(5)
    expect(status.cipher).toContain('AES-256-GCM')
    expect(status.vaults).toBe(5)

    const dataRes = await request.get(`${srv.url}/api/data`)
    expect(dataRes.status()).toBe(200)
    const dataPayload = await dataRes.json()
    expect(dataPayload.metadata.counts.mentors).toBe(0)
    expect(dataPayload.sources).toEqual([])

    const insightsRes = await request.get(`${srv.url}/api/insights`)
    expect(insightsRes.status()).toBe(200)
    expect((await insightsRes.json()).count).toBe(0)

    const dirRes = await request.get(`${srv.url}/api/workbench/directory`)
    expect(dirRes.status()).toBe(200)
    expect(await dirRes.json()).toMatchObject({ total: 0, rows: [] })

    const catalogRes = await request.post(`${srv.url}/api/tools/catalog`, { data: {} })
    expect(catalogRes.status()).toBe(200)
    const catalogBody = await catalogRes.json()
    expect(catalogBody.datasets.every(d => d.count === 0)).toBe(true)

    const reviewsToolRes = await request.post(`${srv.url}/api/tools/query`, { data: { from: 'reviews', limit: 10 } })
    expect(reviewsToolRes.status()).toBe(200)
    expect((await reviewsToolRes.json()).rows).toEqual([])

    const mentorsToolRes = await request.post(`${srv.url}/api/tools/query`, { data: { from: 'mentors', limit: 10 } })
    expect([200, 400]).toContain(mentorsToolRes.status())
    const mentorsToolBody = await mentorsToolRes.json()
    if (mentorsToolRes.status() === 200) expect(mentorsToolBody.rows).toEqual([])
    else expect(typeof mentorsToolBody.error).toBe('string')

    const sourceRes = await request.get(`${srv.url}/api/sources/S1`)
    expect(sourceRes.status()).toBe(404)

    await page.goto(srv.url)
    await expect(page.getByRole('heading', { name: '新对话' })).toBeVisible()
    const hub = page.getByRole('region', { name: '导师与候选入口' })
    await expect(hub).toBeVisible()
    await expect(hub.getByRole('button')).toHaveCount(2)
    await expect(page.locator('.persona-card, .trending')).toHaveCount(0)
    const lockBanner = page.getByRole('region', { name: '导师加密库锁定提示' })
    await expect(lockBanner).toBeVisible()
    await expect(lockBanner).toContainText('5 个加密数据集未解密')
    await expect(page.locator('.start-dataset')).toContainText('0 位评价导师')
    await expect(page.locator('.start-dataset')).not.toContainText('1309')
    await expect(hub).toContainText('数据库已加密锁定')
    await expect(hub).not.toContainText('1309')

    await lockBanner.getByRole('button', { name: '解锁导师库', exact: true }).click()
    const unlockDialog = page.getByRole('dialog', { name: '解锁导师加密数据库', exact: true })
    await expect(unlockDialog).toBeVisible()
    await expect(unlockDialog.locator('.vault-unlock-meta')).toContainText('AES-256-GCM')
    await auditA11y(page)
    await page.keyboard.press('Escape')
    await expect(unlockDialog).toHaveCount(0)

    await page.getByRole('button', { name: '查看导师 · 速查导师档案', exact: true }).click()
    const quick = page.getByRole('dialog', { name: '查看导师', exact: true })
    await expect(quick).toBeVisible()
    await expect(quick.locator('.quick-search-meta')).toContainText('全校 0 位导师')
    await page.keyboard.press('Escape')
    await expect(quick).toHaveCount(0)

    await page.getByRole('button', { name: '候选库 · 打开选导师工作台', exact: true }).click()
    const lib = page.getByRole('dialog', { name: '候选库', exact: true })
    await expect(lib).toBeVisible()
    await expect(lib).toContainText('候选库为空')
    await page.keyboard.press('Escape')

    await auditA11y(page)
    errors.assertClean()
  } finally {
    await srv.close()
    resetRuntimeVaultState()
  }
})

test('锁定保险库拒绝过短或错误密钥，并支持合法密钥运行时解锁与界面刷新恢复', async ({ page, request }) => {
  // Verify wrong >=16-char key in a separate child process so module-level dynamicVaultKey in worker stays unpolluted.
  const childCode = `
    import { startUiServer } from './tests/ui-server.mjs';
    const srv = await startUiServer({ port: 0, configured: true, vaultLocked: true });
    console.log(JSON.stringify({ url: srv.url }));
    process.on('SIGTERM', async () => { await srv.close(); process.exit(0); });
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const childUrl = await new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    child.stdout.on('data', d => {
      out += d.toString()
      const line = out.trim().split('\n')[0]
      if (line.startsWith('{')) resolve(JSON.parse(line).url)
    })
    child.stderr.on('data', d => { err += d.toString() })
    child.on('exit', code => reject(new Error(`child exited ${code}: ${err}`)))
  })

  try {
    const shortRes = await request.post(`${childUrl}/api/vault/unlock`, { data: { key: 'short-key' } })
    expect(shortRes.status()).toBe(400)
    expect((await shortRes.json()).error).toContain('长度不足')

    const wrongRes = await request.post(`${childUrl}/api/vault/unlock`, { data: { key: 'wrong-key-1234567890-abcdef' } })
    expect([400, 401, 403]).toContain(wrongRes.status())
    const healthAfterWrong = await (await request.get(`${childUrl}/api/health`)).json()
    expect(healthAfterWrong.vault_locked).toBe(true)
  } finally {
    child.kill('SIGTERM')
    await new Promise(resolve => child.once('exit', resolve))
  }

  // Test end-to-end UI VaultUnlockDialog submission (wrong key recovery -> valid unlock) and runtime/UI hydration.
  // Supports both custom MENTOR_VAULT_KEY (if configured locally) and M1 built-in project vault decryption.
  const validKey = readLocalVaultKeyIfPresent()

  const srv = await startUiServer({ port: 0, configured: true, vaultLocked: true })
  const errors = attachRuntimeErrorGate(page)
  try {
    const healthBefore = await (await request.get(`${srv.url}/api/health`)).json()
    expect(healthBefore.vault_locked).toBe(true)

    await page.goto(srv.url)
    const lockBanner = page.getByRole('region', { name: '导师加密库锁定提示' })
    await expect(lockBanner).toBeVisible()
    await lockBanner.getByRole('button', { name: '解锁导师库', exact: true }).click()

    const unlockDialog = page.getByRole('dialog', { name: '解锁导师加密数据库', exact: true })
    await expect(unlockDialog).toBeVisible()

    const keyInput = unlockDialog.locator('#vault-unlock-key')
    await expect(keyInput).toHaveAttribute('type', 'password')
    await unlockDialog.getByRole('button', { name: '显示密钥', exact: true }).click()
    await expect(keyInput).toHaveAttribute('type', 'text')
    await unlockDialog.getByRole('button', { name: '隐藏密钥', exact: true }).click()
    await expect(keyInput).toHaveAttribute('type', 'password')

    // Short key error recovery in UI
    await keyInput.fill('short-key')
    await unlockDialog.getByRole('button', { name: '验证密钥并解锁', exact: true }).click()
    await expect(unlockDialog.locator('.form-error[role="alert"]')).toContainText('长度不足')

    // Wrong >=16-char key error recovery in UI (vault remains locked)
    await keyInput.fill('wrong-key-1234567890-abcdef')
    await unlockDialog.getByRole('button', { name: '验证密钥并解锁', exact: true }).click()
    await expect(unlockDialog.locator('.form-error[role="alert"]')).toContainText(/密钥验证失败|完整性/)
    const healthMid = await (await request.get(`${srv.url}/api/health`)).json()
    expect(healthMid.vault_locked).toBe(true)
    errors.consumeExpectedHttpErrors([400, 403])

    // Valid unlock through UI
    if (validKey) {
      await keyInput.fill(validKey)
      await unlockDialog.getByRole('button', { name: '验证密钥并解锁', exact: true }).click()
    } else {
      await unlockDialog.getByRole('button', { name: '使用内置开源模式解锁', exact: true }).click()
    }

    await expect(unlockDialog).toHaveCount(0)
    await expect(lockBanner).toHaveCount(0)
    await expect(page.locator('.notice[role="status"]')).toContainText('导师库已解锁')
    await expect(page.locator('.start-dataset')).toContainText('位评价导师')
    await expect(page.locator('.start-dataset')).not.toContainText('0 位评价导师')

    const healthAfter = await (await request.get(`${srv.url}/api/health`)).json()
    expect(healthAfter.vault_locked).toBe(false)
    expect(healthAfter.mentor_count).toBeGreaterThan(100)
    expect(healthAfter.data_revision).not.toBe(healthBefore.data_revision)

    const insightsAfter = await (await request.get(`${srv.url}/api/insights`)).json()
    expect(insightsAfter.count).toBeGreaterThan(100)

    const dirAfter = await (await request.get(`${srv.url}/api/workbench/directory`)).json()
    expect(dirAfter.total).toBeGreaterThan(100)

    const toolAfter = await (await request.post(`${srv.url}/api/tools/query`, { data: { from: 'mentors', limit: 5 } })).json()
    expect(toolAfter.rows.length).toBe(5)

    await page.getByRole('button', { name: '查看导师 · 速查导师档案', exact: true }).click()
    const quick = page.getByRole('dialog', { name: '查看导师', exact: true })
    await expect(quick).toBeVisible()
    await expect(quick.locator('.quick-search-list .qs-item').first()).toBeVisible()
    errors.assertClean()
  } finally {
    await srv.close()
    resetRuntimeVaultState()
  }
})

test('未配置模型时保留提问草稿、引导完成设置并立即恢复对话与无障碍合规', async ({ page, request }) => {
  const srv = await startUiServer({ port: 0, configured: false, vaultLocked: false })
  const errors = attachRuntimeErrorGate(page)
  try {
    const cfgRes = await request.get(`${srv.url}/api/config`)
    expect(cfgRes.status()).toBe(200)
    const cfg = await cfgRes.json()
    expect(cfg.configured).toBe(false)
    expect(cfg.hasKey).toBe(false)

    // Raw API rejects chat completion while unconfigured
    const chatCreated = await (await request.post(`${srv.url}/api/chats`, { data: {} })).json()
    const msgRes = await request.post(`${srv.url}/api/chats/${chatCreated.id}/messages`, { data: { text: '测试未配置拦截' } })
    expect(msgRes.status()).toBe(400)
    expect((await msgRes.json()).error).toContain('API Key')

    await page.goto(srv.url)
    await expect(page.getByRole('button', { name: '连接模型' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '选择模型' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '推理强度与上下文设置' })).toHaveCount(0)

    const hub = page.getByRole('region', { name: '导师与候选入口' })
    await expect(hub).toBeVisible()
    await expect(hub.locator('.core-card')).toHaveCount(2)
    await expect(hub.getByRole('button')).toHaveCount(2)
    await expect(page.locator('.persona-card, .trending')).toHaveCount(0)
    const onboardingChip = page.locator('.start-onboarding-chip')
    await expect(onboardingChip).toBeVisible()
    await expect(onboardingChip).toContainText('尚未配置大模型 API')
    await expect(onboardingChip.getByRole('button', { name: '立即填写 API Key →', exact: true })).toBeVisible()

    await auditA11y(page)

    const draftQuestion = '网安学院允许实习且不打卡的导师有哪些？'
    const composer = page.getByRole('textbox', { name: '向北极星提问' })
    await composer.fill(draftQuestion)
    await page.getByRole('button', { name: '发送问题' }).click()

    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await expect(settings).toBeVisible()
    await expect(settings.locator('.connection-state')).toHaveText('未配置')
    await auditA11y(page)

    // Closing Settings preserves user draft
    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    await expect(composer).toHaveValue(draftQuestion)

    // Re-open via topbar onboarding pill and complete connection setup
    await page.getByRole('button', { name: '连接模型' }).click()
    await expect(settings).toBeVisible()
    await settings.getByLabel('API URL', { exact: true }).fill(srv.proxyUrl)
    await settings.getByLabel('API Key', { exact: false }).fill('ui-onboarding-secret-key')
    await settings.getByRole('button', { name: '获取模型列表' }).click()
    const modelSelect = settings.getByRole('combobox', { name: '模型', exact: true })
    await expect(modelSelect.locator('option[value="test-agent"]')).toHaveCount(1)
    await modelSelect.selectOption('test-agent')
    await settings.getByRole('button', { name: '连接并保存' }).click()

    await expect(settings).toHaveCount(0)
    await expect(page.locator('.start-onboarding-chip')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: '选择模型' })).toHaveValue('test-agent')
    await expect(page.getByRole('button', { name: '连接模型' })).toHaveCount(0)
    await expect(composer).toHaveValue(draftQuestion)

    await page.getByRole('button', { name: '发送问题' }).click()
    await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('artifact')).toBeVisible()
    errors.assertClean()
  } finally {
    await srv.close()
    resetRuntimeVaultState()
  }
})

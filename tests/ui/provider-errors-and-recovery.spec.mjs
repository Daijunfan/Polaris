import { test, expect } from '@playwright/test'

test.beforeAll(async ({ request }) => {
  await request.post('/__test__/reset')
})

test.afterAll(async ({ request }) => {
  await request.post('/__test__/provider', { data: { modelsStatus: null } })
  await request.post('/__test__/reset')
})

test('模型服务 402/429/永久500/空回复均给出清晰中文提示且支持重试，运行中拦截并发请求', async ({ page, request }) => {
  const pageErrors = []
  page.on('pageerror', err => pageErrors.push(err.message))

  await page.goto('/')
  const composer = page.getByRole('textbox', { name: '向北极星提问' })

  const cases = [
    ['模拟402：余额不足拦截', '模型账户余额不足'],
    ['模拟429：限流故障拦截', '模型接口请求过于频繁'],
    ['模拟永久500：上游持续故障', '模型服务暂时不可用'],
    ['模拟空回复：无内容响应处理', '模型没有返回结果'],
  ]

  for (const [prompt, expectedError] of cases) {
    await composer.fill(prompt)
    await page.getByRole('button', { name: '发送问题' }).click()
    await expect(page.locator('.message-error')).toContainText(expectedError, { timeout: 10000 })
    await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '开启新对话', exact: true }).click()
  }

  // Concurrency guard while a run is active
  await composer.fill('模拟慢速：并发与删除保护验证')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()

  let runningChat = null
  await expect.poll(async () => {
    const activeChats = await (await request.get('/api/chats')).json()
    runningChat = activeChats.chats.find(c => c.running) || null
    return Boolean(runningChat)
  }).toBe(true)

  const dupMsgRes = await request.post(`/api/chats/${runningChat.id}/messages`, { data: { text: '并发消息' } })
  expect(dupMsgRes.status()).toBe(409)

  const delRunningRes = await request.delete(`/api/chats/${runningChat.id}`)
  expect(delRunningRes.status()).toBe(409)

  await page.getByRole('button', { name: '停止生成' }).click()
  await expect(page.locator('.message-error.canceled')).toContainText('已停止生成')
  expect(pageErrors).toEqual([])
})

test('设置面板处理 /models 401/500 故障，并支持 404 时自定义模型 ID 带警告保存', async ({ page, request }) => {
  const pageErrors = []
  page.on('pageerror', err => pageErrors.push(err.message))

  try {
    await page.goto('/')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await expect(settings).toBeVisible()

    // 401 from /models
    await request.post('/__test__/provider', { data: { modelsStatus: 401 } })
    await settings.getByRole('button', { name: '获取模型列表' }).click()
    await expect(settings.locator('.form-error[role="alert"]')).toContainText('API Key 无效或已失效')

    // 500 from /models
    await request.post('/__test__/provider', { data: { modelsStatus: 500 } })
    await settings.getByRole('button', { name: '获取模型列表' }).click()
    await expect(settings.locator('.form-error[role="alert"]')).toContainText('模型服务暂时不可用')

    // 404 on /models with custom model ID succeeds with non-blocking warning
    await request.post('/__test__/provider', { data: { modelsStatus: 404 } })
    await settings.locator('.advanced-settings summary').click()
    await settings.getByLabel('服务商模型 ID', { exact: true }).fill('custom-tool-model')
    await settings.getByRole('button', { name: '连接并保存' }).click()

    await expect(settings).toHaveCount(0)
    await expect(page.locator('.notice')).toContainText('该服务商不支持模型列表，已保存指定模型')
    await expect(page.getByRole('combobox', { name: '选择模型' })).toHaveValue('custom-tool-model')
  } finally {
    await request.post('/__test__/provider', { data: { modelsStatus: null } })
    await request.post('/__test__/reset')
  }

  expect(pageErrors).toEqual([])
})

test('上下文超限自动触发历史压缩并完成回答，同时更新 Token 用量与压缩计数', async ({ page, request }) => {
  const pageErrors = []
  page.on('pageerror', err => pageErrors.push(err.message))

  await request.post('/__test__/reset')
  await page.goto('/')
  const composer = page.getByRole('textbox', { name: '向北极星提问' })
  await composer.fill('先简要介绍付俊松老师')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })

  await composer.fill('模拟上下文超限：继续比较实习与补助条件')
  await page.getByRole('button', { name: '发送问题' }).click()

  await expect(page.getByRole('button', { name: '复制回答' })).toHaveCount(2, { timeout: 15000 })
  await expect(page.getByTestId('artifact').first()).toBeVisible()

  const chats = await (await request.get('/api/chats')).json()
  const detail = await (await request.get(`/api/chats/${chats.chats[0].id}`)).json()
  expect(detail.context?.compactions).toBeGreaterThanOrEqual(1)

  await page.getByRole('button', { name: /Token 用量/ }).click()
  const usageModal = page.getByRole('dialog', { name: 'Token 用量', exact: true })
  await expect(usageModal).toBeVisible()
  await expect(usageModal.locator('.usage-records tbody tr').first()).toBeVisible()
  await expect(usageModal).toContainText('上下文压缩')
  await page.keyboard.press('Escape')
  expect(pageErrors).toEqual([])
})

test('侧栏对话搜索、重命名、草稿隔离、移到回收站撤销与回收站恢复完整生效', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', err => pageErrors.push(err.message))

  await page.goto('/')
  const composer = page.getByRole('textbox', { name: '向北极星提问' })

  // Create Chat A
  await composer.fill('模拟空回复：第一段对话')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.locator('.message-error')).toBeVisible()
  await composer.fill('第一段对话未发送草稿')

  // Create Chat B
  await page.getByRole('button', { name: '开启新对话', exact: true }).click()
  await composer.fill('新对话未发送草稿')

  // Switch back to Chat A -> draft restored
  const firstHistory = page.locator('.chat-history .history-item').first()
  await firstHistory.locator('> button').click()
  await expect(composer).toHaveValue('第一段对话未发送草稿')

  // Rename Chat A
  await firstHistory.hover()
  await firstHistory.getByRole('button', { name: /^重命名对话 / }).click()
  const renameDialog = page.getByRole('dialog', { name: '重命名对话', exact: true })
  await expect(renameDialog).toBeVisible()
  await renameDialog.getByRole('textbox', { name: '对话名称', exact: true }).fill('网安实习导师筛选')
  await renameDialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(renameDialog).toHaveCount(0)
  await expect(page.locator('h1.topbar-topic')).toHaveText('网安实习导师筛选')

  // Search in sidebar
  const sidebarSearch = page.getByRole('searchbox', { name: '搜索对话', exact: true })
  await sidebarSearch.fill('网安实习')
  await expect(page.locator('.chat-history .history-item')).toHaveCount(1)
  await sidebarSearch.fill('不可能存在的对话关键词xyz')
  await expect(page.locator('.history-empty')).toHaveText('没有匹配对话')
  await sidebarSearch.fill('')
  await expect(page.locator('.chat-history .history-item').first()).toContainText('网安实习导师筛选')

  // Delete & undo via toast
  const renamedItem = page.locator('.chat-history .history-item').filter({ hasText: '网安实习导师筛选' }).first()
  await renamedItem.hover()
  await renamedItem.getByRole('button', { name: '移到回收站 网安实习导师筛选', exact: true }).click()
  const notice = page.locator('.notice[role="status"]')
  await expect(notice).toContainText('已移到回收站')
  await notice.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.chat-history .history-item')).toContainText(['网安实习导师筛选'])

  // Delete again & restore from Trash modal
  await renamedItem.hover()
  await renamedItem.getByRole('button', { name: '移到回收站 网安实习导师筛选', exact: true }).click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  const trashModal = page.getByRole('dialog', { name: '回收站', exact: true })
  await expect(trashModal).toBeVisible()
  await expect(trashModal).toContainText('网安实习导师筛选')
  await trashModal.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(trashModal.locator('.empty-state')).toHaveText('回收站为空')
  await page.keyboard.press('Escape')
  await expect(page.locator('.chat-history .history-item')).toContainText(['网安实习导师筛选'])

  await page.reload()
  await expect(page.locator('.chat-history .history-item')).toContainText(['网安实习导师筛选'])
  expect(pageErrors).toEqual([])
})

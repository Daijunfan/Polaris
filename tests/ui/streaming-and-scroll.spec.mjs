import { test, expect } from '@playwright/test'

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

test('长思考延迟即时展示用户气泡、运行进度与草稿提示，并支持提前停止恢复', async ({ page }) => {
  const errors = attachRuntimeErrorGate(page)
  await page.goto('/')
  const composer = page.getByRole('textbox', { name: '向北极星提问' })
  await composer.fill('模拟长思考延迟：分析网安学院导师培养条件')
  await page.getByRole('button', { name: '发送问题' }).click()

  // Optimistic user bubble + stop button + running work-trace appear immediately within the 1800ms window
  await expect(page.locator('.user-message')).toContainText('模拟长思考延迟：分析网安学院导师培养条件', { timeout: 2000 })
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible({ timeout: 2000 })
  await expect(page.locator('.work-trace')).toHaveAttribute('open', '')

  // Typing while generating preserves draft and shows status hint
  await composer.fill('下一轮追问草稿')
  await expect(page.locator('.composer-hint')).toContainText('草稿已保留，回答结束后可发送')

  // Active streaming shimmer indicator during buffered SSE / thinking phase, cleared on completion
  const shimmer = page.locator('.streaming-shimmer')
  await expect(shimmer).toBeVisible({ timeout: 2000 })
  await expect(shimmer).toHaveAttribute('aria-label', '正在生成回答')
  await expect(shimmer.locator('.streaming-shimmer-lines > span')).toHaveCount(3)

  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })
  await expect(shimmer).toHaveCount(0)
  await expect(page.locator('.markdown-wrap.is-streaming')).toHaveCount(0)
  await expect(page.locator('.work-trace summary')).toContainText('已完成')
  await expect(page.locator('.assistant-message .markdown')).toContainText('经过长思考分析')
  await expect(composer).toHaveValue('下一轮追问草稿')

  // Early abort during the 1800ms thinking delay
  await composer.fill('模拟长思考延迟：提前中断测试')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible({ timeout: 2000 })
  await page.getByRole('button', { name: '停止生成' }).click()

  await expect(page.locator('.message-error.canceled').last()).toContainText('已停止生成')
  await expect(page.locator('.work-trace summary').last()).toContainText('已停止')
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible()
  await expect(composer).toBeEnabled()
  errors.assertClean()
})

test('流式长回复上翻显示最新消息按钮、阅读位置不漂移且点击后恢复底部跟随', async ({ page }) => {
  const errors = attachRuntimeErrorGate(page)
  await page.goto('/')
  await page.getByRole('textbox', { name: '向北极星提问' }).fill('模拟持续输出：验证阅读定位与最新消息按钮')
  await page.getByRole('button', { name: '发送问题' }).click()

  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()
  await expect.poll(() => page.locator('.markdown p').count(), { timeout: 10000 }).toBeGreaterThanOrEqual(24)
  await expect(page.locator('.markdown-wrap.is-streaming')).toBeVisible()

  const scroll = page.locator('.conversation-scroll')
  await expect.poll(() => scroll.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2)

  // Scroll upward during active streaming
  await scroll.hover()
  await page.mouse.wheel(0, -350)
  const latestBtn = page.getByRole('button', { name: '回到最新消息' })
  await expect(latestBtn).toBeVisible()

  const driftCheck = await scroll.evaluate(async el => {
    const startTop = el.scrollTop
    const startLen = el.textContent.length
    for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame)
    return {
      drift: Math.abs(el.scrollTop - startTop),
      charsAdded: el.textContent.length - startLen,
    }
  })
  expect(driftCheck.charsAdded).toBeGreaterThan(50)
  expect(driftCheck.drift).toBeLessThan(2)

  await latestBtn.click()
  await expect(latestBtn).toHaveCount(0)
  await expect.poll(() => scroll.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2)

  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.markdown-wrap.is-streaming')).toHaveCount(0)
  await expect(page.locator('.streaming-shimmer')).toHaveCount(0)
  await expect(page.locator('.work-trace.is-finished')).not.toHaveAttribute('open', '')
  await expect(latestBtn).toHaveCount(0)
  const postCollapseBottomGap = await scroll.evaluate(async el => {
    for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame)
    return el.scrollHeight - el.clientHeight - el.scrollTop
  })
  expect(postCollapseBottomGap).toBeLessThan(2)
  await expect(latestBtn).toHaveCount(0)
  errors.assertClean()
})

test('流式交付断流保留已生成部分、工具阶段断流报错可重试、刷新自动接续运行', async ({ page }) => {
  const errors = attachRuntimeErrorGate(page)
  await page.goto('/')
  const composer = page.getByRole('textbox', { name: '向北极星提问' })

  // 1. Mid-delivery disconnect (模拟断流)
  await composer.fill('模拟断流：验证部分内容保留')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.locator('.assistant-message .markdown')).toContainText('已保留的部分回答', { timeout: 10000 })
  await expect(page.locator('.message-error')).toContainText(/连接中断|意外中断|重试/)
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible()

  // 2. Mid-tool-call socket destroy (模拟工具断流)
  await page.getByRole('button', { name: '开启新对话', exact: true }).click()
  await composer.fill('模拟工具断流：验证工具流异常恢复')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.locator('.message-error')).toContainText(/意外中断|重试/, { timeout: 10000 })
  await expect(page.locator('.work-trace summary')).toContainText('未完成')
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible()

  // 3. Page reload mid-stream reconnects via /api/chats/:id/events
  await page.getByRole('button', { name: '开启新对话', exact: true }).click()
  await composer.fill('逐步进度验收：刷新后接续完成推荐')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.locator('.assistant-message .work-trace').last()).toBeVisible({ timeout: 5000 })
  await page.reload()
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('artifact')).toBeVisible()
  errors.assertClean()
})

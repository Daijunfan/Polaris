import { test, expect } from '@playwright/test'

async function streamingReply(page) {
  await page.goto('/')
  await page.getByRole('textbox', { name: '向北极星提问' }).fill('模拟持续输出：阅读时不要抢滚动位置')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button',{name:'复制回答'})).toBeVisible({timeout:10000})
  await expect.poll(() => page.locator('.markdown p').count()).toBeGreaterThanOrEqual(24)
  await page.getByRole('textbox',{name:'向北极星提问'}).fill('模拟持续输出：新增回答时继续阅读旧内容')
  await page.getByRole('button',{name:'发送问题'}).click()
  await expect(page.getByTestId('assistant-message')).toHaveCount(2)
  await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible()
  await expect.poll(()=>page.getByTestId('assistant-message').last().locator('.markdown p').count()).toBeGreaterThanOrEqual(24)
  const scroll = page.locator('.conversation-scroll')
  await expect.poll(() => scroll.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2)
  return scroll
}

async function watchPosition(scroll) {
  return scroll.evaluate(async el => {
    const positions = [], gaps = [], length = el.textContent.length
    for (let frame = 0; frame < 24; frame++) {
      await new Promise(requestAnimationFrame)
      positions.push(el.scrollTop)
      gaps.push(el.scrollHeight - el.clientHeight - el.scrollTop)
    }
    return { min: Math.min(...positions.slice(-12)), max: Math.max(...positions.slice(-12)), maxGap: Math.max(...gaps.slice(-12)), wheelStart: Number(el.dataset.wheelStart), charactersAdded: el.textContent.length - length }
  })
}

async function wheel(page, scroll, deltaY) {
  await scroll.evaluate(el => el.addEventListener('wheel', () => { el.dataset.wheelStart = el.scrollTop }, { once: true }))
  await page.mouse.wheel(0, deltaY)
  return watchPosition(scroll)
}

test('持续回复时轻微向上滚动立即停止跟随，继续上翻也保持阅读位置', async ({ page }) => {
  const scroll = await streamingReply(page)
  await scroll.hover()
  const reading = await wheel(page, scroll, -40)
  await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible()
  expect(reading.charactersAdded).toBeGreaterThan(100)
  expect(reading.max).toBeLessThan(reading.wheelStart - 20)
  expect(reading.max - reading.min).toBeLessThan(2)
  const earlier = await wheel(page, scroll, -450)
  expect(earlier.max).toBeLessThan(reading.min - 300)
  expect(earlier.max - earlier.min).toBeLessThan(2)
  const following = await wheel(page, scroll, 100000)
  await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible()
  expect(following.maxGap).toBeLessThan(2)
  const readingAgain = await wheel(page, scroll, -200)
  expect(readingAgain.max - readingAgain.min).toBeLessThan(2)
  await scroll.focus()
  await expect(page.getByRole('button', { name: '复制回答' })).toHaveCount(2,{timeout:10000})
  expect(await scroll.evaluate(el => el.scrollTop)).toBeCloseTo(readingAgain.min, 0)
  await expect(scroll).toBeFocused()
  await test.info().attach('scroll-positions', { body: JSON.stringify({ reading, earlier, following, readingAgain }), contentType: 'application/json' })
})

test('键盘向上阅读不被输出打断，按 End 回到底部后继续跟随', async ({ page }) => {
  const scroll = await streamingReply(page)
  await scroll.focus()
  await page.keyboard.press('PageUp')
  const reading = await watchPosition(scroll)
  await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible()
  expect(reading.maxGap).toBeGreaterThan(100)
  expect(reading.max - reading.min).toBeLessThan(2)
  await page.keyboard.press('Home')
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeLessThan(1)
  expect((await watchPosition(scroll)).max).toBeLessThan(1)
  await page.keyboard.press('End')
  expect((await watchPosition(scroll)).maxGap).toBeLessThan(2)
  await page.getByRole('button', { name: '停止生成' }).click()
})

test.describe('手机触摸阅读', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('手指向下拖动阅读旧内容时，后续文本保持在下方', async ({ page }) => {
    const scroll = await streamingReply(page), box = await scroll.boundingBox()
    const session = await page.context().newCDPSession(page), x = box.x + box.width / 2, y = box.y + 90
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 6; i++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + i * 25 }] })
      await page.evaluate(() => new Promise(requestAnimationFrame))
    }
    const reading = await watchPosition(scroll)
    await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible()
    expect(reading.maxGap).toBeGreaterThan(100)
    expect(reading.max - reading.min).toBeLessThan(2)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const released = await watchPosition(scroll)
    expect(released.max - released.min).toBeLessThan(2)
    await page.getByRole('button', { name: '停止生成' }).click()
  })
})

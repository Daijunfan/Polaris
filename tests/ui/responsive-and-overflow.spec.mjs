import { test, expect } from '@playwright/test'

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 1000 },
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'tablet-760', width: 760, height: 844 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-360', width: 360, height: 800 },
]

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

async function assertViewportLayoutClean(page, label, { checkOverlap = true } = {}) {
  const result = await page.evaluate(shouldCheckOverlap => {
    const vw = window.innerWidth
    const overflow = document.documentElement.scrollWidth > vw
    const modals = [...document.querySelectorAll('[aria-modal="true"]')]
    const topModal = modals.at(-1)
    const rootScope = topModal || document
    const selectors = topModal
      ? '.modal-header button, .qs-cat-tabs button, .dialog-actions button'
      : 'header.topbar button, header.topbar select, .core-hub button, .composer-bottom button'
    const items = [...rootScope.querySelectorAll(selectors)]
      .filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
      })
      .map(el => ({
        label: el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName,
        rect: el.getBoundingClientRect(),
        el,
      }))

    const overlaps = []
    const outOfBounds = []
    for (let i = 0; i < items.length; i++) {
      const a = items[i]
      if (a.rect.left < -1 || a.rect.right > vw + 1) {
        outOfBounds.push({ label: a.label, left: Math.round(a.rect.left), right: Math.round(a.rect.right), vw })
      }
      if (!shouldCheckOverlap) continue
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j]
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue
        const ix = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left))
        const iy = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top))
        if (ix > 2 && iy > 2) {
          overlaps.push({ a: a.label, b: b.label, area: Math.round(ix * iy) })
        }
      }
    }
    return { overflow, scrollWidth: document.documentElement.scrollWidth, vw, overlaps, outOfBounds }
  }, checkOverlap)
  expect(result.overflow, `${label}: scrollWidth ${result.scrollWidth} > innerWidth ${result.vw}`).toBe(false)
  expect(result.overlaps, `${label}: overlapping controls`).toEqual([])
  expect(result.outOfBounds, `${label}: out-of-bounds controls`).toEqual([])
}

test('首页、速查、档案、候选库与弹窗在五档桌面与移动端视口下零横向溢出与控件零重叠', async ({ page, request }) => {
  const errors = attachRuntimeErrorGate(page)
  await request.put('/api/profile', {
    data: { stage: 'exam', goal: 'career', score: 356, musts: ['internship', 'no_clock'], colleges: ['网络空间安全学院', '计算机学院'] },
  })
  await request.post('/api/workbench/items', { data: { mentors: [{ name: '付俊松' }, { name: '郭燕慧' }] } })

  await page.goto('/')
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await expect(page.getByRole('textbox', { name: '向北极星提问' })).toBeInViewport()
    await assertViewportLayoutClean(page, `welcome-${vp.name}`)
  }

  // QuickSearch across key viewports
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '查看导师', exact: true }).click()
  const quick = page.getByRole('region', { name: '查看导师', exact: true })
  await expect(quick).toBeVisible()
  const kbdLegend = quick.locator('.qs-kbd-legend')
  await expect(kbdLegend).toBeVisible()
  await expect(kbdLegend).toContainText('打开档案')
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await assertViewportLayoutClean(page, `quick-search-${vp.name}`)
    if (vp.width <= 390) {
      await expect(kbdLegend).toBeHidden()
      const hotPillsStyle = await quick.locator('.qs-hot-pills').evaluate(el => {
        const s = getComputedStyle(el)
        return {
          flexWrap: s.flexWrap,
          overflowX: s.overflowX,
          maskImage: s.maskImage,
          webkitMaskImage: s.webkitMaskImage,
        }
      })
      expect(hotPillsStyle.flexWrap).toBe('nowrap')
      expect(hotPillsStyle.overflowX).toBe('auto')
      expect(`${hotPillsStyle.maskImage} ${hotPillsStyle.webkitMaskImage}`).toMatch(/linear-gradient/i)
    }
  }

  // Dossier across desktop, laptop, mobile
  await quick.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' }).fill('付俊松')
  await quick.locator('.quick-search-list .qs-item-main').first().click()
  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await expect(dossier).toBeVisible()
  for (const vp of [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[3], VIEWPORTS[4]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await assertViewportLayoutClean(page, `dossier-${vp.name}`)
  }
  await page.keyboard.press('Escape')

  // Workbench across desktop, laptop, mobile
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '候选库', exact: true }).click()
  const lib = page.getByRole('region', { name: '候选库', exact: true })
  await expect(lib).toBeVisible()
  for (const vp of [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[3], VIEWPORTS[4]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await assertViewportLayoutClean(page, `workbench-${vp.name}`)
  }
  await page.getByRole('button', { name: 'Agent 交互', exact: true }).click()

  // Secondary modals on mobile 360x800
  await page.setViewportSize({ width: 360, height: 800 })
  await page.getByRole('button', { name: '资料与来源', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '资料与来源', exact: true })).toBeVisible()
  await assertViewportLayoutClean(page, 'sources-mobile-360')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '编辑我的择导画像', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '我的择导画像', exact: true })).toBeVisible()
  await assertViewportLayoutClean(page, 'profile-mobile-360')
  await page.keyboard.press('Escape')

  // Mobile sidebar drawer & Escape focus restoration + core nav touch targets
  const menuBtn = page.getByRole('button', { name: '打开对话列表', exact: true })
  await menuBtn.click()
  await expect(page.locator('#sidebar-content')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menuBtn).toBeFocused()

  const navBoxes = await page.locator('.core-nav-btn').evaluateAll(btns =>
    btns.map(b => ({ label: b.getAttribute('aria-label'), ...b.getBoundingClientRect().toJSON() }))
  )
  for (const box of navBoxes) {
    expect(box.width, `${box.label} touch width`).toBeGreaterThanOrEqual(28)
    expect(box.height, `${box.label} touch height`).toBeGreaterThanOrEqual(28)
  }

  errors.assertClean()
})

test('多图聊天与排名对决在桌面与手机视口下自适应无横向溢出', async ({ page }) => {
  const errors = attachRuntimeErrorGate(page)
  await page.goto('/')
  await page.getByRole('textbox', { name: '向北极星提问' }).fill('模拟多图：生成五种图表展示候选导师')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('artifact')).toHaveCount(5)

  for (const vp of [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[3], VIEWPORTS[4]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await assertViewportLayoutClean(page, `multi-chart-${vp.name}`)
    if (vp.width <= 360) {
      const mobileTopbar = await page.evaluate(() => {
        const navBtns = [...document.querySelectorAll('.core-nav-btn')].map(el => el.getBoundingClientRect())
        const topic = document.querySelector('h1.topbar-topic')
        const topicStyle = topic ? getComputedStyle(topic) : null
        return {
          navSizes: navBtns.map(r => ({ w: Math.round(r.width), h: Math.round(r.height) })),
          topicWidth: topic ? Math.round(topic.getBoundingClientRect().width) : null,
          topicClip: topicStyle ? `${topicStyle.clipPath}|${topicStyle.position}` : null,
        }
      })
      for (const sz of mobileTopbar.navSizes) {
        expect(sz.w).toBeGreaterThanOrEqual(36)
        expect(sz.h).toBeGreaterThanOrEqual(36)
      }
      expect(mobileTopbar.topicWidth).toBeLessThanOrEqual(2)
      expect(mobileTopbar.topicClip).toContain('absolute')
    }
  }

  // Ranking + Duel comparison adapts cleanly to 390px mobile
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '开启新对话', exact: true }).click()
  await page.getByRole('textbox', { name: '向北极星提问' }).fill('把多个学院的老师放一起，来个你认为最好的导师的排名。只前30个最好的导师就够了。')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByRole('button', { name: '复制回答' })).toBeVisible({ timeout: 15000 })

  const checkboxes = page.locator('.rank-select input')
  await checkboxes.nth(0).check()
  await checkboxes.nth(1).check()
  await page.getByRole('button', { name: '对比这 2 位', exact: true }).click()
  const compareModal = page.getByRole('dialog', { name: '导师对比', exact: true })
  await expect(compareModal).toBeVisible()
  await assertViewportLayoutClean(page, 'duel-desktop-1440')

  await page.setViewportSize({ width: 390, height: 844 })
  await assertViewportLayoutClean(page, 'duel-mobile-390')
  await page.keyboard.press('Escape')
  errors.assertClean()
})

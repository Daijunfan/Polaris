import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startUiServer } from '../tests/ui-server.mjs'
import { resetRuntimeVaultState } from '../lib/vault.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'docs', 'images')

await fs.mkdir(outDir, { recursive: true })

const SEEDED_PROFILE = {
  stage: 'exam',
  goal: 'career',
  score: 355,
  musts: ['internship', 'no_clock'],
}

const KNOWN_NAMES = new Set()

async function settlePage(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })

  // Dismiss any visible toast notifications before capturing
  for (let attempt = 0; attempt < 5; attempt++) {
    const closeBtns = page.locator('.toast-close, [aria-label="关闭提示"]')
    const count = await closeBtns.count()
    if (count === 0) break
    for (let i = 0; i < count; i++) {
      await closeBtns.nth(i).click().catch(() => {})
    }
    await page.waitForTimeout(80)
  }

  await page.evaluate(() => Promise.all(
    document.getAnimations()
      .filter(a => Number.isFinite(a.effect?.getTiming().iterations))
      .map(a => a.finished.catch(() => {}))
  ))
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
}

async function collectMaskRects(page, seedNames = []) {
  const { discoveredNames, rects } = await page.evaluate((extraNames) => {
    const names = new Set(extraNames.filter(n => typeof n === 'string' && n.trim().length >= 2))
    const addName = (raw) => {
      if (!raw) return
      const text = String(raw).trim()
      if (text.length >= 2 && text.length <= 16) names.add(text)
    }

    const nameSelectors = [
      '.qs-item-title strong',
      '.dossier-name-line h3',
      '.rank-name-row strong',
      '.record-card h4',
      '.duel-name',
      '.duel-legend span',
      '.comparison-table thead th:not(:first-child)',
      '.mentor-tile-name',
    ]
    for (const sel of nameSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        addName(el.textContent)
      }
    }

    for (const el of document.querySelectorAll('.duel-supervisor, .dossier-supervisor')) {
      const m = el.textContent?.match(/实际带教[：:]\s*([^\s，。；、（）()]+)/)
      if (m) addName(m[1])
    }

    const sortedNames = [...names].sort((a, b) => b.length - a.length)
    const rawRects = []
    const panels = [...document.querySelectorAll('.modal-backdrop .modal-panel')]
    const topPanel = panels.at(-1) || null
    const topPanelRect = topPanel ? topPanel.getBoundingClientRect() : null

    function clipToAncestors(el, rect) {
      if (topPanel && topPanelRect && !topPanel.contains(el)) {
        const overlapsPanel =
          rect.right > topPanelRect.left - 2 &&
          rect.left < topPanelRect.right + 2 &&
          rect.bottom > topPanelRect.top - 2 &&
          rect.top < topPanelRect.bottom + 2
        if (overlapsPanel) return null
      }
      let left = Math.max(0, rect.left)
      let top = Math.max(0, rect.top)
      let right = Math.min(window.innerWidth, rect.right)
      let bottom = Math.min(window.innerHeight, rect.bottom)
      let cur = el
      while (cur && cur !== document.documentElement) {
        if (cur.classList?.contains('sr-only')) return null
        const style = getComputedStyle(cur)
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return null
        }
        const ovX = style.overflowX
        const ovY = style.overflowY
        if ((ovX && ovX !== 'visible') || (ovY && ovY !== 'visible')) {
          const cr = cur.getBoundingClientRect()
          if (ovX !== 'visible') {
            left = Math.max(left, cr.left)
            right = Math.min(right, cr.right)
          }
          if (ovY !== 'visible') {
            top = Math.max(top, cr.top)
            bottom = Math.min(bottom, cr.bottom)
          }
        }
        cur = cur.parentElement
      }
      if (right - left <= 2 || bottom - top <= 2) return null
      return { x: left, y: top, w: right - left, h: bottom - top }
    }

    // 1. Mask avatar initials
    for (const el of document.querySelectorAll('.mentor-avatar')) {
      const clipped = clipToAncestors(el, el.getBoundingClientRect())
      if (clipped) rawRects.push(clipped)
    }

    // 2. Mask SVG <text> nodes matching any mentor name
    for (const svgText of document.querySelectorAll('svg text')) {
      const val = svgText.textContent || ''
      if (sortedNames.some(name => val.includes(name))) {
        const clipped = clipToAncestors(svgText, svgText.getBoundingClientRect())
        if (clipped) rawRects.push(clipped)
      }
    }

    // 3. Walk all visible text nodes for mentor names and emails
    const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const text = node.nodeValue
      if (!text || !text.trim()) continue
      const parent = node.parentElement
      if (!parent || parent.closest('script, style, .sr-only')) continue

      const ranges = []
      for (const name of sortedNames) {
        let idx = 0
        while ((idx = text.indexOf(name, idx)) !== -1) {
          ranges.push([idx, idx + name.length])
          idx += name.length
        }
      }
      emailRe.lastIndex = 0
      let em
      while ((em = emailRe.exec(text)) !== null) {
        ranges.push([em.index, em.index + em[0].length])
      }

      for (const [start, end] of ranges) {
        const r = document.createRange()
        r.setStart(node, start)
        r.setEnd(node, end)
        for (const rect of r.getClientRects()) {
          const clipped = clipToAncestors(parent, rect)
          if (clipped) rawRects.push(clipped)
        }
      }
    }

    return { discoveredNames: [...names], rects: rawRects }
  }, [...seedNames])

  for (const name of discoveredNames) KNOWN_NAMES.add(name)
  return rects
}

async function mosaicPng(scratchPage, pngBuffer, rects, cssWidth, cssHeight, dpr) {
  if (!rects.length) return pngBuffer
  const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`
  const maskedBase64 = await scratchPage.evaluate(async ({ url, boxes, w, h, scale }) => {
    const img = new Image()
    img.src = url
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
    })

    const cw = Math.round(w * scale)
    const ch = Math.round(h * scale)
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, cw, ch)

    const tmp = document.createElement('canvas')
    const tctx = tmp.getContext('2d')
    const block = Math.max(8, Math.round(6 * scale))
    const pad = Math.round(2 * scale)

    for (const box of boxes) {
      const rx = Math.max(0, Math.floor(box.x * scale - pad))
      const ry = Math.max(0, Math.floor(box.y * scale - pad))
      const rw = Math.min(cw - rx, Math.ceil(box.w * scale + pad * 2))
      const rh = Math.min(ch - ry, Math.ceil(box.h * scale + pad * 2))
      if (rw <= 2 || rh <= 2) continue

      const tw = Math.max(2, Math.ceil(rw / block))
      const th = Math.max(2, Math.ceil(rh / block))
      tmp.width = tw
      tmp.height = th
      tctx.imageSmoothingEnabled = true
      tctx.clearRect(0, 0, tw, th)
      tctx.drawImage(canvas, rx, ry, rw, rh, 0, 0, tw, th)

      ctx.imageSmoothingEnabled = false
      ctx.drawImage(tmp, 0, 0, tw, th, rx, ry, rw, rh)
    }

    return canvas.toDataURL('image/png').split(',')[1]
  }, { url: dataUrl, boxes: rects, w: cssWidth, h: cssHeight, scale: dpr })

  return Buffer.from(maskedBase64, 'base64')
}

async function captureAndSave(page, scratchPage, filename, { width, height, dpr }) {
  await settlePage(page)
  const rects = await collectMaskRects(page, KNOWN_NAMES)
  const rawBuf = await page.screenshot({ fullPage: false })
  const outBuf = await mosaicPng(scratchPage, rawBuf, rects, width, height, dpr)
  const dest = path.join(outDir, filename)
  await fs.writeFile(dest, outBuf)
  console.log(`Captured ${filename} (${width * dpr}x${height * dpr}, masked ${rects.length} rects)`)
}

const srv = await startUiServer({ port: 0, configured: true, vaultLocked: false })
const browser = await chromium.launch({ headless: true })

try {
  const scratchCtx = await browser.newContext()
  const scratchPage = await scratchCtx.newPage()

  // 1. Desktop light screenshots
  const dpr = 2
  const desktopSize = { width: 1440, height: 920, dpr }
  const desktopCtx = await browser.newContext({
    viewport: { width: desktopSize.width, height: desktopSize.height },
    deviceScaleFactor: dpr,
    colorScheme: 'light',
  })
  const page = await desktopCtx.newPage()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => {
    localStorage.setItem('polaris-theme', 'light')
  })

  await page.goto(srv.url)
  await page.getByRole('heading', { name: '选导师，先看清' }).waitFor()
  await captureAndSave(page, scratchPage, 'polaris-welcome.png', desktopSize)

  // Seed realistic selection profile for ranking / dossier / mobile screenshots
  await page.evaluate(async (profile) => {
    await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    })
  }, SEEDED_PROFILE)
  await page.reload()
  await page.getByRole('heading', { name: '选导师，先看清' }).waitFor()

  // Quick search -> open first result Dossier (light)
  await page.getByRole('button', { name: '查看导师', exact: true }).click()
  const qs = page.getByRole('region', { name: '查看导师', exact: true })
  await qs.waitFor()
  await qs.getByRole('button', { name: '可以实习', exact: true }).click()
  await qs.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' }).fill('付俊松')
  await qs.locator('.quick-search-list .qs-item-main').first().click()
  const dossier = page.getByRole('dialog', { name: '导师档案', exact: true })
  await dossier.waitFor()
  await dossier.locator('.dossier-facts').waitFor()
  await captureAndSave(page, scratchPage, 'polaris-dossier.png', desktopSize)

  // Close dossier and return to Agent page
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Agent 交互', exact: true }).click()

  // Chat ranking + Duel
  await page.getByRole('textbox', { name: '向北极星提问' }).fill('把多个学院的老师放一起，来个你认为最好的导师的排名。只前30个最好的导师就够了。')
  await page.getByRole('button', { name: '发送问题' }).click()
  await page.getByRole('button', { name: '复制回答' }).waitFor({ timeout: 20000 })
  await page.locator('.recommendations').first().scrollIntoViewIfNeeded()
  await captureAndSave(page, scratchPage, 'polaris-ranking.png', desktopSize)

  // Select top 3 and open Duel modal
  const checkboxes = page.locator('.rank-select input')
  for (let i = 0; i < 3; i++) await checkboxes.nth(i).check()
  await page.getByRole('button', { name: '对比这 3 位', exact: true }).click()
  const duel = page.getByRole('dialog', { name: '导师对比', exact: true })
  await duel.waitFor()
  await duel.locator('.comparison-table').waitFor()
  await captureAndSave(page, scratchPage, 'polaris-duel.png', desktopSize)

  await desktopCtx.close()

  // 2. Desktop dark screenshot (polaris-dark.png = Dossier in dark theme)
  const darkCtx = await browser.newContext({
    viewport: { width: desktopSize.width, height: desktopSize.height },
    deviceScaleFactor: dpr,
    colorScheme: 'dark',
  })
  const darkPage = await darkCtx.newPage()
  await darkPage.emulateMedia({ colorScheme: 'dark' })
  await darkPage.addInitScript(() => {
    localStorage.setItem('polaris-theme', 'dark')
  })
  await darkPage.goto(srv.url)
  await darkPage.getByRole('heading', { name: '选导师，先看清' }).waitFor()
  await darkPage.getByRole('button', { name: '查看导师', exact: true }).click()
  const darkQs = darkPage.getByRole('region', { name: '查看导师', exact: true })
  await darkQs.waitFor()
  await darkQs.getByRole('textbox', { name: '搜索导师姓名、方向或关键词' }).fill('付俊松')
  await darkQs.locator('.quick-search-list .qs-item-main').first().click()
  const darkDossier = darkPage.getByRole('dialog', { name: '导师档案', exact: true })
  await darkDossier.waitFor()
  await darkDossier.locator('.dossier-facts').waitFor()
  await captureAndSave(darkPage, scratchPage, 'polaris-dark.png', desktopSize)
  await darkCtx.close()

  // 3. Mobile screenshot (polaris-mobile.png = Quick search 390x844 @2x)
  const mobileSize = { width: 390, height: 844, dpr }
  const mobileCtx = await browser.newContext({
    viewport: { width: mobileSize.width, height: mobileSize.height },
    deviceScaleFactor: dpr,
    hasTouch: true,
    isMobile: true,
    colorScheme: 'light',
  })
  const mobilePage = await mobileCtx.newPage()
  await mobilePage.emulateMedia({ colorScheme: 'light' })
  await mobilePage.addInitScript(() => {
    localStorage.setItem('polaris-theme', 'light')
  })
  await mobilePage.goto(srv.url)
  await mobilePage.getByRole('heading', { name: '选导师，先看清' }).waitFor()
  await mobilePage.getByRole('button', { name: '查看导师', exact: true }).click()
  const mobileQs = mobilePage.getByRole('region', { name: '查看导师', exact: true })
  await mobileQs.waitFor()
  await mobileQs.getByRole('button', { name: '可以实习', exact: true }).click()
  await mobileQs.locator('.quick-search-list .qs-item').first().waitFor()
  await captureAndSave(mobilePage, scratchPage, 'polaris-mobile.png', mobileSize)
  await mobileCtx.close()

  await scratchCtx.close()
} finally {
  await browser.close()
  await srv.close()
  resetRuntimeVaultState()
}

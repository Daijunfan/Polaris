import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import PDFDocument from 'pdfkit'
import { renderHtml } from './html.js'
import {
  formatCell,
  normalizeExportDocument,
  safeString,
  stripInlineMarkdown,
} from './model.js'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.resolve('pdfkit'))

function safeExists(target) {
  try {
    return Boolean(target && fs.existsSync(target) && fs.statSync(target).isFile())
  } catch {
    return false
  }
}

function findPlaywrightBrowser(platform = process.platform) {
  const roots = []
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH)
  }
  if (platform === 'win32') {
    if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright'))
  } else if (platform === 'darwin') {
    roots.push(path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'))
  } else {
    roots.push(path.join(os.homedir(), '.cache', 'ms-playwright'))
  }

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue
    let entries = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^(?:chromium|chromium_headless_shell)-/.test(d.name))
        .map(d => d.name)
        .sort()
        .reverse()
    } catch {
      continue
    }

    for (const dir of entries) {
      const base = path.join(root, dir)
      const candidates = platform === 'win32'
        ? [
            path.join(base, 'chrome-win64', 'chrome.exe'),
            path.join(base, 'chrome-win', 'chrome.exe'),
            path.join(base, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
            path.join(base, 'chrome-headless-shell-win32', 'chrome-headless-shell.exe'),
          ]
        : platform === 'darwin'
          ? [
              path.join(base, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
              path.join(base, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
              path.join(base, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
              path.join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
              path.join(base, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
              path.join(base, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
            ]
          : [
              path.join(base, 'chrome-linux', 'chrome'),
              path.join(base, 'chrome-linux64', 'chrome'),
              path.join(base, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
            ]

      for (const exe of candidates) {
        if (safeExists(exe)) return exe
      }
    }
  }
  return null
}

export function findBrowserExecutable() {
  if (process.env.POLARIS_PDF_BROWSER && safeExists(process.env.POLARIS_PDF_BROWSER)) {
    return process.env.POLARIS_PDF_BROWSER
  }

  const platform = process.platform
  const candidates = []

  if (platform === 'win32') {
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const local = process.env.LOCALAPPDATA || ''
    candidates.push(
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local && path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    )
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
    )
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    )
  }

  for (const exe of candidates) {
    if (safeExists(exe)) return exe
  }
  return findPlaywrightBrowser(platform)
}

function findFileRecursive(dir, matcher, maxDepth = 4) {
  if (!dir || maxDepth < 0 || !fs.existsSync(dir)) return null
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && matcher(entry.name)) return full
  }
  if (maxDepth > 0) {
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const found = findFileRecursive(path.join(dir, entry.name), matcher, maxDepth - 1)
      if (found) return found
    }
  }
  return null
}

export function findSystemCjkFont() {
  const platform = process.platform
  const direct = []

  if (platform === 'darwin') {
    direct.push(
      '/System/Library/Fonts/STHeiti Medium.ttc',
      '/System/Library/Fonts/STHeiti Light.ttc',
      '/System/Library/Fonts/Hiragino Sans GB.ttc',
      '/System/Library/Fonts/Supplemental/Songti.ttc',
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
      '/Library/Fonts/Arial Unicode.ttf',
    )
    for (const f of direct) {
      if (safeExists(f)) return f
    }
    const pingfang = findFileRecursive('/System/Library/AssetsV2', name => name === 'PingFang.ttc', 4)
    if (pingfang && safeExists(pingfang)) return pingfang
  } else if (platform === 'win32') {
    const winDir = process.env.WINDIR || 'C:\\Windows'
    const fontsDir = path.join(winDir, 'Fonts')
    direct.push(
      path.join(fontsDir, 'msyh.ttc'),
      path.join(fontsDir, 'msyh.ttf'),
      path.join(fontsDir, 'simhei.ttf'),
      path.join(fontsDir, 'simsun.ttc'),
      path.join(fontsDir, 'Deng.ttf'),
      path.join(fontsDir, 'NotoSansSC-Regular.ttf'),
    )
    for (const f of direct) {
      if (safeExists(f)) return f
    }
  } else {
    direct.push(
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
      '/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf',
    )
    for (const f of direct) {
      if (safeExists(f)) return f
    }
    const linuxFont = findFileRecursive(
      '/usr/share/fonts',
      name => /(?:NotoSansCJK|SourceHanSans|wqy-zenhei|PingFang|msyh).*\.(?:ttc|ttf|otf)$/i.test(name),
      4,
    )
    if (linuxFont && safeExists(linuxFont)) return linuxFont
  }
  return null
}

export function resolveFontFace(fontPath) {
  if (!fontPath || !/\.ttc$/i.test(fontPath)) return undefined
  try {
    const fontkit = require('fontkit')
    const collection = fontkit.openSync(fontPath)
    const faces = (collection?.fonts || [])
      .map(f => f?.postscriptName)
      .filter(name => typeof name === 'string' && name.length > 0 && !name.startsWith('.'))

    if (!faces.length) return undefined

    return (
      faces.find(name => /SC[-_]?(?:Regular|Medium|W3)$/i.test(name)) ||
      faces.find(name => /SC/i.test(name) && /(?:Regular|Medium|W3)/i.test(name)) ||
      faces.find(name => /SC/i.test(name)) ||
      faces.find(name => !/(?:TC|HK|MO)/i.test(name) && /(?:Regular|Medium|W3)/i.test(name)) ||
      faces.find(name => !/(?:TC|HK|MO)/i.test(name)) ||
      faces[0]
    )
  } catch {
    return undefined
  }
}

async function renderPdfViaBrowser(html, executablePath) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'polaris-pdf-'))
  const profileDir = path.join(tmpDir, 'profile')
  const htmlPath = path.join(tmpDir, 'report.html')
  const pdfPath = path.join(tmpDir, 'report.pdf')

  try {
    await fsp.mkdir(profileDir, { recursive: true })
    await fsp.writeFile(htmlPath, html, 'utf8')
    const fileUrl = pathToFileURL(htmlPath).href
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profileDir}`,
      `--print-to-pdf=${pdfPath}`,
      fileUrl,
    ]
    await execFileAsync(executablePath, args, {
      timeout: 25000,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
    })
    const pdfBuf = await fsp.readFile(pdfPath)
    if (!pdfBuf || pdfBuf.length < 100 || !pdfBuf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new Error('浏览器未生成有效的 PDF 文件')
    }
    return pdfBuf
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

function wrapTextLines(pdf, text, maxWidth) {
  const paragraphs = safeString(text).replace(/\r\n?/g, '\n').split('\n')
  const lines = []
  for (const para of paragraphs) {
    if (!para) {
      lines.push('')
      continue
    }
    let current = ''
    for (const ch of para) {
      const next = current + ch
      if (current && pdf.widthOfString(next) > maxWidth) {
        lines.push(current)
        current = ch
      } else {
        current = next
      }
    }
    if (current) lines.push(current)
  }
  return lines.length ? lines : ['']
}

function splitWideTableForPdf(table) {
  const cols = table.columns || []
  if (cols.length <= 7) return [table]
  const idCols = cols.slice(0, Math.min(2, cols.length))
  const rest = cols.slice(idCols.length)
  const chunks = []
  const chunkSize = 5
  for (let i = 0; i < rest.length; i += chunkSize) {
    const groupCols = [...idCols, ...rest.slice(i, i + chunkSize)]
    chunks.push({
      ...table,
      title: chunks.length === 0 ? table.title : `${table.title || '数据表'}（续表 ${chunks.length + 1}）`,
      columns: groupCols,
    })
  }
  return chunks
}

async function renderPdfViaPdfkit(doc) {
  const fontPath = findSystemCjkFont()
  const faceName = fontPath ? resolveFontFace(fontPath) : undefined

  return new Promise((resolve, reject) => {
    const pdfTitle = stripInlineMarkdown(doc.title)
    const pdfSubtitle = stripInlineMarkdown(doc.subtitle)
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: 44, bottom: 48, left: 40, right: 40 },
      bufferPages: true,
      info: {
        Title: pdfTitle,
        Author: '北极星 Polaris',
        Subject: pdfSubtitle,
      },
    })

    const chunks = []
    pdf.on('data', chunk => chunks.push(chunk))
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)

    let activeFont = 'Helvetica'
    if (fontPath) {
      try {
        pdf.registerFont('PolarisCJK', fontPath, faceName)
        pdf.font('PolarisCJK')
        activeFont = 'PolarisCJK'
      } catch {
        pdf.font('Helvetica')
      }
    } else {
      pdf.font('Helvetica')
    }

    const pageWidth = pdf.page.width
    const pageHeight = pdf.page.height
    const marginLeft = 40
    const contentWidth = pageWidth - marginLeft * 2
    const pageBottom = pageHeight - 54

    const ensureSpace = needed => {
      if (pdf.y + needed > pageBottom) {
        pdf.addPage()
        pdf.font(activeFont)
      }
    }

    const drawLines = (text, x, width, fontSize, color = '#0f172a', lineGap = 3) => {
      pdf.font(activeFont).fontSize(fontSize).fillColor(color)
      const lines = wrapTextLines(pdf, text, width)
      const lineH = fontSize + lineGap
      for (const line of lines) {
        ensureSpace(lineH + 2)
        pdf.text(line, x, pdf.y, { lineBreak: false })
        pdf.y += lineH
      }
      return lines.length * lineH
    }

    // Banner
    const bannerTop = pdf.y
    pdf.font(activeFont).fontSize(17)
    const titleLines = wrapTextLines(pdf, pdfTitle, contentWidth - 28)
    pdf.font(activeFont).fontSize(9.5)
    const subLines = wrapTextLines(pdf, pdfSubtitle, contentWidth - 28)
    const bannerHeight = 28 + titleLines.length * 22 + subLines.length * 14 + (doc.filtersApplied.length ? 16 : 0)

    pdf.save()
    pdf.roundedRect(marginLeft, bannerTop, contentWidth, bannerHeight, 6).fill('#1d4b8f')
    pdf.restore()

    let cursorY = bannerTop + 12
    pdf.font(activeFont).fontSize(9).fillColor('#dbeafe').text('北极星 Polaris · 导出的分析报告', marginLeft + 14, cursorY, { lineBreak: false })
    cursorY += 15
    pdf.font(activeFont).fontSize(16).fillColor('#ffffff')
    for (const line of titleLines) {
      pdf.text(line, marginLeft + 14, cursorY, { lineBreak: false })
      cursorY += 21
    }
    pdf.font(activeFont).fontSize(9.5).fillColor('#e2e8f0')
    for (const line of subLines) {
      pdf.text(line, marginLeft + 14, cursorY, { lineBreak: false })
      cursorY += 14
    }
    if (doc.filtersApplied.length) {
      pdf.font(activeFont).fontSize(8.5).fillColor('#f8fafc').text(`筛选：${doc.filtersApplied.map(f => stripInlineMarkdown(f)).join(' · ')}`, marginLeft + 14, cursorY, { lineBreak: false })
    }
    pdf.y = bannerTop + bannerHeight + 14

    // KPI Summary
    if (doc.summaryCards.length) {
      const cols = Math.min(doc.summaryCards.length, 4)
      const gap = 8
      const cardW = (contentWidth - gap * (cols - 1)) / cols
      for (let i = 0; i < doc.summaryCards.length; i += cols) {
        const slice = doc.summaryCards.slice(i, i + cols)
        ensureSpace(46)
        const rowY = pdf.y
        slice.forEach((card, idx) => {
          const cx = marginLeft + idx * (cardW + gap)
          pdf.save()
          pdf.roundedRect(cx, rowY, cardW, 40, 4).fillAndStroke('#f8fafc', '#e2e8f0')
          pdf.restore()
          pdf.font(activeFont).fontSize(8.5).fillColor('#475569').text(stripInlineMarkdown(card.label), cx + 8, rowY + 7, { width: cardW - 16, lineBreak: false })
          pdf.font(activeFont).fontSize(11).fillColor('#1d4b8f').text(stripInlineMarkdown(card.value), cx + 8, rowY + 21, { width: cardW - 16, lineBreak: false })
        })
        pdf.y = rowY + 48
      }
      pdf.y += 4
    }

    const renderedTables = new Set()

    const drawPdfTable = rawTable => {
      const subTables = splitWideTableForPdf(rawTable)
      for (const table of subTables) {
        const cols = table.columns || []
        const rows = table.rows || []
        if (!cols.length) continue

        if (table.title) {
          ensureSpace(26)
          drawLines(stripInlineMarkdown(table.title), marginLeft, contentWidth, 11, '#1d4b8f', 4)
        }
        if (table.description) {
          drawLines(stripInlineMarkdown(table.description), marginLeft, contentWidth, 8.5, '#64748b', 3)
        }

        const weights = cols.map(c => {
          const hdrLen = stripInlineMarkdown(safeString(c.label) || safeString(c.key)).length
          const sample = rows.slice(0, 15).map(r => stripInlineMarkdown(safeString(formatCell(r && Object.hasOwn(r, c.key) ? r[c.key] : null, c))).length)
          const avg = sample.length ? sample.reduce((a, b) => a + b, 0) / sample.length : 4
          return Math.min(26, Math.max(4, Math.max(hdrLen * 1.4, avg * 0.85)))
        })
        const wSum = weights.reduce((a, b) => a + b, 0) || cols.length
        const colWidths = weights.map(w => Math.max(36, (w / wSum) * contentWidth))
        const totalW = colWidths.reduce((a, b) => a + b, 0)
        if (totalW !== contentWidth && colWidths.length) {
          colWidths[colWidths.length - 1] += contentWidth - totalW
        }

        const fontSize = cols.length > 6 ? 8 : 8.5
        const lineH = fontSize + 3

        const drawHeaderRow = () => {
          const headerWrapped = cols.map((col, idx) =>
            wrapTextLines(pdf.font(activeFont).fontSize(fontSize), stripInlineMarkdown(safeString(col.label) || safeString(col.key)), colWidths[idx] - 8),
          )
          const hLines = Math.max(...headerWrapped.map(l => l.length), 1)
          const rowH = hLines * lineH + 8
          ensureSpace(rowH + 14)
          const startY = pdf.y
          let x = marginLeft
          cols.forEach((_, idx) => {
            pdf.save()
            pdf.rect(x, startY, colWidths[idx], rowH).fillAndStroke('#edf4ff', '#cbd5e1')
            pdf.restore()
            pdf.font(activeFont).fontSize(fontSize).fillColor('#1d4b8f')
            headerWrapped[idx].forEach((ln, lIdx) => {
              pdf.text(ln, x + 4, startY + 4 + lIdx * lineH, { lineBreak: false })
            })
            x += colWidths[idx]
          })
          pdf.y = startY + rowH
        }

        drawHeaderRow()

        for (let rIdx = 0; rIdx < rows.length; rIdx += 1) {
          const rowObj = rows[rIdx] || {}
          pdf.font(activeFont).fontSize(fontSize)
          const cellWrapped = cols.map((col, idx) =>
            wrapTextLines(pdf, stripInlineMarkdown(formatCell(Object.hasOwn(rowObj, col.key) ? rowObj[col.key] : null, col)), colWidths[idx] - 8),
          )
          const maxLines = Math.max(...cellWrapped.map(l => l.length), 1)
          const rowH = Math.min(220, maxLines * lineH + 8)

          if (pdf.y + rowH > pageBottom) {
            pdf.addPage()
            pdf.font(activeFont)
            drawHeaderRow()
          }

          const startY = pdf.y
          const bg = rIdx % 2 === 1 ? '#f8fafc' : '#ffffff'
          let x = marginLeft
          cols.forEach((_, idx) => {
            pdf.save()
            pdf.rect(x, startY, colWidths[idx], rowH).fillAndStroke(bg, '#cbd5e1')
            pdf.restore()
            pdf.font(activeFont).fontSize(fontSize).fillColor('#0f172a')
            const maxVisible = Math.floor((rowH - 6) / lineH)
            cellWrapped[idx].slice(0, maxVisible).forEach((ln, lIdx) => {
              pdf.text(ln, x + 4, startY + 4 + lIdx * lineH, { lineBreak: false })
            })
            x += colWidths[idx]
          })
          pdf.y = startY + rowH
        }
        pdf.y += 10
      }
    }

    for (const sec of doc.sections) {
      if (sec.heading) {
        ensureSpace(26)
        pdf.y += 4
        drawLines(stripInlineMarkdown(sec.heading), marginLeft, contentWidth, sec.level === 3 ? 11.5 : 13, sec.level === 3 ? '#0f172a' : '#1d4b8f', 4)
      }
      if (sec.badges?.length) {
        drawLines(sec.badges.map(b => `[${stripInlineMarkdown(b.label)}]`).join('  '), marginLeft, contentWidth, 9, '#334155', 3)
      }
      if (sec.callout) {
        const text = `${sec.callout.title ? `${stripInlineMarkdown(sec.callout.title)}：` : ''}${stripInlineMarkdown(sec.callout.text)}`
        const color = sec.callout.tone === 'bad' ? '#b42318' : sec.callout.tone === 'good' ? '#146c43' : '#1d4b8f'
        drawLines(text, marginLeft + 8, contentWidth - 16, 9.5, color, 3)
        pdf.y += 4
      }
      if (sec.quote) {
        drawLines(`“${stripInlineMarkdown(sec.quote)}”`, marginLeft + 8, contentWidth - 16, 9.5, '#475569', 3)
        pdf.y += 4
      }
      for (const kv of sec.kvPairs || []) {
        drawLines(`${stripInlineMarkdown(kv.label)}：${stripInlineMarkdown(kv.value)}`, marginLeft + 4, contentWidth - 8, 9.5, '#1e293b', 3)
      }
      for (const p of sec.paragraphs || []) {
        drawLines(stripInlineMarkdown(p), marginLeft, contentWidth, 9.5, '#1e293b', 3.5)
        pdf.y += 3
      }
      for (const b of sec.bullets || []) {
        drawLines(`• ${stripInlineMarkdown(b)}`, marginLeft + 6, contentWidth - 10, 9.5, '#1e293b', 3)
      }
      const secTables = sec.tables?.length ? sec.tables : sec.table ? [sec.table] : []
      for (const tbl of secTables) {
        renderedTables.add(tbl)
        drawPdfTable(tbl)
      }
    }

    for (const table of doc.tables) {
      if (renderedTables.has(table)) continue
      drawPdfTable(table)
    }

    if (doc.sources.length) {
      ensureSpace(30)
      drawLines('资料来源', marginLeft, contentWidth, 12, '#1d4b8f', 4)
      for (const src of doc.sources) {
        const line = `[${src.number}] ${stripInlineMarkdown(src.title)}${src.safeUrl ? ` (${src.safeUrl})` : ''}`
        drawLines(line, marginLeft, contentWidth, 8.5, '#475569', 3)
      }
    }

    // Footer page numbers on all buffered pages
    const range = pdf.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i += 1) {
      pdf.switchToPage(i)
      const footerY = pageHeight - 30
      pdf.font(activeFont).fontSize(8.5).fillColor('#64748b')
      pdf.text('北极星 Polaris', marginLeft, footerY, { lineBreak: false })
      const pageLabel = `第 ${i + 1} / ${range.count} 页`
      const labelW = pdf.widthOfString(pageLabel)
      pdf.text(pageLabel, pageWidth - marginLeft - labelW, footerY, { lineBreak: false })
    }

    pdf.end()
  })
}

export async function renderPdf(docInput, options = {}) {
  const safeOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
  const doc = normalizeExportDocument(docInput)
  const engine = safeString(safeOptions.engine).trim() || 'auto'
  const html = renderHtml(doc)

  if (engine !== 'pdfkit' && typeof globalThis.__polarisPrintHtmlToPdf === 'function') {
    const hooked = await globalThis.__polarisPrintHtmlToPdf(html, { title: stripInlineMarkdown(doc.title), doc, options: safeOptions })
    if (hooked && hooked.length > 0) {
      return Buffer.from(hooked)
    }
  }

  if (engine === 'browser' || engine === 'auto') {
    const exe = findBrowserExecutable()
    if (exe) {
      try {
        return await renderPdfViaBrowser(html, exe)
      } catch (err) {
        if (engine === 'browser') throw err
      }
    } else if (engine === 'browser') {
      throw new Error('未检测到可用的 Chrome / Edge / Chromium 浏览器用于打印 PDF')
    }
  }

  return renderPdfViaPdfkit(doc)
}

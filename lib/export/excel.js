import ExcelJS from 'exceljs'
import {
  formatCell,
  normalizeExportDocument,
  safeString,
  sanitizeSheetName,
  stripInlineMarkdown,
} from './model.js'

const HEADER_FONT = { name: 'Microsoft YaHei', size: 10.5, bold: true, color: { argb: 'FF1D4B8F' } }
const BANNER_FONT = { name: 'Microsoft YaHei', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
const SUBTITLE_FONT = { name: 'Microsoft YaHei', size: 9.5, color: { argb: 'FF475569' } }
const BODY_FONT = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF0F172A' } }
const LINK_FONT = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF1D4B8F' }, underline: true }

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
}

const HEADER_BORDER = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'medium', color: { argb: 'FF1D4B8F' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
}

function displayWidth(text) {
  let width = 0
  for (const ch of safeString(text)) {
    const code = ch.codePointAt(0) || 0
    width += code > 255 ? 2 : 1
  }
  return width
}

function guardFormulaString(text) {
  const str = safeString(text)
  if (/^(?:[\s\u0000-\u001f]*[=+@-]|[\t\r])/.test(str)) {
    return `'${str}`
  }
  return str
}

function numberFormatForColumn(col, value) {
  if (col.key === 'year') return '0'
  if (col.fractionDigits === 2) return '0.00'
  if (Number.isInteger(value) && !col.fractionDigits) return '#,##0'
  return '#,##0.##'
}

function excelCellValue(rawValue, col) {
  if (rawValue == null || rawValue === '') return null
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue
  }
  if (typeof rawValue === 'boolean') {
    return rawValue ? '是' : '否'
  }
  if (Array.isArray(rawValue)) {
    const joined = rawValue.map(v => (typeof v === 'string' ? stripInlineMarkdown(v) : safeString(v))).filter(Boolean).join('、')
    return joined ? guardFormulaString(joined) : null
  }
  const formatted = formatCell(rawValue, col)
  if (!formatted || formatted === '—') return null
  return guardFormulaString(stripInlineMarkdown(formatted))
}

function addStyledTableSheet(workbook, table, doc, usedSheetNames) {
  const sheetName = sanitizeSheetName(table.sheetName || table.title || '数据表', usedSheetNames)
  const ws = workbook.addWorksheet(sheetName, {
    properties: { defaultRowHeight: 21 },
  })

  const columns = table.columns || []
  const colCount = Math.max(1, columns.length)

  // Row 1: Polaris #1D4B8F banner
  ws.mergeCells(1, 1, 1, colCount)
  const bannerRow = ws.getRow(1)
  bannerRow.height = 30
  const bannerCell = bannerRow.getCell(1)
  bannerCell.value = guardFormulaString(stripInlineMarkdown(table.title || doc.title))
  bannerCell.font = BANNER_FONT
  bannerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4B8F' } }
  bannerCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

  // Row 2: Subtitle / filters / description
  ws.mergeCells(2, 1, 2, colCount)
  const subRow = ws.getRow(2)
  subRow.height = 20
  const metaParts = [
    stripInlineMarkdown(doc.subtitle),
    table.description && table.description !== doc.subtitle ? stripInlineMarkdown(table.description) : null,
    doc.filtersApplied?.length ? `筛选：${doc.filtersApplied.map(f => stripInlineMarkdown(f)).join(' · ')}` : null,
  ].filter(Boolean)
  const subCell = subRow.getCell(1)
  subCell.value = guardFormulaString(metaParts.join(' ｜ '))
  subCell.font = SUBTITLE_FONT
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

  // Row 3: Column headers
  const headerRowIdx = 3
  const headerRow = ws.getRow(headerRowIdx)
  headerRow.height = 26
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1)
    cell.value = guardFormulaString(stripInlineMarkdown(safeString(col.label) || safeString(col.key)))
    cell.font = HEADER_FONT
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF4FF' } }
    cell.border = HEADER_BORDER
    cell.alignment = { vertical: 'middle', horizontal: col.numeric ? 'right' : 'left', wrapText: true }
  })

  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }]
  if (columns.length > 0 && table.rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to: { row: headerRowIdx, column: colCount },
    }
  }

  // Track CJK display widths per column
  const maxWidths = columns.map(col => Math.max(10, displayWidth(stripInlineMarkdown(safeString(col.label) || safeString(col.key))) + 4))

  const sampleLimit = Math.min(table.rows.length, 300)
  for (let rIdx = 0; rIdx < table.rows.length; rIdx += 1) {
    const rowObj = table.rows[rIdx] || {}
    const wsRow = ws.getRow(headerRowIdx + 1 + rIdx)
    const isZebra = rIdx % 2 === 1
    let maxLines = 1

    columns.forEach((col, cIdx) => {
      const val = excelCellValue(Object.hasOwn(rowObj, col.key) ? rowObj[col.key] : null, col)
      const cell = wsRow.getCell(cIdx + 1)
      if (typeof val === 'number') {
        cell.value = val
        cell.numFmt = numberFormatForColumn(col, val)
        cell.alignment = { vertical: 'top', horizontal: 'right', wrapText: true }
      } else {
        cell.value = val
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true }
      }
      cell.font = BODY_FONT
      cell.border = THIN_BORDER
      if (isZebra) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      }

      if (val != null && rIdx < sampleLimit) {
        const text = String(val)
        const lines = text.split('\n')
        const longest = Math.max(...lines.map(displayWidth), 0)
        maxWidths[cIdx] = Math.max(maxWidths[cIdx], Math.min(48, longest + 3))
      }
    })

    // Compute dynamic row height based on clamped column widths
    columns.forEach((col, cIdx) => {
      const colW = Math.min(48, Math.max(10, maxWidths[cIdx]))
      const val = wsRow.getCell(cIdx + 1).value
      if (val == null) return
      const text = String(val)
      const effWidth = Math.max(6, colW - 2)
      let linesForCell = 0
      for (const seg of text.split('\n')) {
        linesForCell += Math.max(1, Math.ceil(displayWidth(seg) / effWidth))
      }
      if (linesForCell > maxLines) maxLines = linesForCell
    })

    wsRow.height = Math.min(180, Math.max(21, maxLines * 15 + 7))
  }

  columns.forEach((_, cIdx) => {
    ws.getColumn(cIdx + 1).width = Math.min(48, Math.max(10, maxWidths[cIdx]))
  })

  return ws
}

function synthesizeSummaryTable(doc) {
  const rows = []
  for (const card of doc.summaryCards || []) {
    rows.push({ section: '核心指标', item: stripInlineMarkdown(card.label), content: stripInlineMarkdown(card.value) })
  }
  for (const sec of doc.sections || []) {
    for (const kv of sec.kvPairs || []) {
      rows.push({ section: stripInlineMarkdown(sec.heading || '详情'), item: stripInlineMarkdown(kv.label), content: stripInlineMarkdown(kv.value) })
    }
    for (const p of sec.paragraphs || []) {
      rows.push({ section: stripInlineMarkdown(sec.heading || '正文'), item: '正文', content: stripInlineMarkdown(p) })
    }
    for (const b of sec.bullets || []) {
      rows.push({ section: stripInlineMarkdown(sec.heading || '要点'), item: '要点', content: stripInlineMarkdown(b) })
    }
    if (sec.callout) {
      rows.push({
        section: stripInlineMarkdown(sec.heading || '提示'),
        item: stripInlineMarkdown(sec.callout.title || '提示'),
        content: stripInlineMarkdown(sec.callout.text),
      })
    }
  }
  if (!rows.length) {
    rows.push({ section: '说明', item: '标题', content: stripInlineMarkdown(doc.title) })
  }
  return {
    sheetName: '内容概览',
    title: stripInlineMarkdown(doc.title),
    description: stripInlineMarkdown(doc.subtitle),
    columns: [
      { key: 'section', label: '板块', type: 'string' },
      { key: 'item', label: '项目', type: 'string' },
      { key: 'content', label: '内容', type: 'string' },
    ],
    rows,
  }
}

function addSourcesSheet(workbook, sources, doc, usedSheetNames) {
  if (!sources.length) return
  const sheetName = sanitizeSheetName('资料来源', usedSheetNames)
  const ws = workbook.addWorksheet(sheetName, { properties: { defaultRowHeight: 22 } })

  ws.mergeCells(1, 1, 1, 5)
  const banner = ws.getRow(1)
  banner.height = 28
  banner.getCell(1).value = guardFormulaString(`${stripInlineMarkdown(doc.title)} · 资料来源`)
  banner.getCell(1).font = BANNER_FONT
  banner.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4B8F' } }
  banner.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

  const headers = ['序号', '标题', '类型', '年份 / 发布', '链接']
  const headerRow = ws.getRow(2)
  headerRow.height = 24
  headers.forEach((h, idx) => {
    const c = headerRow.getCell(idx + 1)
    c.value = h
    c.font = HEADER_FONT
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF4FF' } }
    c.border = HEADER_BORDER
    c.alignment = { vertical: 'middle', horizontal: 'left' }
  })

  ws.views = [{ state: 'frozen', ySplit: 2 }]
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 5 } }

  sources.forEach((src, idx) => {
    const r = ws.getRow(3 + idx)
    r.height = 22
    const vals = [
      `[${src.number || idx + 1}]`,
      guardFormulaString(stripInlineMarkdown(safeString(src.title) || '未命名资料')),
      guardFormulaString(stripInlineMarkdown(safeString(src.kind) || '资料')),
      guardFormulaString(stripInlineMarkdown([safeString(src.publisher), safeString(src.published_at) || safeString(src.year)].filter(Boolean).join(' · ') || '—')),
      src.safeUrl || '内部整理资料',
    ]
    vals.forEach((v, cIdx) => {
      const cell = r.getCell(cIdx + 1)
      if (cIdx === 4 && src.safeUrl) {
        cell.value = { text: src.safeUrl, hyperlink: src.safeUrl }
        cell.font = LINK_FONT
      } else {
        cell.value = v
        cell.font = BODY_FONT
      }
      cell.border = THIN_BORDER
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      }
    })
  })

  ws.getColumn(1).width = 10
  ws.getColumn(2).width = 36
  ws.getColumn(3).width = 16
  ws.getColumn(4).width = 24
  ws.getColumn(5).width = 46
}

export async function renderExcel(docInput) {
  const doc = normalizeExportDocument(docInput)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '北极星 Polaris'
  workbook.created = new Date()

  const usedSheetNames = new Set()
  const docTableSet = new Set(doc.tables)
  const inlineTables = doc.sections
    .flatMap(sec => sec.tables || [])
    .filter(t => t && t.columns?.length && !docTableSet.has(t))
  const tables = doc.tables.length || inlineTables.length
    ? [...doc.tables, ...inlineTables]
    : [synthesizeSummaryTable(doc)]

  for (const table of tables) {
    addStyledTableSheet(workbook, table, doc, usedSheetNames)
  }

  addSourcesSheet(workbook, doc.sources, doc, usedSheetNames)

  const out = await workbook.xlsx.writeBuffer()
  return Buffer.from(out)
}

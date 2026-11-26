import { columnLabel, internalColumn } from '../../src/presentation.js'
import {
  PRESET_META,
  buildArtifactDocument,
  buildChatDocument,
  buildComparisonDocument,
  buildCustomDocument,
  buildDossierDocument,
  buildFromMentors,
  buildInsights,
  resolvePresetFilter,
} from './builders.js'
import { renderDocx } from './docx.js'
import { renderExcel } from './excel.js'
import { renderHtml } from './html.js'
import { renderMarkdown } from './markdown.js'
import {
  createExportDocument,
  formatCell,
  normalizeExportDocument,
  radarSvg,
  safeString,
  sanitizeExportFilename,
  sanitizeFilename,
  sanitizeSheetName,
  sanitizeSvg,
  sanitizeText,
  sanitizeTitleText,
  stripInlineMarkdown,
  stripInternalTokens,
} from './model.js'
import {
  findBrowserExecutable,
  findSystemCjkFont,
  renderPdf,
  resolveFontFace,
} from './pdf.js'

export const EXPORT_FORMATS = ['xlsx', 'pdf', 'docx', 'md', 'html', 'csv']

export const MIME_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
}

function formatCsvField(value) {
  if (value == null) return '""'
  let text = Array.isArray(value) ? value.map(v => safeString(v)).join('、') : safeString(value)
  if (typeof value === 'string' && /^(?:[\s\u0000-\u001f]*[=+@-]|[\t\r])/.test(text)) {
    text = `'${text}`
  }
  return `"${text.replaceAll('"', '""')}"`
}

export function renderCsv(docInput) {
  const doc = normalizeExportDocument(docInput)
  const fallbackTable = doc.tables[0] || doc.sections.flatMap(sec => sec.tables || []).find(t => t && t.columns?.length)
  if (fallbackTable) {
    const table = fallbackTable
    const visibleColumns = table.columns.filter(col => !internalColumn(col))
    const headerLine = visibleColumns
      .map(col => formatCsvField(stripInlineMarkdown(columnLabel(col))))
      .join(',')
    const rowLines = table.rows.map(row =>
      visibleColumns
        .map(col => {
          const rawVal = row && Object.hasOwn(row, col.key) ? row[col.key] : null
          if (rawVal == null) return formatCsvField(null)
          if (typeof rawVal === 'number') return formatCsvField(rawVal)
          if (Array.isArray(rawVal)) {
            const joined = rawVal
              .map(v => (typeof v === 'string' ? v : safeString(v)))
              .filter(Boolean)
              .join('、')
            return formatCsvField(formatCell(joined, col))
          }
          return formatCsvField(formatCell(rawVal, col))
        })
        .join(','),
    )
    return `\uFEFF${[headerLine, ...rowLines].join('\r\n')}`
  }
  const rows = [
    ...doc.summaryCards.map(c => ({ item: c.label, content: c.value })),
    ...doc.sections.flatMap(sec => [
      ...(sec.kvPairs || []).map(kv => ({ item: kv.label, content: kv.value })),
      ...(sec.paragraphs || []).map(p => ({ item: sec.heading || '正文', content: p })),
      ...(sec.bullets || []).map(b => ({ item: sec.heading || '要点', content: b })),
    ]),
  ]
  const finalRows = rows.length ? rows : [{ item: '标题', content: doc.title }]
  const headerLine = [formatCsvField('项目'), formatCsvField('内容')].join(',')
  const rowLines = finalRows.map(r => [
    formatCsvField(formatCell(r.item, { key: 'item', type: 'string' })),
    formatCsvField(formatCell(r.content, { key: 'content', type: 'string' })),
  ].join(','))
  return `\uFEFF${[headerLine, ...rowLines].join('\r\n')}`
}

export async function exportDocument(docInput, format = 'xlsx', options = {}) {
  const ext = safeString(format).toLowerCase().trim()
  if (!EXPORT_FORMATS.includes(ext)) {
    throw new Error(`不支持的导出格式：${ext || safeString(format) || '空'}（支持 ${EXPORT_FORMATS.join(' / ')}）`)
  }

  const safeOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
  const doc = normalizeExportDocument(docInput)
  const rawFilename = safeString(safeOptions.filename)
  const baseName = rawFilename
    ? sanitizeExportFilename(rawFilename, '北极星导出')
    : sanitizeFilename(stripInlineMarkdown(doc.title) || '北极星导出')
  const filename = baseName.toLowerCase().endsWith(`.${ext}`) ? baseName : `${baseName}.${ext}`
  const type = MIME_TYPES[ext]

  let body
  let binary = false
  if (ext === 'xlsx') {
    body = await renderExcel(doc, safeOptions)
    binary = true
  } else if (ext === 'pdf') {
    body = await renderPdf(doc, safeOptions)
    binary = true
  } else if (ext === 'docx') {
    body = await renderDocx(doc, safeOptions)
    binary = true
  } else if (ext === 'html') {
    body = renderHtml(doc, safeOptions)
  } else if (ext === 'md') {
    body = renderMarkdown(doc, safeOptions)
  } else {
    body = renderCsv(doc)
  }

  return {
    body,
    type,
    extension: ext,
    filename,
    binary,
  }
}

export {
  PRESET_META,
  buildArtifactDocument,
  buildChatDocument,
  buildComparisonDocument,
  buildCustomDocument,
  buildDossierDocument,
  buildFromMentors,
  buildInsights,
  createExportDocument,
  findBrowserExecutable,
  findSystemCjkFont,
  formatCell,
  normalizeExportDocument,
  radarSvg,
  renderDocx,
  renderExcel,
  renderHtml,
  renderMarkdown,
  renderPdf,
  resolveFontFace,
  resolvePresetFilter,
  sanitizeExportFilename,
  sanitizeFilename,
  sanitizeSheetName,
  sanitizeSvg,
  sanitizeText,
  sanitizeTitleText,
}

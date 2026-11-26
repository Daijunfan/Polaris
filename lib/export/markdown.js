import { formatCell, normalizeExportDocument, safeString, stripInlineMarkdown } from './model.js'

function escapeMdCell(value) {
  return safeString(value).replaceAll('|', '\\|').replace(/\r?\n/g, ' ')
}

function renderMdTable(table) {
  const cols = table.columns || []
  const rows = table.rows || []
  if (!cols.length) return ''
  const parts = []
  if (table.title) parts.push(`### ${table.title}`)
  if (table.description) parts.push(table.description)
  const head = `| ${cols.map(c => escapeMdCell(safeString(c.label) || safeString(c.key))).join(' | ')} |`
  const sep = `| ${cols.map(c => (c.numeric ? '---:' : '---')).join(' | ')} |`
  const body = rows.length
    ? rows.map(row => `| ${cols.map(col => escapeMdCell(formatCell(row && Object.hasOwn(row, col.key) ? row[col.key] : null, col))).join(' | ')} |`).join('\n')
    : `| ${cols.map((_, idx) => (idx === 0 ? '暂无数据' : '—')).join(' | ')} |`
  parts.push(`${head}\n${sep}\n${body}`)
  return parts.join('\n\n')
}

export function renderMarkdown(docInput) {
  const doc = normalizeExportDocument(docInput)
  const lines = []
  const renderedTables = new Set()

  lines.push(`# ${doc.title}`)
  if (doc.subtitle) lines.push(doc.subtitle)
  if (doc.filtersApplied.length) {
    lines.push(`> 筛选条件：${doc.filtersApplied.join(' · ')}`)
  }

  if (doc.summaryCards.length) {
    lines.push('## 核心指标')
    lines.push(doc.summaryCards.map(c => `- **${stripInlineMarkdown(c.label)}**：${c.value}`).join('\n'))
  }

  for (const sec of doc.sections) {
    if (sec.heading) {
      lines.push(`${sec.level === 3 ? '###' : '##'} ${sec.heading}`)
    }
    if (sec.badges?.length) {
      lines.push(sec.badges.map(b => `\`${b.label}\``).join(' '))
    }
    if (sec.callout) {
      lines.push(`> **${stripInlineMarkdown(sec.callout.title || '提示')}**：${sec.callout.text.replace(/\n/g, '\n> ')}`)
    }
    if (sec.quote) {
      lines.push(`> ${sec.quote.replace(/\n/g, '\n> ')}`)
    }
    if (sec.kvPairs?.length) {
      lines.push(sec.kvPairs.map(kv => `- **${stripInlineMarkdown(kv.label)}**：${kv.value}`).join('\n'))
    }
    for (const p of sec.paragraphs || []) {
      lines.push(p)
    }
    if (sec.bullets?.length) {
      lines.push(sec.bullets.map(b => `- ${b}`).join('\n'))
    }
    const secTables = sec.tables?.length ? sec.tables : sec.table ? [sec.table] : []
    for (const tbl of secTables) {
      renderedTables.add(tbl)
      const mdTbl = renderMdTable(tbl)
      if (mdTbl) lines.push(mdTbl)
    }
  }

  const extraTables = doc.tables.filter(t => !renderedTables.has(t))
  for (const table of extraTables) {
    const mdTbl = renderMdTable(table)
    if (mdTbl) lines.push(mdTbl)
  }

  if (doc.sources.length) {
    lines.push('## 资料来源')
    lines.push(
      doc.sources.map(src => {
        const cleanTitle = stripInlineMarkdown(src.title)
        const title = src.safeUrl ? `[${cleanTitle}](${src.safeUrl})` : cleanTitle
        const meta = [safeString(src.kind), safeString(src.publisher), safeString(src.published_at) || safeString(src.year)].filter(Boolean).join(' · ')
        return `- **[${src.number}] ${title}**${meta ? ` · ${meta}` : ''}`
      }).join('\n'),
    )
  }

  return lines.filter(Boolean).join('\n\n') + '\n'
}

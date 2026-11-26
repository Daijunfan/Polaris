import { APP_EN, APP_NAME, STAR_PATH } from '../brand.js'
import {
  formatCell,
  normalizeExportDocument,
  parseInlineMarkdown,
  safePublicWebUrl,
  safeString,
  sanitizeSvg,
  stripInlineMarkdown,
} from './model.js'

export function escapeHtml(value) {
  return safeString(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
}

function renderInlineTokens(tokens) {
  return tokens.map(tok => {
    if (tok.type === 'code' || tok.code) {
      return `<code>${escapeHtml(tok.text)}</code>`
    }
    let node = tok.children ? renderInlineTokens(tok.children) : escapeHtml(tok.text)
    if (tok.type === 'italic' || tok.italic) {
      node = `<em>${node}</em>`
    }
    if (tok.type === 'bold' || tok.bold) {
      node = `<strong>${node}</strong>`
    }
    if (tok.type === 'link' && safePublicWebUrl(tok.url)) {
      node = `<a href="${escapeHtml(tok.url)}" target="_blank" rel="noopener noreferrer">${node}</a>`
    }
    return node
  }).join('')
}

function renderInlineHtml(text) {
  return renderInlineTokens(parseInlineMarkdown(text))
}

function renderTableHtml(table) {
  const cols = table.columns || []
  const rows = table.rows || []
  if (!cols.length) return ''
  const head = cols.map(col => `<th${col.numeric ? ' class="num"' : ''}>${renderInlineHtml(col.label || col.key)}</th>`).join('')
  const body = rows.length
    ? rows.map(row => {
        const cells = cols.map(col => {
          const val = formatCell(row && Object.hasOwn(row, col.key) ? row[col.key] : null, col)
          const cls = col.numeric ? ' class="num"' : ''
          return `<td${cls}>${renderInlineHtml(val)}</td>`
        }).join('')
        return `<tr>${cells}</tr>`
      }).join('')
    : `<tr><td colspan="${cols.length}" class="empty-cell">暂无数据记录</td></tr>`

  return [
    '<div class="table-wrap">',
    table.title ? `<div class="table-head"><h3>${renderInlineHtml(table.title)}</h3>${table.description ? `<span>${renderInlineHtml(table.description)}</span>` : ''}</div>` : '',
    `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
    '</div>',
  ].join('')
}

export function renderHtml(docInput) {
  const doc = normalizeExportDocument(docInput)
  const renderedTables = new Set()

  const summaryHtml = doc.summaryCards.length
    ? `<section class="kpi-grid" aria-label="核心指标">${doc.summaryCards.map(c => `<div class="kpi-card"><span class="kpi-label">${escapeHtml(stripInlineMarkdown(c.label))}</span><strong class="kpi-value">${escapeHtml(stripInlineMarkdown(c.value))}</strong></div>`).join('')}</section>`
    : ''

  const filtersHtml = doc.filtersApplied.length
    ? `<div class="filter-pills">${doc.filtersApplied.map(f => `<span class="filter-pill">${escapeHtml(stripInlineMarkdown(f))}</span>`).join('')}</div>`
    : ''

  const chartsHtml = doc.charts.length
    ? `<section class="section"><h2>数据分布图</h2><div class="chart-grid">${doc.charts.map(c => {
        const safeSvg = sanitizeSvg(c.svg)
        return safeSvg ? `<div class="chart-box"><h3>${escapeHtml(stripInlineMarkdown(c.title))}</h3>${safeSvg}</div>` : ''
      }).filter(Boolean).join('')}</div></section>`
    : ''

  const sectionsHtml = doc.sections.map(sec => {
    const tag = sec.level === 3 ? 'h3' : 'h2'
    const parts = []
    if (sec.heading) parts.push(`<${tag}>${renderInlineHtml(sec.heading)}</${tag}>`)

    if (sec.badges?.length) {
      parts.push(
        `<div class="badge-list">${sec.badges.map(b => `<span class="badge tone-${escapeHtml(b.tone)}"${b.detail ? ` title="${escapeHtml(stripInlineMarkdown(b.detail))}"` : ''}>${escapeHtml(stripInlineMarkdown(b.label))}</span>`).join('')}</div>`,
      )
    }
    if (sec.callout) {
      parts.push(
        `<div class="callout tone-${escapeHtml(sec.callout.tone)}">${sec.callout.title ? `<strong>${renderInlineHtml(sec.callout.title)}</strong>` : ''}<p>${renderInlineHtml(sec.callout.text)}</p></div>`,
      )
    }
    if (sec.quote) {
      parts.push(`<blockquote class="quote">${renderInlineHtml(sec.quote)}</blockquote>`)
    }
    const safeRadarSvg = sanitizeSvg(sec.radarSvg)
    if (safeRadarSvg && sec.kvPairs?.length) {
      parts.push(
        `<div class="radar-split"><div class="radar-box">${safeRadarSvg}</div><dl class="kv-grid">${sec.kvPairs.map(kv => `<div class="kv-item"><dt>${escapeHtml(stripInlineMarkdown(kv.label))}</dt><dd>${renderInlineHtml(kv.value)}</dd></div>`).join('')}</dl></div>`,
      )
    } else {
      if (safeRadarSvg) parts.push(`<div class="radar-box">${safeRadarSvg}</div>`)
      if (sec.kvPairs?.length) {
        parts.push(`<dl class="kv-grid">${sec.kvPairs.map(kv => `<div class="kv-item"><dt>${escapeHtml(stripInlineMarkdown(kv.label))}</dt><dd>${renderInlineHtml(kv.value)}</dd></div>`).join('')}</dl>`)
      }
    }
    for (const p of sec.paragraphs || []) {
      parts.push(`<p class="prose">${renderInlineHtml(p)}</p>`)
    }
    if (sec.bullets?.length) {
      parts.push(`<ul class="bullet-list">${sec.bullets.map(b => `<li>${renderInlineHtml(b)}</li>`).join('')}</ul>`)
    }
    const secTables = sec.tables?.length ? sec.tables : sec.table ? [sec.table] : []
    for (const tbl of secTables) {
      renderedTables.add(tbl)
      parts.push(renderTableHtml(tbl))
    }
    return `<section class="section">${parts.join('')}</section>`
  }).join('')

  const extraTables = doc.tables.filter(t => !renderedTables.has(t))
  const tablesHtml = extraTables.length
    ? `<section class="section"><h2>数据明细</h2>${extraTables.map(renderTableHtml).join('')}</section>`
    : ''

  const sourcesHtml = doc.sources.length
    ? `<section class="section sources-section"><h2>资料来源</h2><ol class="sources-list">${doc.sources.map(src => {
        const meta = [safeString(src.kind), safeString(src.publisher), safeString(src.published_at) || safeString(src.year)].filter(Boolean).map(escapeHtml).join(' · ')
        const cleanSrcTitle = stripInlineMarkdown(src.title)
        const titleNode = src.safeUrl
          ? `<a href="${escapeHtml(src.safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanSrcTitle)}</a>`
          : escapeHtml(cleanSrcTitle)
        return `<li><span class="src-num">[${escapeHtml(src.number)}]</span> <strong>${titleNode}</strong>${meta ? ` <span class="src-meta">${meta}</span>` : ''}</li>`
      }).join('')}</ol></section>`
    : ''

  const css = `
@page{size:A4;margin:16mm 14mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#f8fafc;color:#0f172a;font:14px/1.7 "PingFang SC","Hiragino Sans GB","Microsoft YaHei UI","Microsoft YaHei","Noto Sans CJK SC","WenQuanYi Micro Hei",system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
main{max-width:1060px;margin:28px auto;padding:36px 40px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 8px 28px rgba(15,23,42,.05)}
.report-header{background:#1d4b8f;color:#ffffff;padding:24px 28px;border-radius:12px;margin-bottom:22px;break-after:avoid}
.brand{display:flex;align-items:center;gap:10px;font-size:13px;opacity:.92;margin-bottom:8px}
.report-header h1{margin:0;font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-.2px}
.subtitle{margin:6px 0 0;font-size:13px;opacity:.9}
.filter-pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.filter-pill{display:inline-block;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.16);color:#ffffff;font-size:12px}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin-bottom:22px}
.kpi-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;break-inside:avoid}
.kpi-label{display:block;font-size:12px;color:#475569}
.kpi-value{display:block;margin-top:4px;font-size:16px;color:#0f172a;font-weight:700}
.section{padding:18px 0;border-top:1px solid #e2e8f0}
.section:first-of-type{border-top:0}
h2{margin:0 0 12px;font-size:18px;color:#1d4b8f;border-left:4px solid #1d4b8f;padding-left:10px;break-after:avoid}
h3{margin:14px 0 8px;font-size:15px;color:#0f172a;break-after:avoid}
.prose{margin:8px 0;white-space:pre-line;color:#1e293b}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;background:#f1f5f9;padding:1px 5px;border-radius:4px}
.bullet-list{margin:8px 0;padding-left:20px;color:#1e293b}
.bullet-list li{margin:4px 0}
.badge-list{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid transparent}
.badge.tone-good{background:#eaf7f0;color:#146c43;border-color:#bfe6cf}
.badge.tone-bad{background:#fef2f2;color:#b42318;border-color:#fecaca}
.badge.tone-note{background:#edf4ff;color:#1d4b8f;border-color:#c7daf7}
.callout{border-radius:10px;padding:12px 14px;margin:10px 0;border:1px solid #c7daf7;background:#edf4ff;break-inside:avoid}
.callout.tone-bad{background:#fef2f2;border-color:#fecaca;color:#7f1d1d}
.callout.tone-good{background:#eaf7f0;border-color:#bfe6cf;color:#065f46}
.callout strong{display:block;margin-bottom:4px;font-size:13.5px}
.callout p{margin:0;white-space:pre-line}
.quote{margin:10px 0;padding:10px 14px;border-left:3px solid #1d4b8f;background:#f8fafc;color:#334155;font-style:normal;break-inside:avoid}
.radar-split{display:grid;grid-template-columns:250px 1fr;gap:18px;align-items:start;margin:10px 0}
.radar-box{display:flex;justify-content:center;align-items:center;padding:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;break-inside:avoid}
.kv-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;margin:10px 0}
.kv-item{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;break-inside:avoid}
.kv-item dt{font-size:12px;font-weight:600;color:#475569}
.kv-item dd{margin:4px 0 0;color:#0f172a;white-space:pre-line;overflow-wrap:anywhere}
.chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.chart-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;break-inside:avoid}
.chart-box svg{max-width:100%;height:auto}
.table-wrap{margin:14px 0;overflow-x:auto}
.table-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:6px}
.table-head span{font-size:12.5px;color:#64748b}
table{width:100%;border-collapse:collapse;font-size:12.5px}
thead{display:table-header-group}
th,td{padding:8px 10px;border:1px solid #cbd5e1;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#edf4ff;color:#1d4b8f;font-weight:700}
tbody tr:nth-child(even){background:#f8fafc}
tr{break-inside:avoid}
.num{text-align:right;font-variant-numeric:tabular-nums}
.empty-cell{text-align:center;color:#64748b;padding:16px}
.sources-list{margin:8px 0;padding-left:20px;font-size:12.5px;color:#334155}
.sources-list li{margin:4px 0}
.src-num{color:#1d4b8f;font-weight:600}
.src-meta{color:#64748b}
a{color:#1d4b8f;text-decoration:none}
a:hover{text-decoration:underline}
.report-footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;display:flex;justify-content:space-between}
@media print{body{background:#ffffff}main{margin:0;padding:0;border:0;box-shadow:none;max-width:none}}
@media(max-width:720px){main{margin:0;padding:18px;border:0;border-radius:0}.radar-split,.kv-grid{grid-template-columns:1fr}}
`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(stripInlineMarkdown(doc.title))}</title>
<style>${css}</style>
</head>
<body>
<main>
  <header class="report-header">
    <div class="brand">
      <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#ffffff" fill-opacity="0.16"/><path d="${STAR_PATH}" transform="translate(0 1.5)" fill="#fbbf24"/></svg>
      <span>${escapeHtml(APP_NAME)} ${escapeHtml(APP_EN)} · 导出的研究与选导报告</span>
    </div>
    <h1>${renderInlineHtml(doc.title)}</h1>
    <p class="subtitle">${renderInlineHtml(doc.subtitle)}</p>
    ${filtersHtml}
  </header>
  ${summaryHtml}
  ${chartsHtml}
  ${sectionsHtml}
  ${tablesHtml}
  ${sourcesHtml}
  <footer class="report-footer">
    <span>${escapeHtml(APP_NAME)} ${escapeHtml(APP_EN)}</span>
    <span>由本地加密库动态生成 · 仅供选导参考</span>
  </footer>
</main>
</body>
</html>`
}

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import {
  formatCell,
  normalizeExportDocument,
  parseInlineMarkdown,
  safePublicWebUrl,
  safeString,
  stripInlineMarkdown,
} from './model.js'

const CJK_FONT = {
  name: 'Microsoft YaHei',
  eastAsia: 'Microsoft YaHei',
  ascii: 'Calibri',
  hAnsi: 'Calibri',
}

const CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
}

const CELL_MARGINS = { top: 80, bottom: 80, left: 100, right: 100 }

function makeRun(text, opts = {}) {
  return new TextRun({
    text: safeString(text).replace(/[\r\n]+/g, ' '),
    font: CJK_FONT,
    size: opts.size ?? 20, // 10pt
    color: opts.color ?? '0F172A',
    bold: Boolean(opts.bold),
    italics: Boolean(opts.italics),
    underline: opts.underline,
  })
}

function renderInlineRuns(tokens, opts = {}) {
  const runs = []
  for (const tok of tokens) {
    if (tok.type === 'code' || tok.code) {
      runs.push(
        new TextRun({
          text: tok.text,
          font: { name: 'Consolas', eastAsia: 'Microsoft YaHei', ascii: 'Consolas', hAnsi: 'Consolas' },
          size: (opts.size ?? 20) - 1,
          color: opts.color || '1D4B8F',
          bold: Boolean(opts.bold),
          italics: Boolean(opts.italics),
          underline: opts.underline,
        }),
      )
      continue
    }
    if (tok.type === 'bold' || tok.bold || tok.type === 'italic' || tok.italic) {
      const nextOpts = {
        ...opts,
        ...(tok.type === 'bold' || tok.bold ? { bold: true } : {}),
        ...(tok.type === 'italic' || tok.italic ? { italics: true } : {}),
      }
      const childRuns = tok.children
        ? renderInlineRuns(tok.children, nextOpts)
        : [makeRun(tok.text, nextOpts)]
      runs.push(...childRuns)
      continue
    }
    if (tok.type === 'link' && safePublicWebUrl(tok.url) && !opts.inLink) {
      const linkOpts = { ...opts, inLink: true, color: '1D4B8F', underline: {} }
      const childRuns = tok.children
        ? renderInlineRuns(tok.children, linkOpts)
        : [makeRun(tok.text, linkOpts)]
      runs.push(
        new ExternalHyperlink({
          link: tok.url,
          children: childRuns,
        }),
      )
      continue
    }
    if (tok.children) {
      runs.push(...renderInlineRuns(tok.children, opts))
    } else {
      runs.push(makeRun(tok.text, opts))
    }
  }
  return runs
}

function inlineChildren(text, opts = {}) {
  return renderInlineRuns(parseInlineMarkdown(text), opts)
}

function computeColumnWidths(columns, rows, totalDxa = 9600) {
  const weights = columns.map(col => {
    const labelLen = (safeString(col.label) || safeString(col.key)).length
    const sample = rows.slice(0, 20).map(r => safeString(formatCell(r && Object.hasOwn(r, col.key) ? r[col.key] : null, col)).length)
    const avg = sample.length ? sample.reduce((a, b) => a + b, 0) / sample.length : 4
    return Math.min(28, Math.max(4, Math.max(labelLen * 1.4, avg * 0.9)))
  })
  const sum = weights.reduce((a, b) => a + b, 0) || columns.length
  const widths = weights.map(w => Math.max(420, Math.floor((w / sum) * totalDxa)))
  const diff = totalDxa - widths.reduce((a, b) => a + b, 0)
  if (widths.length) widths[widths.length - 1] = Math.max(420, widths[widths.length - 1] + diff)
  return widths
}

function buildDocxTable(table) {
  const cols = table.columns || []
  const rows = table.rows || []
  if (!cols.length) return []

  const totalDxa = 9600
  const widths = computeColumnWidths(cols, rows, totalDxa)
  const fontSize = cols.length > 10 ? 15 : cols.length > 6 ? 17 : 19

  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: cols.map((col, idx) =>
      new TableCell({
        width: { size: widths[idx], type: WidthType.DXA },
        shading: { fill: 'EDF4FF', type: ShadingType.CLEAR, color: 'auto' },
        borders: CELL_BORDERS,
        margins: CELL_MARGINS,
        children: [
          new Paragraph({
            alignment: col.numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
            spacing: { before: 20, after: 20 },
            children: inlineChildren(col.label || col.key, { bold: true, size: fontSize, color: '1D4B8F' }),
          }),
        ],
      }),
    ),
  })

  const dataRows = (rows.length ? rows : [null]).map((row, rIdx) => {
    if (!row) {
      return new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            columnSpan: cols.length,
            width: { size: totalDxa, type: WidthType.DXA },
            borders: CELL_BORDERS,
            margins: CELL_MARGINS,
            children: [new Paragraph({ children: [makeRun('暂无数据记录', { size: fontSize, color: '64748B' })] })],
          }),
        ],
      })
    }
    const fill = rIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF'
    return new TableRow({
      cantSplit: true,
      children: cols.map((col, idx) => {
        const text = formatCell(Object.hasOwn(row, col.key) ? row[col.key] : null, col)
        const lines = safeString(text).split(/\r\n?|\n/)
        return new TableCell({
          width: { size: widths[idx], type: WidthType.DXA },
          shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
          borders: CELL_BORDERS,
          margins: CELL_MARGINS,
          children: (lines.length ? lines : ['']).map(line =>
            new Paragraph({
              alignment: col.numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
              spacing: { before: 15, after: 15 },
              children: inlineChildren(line, { size: fontSize }),
            }),
          ),
        })
      }),
    })
  })

  const out = []
  if (table.title) {
    out.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 80 },
        children: inlineChildren(table.title, { bold: true, size: 22, color: '1D4B8F' }),
      }),
    )
  }
  if (table.description) {
    out.push(
      new Paragraph({
        spacing: { before: 0, after: 80 },
        children: inlineChildren(table.description, { size: 18, color: '64748B' }),
      }),
    )
  }
  out.push(
    new Table({
      width: { size: totalDxa, type: WidthType.DXA },
      columnWidths: widths,
      rows: [headerRow, ...dataRows],
    }),
  )
  return out
}

function buildKpiGrid(cards) {
  if (!cards.length) return []
  const count = Math.min(cards.length, 4)
  const totalDxa = 9600
  const cellW = Math.floor(totalDxa / count)
  const rows = []
  for (let i = 0; i < cards.length; i += count) {
    const slice = cards.slice(i, i + count)
    const cells = slice.map(card =>
      new TableCell({
        width: { size: cellW, type: WidthType.DXA },
        shading: { fill: 'F8FAFC', type: ShadingType.CLEAR, color: 'auto' },
        borders: CELL_BORDERS,
        margins: { top: 100, bottom: 100, left: 140, right: 140 },
        children: [
          new Paragraph({
            spacing: { before: 0, after: 40 },
            children: [makeRun(stripInlineMarkdown(card.label), { size: 17, color: '475569' })],
          }),
          new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [makeRun(stripInlineMarkdown(card.value), { bold: true, size: 22, color: '1D4B8F' })],
          }),
        ],
      }),
    )
    while (cells.length < count) {
      cells.push(
        new TableCell({
          width: { size: cellW, type: WidthType.DXA },
          borders: CELL_BORDERS,
          children: [new Paragraph({ children: [] })],
        }),
      )
    }
    rows.push(new TableRow({ cantSplit: true, children: cells }))
  }
  return [
    new Table({
      width: { size: cellW * count, type: WidthType.DXA },
      columnWidths: Array(count).fill(cellW),
      rows,
    }),
  ]
}

function buildCalloutBox(title, text, tone = 'note') {
  const palettes = {
    bad: { fill: 'FEF2F2', border: 'FECACA', titleColor: 'B42318', textColor: '7F1D1D' },
    good: { fill: 'EAF7F0', border: 'BFE6CF', titleColor: '146C43', textColor: '065F46' },
    note: { fill: 'EDF4FF', border: 'C7DAF7', titleColor: '1D4B8F', textColor: '0F172A' },
  }
  const palette = typeof tone === 'string' && Object.hasOwn(palettes, tone) ? palettes[tone] : palettes.note

  const children = []
  if (title) {
    children.push(
      new Paragraph({
        spacing: { before: 20, after: 40 },
        children: inlineChildren(title, { bold: true, size: 20, color: palette.titleColor }),
      }),
    )
  }
  for (const line of safeString(text).split(/\r\n?|\n/)) {
    children.push(
      new Paragraph({
        spacing: { before: 10, after: 20 },
        children: inlineChildren(line, { size: 19, color: palette.textColor }),
      }),
    )
  }

  return new Table({
    width: { size: 9600, type: WidthType.DXA },
    columnWidths: [9600],
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 9600, type: WidthType.DXA },
            shading: { fill: palette.fill, type: ShadingType.CLEAR, color: 'auto' },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 6, color: palette.border },
              bottom: { style: BorderStyle.SINGLE, size: 6, color: palette.border },
              right: { style: BorderStyle.SINGLE, size: 6, color: palette.border },
              left: { style: BorderStyle.SINGLE, size: 18, color: palette.titleColor },
            },
            margins: { top: 100, bottom: 100, left: 160, right: 140 },
            children,
          }),
        ],
      }),
    ],
  })
}

export async function renderDocx(docInput) {
  const doc = normalizeExportDocument(docInput)
  const children = []
  const renderedTables = new Set()

  // Title banner block
  children.push(
    new Table({
      width: { size: 9600, type: WidthType.DXA },
      columnWidths: [9600],
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: 9600, type: WidthType.DXA },
              shading: { fill: '1D4B8F', type: ShadingType.CLEAR, color: 'auto' },
              borders: {
                top: { style: BorderStyle.NONE, size: 0, color: '1D4B8F' },
                bottom: { style: BorderStyle.NONE, size: 0, color: '1D4B8F' },
                left: { style: BorderStyle.NONE, size: 0, color: '1D4B8F' },
                right: { style: BorderStyle.NONE, size: 0, color: '1D4B8F' },
              },
              margins: { top: 180, bottom: 180, left: 220, right: 220 },
              children: [
                new Paragraph({
                  spacing: { before: 0, after: 60 },
                  children: [makeRun('北极星 Polaris · 择导分析文档', { size: 18, color: 'DCE8FF' })],
                }),
                new Paragraph({
                  spacing: { before: 0, after: 60 },
                  children: [makeRun(stripInlineMarkdown(doc.title), { bold: true, size: 32, color: 'FFFFFF' })],
                }),
                new Paragraph({
                  spacing: { before: 0, after: 0 },
                  children: [makeRun(stripInlineMarkdown(doc.subtitle), { size: 18, color: 'E2E8F0' })],
                }),
                ...(doc.filtersApplied.length
                  ? [
                      new Paragraph({
                        spacing: { before: 60, after: 0 },
                        children: [makeRun(`筛选条件：${doc.filtersApplied.map(f => stripInlineMarkdown(f)).join(' · ')}`, { size: 17, color: 'F8FAFC' })],
                      }),
                    ]
                  : []),
              ],
            }),
          ],
        }),
      ],
    }),
  )

  children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [] }))

  if (doc.summaryCards.length) {
    children.push(...buildKpiGrid(doc.summaryCards))
    children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [] }))
  }

  for (const sec of doc.sections) {
    if (sec.heading) {
      children.push(
        new Paragraph({
          heading: sec.level === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2,
          spacing: { before: 220, after: 100 },
          children: inlineChildren(sec.heading, {
            bold: true,
            size: sec.level === 3 ? 24 : 28,
            color: sec.level === 3 ? '0F172A' : '1D4B8F',
          }),
        }),
      )
    }

    if (sec.badges?.length) {
      const runs = []
      sec.badges.forEach((b, idx) => {
        const color = b.tone === 'bad' ? 'B42318' : b.tone === 'good' ? '146C43' : '1D4B8F'
        if (idx > 0) runs.push(makeRun('  ', { size: 18 }))
        runs.push(makeRun(`[${stripInlineMarkdown(b.label)}]`, { bold: true, size: 18, color }))
      })
      children.push(new Paragraph({ spacing: { before: 40, after: 80 }, children: runs }))
    }

    if (sec.callout) {
      children.push(buildCalloutBox(sec.callout.title, sec.callout.text, sec.callout.tone))
      children.push(new Paragraph({ spacing: { before: 40, after: 40 }, children: [] }))
    }

    if (sec.quote) {
      children.push(buildCalloutBox('学生评价归纳', sec.quote, 'note'))
      children.push(new Paragraph({ spacing: { before: 40, after: 40 }, children: [] }))
    }

    if (sec.kvPairs?.length) {
      const kvTable = {
        columns: [
          { key: 'label', label: '项目', type: 'string' },
          { key: 'value', label: '内容', type: 'string' },
        ],
        rows: sec.kvPairs.map(kv => ({ label: kv.label, value: kv.value })),
      }
      children.push(...buildDocxTable(kvTable))
      children.push(new Paragraph({ spacing: { before: 40, after: 40 }, children: [] }))
    }

    for (const p of sec.paragraphs || []) {
      for (const line of p.split(/\r\n?|\n/)) {
        if (!line.trim()) continue
        children.push(
          new Paragraph({
            spacing: { before: 40, after: 80, line: 320 },
            children: inlineChildren(line, { size: 20 }),
          }),
        )
      }
    }

    for (const b of sec.bullets || []) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { before: 30, after: 50, line: 300 },
          children: inlineChildren(b, { size: 20 }),
        }),
      )
    }

    const secTables = sec.tables?.length ? sec.tables : sec.table ? [sec.table] : []
    for (const tbl of secTables) {
      renderedTables.add(tbl)
      children.push(...buildDocxTable(tbl))
      children.push(new Paragraph({ spacing: { before: 60, after: 60 }, children: [] }))
    }
  }

  const extraTables = doc.tables.filter(t => !renderedTables.has(t))
  if (extraTables.length) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 100 },
        children: [makeRun('数据明细表', { bold: true, size: 28, color: '1D4B8F' })],
      }),
    )
    for (const tbl of extraTables) {
      children.push(...buildDocxTable(tbl))
      children.push(new Paragraph({ spacing: { before: 80, after: 80 }, children: [] }))
    }
  }

  if (doc.sources.length) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 100 },
        children: [makeRun('资料来源', { bold: true, size: 26, color: '1D4B8F' })],
      }),
    )
    for (const src of doc.sources) {
      const meta = [safeString(src.kind), safeString(src.publisher), safeString(src.published_at) || safeString(src.year)].filter(Boolean).join(' · ')
      const cleanSrcTitle = stripInlineMarkdown(src.title)
      const runs = [makeRun(`[${src.number}] `, { bold: true, size: 18, color: '1D4B8F' })]
      if (src.safeUrl) {
        runs.push(
          new ExternalHyperlink({
            link: src.safeUrl,
            children: [makeRun(cleanSrcTitle, { size: 18, color: '1D4B8F', underline: {} })],
          }),
        )
      } else {
        runs.push(makeRun(cleanSrcTitle, { size: 18 }))
      }
      if (meta) runs.push(makeRun(` · ${meta}`, { size: 17, color: '64748B' }))
      children.push(
        new Paragraph({
          spacing: { before: 20, after: 40 },
          children: runs,
        }),
      )
    }
  }

  const document = new Document({
    creator: '北极星 Polaris',
    title: stripInlineMarkdown(doc.title),
    description: stripInlineMarkdown(doc.subtitle),
    styles: {
      default: {
        document: {
          run: {
            font: CJK_FONT,
            size: 20,
            color: '0F172A',
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [makeRun(`北极星 Polaris · ${stripInlineMarkdown(doc.title)}`, { size: 16, color: '64748B' })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    font: CJK_FONT,
                    size: 16,
                    color: '64748B',
                    children: ['北极星 Polaris  ·  第 ', PageNumber.CURRENT, ' 页 / 共 ', PageNumber.TOTAL_PAGES, ' 页'],
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })

  const buffer = await Packer.toBuffer(document)
  return Buffer.from(buffer)
}

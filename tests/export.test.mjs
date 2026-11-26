import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import readXlsxFile, { readSheet } from 'read-excel-file/node'
import { loadData } from '../lib/data.js'
import {
  EXPORT_FORMATS,
  PRESET_META,
  buildArtifactDocument,
  buildChatDocument,
  buildComparisonDocument,
  buildCustomDocument,
  buildDossierDocument,
  buildFromMentors,
  buildInsights,
  exportDocument,
  findBrowserExecutable,
  findSystemCjkFont,
  formatCell,
  normalizeExportDocument,
  radarSvg,
  renderCsv,
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
} from '../lib/export/index.js'
import { parseInlineMarkdown, stripInlineMarkdown } from '../lib/export/model.js'
import { publicText } from '../lib/presentation.js'
import { defaultComparisonFields, mentorComparisonFields } from '../lib/fields.js'
import { matchScore } from '../lib/match.js'
import { reportAnalysis } from '../server/report-analysis.js'
import { createWorkbench } from '../server/workbench.js'
import { createStore } from '../server/store.js'

const requireFromDocx = createRequire(import.meta.resolve('docx'))
const { unzipSync } = requireFromDocx('fflate')

const data = loadData()
const allInsights = buildInsights(data)

function assertNoInternalLeak(text) {
  assert.doesNotMatch(text, /\b(?:mentor|review|student|exam|profile|candidate)-[a-f0-9]{12}\b/i)
  assert.doesNotMatch(text, /\b(?:mentor_id|review_id|student_id|exam_id|profile_id|candidate_id|source_locator|source_location|original_sha256|sha256)\b/i)
}

async function withTmpDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-export-test-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

test('model.js: 文件名与工作表名清洗、截断及去重正确，内部字段与 ID 被彻底剥离', () => {
  assert.equal(sanitizeFilename('  导师/对比:报告*2026?.xlsx  '), '导师 对比 报告 2026 .xlsx'.trim())
  assert.equal(sanitizeFilename('   '), '北极星导出')

  const used = new Set()
  const longName = '这是一个非常长的工作表名称超过了三十一个字符限制测试[1]/2:3*4?5'
  const s1 = sanitizeSheetName(longName, used)
  const s2 = sanitizeSheetName(longName, used)
  assert.ok(s1.length <= 31)
  assert.ok(s2.length <= 31)
  assert.notEqual(s1, s2)
  assert.doesNotMatch(s1, /[\\/*?:[\]]/)

  const doc = normalizeExportDocument({
    title: '测试剥离',
    tables: [
      {
        sheetName: '测试表',
        columns: [
          { key: 'mentor_id', label: '导师 ID', type: 'string' },
          { key: 'review_id', label: '评价 ID', type: 'string' },
          { key: 'student_id', label: '学生 ID', type: 'string' },
          { key: 'source_locator', label: '原文定位', type: 'string' },
          { key: 'sha256', label: 'SHA256', type: 'string' },
          { key: 'candidate_id', label: '候选记录 ID', type: 'string' },
          { key: 'name', label: '导师', type: 'string' },
          { key: 'rating', label: '培养体验评分 / 5', type: 'number' },
        ],
        rows: [
          {
            mentor_id: 'mentor-1234567890ab',
            review_id: 'review-1234567890ab',
            student_id: 'student-1234567890ab',
            source_locator: '导师评价.md:L10',
            sha256: 'deadbeef',
            candidate_id: 'candidate-1234567890ab',
            name: '付俊松',
            rating: 5,
          },
        ],
      },
    ],
  })

  const colKeys = doc.tables[0].columns.map(c => c.key)
  assert.deepEqual(colKeys, ['name', 'rating'])
  assert.equal(doc.tables[0].columns[1].numeric, true)
  const serialized = JSON.stringify(doc)
  assertNoInternalLeak(serialized)
})

test('model.js: radarSvg 生成独立内联 SVG 且包含六维标签', () => {
  const sample = allInsights.list.find(m => m.fingerprint?.reputation && m.fingerprint?.research)
  assert.ok(sample)
  const svg = radarSvg([{ name: sample.name, fingerprint: sample.fingerprint }], { size: 220 })
  assert.match(svg, /^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.ok(svg.includes('学生口碑'))
  assert.ok(svg.includes('科研强度'))
  assert.ok(svg.includes('<polygon'))
  assert.ok(svg.includes('font-family='))
})

test('builders.js: buildInsights 与全部 PRESET_META 预设筛选准确一致', () => {
  assert.ok(allInsights.count >= 400)
  for (const preset of Object.keys(PRESET_META)) {
    const resolved = resolvePresetFilter(preset, { allMentors: allInsights.list })
    assert.equal(resolved.id, preset)
    assert.ok(resolved.title.length > 0)
    if (preset === 'five_star') {
      assert.ok(resolved.mentors.length > 0)
      assert.ok(resolved.mentors.every(m => m.rating === 5))
    } else if (preset === 'zero_risk') {
      assert.ok(resolved.mentors.length > 0)
      assert.ok(resolved.mentors.every(m => !m.flags.some(f => f.tone === 'bad')))
    } else if (preset === 'internship_no_clock') {
      assert.ok(resolved.mentors.length > 0)
      assert.ok(resolved.mentors.every(m =>
        m.flags.some(f => f.id === 'internship_ok' && !f.conditional) &&
        m.flags.some(f => f.id === 'no_clock'),
      ))
    } else if (preset === 'doctoral') {
      assert.ok(resolved.mentors.length > 0)
      assert.ok(resolved.mentors.every(m => m.doctoral))
    } else if (preset === 'library' || preset === 'comparison') {
      assert.equal(resolved.mentors.length, 0)
    } else if (preset === 'all') {
      assert.equal(resolved.mentors.length, allInsights.count)
    }
  }
  assert.throws(() => resolvePresetFilter('unknown_preset'), /不支持/)
})

test('builders.js: 全部 6 个 Builder 正确生成规范化 ExportDocument 并保留备注、对比雷达与来源', async () => withTmpDir(async dir => {
  const store = createStore(dir)
  const board = createWorkbench({ store, data })
  const dirRows = board.directory('', '', 0, 'rating').rows.slice(0, 3)
  board.addItems(dirRows)
  board.updateItem(dirRows[0].key, { note: '重点跟进的老师', status: 'priority' })
  board.setComparison(dirRows)
  board.addSnapshot('第一轮方案', '优先联系评分高的导师')

  const snap = board.snapshot()
  const profile = { goal: 'career', musts: ['internship', 'no_clock'], colleges: [], stage: 'master', interests: '' }

  // 1. buildFromMentors
  const mentorsDoc = buildFromMentors({
    rows: dirRows,
    insights: allInsights,
    title: '5星导师精选',
    filtersApplied: ['评分 = 5'],
    workspaceItems: snap.items,
    profile,
    matchFn: matchScore,
  })
  assert.equal(mentorsDoc.kind, 'mentors')
  assert.ok(mentorsDoc.tables.length >= 2)
  assert.ok(mentorsDoc.tables[0].rows.some(r => r.note === '重点跟进的老师'))
  assert.ok(mentorsDoc.tables[0].columns.some(c => c.key === 'match_score'))
  assertNoInternalLeak(JSON.stringify(mentorsDoc))

  // 2. buildComparisonDocument
  const compDoc = buildComparisonDocument({
    rows: snap.comparison,
    insights: allInsights,
    fields: defaultComparisonFields,
    goal: '就业实习',
    snapshots: snap.snapshots,
    conclusion: '优先选择不打卡且允许实习的导师',
  })
  assert.equal(compDoc.kind, 'comparison')
  assert.ok(compDoc.sections.some(s => s.radarSvg))
  assert.ok(compDoc.charts.length >= 1)
  assert.ok(compDoc.tables.some(t => t.sheetName === '对比矩阵'))
  assertNoInternalLeak(JSON.stringify(compDoc))

  // 3. buildDossierDocument
  const target = allInsights.byKey.get(dirRows[0].key)
  const detail = board.detail(dirRows[0].key)
  const dossierDoc = buildDossierDocument({
    insight: target,
    detail,
    match: matchScore(target, profile),
    fieldOptions: mentorComparisonFields,
    savedItem: snap.items[0],
  })
  assert.equal(dossierDoc.kind, 'dossier')
  assert.ok(dossierDoc.title.includes(target.name))
  assert.ok(dossierDoc.tables.length >= 2)
  assert.ok(dossierDoc.sources.length > 0)
  assertNoInternalLeak(JSON.stringify(dossierDoc))

  // 4. buildArtifactDocument
  const artifactDoc = buildArtifactDocument({
    artifacts: [
      {
        id: 'art-1',
        type: 'table',
        purpose: 'recommendation',
        title: '推荐导师表',
        columns: [
          { key: 'mentor_id', label: '导师 ID', type: 'string' },
          { key: 'name', label: '导师', type: 'string' },
          { key: 'college', label: '学院', type: 'string' },
          { key: 'rating', label: '培养体验评分 / 5', type: 'number' },
        ],
        rows: dirRows.map(r => ({ mentor_id: r.key, name: r.name, college: r.college, rating: r.rating })),
        row_notes: ['口碑极佳', '资源丰富', '时间自由'],
        sources: detail.sources,
      },
    ],
  })
  assert.equal(artifactDoc.kind, 'table')
  assert.ok(artifactDoc.tables[0].columns.some(c => c.key === '推荐序'))
  assert.ok(artifactDoc.tables[0].columns.some(c => c.key === 'assistant_note'))
  assertNoInternalLeak(JSON.stringify(artifactDoc))

  // 5. buildChatDocument
  const chat = {
    id: 'chat-1',
    title: '大模型导师咨询',
    messages: [
      { id: 'u1', role: 'user', content: '推荐计算机学院评分高的导师', createdAt: new Date().toISOString() },
      {
        id: 'a1',
        role: 'assistant',
        status: 'complete',
        content: '以下导师表现突出：\n\n- **评价扎实**：口碑良好 [S1]',
        artifacts: [
          {
            id: 't1',
            type: 'table',
            title: '候选名单',
            columns: [
              { key: 'name', label: '导师', type: 'string' },
              { key: 'rating', label: '评分', type: 'number' },
            ],
            rows: [{ name: dirRows[0].name, rating: dirRows[0].rating }],
            sources: detail.sources.slice(0, 1),
          },
        ],
        sources: detail.sources.slice(0, 1),
      },
    ],
  }
  const chatDoc = buildChatDocument({ chat })
  assert.equal(chatDoc.kind, 'chat')
  assert.ok(chatDoc.tables.length >= 2)
  const singleMsgDoc = buildChatDocument({ chat, messageId: 'a1' })
  assert.equal(singleMsgDoc.tables[0].rows.length, 2) // preceding user + target assistant
  assertNoInternalLeak(JSON.stringify(chatDoc))

  // 6. buildCustomDocument
  const customDoc = buildCustomDocument({
    title: '套磁分析与邮件建议',
    content: '## 推荐理由\n\n建议优先联系**付俊松**老师。\n\n- 研究方向契合\n- 允许实习\n\n| 导师 | 评分 |\n|---|---|\n| 付俊松 | 5 |',
    sources: detail.sources.slice(0, 1),
  })
  assert.equal(customDoc.kind, 'document')
  assert.ok(customDoc.sections.length >= 1)
  assert.equal(customDoc.tables.length, 1)
  assert.equal(customDoc.tables[0].rows[0].col_1, 5)
}))

test('excel.js: 生成标准 .xlsx 并通过 read-excel-file 与 ExcelJS 双向回读验证中文、数值、冻结表头与公式注入防护', async () => withTmpDir(async dir => {
  const sampleMentors = allInsights.list.filter(m => m.rating != null).slice(0, 5)
  const doc = buildFromMentors({
    rows: [
      ...sampleMentors,
      {
        name: '公式注入测试',
        college: '计算机学院',
        rating: 4,
        can_supervise_doctoral: true,
        stipend_text: '=1+1',
        management: '  +SUM(A1:A2)',
        internship: '@cmd',
        graduation: '-2+3',
        student_count: 12,
      },
    ],
    insights: allInsights,
    title: '工作表超长名称测试_一二三四五六七八九十甲乙丙丁戊己庚辛',
    sources: [
      { id: 'S1', title: '北邮导师评价汇总', kind: '学生评价', year: 2026, url: 'https://www.bupt.edu.cn/test' },
    ],
  })

  const buf = await renderExcel(doc)
  assert.ok(Buffer.isBuffer(buf))
  assert.equal(buf.subarray(0, 4).toString('hex'), '504b0304') // PK\x03\x04

  const xlsxPath = path.join(dir, 'test-mentors.xlsx')
  await fs.writeFile(xlsxPath, buf)

  // Verify via ExcelJS
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  assert.ok(wb.worksheets.length >= 3) // 导师清单 + 六维画像分值 + 资料来源
  for (const ws of wb.worksheets) {
    assert.ok(ws.name.length <= 31)
  }
  const sheet1 = wb.worksheets[0]
  assert.equal(sheet1.views[0]?.state, 'frozen')
  assert.equal(sheet1.views[0]?.ySplit, 3)
  assert.ok(sheet1.autoFilter)

  // Verify numeric cell type preserved
  const headerRow = sheet1.getRow(3)
  const ratingColIdx = headerRow.values.findIndex(v => String(v || '').includes('评分'))
  assert.ok(ratingColIdx > 0)
  const firstDataRating = sheet1.getRow(4).getCell(ratingColIdx).value
  assert.equal(typeof firstDataRating, 'number')

  // Verify via read-excel-file/node (both file path & Buffer)
  const sheets = await readXlsxFile(xlsxPath)
  assert.ok(sheets.length >= 3)
  const rows1 = await readSheet(buf, sheet1.name)
  const flatText = rows1.flat().map(v => String(v ?? '')).join('\n')
  assert.ok(flatText.includes(sampleMentors[0].name))
  assert.ok(flatText.includes("'=1+1"))
  assert.ok(flatText.includes("'  +SUM(A1:A2)"))
  assert.ok(flatText.includes("'@cmd"))
  assert.ok(flatText.includes("'-2+3"))

  const srcSheet = wb.getWorksheet('资料来源')
  assert.ok(srcSheet)
  assertNoInternalLeak(flatText)
}))

test('docx.js: 生成标准 .docx 并解压 word/document.xml 验证中文、表格与无残留 Markdown 星号', async () => {
  const sample = allInsights.list.find(m => m.flags.length > 0 && m.rating != null)
  const dossierDoc = buildDossierDocument({
    insight: sample,
    savedItem: { status: 'priority', contact_status: '重点联系', note: '已发**套磁信**，等待回复' },
  })
  const customDoc = buildCustomDocument({
    title: '套磁建议与分析',
    content: '## 重点建议\n\n请优先联系**' + sample.name + '**老师（*计算机学院*）。\n\n- 突出项目经历\n- 附上成绩单',
  })

  for (const doc of [dossierDoc, customDoc]) {
    const buf = await renderDocx(doc)
    assert.ok(Buffer.isBuffer(buf))
    assert.equal(buf.subarray(0, 4).toString('hex'), '504b0304')

    const files = unzipSync(new Uint8Array(buf))
    assert.ok(files['word/document.xml'])
    const xml = Buffer.from(files['word/document.xml']).toString('utf8')
    assert.ok(xml.includes(sample.name))
    assert.ok(xml.includes('Microsoft YaHei'))
    assert.doesNotMatch(xml, /\*\*[^*]+\*\*/) // zero raw ** markers!
    assertNoInternalLeak(xml)
  }
  const dossierBuf = await renderDocx(dossierDoc)
  const dossierXml = Buffer.from(unzipSync(new Uint8Array(dossierBuf))['word/document.xml']).toString('utf8')
  assert.ok(dossierXml.includes('<w:tbl>'))
  assert.ok(dossierXml.includes('<w:tblHeader/>'))
})

test('pdf.js: pdfkit 引擎、全局 Electron 钩子与 Browser Print-to-PDF 均生成有效 PDF', async () => {
  const sample = allInsights.list.filter(m => m.rating != null).slice(0, 4)
  const compDoc = buildComparisonDocument({
    rows: sample,
    insights: allInsights,
    fields: defaultComparisonFields,
    goal: '科研深造',
    conclusion: '优先选择指导认真、方向匹配的导师。',
  })

  // 1. Direct pdfkit engine
  const fontPath = findSystemCjkFont()
  if (process.platform === 'darwin' || process.platform === 'win32') {
    assert.ok(fontPath, 'macOS / Windows 应能探测到系统 CJK 字体')
    if (fontPath.endsWith('.ttc')) {
      const face = resolveFontFace(fontPath)
      assert.ok(face && !face.startsWith('.'), 'TTC 字体应解析出有效子字体名称')
    }
  }
  const kitPdf = await renderPdf(compDoc, { engine: 'pdfkit' })
  assert.ok(Buffer.isBuffer(kitPdf))
  assert.match(kitPdf.subarray(0, 16).toString('ascii'), /^%PDF-1\./)
  assert.ok(kitPdf.subarray(-64).toString('ascii').includes('%%EOF'))
  assert.ok(kitPdf.length > 2048)
  if (fontPath) {
    assert.ok(kitPdf.includes(Buffer.from('/FontDescriptor')))
  }

  // 2. Global Electron print hook
  const prevHook = globalThis.__polarisPrintHtmlToPdf
  try {
    let hookCalled = false
    globalThis.__polarisPrintHtmlToPdf = async html => {
      hookCalled = true
      assert.ok(html.includes(sample[0].name))
      return Buffer.from('%PDF-1.4\n%hook-test\n%%EOF\n')
    }
    const hookedPdf = await renderPdf(compDoc, { engine: 'auto' })
    assert.equal(hookCalled, true)
    assert.ok(hookedPdf.toString('ascii').includes('%hook-test'))
  } finally {
    if (prevHook === undefined) delete globalThis.__polarisPrintHtmlToPdf
    else globalThis.__polarisPrintHtmlToPdf = prevHook
  }

  // 3. Browser print-to-pdf (when Chrome/Edge/Playwright Chromium available)
  const browserExe = findBrowserExecutable()
  if (browserExe) {
    const browserPdf = await renderPdf(compDoc, { engine: 'browser' })
    assert.ok(Buffer.isBuffer(browserPdf))
    assert.match(browserPdf.subarray(0, 16).toString('ascii'), /^%PDF-1\./)
    assert.ok(browserPdf.subarray(-64).toString('ascii').includes('%%EOF'))
    assert.ok(browserPdf.length > 4096)
  }
})

test('html.js / markdown.js / csv / index.js: XSS 转义、BOM 防护与统一 exportDocument 接口正常', async () => {
  const doc = buildCustomDocument({
    title: '安全导出<script>alert(1)</script>报告',
    content: '正文包含 <script>evil()</script> 与 `=1+1` 测试。\n\n| 导师 | 备注 |\n|---|---|\n| 张三 | =CMD() |\n| 李四 | 口碑很好 |',
    sources: [{ id: 'S1', title: '官网资料', kind: '学校官网', url: 'https://www.bupt.edu.cn/' }],
  })

  const html = renderHtml(doc)
  assert.doesNotMatch(html, /<script>/i)
  assert.ok(html.includes('&lt;script&gt;'))
  assert.doesNotMatch(html, /fonts\.googleapis\.com/i)
  assert.ok(html.includes('@page{size:A4'))

  const md = renderMarkdown(doc)
  assert.ok(md.includes('# 安全导出'))
  assert.ok(md.includes('## 资料来源'))
  assert.ok(md.includes('[1] [官网资料](https://www.bupt.edu.cn/)'))

  const csv = renderCsv(doc)
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes("'=CMD()"))

  for (const fmt of EXPORT_FORMATS) {
    const opts = fmt === 'pdf' ? { engine: 'pdfkit' } : {}
    const res = await exportDocument(doc, fmt, opts)
    assert.equal(res.extension, fmt)
    assert.ok(res.filename.endsWith(`.${fmt}`))
    assert.ok(res.type.length > 0)
    assert.ok(res.body.length > 0)
    assert.equal(res.binary, ['xlsx', 'pdf', 'docx'].includes(fmt))
  }

  await assert.rejects(() => exportDocument(doc, 'pptx'), /不支持的导出格式/)
})

test('回归测试 [Defect 1 & Minor 2]: 彻底剥离 profile-<12hex>/profile_id/candidate_id/sha256 并格式化 dossier 学科分隔符', async () => {
  const polluted = {
    name: '测试导师 profile-1234567890ab',
    college: '计算机学院',
    rating: 5,
    mentor_id: 'mentor-1234567890ab',
    profile_id: 'profile-abcdef123456',
    candidate_id: 'candidate-112233445566',
    sha256: 'deadbeef1234',
    original_sha256: 'cafebabe5678',
    doctoral_evidence: '指导学科：指导学博学科: 081200|计算机科学与技术',
    academic_summary: '教授；主持国家级大模型科研项目',
    professional_title: '教授',
  }

  // 1. buildComparisonDocument with internal fields requested
  const compDoc = buildComparisonDocument({
    rows: [polluted],
    fields: ['rating', 'mentor_id', 'profile_id', 'candidate_id', 'sha256', 'original_sha256', 'source_locator', 'doctoral_evidence'],
  })
  assertNoInternalLeak(JSON.stringify(compDoc))
  assert.ok(!compDoc.tables[0].columns.some(c => ['mentor_id', 'profile_id', 'candidate_id', 'sha256', 'original_sha256', 'source_locator'].includes(c.key)))
  assertNoInternalLeak(renderMarkdown(compDoc))
  assertNoInternalLeak(renderHtml(compDoc))

  // 2. buildDossierDocument with string & object fieldOptions + raw | pipe text
  const dossierDoc = buildDossierDocument({
    detail: polluted,
    fieldOptions: [
      { key: 'rating', label: '评分' },
      { key: 'profile_id', label: '档案ID' },
      'mentor_id',
      'candidate_id',
      'sha256',
      'original_sha256',
      'doctoral_evidence',
      'academic_summary',
    ],
  })
  assertNoInternalLeak(JSON.stringify(dossierDoc))
  const overviewRows = dossierDoc.tables[0].rows
  const docRow = overviewRows.find(r => r.field === '博士指导依据')
  assert.ok(docRow)
  assert.ok(!String(docRow.value).includes('|'))
  assert.ok(String(docRow.value).includes('学术博士：081200 · 计算机科学与技术'))
  const acadRow = overviewRows.find(r => r.field === '学术与项目概览')
  assert.ok(acadRow)
  assert.equal(acadRow.value, '主持国家级大模型科研项目')

  // 3. buildChatDocument & buildCustomDocument with profile-<12hex> and sha256 across all 6 formats
  const chatDoc = buildChatDocument({
    chat: {
      id: 'c-leak',
      title: '排查 profile-1234567890ab 与 sha256',
      messages: [
        { id: 'u1', role: 'user', content: '查询 profile_id 和 candidate-112233445566' },
        {
          id: 'a1',
          role: 'assistant',
          status: 'complete',
          content: '记录 profile-1234567890ab 与 original_sha256 已脱敏。',
          artifacts: [
            {
              id: 'art-leak',
              type: 'table',
              title: '表 profile-abcdef123456',
              columns: [
                { key: 'profile_id', label: 'profile_id', type: 'string' },
                { key: 'name', label: '导师', type: 'string' },
                { key: 'note', label: '说明', type: 'string' },
              ],
              rows: [{ profile_id: 'profile-1234567890ab', name: '张三', note: '关联 profile-abcdef123456 与 candidate_id' }],
            },
          ],
        },
      ],
    },
  })
  const customDoc = buildCustomDocument({
    title: '自定义 profile-1234567890ab 报告',
    content: '正文包含 profile-1234567890ab、profile_id、candidate_id、sha256、original_sha256。',
    sources: [{ id: 'S1', title: '来源 profile-1234567890ab', kind: 'sha256' }],
  })

  for (const doc of [chatDoc, customDoc]) {
    for (const fmt of EXPORT_FORMATS) {
      const opts = fmt === 'pdf'
        ? { engine: 'pdfkit', filename: 'profile-1234567890ab-out' }
        : { filename: 'profile-1234567890ab-out' }
      const res = await exportDocument(doc, fmt, opts)
      assertNoInternalLeak(res.filename)
      if (fmt === 'xlsx') {
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(res.body)
        for (const ws of wb.worksheets) {
          assertNoInternalLeak(ws.name)
          const rows = await readSheet(res.body, ws.name)
          assertNoInternalLeak(rows.flat().map(v => String(v ?? '')).join('\n'))
        }
      } else if (fmt === 'docx') {
        const xml = Buffer.from(unzipSync(new Uint8Array(res.body))['word/document.xml']).toString('utf8')
        assertNoInternalLeak(xml)
      } else if (fmt !== 'pdf') {
        assertNoInternalLeak(String(res.body))
      } else {
        assert.match(res.body.subarray(0, 16).toString('ascii'), /^%PDF-1\./)
      }
    }
  }
})

test('回归测试 [Defect 2]: sanitizeSheetName 引号/History/空值清洗与 Excel 横幅/副标题/概览/来源公式注入防护', async () => {
  const used = new Set()
  assert.equal(sanitizeSheetName("'quoted'", used), 'quoted')
  assert.equal(sanitizeSheetName("a'", used), 'a')
  assert.equal(sanitizeSheetName("'a", used), 'a_2')
  assert.equal(sanitizeSheetName("'''", used), '数据表')
  assert.equal(sanitizeSheetName('History', used), 'History_')
  assert.equal(sanitizeSheetName('history', used), 'History__2')
  assert.equal(sanitizeSheetName("'History'", used), 'History__3')
  const sLongQuote = sanitizeSheetName(`'${'甲'.repeat(30)}'乙`, used)
  assert.ok(sLongQuote.length <= 31)
  assert.ok(!sLongQuote.startsWith("'") && !sLongQuote.endsWith("'"))

  const formulaDoc = {
    title: '=1+1',
    subtitle: '+SUM(1,1)',
    filtersApplied: ['-CMD()'],
    tables: [
      { sheetName: "'quoted'", title: '=HYPERLINK("http://evil","click")', columns: [{ key: 'name', label: '导师', type: 'string' }], rows: [{ name: '张三' }] },
      { sheetName: "a'", columns: [{ key: 'name', label: '导师', type: 'string' }], rows: [{ name: '李四' }] },
      { sheetName: 'History', columns: [{ key: 'name', label: '导师', type: 'string' }], rows: [{ name: '王五' }] },
      { sheetName: "'''", columns: [{ key: 'name', label: '导师', type: 'string' }], rows: [{ name: '赵六' }] },
    ],
    sources: [
      { id: 'S1', title: '@evil', kind: '=1+1', publisher: '-2+3', year: 2026 },
    ],
  }
  const buf = await renderExcel(formulaDoc)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  assert.equal(wb.worksheets.length, 5)
  for (const ws of wb.worksheets) {
    assert.ok(ws.name.length > 0 && ws.name.length <= 31)
    assert.ok(!ws.name.startsWith("'") && !ws.name.endsWith("'"))
    assert.notEqual(ws.name.toLowerCase(), 'history')
  }
  const sheet1 = wb.worksheets[0]
  assert.equal(sheet1.getRow(1).getCell(1).value, '\'=HYPERLINK("http://evil","click")')
  assert.ok(String(sheet1.getRow(2).getCell(1).value).startsWith("'+SUM(1,1)"))

  const srcSheet = wb.getWorksheet('资料来源')
  assert.ok(srcSheet)
  assert.equal(srcSheet.getRow(1).getCell(1).value, "'=1+1 · 资料来源")
  assert.equal(srcSheet.getRow(3).getCell(2).value, "'@evil")
  assert.equal(srcSheet.getRow(3).getCell(3).value, "'=1+1")

  // Synthesized 内容概览 table when no tables present
  const noTableBuf = await renderExcel({
    title: '=BANNER()',
    subtitle: '@SUB()',
    sections: [{ heading: '=H1', paragraphs: ['+P1'], bullets: ['-B1'], kvPairs: [{ label: 'k', value: '=V1' }] }],
  })
  const wb2 = new ExcelJS.Workbook()
  await wb2.xlsx.load(noTableBuf)
  const sumSheet = wb2.getWorksheet('内容概览')
  assert.ok(sumSheet)
  assert.equal(sumSheet.getRow(1).getCell(1).value, "'=BANNER()")
  assert.equal(sumSheet.getRow(2).getCell(1).value, "'@SUB()")
  const rows2 = await readSheet(noTableBuf, '内容概览')
  const flat2 = rows2.flat().map(v => String(v ?? ''))
  assert.ok(flat2.some(v => v === "'+P1"))
  assert.ok(flat2.some(v => v === "'-B1"))
  assert.ok(flat2.some(v => v === "'=V1"))
})

test('回归测试 [Defect 3]: DOCX / HTML / PDF 标题与表格单元格行内 Markdown 渲染无裸 ** / * / [label](url) 残留', async () => {
  const customDoc = buildCustomDocument({
    title: '**总标题**',
    content: [
      '## **粗体标题** 与 *斜体标题*',
      '',
      '| **导师姓名** | *综合评价* | 链接 |',
      '|---|---|---|',
      '| **张三** | *优秀* 且 `积极` | [官网主页](https://example.com/prof) |',
    ].join('\n'),
  })

  const docxBuf = await renderDocx(customDoc)
  const xml = Buffer.from(unzipSync(new Uint8Array(docxBuf))['word/document.xml']).toString('utf8')
  assert.ok(xml.includes('粗体标题'))
  assert.ok(xml.includes('张三'))
  assert.ok(xml.includes('优秀'))
  assert.ok(xml.includes('积极'))
  assert.ok(xml.includes('官网主页'))
  assert.doesNotMatch(xml, /\*\*|\*斜体|\*优秀|`积极`|\[官网主页\]\(https:/)

  const html = renderHtml(customDoc)
  assert.ok(html.includes('<strong>粗体标题</strong>'))
  assert.ok(html.includes('<strong>张三</strong>'))
  assert.ok(html.includes('<em>优秀</em>'))
  assert.ok(html.includes('<code>积极</code>'))
  assert.ok(html.includes('<a href="https://example.com/prof"'))
  assert.doesNotMatch(html, /\*\*张三\*\*|\*优秀\*|\[官网主页\]\(/)

  const pdfBuf = await renderPdf(customDoc, { engine: 'pdfkit' })
  assert.match(pdfBuf.subarray(0, 16).toString('ascii'), /^%PDF-1\./)
})

test('回归测试 [Defect 4 & Minor 1/3/4]: 同签名多表不丢表、无重复渲染、短横线金额不 NaN、同名胜出归属准确、Preset Scope 隔离', async () => {
  // 1. Two identical-header/row-count Markdown tables under one heading
  const dualTableDoc = buildCustomDocument({
    title: '同签名双表测试',
    content: [
      '## 分组榜单',
      '',
      '| 导师 | 分数 |',
      '|---|---|',
      '| 甲导师独特行 | 10 |',
      '',
      '| 导师 | 分数 |',
      '|---|---|',
      '| 乙导师独特行 | 20 |',
    ].join('\n'),
  })
  assert.equal(dualTableDoc.tables.length, 2)
  assert.equal(dualTableDoc.sections[0].tables.length, 2)
  for (const out of [
    renderMarkdown(dualTableDoc),
    renderHtml(dualTableDoc),
    (await exportDocument(dualTableDoc, 'md')).body,
    (await exportDocument(dualTableDoc, 'html')).body,
    Buffer.from(unzipSync(new Uint8Array((await exportDocument(dualTableDoc, 'docx')).body))['word/document.xml']).toString('utf8'),
  ]) {
    assert.equal(out.split('甲导师独特行').length - 1, 1)
    assert.equal(out.split('乙导师独特行').length - 1, 1)
  }
  const dualXlsx = await renderExcel(dualTableDoc)
  const dualWb = new ExcelJS.Workbook()
  await dualWb.xlsx.load(dualXlsx)
  assert.equal(dualWb.worksheets.length, 2)
  const dualPdf = await renderPdf(dualTableDoc, { engine: 'pdfkit' })
  assert.match(dualPdf.subarray(0, 16).toString('ascii'), /^%PDF-1\./)

  // 2. Untitled artifact in buildChatDocument renders exactly once across repeated normalize/export
  const untitledChatDoc = buildChatDocument({
    chat: {
      id: 'c-untitled',
      title: '无标题附件表去重',
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          status: 'complete',
          content: '请查看附带数据表。',
          artifacts: [
            {
              id: 'art-empty-title',
              type: 'table',
              title: '',
              columns: [{ key: 'name', label: '导师', type: 'string' }],
              rows: [{ name: '独特行甲无标题' }],
            },
          ],
        },
      ],
    },
  })
  for (const out of [
    renderMarkdown(untitledChatDoc),
    renderHtml(untitledChatDoc),
    (await exportDocument(untitledChatDoc, 'md')).body,
    (await exportDocument(untitledChatDoc, 'html')).body,
    Buffer.from(unzipSync(new Uint8Array(await renderDocx(untitledChatDoc)))['word/document.xml']).toString('utf8'),
  ]) {
    assert.equal(out.split('独特行甲无标题').length - 1, 1)
  }

  // 3. Hyphenated money "1000-2000" / "1,000-2,000" / "面议" never produces NaN across all 6 formats
  const moneyDoc = normalizeExportDocument({
    title: '补助格式边界测试',
    tables: [
      {
        sheetName: '补助表',
        columns: [
          { key: 'name', label: '导师', type: 'string' },
          { key: 'stipend', label: '月补助', type: 'money' },
        ],
        rows: [
          { name: '老师A', stipend: '1000-2000' },
          { name: '老师B', stipend: '1,000-2,500' },
          { name: '老师C', stipend: '面议' },
          { name: '老师D', stipend: 1500 },
        ],
      },
    ],
  })
  for (const fmt of EXPORT_FORMATS) {
    const res = await exportDocument(moneyDoc, fmt, fmt === 'pdf' ? { engine: 'pdfkit' } : {})
    if (!res.binary) {
      assert.ok(!/\bNaN\b/.test(res.body), `${fmt} 不应包含 NaN`)
      assert.ok(res.body.includes('1,000–2,000'))
      assert.ok(res.body.includes('1,000–2,500'))
      assert.ok(res.body.includes('面议'))
    } else if (fmt === 'xlsx') {
      const txt = (await readSheet(res.body, '补助表')).flat().map(v => String(v ?? '')).join('\n')
      assert.ok(!/\bNaN\b/.test(txt))
      assert.ok(txt.includes('1,000–2,000'))
      assert.ok(txt.includes('1,000–2,500'))
      assert.ok(txt.includes('面议'))
    } else if (fmt === 'docx') {
      const xml = Buffer.from(unzipSync(new Uint8Array(res.body))['word/document.xml']).toString('utf8')
      assert.ok(!/\bNaN\b/.test(xml))
      assert.ok(xml.includes('1,000–2,000'))
      assert.ok(xml.includes('1,000–2,500'))
      assert.ok(xml.includes('面议'))
    } else if (fmt === 'pdf') {
      assert.match(res.body.subarray(0, 16).toString('ascii'), /^%PDF-1\./)
    }
  }

  // 4. Same-name winner collision in buildComparisonDocument
  const sameNameComp = buildComparisonDocument({
    rows: [
      {
        name: '王伟',
        college: '计算机学院',
        rating: 5,
        fingerprint: { reputation: { value: 5, evidence: ['口碑极佳'] } },
        flags: [],
      },
      {
        name: '王伟',
        college: '信通学院',
        rating: 2,
        fingerprint: { reputation: { value: 2, evidence: ['评价一般'] } },
        flags: [],
      },
    ],
  })
  const compMatrix = sameNameComp.tables.find(t => t.sheetName === '对比矩阵')
  assert.ok(compMatrix)
  const csRow = compMatrix.rows.find(r => r.college === '计算机学院')
  const isRow = compMatrix.rows.find(r => r.college === '信通学院')
  assert.equal(csRow.won_axes, '学生口碑(5)')
  assert.equal(isRow.won_axes, '—')

  // 5. resolvePresetFilter returns empty mentors for non-mentor scopes
  assert.deepEqual(resolvePresetFilter('library', { allMentors: allInsights.list }).mentors, [])
  assert.deepEqual(resolvePresetFilter('comparison', { allMentors: allInsights.list }).mentors, [])
})

test('回归测试 [Defect 5]: normalizeExportDocument 与 renderHtml 净化直接传入的 SVG XSS 载荷', () => {
  const maliciousSvg = '<svg onload="alert(1)"onclick="alert(2)"><scr<script></script>ipt>alert(1)</scr<script></script>ipt><foreignObject><div>xss</div></foreignObject><animate onbegin="alert(1)"/><a xlink:href="javascript:alert(1)"><circle cx="10" cy="10" r="5"/></a></svg>'
  const doc = normalizeExportDocument({
    title: 'SVG XSS 防护测试',
    sections: [
      {
        heading: '雷达图',
        radarSvg: maliciousSvg,
      },
    ],
    charts: [
      { title: '分布图', svg: maliciousSvg },
      { title: '非SVG载荷', svg: '<img src=x onerror=alert(1)>' },
    ],
  })

  assert.equal(doc.charts.length, 1)
  const html = renderHtml(doc)
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<foreignObject/i)
  assert.doesNotMatch(html, /<animate/i)
  assert.doesNotMatch(html, /\bon(?:load|click|begin|error)\s*=/i)
  assert.doesNotMatch(html, /javascript\s*:/i)
  assert.ok(html.includes('<circle cx="10" cy="10" r="5"/>'))
})

test('回归测试 [Iter 3 / SVG Allowlist & Split-SVG]: 严格 SVG 白名单拦截实体编码 URI、image、style、错位嵌套与多根载荷', () => {
  const entityLinkSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><a id="xsslink" href="&#106;avascript:window.__xssTriggered=1"><rect width="120" height="40" fill="#1d4b8f"/><text x="10" y="25" fill="#fff">Click</text></a></svg>'
  const tabEntitySvg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#x09;script:alert(1)"><text y="20">Hi</text></a></svg>'
  const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+" width="20" height="20"/></svg>'
  const styleSvg = '<svg xmlns="http://www.w3.org/2000/svg"><style>body{display:none!important}</style><rect width="10" height="10" style="color:expression(alert(1));opacity:0.8" fill="url(https://evil.com/x)"/></svg>'
  const mismatchedForeign = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><script>alert(1)</foreignObject><circle cx="5" cy="5" r="2"/></svg>'
  const wellFormedForeign = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>xss</div><script>alert(1)</script></foreignObject><circle cx="5" cy="5" r="2"/></svg>'
  const splitSvgPayload = '<svg></svg><form><input></form><svg></svg>'

  assert.equal(sanitizeSvg(mismatchedForeign), null)
  assert.equal(sanitizeSvg('<svg><foreignObject><script>a="</foreignObject><text>x</text></svg>'), null)
  assert.equal(sanitizeSvg(splitSvgPayload), null)
  const cleanWellFormed = sanitizeSvg(wellFormedForeign)
  assert.ok(cleanWellFormed)
  assert.doesNotMatch(cleanWellFormed, /<\/?(?:foreignObject|div|script)\b/i)
  assert.ok(cleanWellFormed.includes('<circle cx="5" cy="5" r="2"/>'))

  const doc = normalizeExportDocument({
    title: '严格 SVG 白名单测试',
    charts: [
      { title: '实体链接', svg: entityLinkSvg },
      { title: '制表符实体', svg: tabEntitySvg },
      { title: '内嵌图片', svg: imageSvg },
      { title: '样式注入', svg: styleSvg },
      { title: '合规异质嵌套', svg: wellFormedForeign },
      { title: '错位嵌套', svg: mismatchedForeign },
      { title: '多根分裂', svg: splitSvgPayload },
    ],
  })
  assert.equal(doc.charts.length, 5)
  const html = renderHtml(doc)
  assert.doesNotMatch(html, /<a\b/i)
  assert.doesNotMatch(html, /xsslink/i)
  assert.doesNotMatch(html, /<image\b/i)
  assert.doesNotMatch(html, /<style>body\{display:none/i)
  assert.doesNotMatch(html, /<\/?foreignObject/i)
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<form\b/i)
  assert.doesNotMatch(html, /expression\s*\(/i)
  assert.doesNotMatch(html, /https:\/\/evil\.com/i)
  assert.doesNotMatch(html, /\bhref\s*=/i)
  assert.ok(html.includes('<rect width="120" height="40" fill="#1d4b8f"/>'))
  assert.ok(html.includes('<circle cx="5" cy="5" r="2"/>'))

  // Legitimate radarSvg, distributionBarSvg & reportAnalysis SVGs remain intact byte-for-byte
  const sample = allInsights.list.find(m => m.fingerprint?.reputation)
  const validRadar = radarSvg([{ name: sample.name, fingerprint: sample.fingerprint }])
  assert.equal(sanitizeSvg(validRadar), validRadar)

  const compForSvg = buildComparisonDocument({
    rows: allInsights.list.filter(m => m.rating != null).slice(0, 3),
    insights: allInsights,
  })
  assert.ok(compForSvg.charts.length >= 1)
  for (const ch of compForSvg.charts) {
    assert.equal(sanitizeSvg(ch.svg), ch.svg)
  }

  const analysisOut = reportAnalysis({
    rows: allInsights.list.filter(m => m.rating != null).slice(0, 3),
    fields: defaultComparisonFields,
    labels: { rating: '评分' },
    level: 2,
  })
  const svgMatches = [...analysisOut.html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map(m => m[0])
  assert.ok(svgMatches.length >= 1)
  for (const svgSnippet of svgMatches) {
    assert.ok(svgSnippet.includes('style="width:100%;max-width:740px"'))
    assert.equal(sanitizeSvg(svgSnippet), svgSnippet)
  }

  // Additional adversarial rejections: DOCTYPE/ENTITY, unclosed style-breakout, external url(), unquoted svg/onload
  assert.equal(sanitizeSvg('<!DOCTYPE svg [<!ENTITY xxe "test">]><svg>&xxe;</svg>'), null)
  assert.equal(sanitizeSvg('<svg><style></svg><img src=x onerror=alert(1)></style></svg>'), '<svg></svg>')
  assert.equal(sanitizeSvg('<svg><style></svg><img src=x onerror=alert(1)>'), null)
  assert.equal(
    sanitizeSvg('<svg viewBox="0 0 10 10"><path d="M0 0" fill="url(https://evil.com/x#a)"/></svg>'),
    '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>',
  )
  assert.equal(
    sanitizeSvg('<svg/onload=alert(1)><circle cx="5" cy="5" r="2"/></svg>'),
    '<svg><circle cx="5" cy="5" r="2"/></svg>',
  )
})

test('回归测试 [Iter 3 / Nested Markdown & PDF Banner]: 嵌套与组合行内 Markdown 解析、渲染及 PDF 元数据脱敏', async () => {
  const boldLinkTokens = parseInlineMarkdown('**[官网](https://example.com)**')
  assert.equal(boldLinkTokens[0].type, 'bold')
  assert.equal(boldLinkTokens[0].text, '官网')
  assert.equal(boldLinkTokens[0].children[0].type, 'link')
  assert.equal(boldLinkTokens[0].children[0].url, 'https://example.com/')

  const linkBoldTokens = parseInlineMarkdown('[**粗体链接**](https://example.com)')
  assert.equal(linkBoldTokens[0].type, 'link')
  assert.equal(linkBoldTokens[0].text, '粗体链接')
  assert.equal(linkBoldTokens[0].children[0].type, 'bold')

  const boldItalicTokens = parseInlineMarkdown('***粗斜体***')
  assert.equal(boldItalicTokens[0].type, 'bold')
  assert.equal(boldItalicTokens[0].children[0].type, 'italic')
  assert.equal(boldItalicTokens[0].children[0].text, '粗斜体')

  const boldCodeTokens = parseInlineMarkdown('**`code`**')
  assert.equal(boldCodeTokens[0].type, 'bold')
  assert.equal(boldCodeTokens[0].children[0].type, 'code')
  assert.equal(boldCodeTokens[0].children[0].text, 'code')

  assert.equal(stripInlineMarkdown('**[官网](https://example.com)** 和 **包含 *斜体* 的粗体**'), '官网 和 包含 斜体 的粗体')
  assert.equal(stripInlineMarkdown('[**粗体** ](https://example.com)'), '粗体 ')
  assert.equal(stripInlineMarkdown('[**粗体**](javascript:alert(1))'), '粗体')

  const doc = buildCustomDocument({
    title: '**总标题**',
    subtitle: '*副标题*说明',
    content: [
      '## **[官网](https://example.com)**',
      '',
      '**包含 *斜体* 的粗体**，以及 *包含 **粗体** 的斜体*，还有 [**粗体链接**](https://example.com/b)、***粗斜体*** 和 **`code`**。',
    ].join('\n'),
  })

  const html = renderHtml(doc)
  assert.ok(html.includes('<strong><a href="https://example.com/" target="_blank" rel="noopener noreferrer">官网</a></strong>'))
  assert.ok(html.includes('<a href="https://example.com/b" target="_blank" rel="noopener noreferrer"><strong>粗体链接</strong></a>'))
  assert.ok(html.includes('<strong>包含 <em>斜体</em> 的粗体</strong>'))
  assert.ok(html.includes('<em>包含 <strong>粗体</strong> 的斜体</em>'))
  assert.ok(html.includes('<strong><em>粗斜体</em></strong>'))
  assert.ok(html.includes('<strong><code>code</code></strong>'))
  assert.doesNotMatch(html, /\*\*|\*斜体|\*包含|\]\(https:/)

  const docxBuf = await renderDocx(doc)
  const docxFiles = unzipSync(new Uint8Array(docxBuf))
  const xml = Buffer.from(docxFiles['word/document.xml']).toString('utf8')
  const rels = Buffer.from(docxFiles['word/_rels/document.xml.rels']).toString('utf8')
  assert.ok(xml.includes('官网'))
  assert.ok(xml.includes('粗体链接'))
  assert.ok(xml.includes('斜体'))
  assert.ok(xml.includes('粗斜体'))
  assert.ok(xml.includes('code'))
  assert.ok(rels.includes('https://example.com/'))
  assert.doesNotMatch(xml, /\*|\[\*\*|\]\(https:|`code`/)

  const pdfBuf = await renderPdf(doc, { engine: 'pdfkit' })
  assert.match(pdfBuf.subarray(0, 16).toString('ascii'), /^%PDF-1\./)
  const pdfLatin = pdfBuf.toString('latin1')
  assert.ok(pdfLatin.includes('/Title'))
  // UTF-16BE for '**' is \x00*\x00*; ensure /Title metadata does not contain literal '**'
  assert.ok(!/\/Title\s*\([^)]*\x00\*\x00\*/.test(pdfLatin))
})

test('回归测试 [Iter 3 / Missing Columns & Fallback Headings]: buildCustomDocument / buildArtifactDocument 缺失 columns 防护与前置表格标题一致', () => {
  const customDoc = buildCustomDocument({
    title: '缺失列测试',
    tables: [
      { title: '推断裂表', rows: [{ a: 1, mentor_id: 'mentor-1234567890ab' }] },
      { title: '空表' },
    ],
  })
  assert.equal(customDoc.tables.length, 1)
  assert.deepEqual(customDoc.tables[0].columns.map(c => c.key), ['a'])
  assert.equal(customDoc.tables[0].rows[0].a, 1)

  assert.throws(
    () => buildArtifactDocument({ artifacts: [{ title: 't', rows: [{ a: 1 }] }] }),
    err => !(err instanceof TypeError) && /没有可导出的有效数据表/.test(err.message),
  )

  // Reviewer Note 2: two tables before any heading share consistent section heading
  const leadTableDoc = buildCustomDocument({
    title: '前置双表',
    content: [
      '| 列1 | 列2 |',
      '|---|---|',
      '| A | 1 |',
      '',
      '| 列1 | 列2 |',
      '|---|---|',
      '| B | 2 |',
    ].join('\n'),
  })
  assert.equal(leadTableDoc.tables.length, 2)
  assert.equal(leadTableDoc.tables[0].title, '前置双表')
  assert.equal(leadTableDoc.tables[1].title, '前置双表')
})

test('回归测试 [Iter 3 / Formula Tab-CR, Multiline DOCX, Sheet Surrogates & Filename]: Excel/CSV 前导制表符与回车防护、DOCX 多行单元格、代理对与文件名保留', async () => {
  // 1. Bare \t and \r formula guard in Excel & CSV
  const formulaDoc = normalizeExportDocument({
    title: '公式前缀边界',
    tables: [
      {
        sheetName: '测试表',
        columns: [
          { key: 'a', label: '列A', type: 'string' },
          { key: 'b', label: '列B', type: 'string' },
        ],
        rows: [
          { a: '\tcmd', b: '\rcmd' },
          { a: '第一行内容\n第二行内容', b: '正常内容' },
        ],
      },
    ],
  })
  const xlsxBuf = await renderExcel(formulaDoc)
  const sheetRows = await readSheet(xlsxBuf, '测试表')
  const flatXlsx = sheetRows.flat().map(v => String(v ?? ''))
  assert.ok(flatXlsx.includes("'\tcmd"))
  assert.ok(flatXlsx.includes("'\rcmd"))

  const csv = renderCsv(formulaDoc)
  assert.ok(csv.includes("'\tcmd"))
  assert.ok(csv.includes("'\rcmd"))

  // 2. DOCX multiline table cell splits across <w:p> without raw \n inside <w:t>
  const docxBuf = await renderDocx(formulaDoc)
  const xml = Buffer.from(unzipSync(new Uint8Array(docxBuf))['word/document.xml']).toString('utf8')
  assert.ok(xml.includes('第一行内容'))
  assert.ok(xml.includes('第二行内容'))
  const wtMatches = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
  assert.ok(wtMatches.length > 0)
  for (const m of wtMatches) {
    assert.ok(!m[1].includes('\n') && !m[1].includes('\r'), 'DOCX <w:t> 不应包含原始换行符')
  }

  // 3. sanitizeSheetName multi-quote & UTF-16 surrogate safety + ExcelJS addWorksheet roundtrip
  const used = new Set()
  assert.equal(sanitizeSheetName("''a''", used), 'a')
  assert.equal(sanitizeSheetName("' ' 'quoted' ' '", used), 'quoted')
  assert.equal(sanitizeSheetName("' ' 'History' ' '", used), 'History_')
  const truncEmoji = sanitizeSheetName('a'.repeat(30) + '🎓', used)
  const collideEmoji1 = sanitizeSheetName('a'.repeat(28) + '🎓', used)
  const collideEmoji2 = sanitizeSheetName('a'.repeat(28) + '🎓', used)
  const emojiSheet = sanitizeSheetName('🎓'.repeat(20), used)
  const emojiSheet2 = sanitizeSheetName('🎓'.repeat(20), used)
  const testWb = new ExcelJS.Workbook()
  for (const name of [truncEmoji, collideEmoji1, collideEmoji2, emojiSheet, emojiSheet2, 'quoted', 'History_']) {
    assert.ok(name.length > 0 && name.length <= 31)
    assert.ok(!/[\uD800-\uDBFF]$/.test(name))
  }
  for (const name of [truncEmoji, collideEmoji1, collideEmoji2, emojiSheet, emojiSheet2]) {
    const ws = testWb.addWorksheet(name)
    assert.equal(ws.name, name)
  }

  // 4. Excel data sheet named '资料来源' + doc.sources deduplicates to '资料来源_2'
  const sourcesCollisionDoc = normalizeExportDocument({
    title: '资料来源重名测试',
    tables: [
      {
        sheetName: '资料来源',
        title: '自定义资料表',
        columns: [{ key: 'item', label: '条目', type: 'string' }],
        rows: [{ item: '用户数据行' }],
      },
    ],
    sources: [{ id: 'S1', title: '官方公告', kind: '官网', year: 2026 }],
  })
  const colXlsx = await renderExcel(sourcesCollisionDoc)
  const colWb = new ExcelJS.Workbook()
  await colWb.xlsx.load(colXlsx)
  assert.ok(colWb.getWorksheet('资料来源'))
  assert.ok(colWb.getWorksheet('资料来源_2'))

  // 5. exportDocument preserves caller filenames & doc/table titles while stripping internal IDs/locators
  for (const [inputName, fmt, expected] of [
    ['计算机学院5星导师.xlsx', 'xlsx', '计算机学院5星导师.xlsx'],
    ['推荐导师报告.pdf', 'pdf', '推荐导师报告.pdf'],
    ['my_report_t1.md', 'md', 'my_report_t1.md'],
    ['report-t1.md', 'md', 'report-t1.md'],
  ]) {
    const res = await exportDocument(formulaDoc, fmt, {
      filename: inputName,
      ...(fmt === 'pdf' ? { engine: 'pdfkit' } : {}),
    })
    assert.equal(res.filename, expected)
  }
  for (const leakedName of ['profile-1234567890ab_清单.xlsx', 'mentor_id_sha256.xlsx']) {
    const res = await exportDocument(formulaDoc, 'xlsx', { filename: leakedName })
    assert.doesNotMatch(res.filename, /profile-1234567890ab|mentor_id|sha256/)
    assert.ok(res.filename.endsWith('.xlsx'))
  }

  const titlePreservedDoc = normalizeExportDocument({
    title: '推荐导师报告.pdf',
    subtitle: '附件：my_report_t1.md（来源：导师评价.md:L10）',
    tables: [
      {
        sheetName: '表1',
        title: '计算机学院5星导师.xlsx',
        columns: [{ key: 'name', label: '导师', type: 'string' }],
        rows: [{ name: '张三' }],
      },
    ],
  })
  assert.equal(titlePreservedDoc.title, '推荐导师报告.pdf')
  assert.equal(titlePreservedDoc.tables[0].title, '计算机学院5星导师.xlsx')
  assert.ok(titlePreservedDoc.subtitle.includes('my_report_t1.md'))
  assert.doesNotMatch(titlePreservedDoc.subtitle, /:L10/)
  assert.equal(sanitizeExportFilename('/Users/alice/reports/5星导师.xlsx'), '5星导师.xlsx')
  assert.doesNotMatch(sanitizeTitleText('http://localhost:3000/api/mentors data.jsonl'), /localhost|jsonl/)
})

test('回归测试 [Iter 4 / Malformed Artifacts & Chat Export]: buildChatDocument 与 buildArtifactDocument 畸形制品防护及合法图表保留', () => {
  const malformedCases = [
    [{ title: '缺列', rows: [{ a: 1 }] }],
    [{ title: '缺行', columns: [{ key: 'a', label: 'A' }] }],
    [null],
    [{ title: '空列项', columns: [null], rows: [{ a: 1 }] }],
    'bad-non-array',
  ]

  for (const badArtifacts of malformedCases) {
    const docWithUser = buildChatDocument({
      chat: {
        title: '畸形制品对话测试',
        messages: [
          null,
          { id: 'u1', role: 'user', content: '请筛选导师' },
          { id: 'a1', role: 'assistant', status: 'complete', content: '以下为结果。', artifacts: badArtifacts },
        ],
      },
    })
    assert.equal(docWithUser.kind, 'chat')
    assert.equal(docWithUser.tables.length, 1)
    assert.equal(docWithUser.tables[0].sheetName, '对话摘要')
    assert.equal(docWithUser.tables[0].title, '畸形制品对话测试 · 对话内容摘要')

    const docNoUser = buildChatDocument({
      chat: {
        title: '无用户前导畸形测试',
        messages: [
          { id: 'a1', role: 'assistant', status: 'complete', content: '仅回答。', artifacts: badArtifacts },
        ],
      },
    })
    assert.equal(docNoUser.kind, 'chat')
    assert.equal(docNoUser.tables.length, 1)
    assert.equal(docNoUser.tables[0].sheetName, '对话摘要')
    assert.equal(docNoUser.tables[0].title, '无用户前导畸形测试 · 对话内容摘要')
  }

  // rows: [null] strips null row without TypeError, yielding 0 valid rows
  for (const withUser of [true, false]) {
    const messages = withUser
      ? [
          { id: 'u1', role: 'user', content: '请筛选' },
          { id: 'a1', role: 'assistant', status: 'complete', content: '结果。', artifacts: [{ title: '空行项', columns: [{ key: 'a', label: 'A' }], rows: [null] }] },
        ]
      : [
          { id: 'a1', role: 'assistant', status: 'complete', content: '结果。', artifacts: [{ title: '空行项', columns: [{ key: 'a', label: 'A' }], rows: [null] }] },
        ]
    const nullRowChat = buildChatDocument({ chat: { title: '空行清洗测试', messages } })
    assert.equal(nullRowChat.kind, 'chat')
    assert.equal(nullRowChat.tables.length, 2)
    assert.equal(nullRowChat.tables[1].title, '空行项')
    assert.equal(nullRowChat.tables[1].rows.length, 0)
  }

  // Mixed malformed + legitimate bar/scatter/metric artifacts: malformed dropped, valid charts preserved
  const mixedChatDoc = buildChatDocument({
    chat: {
      title: '混合图表对话',
      messages: [
        { id: 'u1', role: 'user', content: '展示统计图表' },
        {
          id: 'a1',
          role: 'assistant',
          status: 'complete',
          content: '已生成统计图表。',
          artifacts: [
            null,
            { title: '缺列无效表', rows: [{ x: 1 }] },
            {
              type: 'bar',
              title: '评分分布柱状图',
              description: '按评分区间统计',
              x: 'bucket',
              y: ['count'],
              columns: [
                { key: 'bucket', label: '评分区间', type: 'string' },
                { key: 'count', label: '导师数', type: 'integer' },
              ],
              rows: [{ bucket: '4.5-5.0', count: 12 }],
            },
            {
              type: 'scatter',
              title: '发表与口碑散点',
              description: '论文数与口碑关系',
              x: 'papers',
              y: ['rating'],
              columns: [
                { key: 'papers', label: '论文数', type: 'integer' },
                { key: 'rating', label: '评分', type: 'number' },
              ],
              rows: [{ papers: 42, rating: 4.8 }],
            },
            {
              type: 'metric',
              title: '核心指标卡',
              description: '样本总览',
              y: ['value'],
              columns: [
                { key: 'label', label: '指标', type: 'string' },
                { key: 'value', label: '数值', type: 'integer' },
              ],
              rows: [{ label: '收录导师', value: 100 }],
            },
            {
              type: 'bar',
              title: '非数组字段容错图',
              x: 'k',
              y: 'v',
              sources: 'bad-sources',
              row_notes: 'bad-notes',
              columns: [
                { key: 'k', label: '类别', type: 'string' },
                { key: 'v', label: '数量', type: 'integer' },
              ],
              rows: [{ k: 'A', v: 3 }],
            },
          ],
        },
      ],
    },
  })
  assert.equal(mixedChatDoc.tables.length, 5)
  assert.equal(mixedChatDoc.tables[1].title, '评分分布柱状图')
  assert.match(mixedChatDoc.tables[1].description, /导师数 12/)
  assert.equal(mixedChatDoc.tables[2].title, '发表与口碑散点')
  assert.equal(mixedChatDoc.tables[3].title, '核心指标卡')
  assert.equal(mixedChatDoc.tables[3].description, '样本总览')
  assert.equal(mixedChatDoc.tables[4].title, '非数组字段容错图')

  // buildArtifactDocument rejects columns: [null] with domain Error, not TypeError
  assert.throws(
    () => buildArtifactDocument({ artifacts: [{ title: 't', columns: [null], rows: [{ a: 1 }] }] }),
    err => !(err instanceof TypeError) && err instanceof Error && /没有可导出的有效数据表/.test(err.message),
  )

  // buildArtifactDocument filters null rows and preserves valid row + aligned row_notes
  const partialRowsDoc = buildArtifactDocument({
    artifacts: [
      {
        title: '部分空行测试',
        columns: [{ key: 'a', label: '列A', type: 'integer' }],
        rows: [null, { a: 2 }],
        row_notes: ['已过滤备注', '保留备注'],
      },
    ],
  })
  assert.equal(partialRowsDoc.tables.length, 1)
  assert.equal(partialRowsDoc.tables[0].rows.length, 1)
  assert.equal(partialRowsDoc.tables[0].rows[0].a, 2)
})

test('回归测试 [Iter 5 / Malformed Sources, Metadata & Custom Tables]: builders 对非数组与含空项的 sources/tools/activity/files/tables 防护', () => {
  // 1. buildArtifactDocument with sources: [null, validSource]
  const artDoc = buildArtifactDocument({
    artifacts: [
      {
        title: '来源含空项制品',
        columns: [{ key: 'a', label: 'A', type: 'integer' }],
        rows: [{ a: 1 }],
        sources: [null, { id: 'S1', title: '公开来源', kind: 'web' }],
      },
    ],
  })
  assert.equal(artDoc.kind, 'table')
  assert.equal(artDoc.sources.length, 1)
  assert.equal(artDoc.sources[0].id, 'S1')
  assert.equal(artDoc.sources[0].title, '公开来源')

  // 2. buildChatDocument with malformed sources, tools, activity, files, and artifact sources
  const chatCases = [
    { sources: [null] },
    { sources: 'bad' },
    { tools: 'bad' },
    { tools: [null] },
    { activity: [null] },
    { files: [null] },
    { files: 'bad' },
    {
      sources: [null, { id: 'S2', title: '对话来源', kind: 'web' }],
      tools: [null, { id: 't1', name: 'search', status: 'done', summary: '完成' }],
      activity: [null, { id: 'act1', kind: 'tool', label: '检索', status: 'done' }],
      files: [null, { id: 'f1', name: 'out.xlsx', format: 'xlsx', count: 1 }],
      artifacts: [
        {
          title: '附表',
          columns: [{ key: 'a', label: 'A', type: 'integer' }],
          rows: [{ a: 1 }],
          sources: [null],
        },
      ],
    },
  ]

  for (const extra of chatCases) {
    const doc = buildChatDocument({
      chat: {
        title: '元数据容错对话',
        messages: [
          { role: 'user', content: 'hi' },
          {
            id: 'm1',
            role: 'assistant',
            status: 'complete',
            content: 'ok',
            artifacts: [
              {
                title: 't',
                columns: [{ key: 'a', label: 'A' }],
                rows: [{ a: 1 }],
                sources: [null],
              },
            ],
            ...extra,
          },
        ],
      },
    })
    assert.equal(doc.kind, 'chat')
    assert.ok(doc.tables.length >= 2)
  }

  // 3. buildCustomDocument with non-array tables and [null] / non-array sources, plus single table object
  const badCustom = buildCustomDocument({
    title: 'x',
    tables: 'bad',
    sources: [null],
  })
  assert.equal(badCustom.kind, 'document')
  assert.deepEqual(badCustom.tables, [])
  assert.deepEqual(badCustom.sources, [])

  const badSourcesCustom = buildCustomDocument({
    title: 'x2',
    tables: 'bad',
    sources: 'bad',
  })
  assert.equal(badSourcesCustom.kind, 'document')
  assert.deepEqual(badSourcesCustom.sources, [])

  const singleTableCustom = buildCustomDocument({
    title: 'x',
    tables: { title: 't', rows: [{ a: 1 }], sources: [null, { id: 'S3', title: '单表来源', kind: 'web' }] },
  })
  assert.equal(singleTableCustom.kind, 'document')
  assert.equal(singleTableCustom.tables.length, 1)
  assert.equal(singleTableCustom.tables[0].title, 't')
  assert.equal(singleTableCustom.tables[0].rows[0].a, 1)
  assert.equal(singleTableCustom.sources.length, 1)
  assert.equal(singleTableCustom.sources[0].id, 'S3')

  // 4. Other builders (buildDossierDocument, buildFromMentors, buildComparisonDocument) handle non-array / [null] sources
  const dossierBadSources = buildDossierDocument({
    detail: { name: '张三', college: '计算机学院', sources: 'bad' },
  })
  assert.equal(dossierBadSources.kind, 'dossier')
  assert.deepEqual(dossierBadSources.sources, [])

  const mentorsBadSources = buildFromMentors({
    rows: [{ name: '张三', college: '计算机学院', sources: [null] }],
    sources: 'bad',
  })
  assert.equal(mentorsBadSources.kind, 'mentors')
  assert.deepEqual(mentorsBadSources.sources, [])

  const compBadSources = buildComparisonDocument({
    rows: [{ name: '张三', college: '计算机学院', sources: 'bad' }],
  })
  assert.equal(compBadSources.kind, 'comparison')
  assert.deepEqual(compBadSources.sources, [])
})

test('回归测试 [Iter 6 / Fuzz Boundary Hardening]: 全部 31 项 fuzz TypeError 边界与全格式 null 文档导出防护', async () => {
  // Gap 1: buildFromMentors & buildComparisonDocument & resolveInsightMap
  const mNullRows = buildFromMentors({ rows: [null] })
  assert.equal(mNullRows.kind, 'mentors')
  assert.equal(mNullRows.tables[0].rows.length, 0)

  const mBadRows = buildFromMentors({ rows: 'bad', fields: 'bad', workspaceItems: 'bad' })
  assert.equal(mBadRows.kind, 'mentors')
  assert.equal(mBadRows.tables[0].rows.length, 0)

  const mBadFilters = buildFromMentors({ rows: [{ name: 'A', college: 'B' }], filtersApplied: 'bad' })
  assert.equal(mBadFilters.kind, 'mentors')
  assert.deepEqual(mBadFilters.filtersApplied, [])
  assert.equal(mBadFilters.tables[0].rows.length, 1)

  const mNullInsight = buildFromMentors({
    rows: [{ name: 'A', college: 'B' }],
    insights: { mentors: { 'B:A': null } },
  })
  assert.equal(mNullInsight.kind, 'mentors')
  assert.equal(mNullInsight.tables[0].rows[0].name, 'A')

  const mArrayInsight = buildFromMentors({
    rows: [{ key: 'k1', name: 'A', college: 'B' }],
    insights: [null, { key: 'k1', name: 'A', college: 'B', flags: [null, { label: '好', tone: 'good' }] }],
  })
  assert.equal(mArrayInsight.tables[0].rows[0].green_flags, '好')

  const cNullRows = buildComparisonDocument({ rows: [null] })
  assert.equal(cNullRows.kind, 'comparison')
  assert.equal(cNullRows.tables[0].rows.length, 0)

  const cBadRows = buildComparisonDocument({ rows: 'bad', fields: 'bad' })
  assert.equal(cBadRows.kind, 'comparison')
  assert.equal(cBadRows.tables[0].rows.length, 0)

  const cNullSnapshots = buildComparisonDocument({ rows: [{ name: 'A', college: 'B' }], snapshots: [null] })
  assert.equal(cNullSnapshots.kind, 'comparison')
  assert.equal(cNullSnapshots.tables[0].rows.length, 1)

  const cBadSnapshots = buildComparisonDocument({ rows: [{ name: 'A', college: 'B' }], snapshots: 'bad' })
  assert.equal(cBadSnapshots.kind, 'comparison')

  const cNullInsight = buildComparisonDocument({
    rows: [{ name: 'A', college: 'B' }],
    insights: { mentors: { 'B:A': null } },
  })
  assert.equal(cNullInsight.kind, 'comparison')

  const cBadFlagsInsight = buildComparisonDocument({
    rows: [{ name: 'A', college: 'B' }],
    insights: { mentors: { 'B:A': { key: 'k1', flags: [null, 'bad'] } } },
  })
  assert.equal(cBadFlagsInsight.kind, 'comparison')

  const mPartialProfile = buildFromMentors({
    rows: [{ name: 'A', college: 'B' }],
    profile: { goal: 'career' },
  })
  assert.equal(mPartialProfile.kind, 'mentors')

  const dBadFlagEvidence = buildDossierDocument({
    insight: { name: 'A', flags: [{ label: '标签', tone: 'good', evidence: 'bad' }] },
  })
  assert.equal(dBadFlagEvidence.kind, 'dossier')

  // Gap 2: Central IR boundary (model.js) & exportDocument(null, fmt) across all 6 formats
  for (const fmt of EXPORT_FORMATS) {
    const res = await exportDocument(null, fmt, fmt === 'pdf' ? { engine: 'pdfkit' } : {})
    assert.equal(res.extension, fmt)
    assert.ok(res.filename.endsWith(`.${fmt}`))
    assert.ok(res.body.length > 0)
  }
  const nullOptsRes = await exportDocument(null, 'md', null)
  assert.equal(nullOptsRes.extension, 'md')
  assert.ok(nullOptsRes.body.length > 0)
  assert.equal(formatCell(42, null), '42')

  for (const badDoc of [
    null,
    'bad',
    [],
    { tables: 'bad' },
    { tables: [null, { columns: 'bad', rows: 'bad' }, { columns: [null], rows: [null] }] },
    { sections: 'bad' },
    { sections: [null] },
    { summaryCards: 'bad' },
    { summaryCards: [null] },
    { filtersApplied: 'bad' },
    { charts: 'bad' },
    { charts: [null] },
    { sources: {} },
    { sources: 'bad' },
    { sources: [null, 'bad', []] },
    { sections: [{ paragraphs: 'bad', bullets: 'bad', kvPairs: 'bad', badges: 'bad', tables: 'bad', callout: 'bad', radarSvg: 123 }] },
    { sections: [{ kvPairs: [null], badges: [null], tables: [null] }] },
  ]) {
    const norm = normalizeExportDocument(badDoc)
    assert.equal(typeof norm.title, 'string')
    assert.ok(Array.isArray(norm.tables))
    assert.ok(Array.isArray(norm.sections))
    assert.ok(Array.isArray(norm.summaryCards))
    assert.ok(Array.isArray(norm.filtersApplied))
    assert.ok(Array.isArray(norm.charts))
    assert.ok(Array.isArray(norm.sources))
  }

  // Gap 3: buildDossierDocument malformed subfields & null option bags across all builders
  const dNullFlags = buildDossierDocument({ insight: { name: 'A', flags: [null] } })
  assert.equal(dNullFlags.kind, 'dossier')

  const dBadFlags = buildDossierDocument({ insight: { name: 'A', flags: 'bad' } })
  assert.equal(dBadFlags.kind, 'dossier')

  const dBadMatch = buildDossierDocument({ insight: { name: 'A' }, match: { score: 80, hits: 'bad', misses: 'bad' } })
  assert.equal(dBadMatch.kind, 'dossier')

  const dBadEvidence = buildDossierDocument({
    insight: { name: 'A', fingerprint: { guidance: { value: 4, evidence: 'bad' } }, supervisor: 'bad', evidence: 'bad' },
    detail: { name: 'A' },
    fieldOptions: 'bad',
  })
  assert.equal(dBadEvidence.kind, 'dossier')

  assert.equal(buildFromMentors(null).kind, 'mentors')
  assert.equal(buildComparisonDocument(null).kind, 'comparison')
  assert.equal(buildCustomDocument(null).kind, 'document')
  assert.deepEqual(buildInsights(null).list, [])
  assert.equal(buildInsights(null).count, 0)

  const presetNullOpts = resolvePresetFilter('five_star', null)
  assert.equal(presetNullOpts.id, 'five_star')
  assert.deepEqual(presetNullOpts.mentors, [])
  const presetBadOpts = resolvePresetFilter('five_star', { allMentors: [null], colleges: 'bad', extraFilters: 'bad' })
  assert.deepEqual(presetBadOpts.mentors, [])

  assert.throws(
    () => buildChatDocument(null),
    err => !(err instanceof TypeError) && err instanceof Error && /缺少对话记录/.test(err.message),
  )
  assert.throws(
    () => buildArtifactDocument(null),
    err => !(err instanceof TypeError) && err instanceof Error && /没有可导出的有效数据表/.test(err.message),
  )
  assert.throws(
    () => buildDossierDocument(null),
    err => !(err instanceof TypeError) && err instanceof Error && /缺少导师档案数据/.test(err.message),
  )
})

test('回归测试 [Iter 7 / Challenger M5.1_6 Defensive Gaps & Prototype/NaN Hardening]: renderPdf(doc, null)、profile/insights/preset 清洗、radarSvg NaN 与 constructor 原型防护', async () => {
  // 1. Challenge 1: renderPdf(doc, null) and all render*(doc, null) helpers
  const pdfFromNullOpts = await renderPdf({ title: 'T' }, null)
  assert.ok(Buffer.isBuffer(pdfFromNullOpts))
  assert.match(pdfFromNullOpts.subarray(0, 16).toString('ascii'), /^%PDF-1\./)

  const pdfFromBadOpts = await renderPdf({ title: 'T' }, 'bad')
  assert.ok(Buffer.isBuffer(pdfFromBadOpts))
  assert.match(pdfFromBadOpts.subarray(0, 16).toString('ascii'), /^%PDF-1\./)

  assert.ok(Buffer.isBuffer(await renderExcel({ title: 'T' }, null)))
  assert.ok(Buffer.isBuffer(await renderDocx({ title: 'T' }, null)))
  assert.equal(typeof renderHtml({ title: 'T' }, null), 'string')
  assert.equal(typeof renderMarkdown({ title: 'T' }, null), 'string')
  assert.equal(typeof renderCsv({ title: 'T' }, null), 'string')

  // 2. Challenge 2: buildFromMentors malformed profile sanitization
  const ins = { mentors: { 'B:A': { key: 'k1', name: 'A', college: 'B', flags: [], fingerprint: {} } } }
  const pNullCollege = buildFromMentors({
    rows: [{ name: 'A', college: 'B' }],
    insights: ins,
    profile: { colleges: [null], musts: ['internship'] },
  })
  assert.equal(pNullCollege.kind, 'mentors')
  assert.equal(pNullCollege.tables[0].rows.length, 1)

  const pUnknownMust = buildFromMentors({
    rows: [{ name: 'A', college: 'B' }],
    insights: ins,
    profile: { colleges: ['B'], musts: ['unknown_must_key', 'constructor'] },
  })
  assert.equal(pUnknownMust.kind, 'mentors')
  assert.equal(pUnknownMust.tables[0].rows.length, 1)

  const pInvalidGoal = buildFromMentors({
    rows: [{ name: 'A', college: 'B' }],
    insights: ins,
    profile: { goal: 'invalid_goal', stage: 'invalid_stage', musts: ['internship'] },
  })
  assert.equal(pInvalidGoal.kind, 'mentors')
  assert.equal(pInvalidGoal.tables[0].rows.length, 1)

  // 3. Challenge 3: buildInsights & resolvePresetFilter malformed inputs
  const insBadProfile = buildInsights({
    mentors: [{ name: 'A', college: 'B' }],
    profiles: [{ name: 'A', college: 123, admissions: 789, biography: 42, projects: {}, achievements: 0, supervisor_type: 99 }],
  })
  assert.equal(insBadProfile.count, 2)
  assert.ok(insBadProfile.list.every(m => m.name === 'A'))

  const insBadSourceIds = buildInsights({
    mentors: [{ name: 'A', college: 'B', source_ids: { bad: 1 }, group_context: 123, mentor_note: 456 }],
  })
  assert.equal(insBadSourceIds.count, 1)
  assert.deepEqual(insBadSourceIds.list[0].source_ids, [])

  const presetBadFlags = resolvePresetFilter('zero_risk', {
    allMentors: [{ name: 'A', college: 'B', rating: 5, flags: 'bad' }],
  })
  assert.equal(presetBadFlags.mentors.length, 1)
  assert.equal(presetBadFlags.mentors[0].name, 'A')

  assert.throws(
    () => resolvePresetFilter('constructor', { allMentors: [] }),
    err => !(err instanceof TypeError) && /不支持/.test(err.message),
  )

  // 4. Minor note 1: radarSvg non-numeric fingerprint produces valid SVG with zero NaN
  const svgNonNumeric = radarSvg([
    {
      name: '测试导师',
      fingerprint: {
        reputation: { value: 'bad' },
        research: { value: Number.NaN },
        freedom: { value: Infinity },
        funding: { value: 4.2 },
      },
    },
  ])
  assert.match(svgNonNumeric, /^<svg\b/)
  assert.doesNotMatch(svgNonNumeric, /\bNaN\b/)

  // 5. Minor note 2: contactStatuses & fieldLabels prototype guard ('constructor')
  const mentorsProtoStatus = buildFromMentors({
    rows: [
      { key: 'k1', name: '甲', college: 'B', status: 'constructor' },
      { key: 'k2', name: '乙', college: 'B' },
    ],
    workspaceItems: [{ key: 'k2', status: 'constructor' }],
  })
  const mRows = mentorsProtoStatus.tables[0].rows
  assert.equal(mRows[0].contact_status, 'constructor')
  assert.equal(mRows[1].contact_status, 'constructor')
  assert.doesNotMatch(JSON.stringify(mentorsProtoStatus), /\[native code\]/)

  const dossierProtoStatus = buildDossierDocument({
    insight: { name: '甲', college: 'B' },
    savedItem: { status: 'constructor', note: '测试备注' },
  })
  const savedSec = dossierProtoStatus.sections.find(s => s.heading === '我的候选库记录')
  assert.ok(savedSec)
  assert.equal(savedSec.kvPairs[0].value, 'constructor')
  assert.doesNotMatch(JSON.stringify(dossierProtoStatus), /\[native code\]/)

  const dossierProtoDetail = buildDossierDocument({
    detail: { name: '乙', college: 'B', status: 'constructor' },
  })
  assert.doesNotMatch(JSON.stringify(dossierProtoDetail), /\[native code\]/)
})

test('回归测试 [Iter 8 / Challenger M5.1_7 Prototype Lookup Leak]: constructor/toString/__proto__/valueOf 零 [native code] 泄漏且保留合法自有字段', async () => {
  const protoKeys = ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']

  // 1. normalizeExportDocument with prototype column keys and empty row
  const normDoc = normalizeExportDocument({
    title: 'T',
    tables: [{ columns: protoKeys.map(key => ({ key })), rows: [{}] }],
  })
  const normRow = normDoc.tables[0].rows[0]
  assert.equal(Object.getPrototypeOf(normRow), Object.prototype)
  for (const key of protoKeys) {
    assert.equal(Object.hasOwn(normRow, key), true)
    assert.equal(normRow[key], null)
  }

  // 2. buildFromMentors with prototype fields + legitimate own fields
  const mentorsProtoDoc = buildFromMentors({
    rows: [{ name: 'A', college: 'B', rating: 5, management: '不打卡' }],
    fields: ['rating', 'management', ...protoKeys],
  })
  assert.equal(mentorsProtoDoc.tables[0].rows[0].rating, 5)
  assert.equal(mentorsProtoDoc.tables[0].rows[0].management, '不打卡')
  assert.equal(mentorsProtoDoc.tables[0].rows[0].constructor, null)

  // 3. buildComparisonDocument with prototype fields + legitimate own fields
  const compProtoDoc = buildComparisonDocument({
    rows: [
      { name: 'A', college: 'B', rating: 5, management: '不打卡' },
      { name: 'C', college: 'D', rating: 4, management: '弹性管理' },
    ],
    fields: ['rating', 'management', ...protoKeys],
  })
  const compSec = compProtoDoc.sections.find(s => s.heading.startsWith('A'))
  assert.ok(compSec)
  assert.ok(compSec.kvPairs.some(kv => kv.label === '管理与考勤' && kv.value === '不打卡'))
  assert.ok(!compSec.kvPairs.some(kv => protoKeys.includes(kv.label)))

  // 4. buildDossierDocument with prototype fieldOptions + legitimate own fieldOptions
  const dossierProtoDoc = buildDossierDocument({
    insight: { name: 'A', college: 'B', rating: 5 },
    detail: { name: 'A', college: 'B', rating: 5, management: '不打卡', doctoral_evidence: '指导学博学科: 081200|计算机科学与技术' },
    fieldOptions: ['management', 'doctoral_evidence', ...protoKeys],
  })
  const overviewRows = dossierProtoDoc.tables[0].rows
  assert.ok(overviewRows.some(r => r.field === '管理与考勤' && r.value === '不打卡'))
  assert.ok(overviewRows.some(r => r.field === '博士指导依据' && String(r.value).includes('学术博士：081200 · 计算机科学与技术')))
  assert.ok(!overviewRows.some(r => protoKeys.includes(r.field)))

  // 5. Additional helper edges: filename/title regex lookup, SVG named entities, formatCell admission_type, custom/artifact/chat prototype keys
  assert.equal(sanitizeExportFilename('constructor.md:L10'), '资料来源')
  assert.equal(sanitizeTitleText('constructor.md:L10'), '资料来源')
  assert.equal(sanitizeSvg('<svg><text>&constructor;&toString;</text></svg>'), '<svg><text>&amp;constructor;&amp;toString;</text></svg>')
  assert.equal(formatCell('exam', { key: 'admission_type' }), '考研')
  assert.equal(formatCell('constructor', { key: 'admission_type' }), 'constructor')
  const customProtoDoc = buildCustomDocument({
    title: '自定义原型键',
    tables: [{ title: 't', rows: [{ score: 95 }, {}] }],
  })
  assert.equal(customProtoDoc.tables[0].columns[0].numeric, true)

  const artifactProtoDoc = buildArtifactDocument({
    artifacts: [{
      title: '制品原型键',
      columns: [{ key: 'name', label: '导师' }, ...protoKeys.map(key => ({ key }))],
      rows: [{ name: 'A' }],
    }],
  })
  const chatProtoDoc = buildChatDocument({
    chat: {
      title: '对话原型键',
      messages: [{
        id: 'a1',
        role: 'assistant',
        status: 'complete',
        content: '测试',
        artifacts: [{
          title: '附件原型键',
          columns: [{ key: 'name', label: '导师' }, ...protoKeys.map(key => ({ key }))],
          rows: [{ name: 'A' }],
        }],
      }],
    },
  })

  // 6. Assert zero prototype leaks across JSON IR and all 6 export formats
  const docs = [normDoc, mentorsProtoDoc, compProtoDoc, dossierProtoDoc, artifactProtoDoc, chatProtoDoc]
  const allJson = JSON.stringify(docs)
  assert.doesNotMatch(allJson, /\[native code\]|function Object|function toString|\[object Object\]/)

  for (const doc of docs) {
    for (const fmt of EXPORT_FORMATS) {
      const res = await exportDocument(doc, fmt, fmt === 'pdf' ? { engine: 'pdfkit' } : {})
      if (!res.binary) {
        assert.doesNotMatch(String(res.body), /\[native code\]|function Object|function toString|\[object Object\]/, `${fmt} 不应泄漏原型属性`)
      } else if (fmt === 'xlsx') {
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(res.body)
        for (const ws of wb.worksheets) {
          const rows = await readSheet(res.body, ws.name)
          const text = rows.flat().map(v => String(v ?? '')).join('\n')
          assert.doesNotMatch(text, /\[native code\]|function Object|function toString|\[object Object\]/)
        }
      } else if (fmt === 'docx') {
        const xml = Buffer.from(unzipSync(new Uint8Array(res.body))['word/document.xml']).toString('utf8')
        assert.doesNotMatch(xml, /\[native code\]|function Object|function toString|\[object Object\]/)
      } else {
        assert.match(res.body.subarray(0, 16).toString('ascii'), /^%PDF-1\./)
      }
    }
  }
})

test('回归测试 [Iter 9 / Challenger M5.1_8 Prototype-Value & Text-Lookup Guard]: admission_type/match_status 与 bare .md / color_by 在全格式零泄漏且不污染 Object.prototype', async () => {
  const protoValues = ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty', '__defineGetter__']
  const protoOwnBefore = Object.getOwnPropertyNames(Object.prototype).slice().sort()

  // 1. formatCell for match_status & admission_type (prototype values + valid enums + status-labeled columns + array edge)
  const validStatuses = [
    ['unique', '可确认归属'],
    ['ambiguous', '归属待确认'],
    ['unmatched', '暂无对应资料'],
    ['unlinked', '暂无成绩记录'],
    ['not_admitted', '未拟录取'],
  ]
  for (const [rawStatus, expectedLabel] of validStatuses) {
    assert.equal(formatCell(rawStatus, { key: 'match_status' }), expectedLabel)
    assert.equal(formatCell(rawStatus, { key: 'custom_col', label: '关联状态' }), expectedLabel)
  }
  assert.equal(formatCell('exam', { key: 'admission_type' }), '考研')
  assert.equal(formatCell('recommended', { key: 'admission_type' }), '保研')
  for (const pk of protoValues) {
    assert.equal(formatCell(pk, { key: 'match_status' }), pk)
    assert.equal(formatCell(pk, { key: 'custom_col', label: '关联状态' }), pk)
    assert.equal(formatCell(pk, { key: 'admission_type' }), pk)
    assert.equal(formatCell([pk], { key: 'match_status' }), pk)
    assert.equal(formatCell([pk], { key: 'admission_type' }), pk)
  }

  // 2. renderCsv for admission_type, match_status, status-labeled columns, plus numeric/boolean/money/null parity
  const csvDoc = {
    title: 'CSV原型值回归测试',
    tables: [{
      columns: [
        { key: 'name', label: '导师', type: 'string' },
        { key: 'admission_type', label: '招生类型', type: 'string' },
        { key: 'match_status', label: '成绩归属说明', type: 'string' },
        { key: 'custom_status', label: '关联状态', type: 'string' },
        { key: 'score_reexam', label: '复试成绩', type: 'number' },
        { key: 'stipend_monthly', label: '月劳务（元）', type: 'money' },
        { key: 'can_supervise_doctoral', label: '可指导博士', type: 'boolean' },
      ],
      rows: [
        {
          name: '合法导师',
          admission_type: 'exam',
          match_status: 'unique',
          custom_status: 'not_admitted',
          score_reexam: 380.5,
          stipend_monthly: '1000–2000',
          can_supervise_doctoral: true,
        },
        {
          name: '保研导师',
          admission_type: 'recommended',
          match_status: 'unlinked',
          custom_status: 'ambiguous',
          score_reexam: null,
          stipend_monthly: 1500,
          can_supervise_doctoral: false,
        },
        ...protoValues.map(pk => ({
          name: `原型_${pk}`,
          admission_type: pk,
          match_status: pk,
          custom_status: pk,
          score_reexam: 100,
          stipend_monthly: '2000',
          can_supervise_doctoral: true,
        })),
      ],
    }],
  }
  const csvOut = renderCsv(csvDoc)
  assert.doesNotMatch(csvOut, /\[native code\]|function Object|function toString|\[object Object\]/)
  assert.ok(csvOut.includes('"合法导师","考研","可确认归属","未拟录取",380.5,"1,000–2,000","是"') || csvOut.includes('"合法导师","考研","可确认归属","未拟录取","380.5","1,000–2,000","是"'))
  assert.ok(csvOut.includes('"保研导师","保研","暂无成绩记录","归属待确认","","1500","否"') || csvOut.includes('"保研导师","保研","暂无成绩记录","归属待确认","",1500,"否"'))
  for (const pk of protoValues) {
    assert.ok(csvOut.includes(`"原型_${pk}","${pk}","${pk}","${pk}"`), `renderCsv 应保留原型键文本 ${pk}`)
  }

  // 3. sanitizeText: bare *.md, color_by: <proto>, and color_by=<proto> neutralized, valid inputs match publicText
  const combinedText = 'constructor.md toString.md __proto__.md valueOf.pdf hasOwnProperty.xlsx __defineGetter__.csv color_by: constructor color_by=constructor color_by: __proto__ color_by=__proto__'
  const cleanCombined = sanitizeText(combinedText)
  assert.doesNotMatch(cleanCombined, /\[native code\]|function Object|function toString|\[object Object\]/)
  assert.equal(cleanCombined, '资料来源 资料来源 资料来源 资料来源 资料来源 资料来源 按业务分类分色 按业务分类分色 按业务分类分色 按业务分类分色')
  assert.equal(sanitizeText('file:///Users/alice/foo.md'), '内部资料')
  assert.equal(sanitizeText('file:///Users/alice/constructor.md'), '内部资料')
  assert.equal(sanitizeText('/Users/alice/constructor.md'), '内部资料')

  for (const validSample of [
    '导师评价.md',
    '导师评价.md:L10',
    '初试结果.md',
    '复试结果.md',
    'color_by: rating',
    'color_by=rating',
    'https://example.com/constructor.md',
  ]) {
    assert.equal(sanitizeText(validSample), publicText(validSample))
  }

  // 4. buildChatDocument, buildFromMentors (note), buildCustomDocument (content), buildArtifactDocument across all 6 formats
  const chatLeakDoc = buildChatDocument({
    chat: {
      title: '对话文本原型测试',
      messages: [
        { id: 'u1', role: 'user', content: '请检查 constructor.md 和 color_by: constructor 与 color_by=constructor' },
        {
          id: 'a1',
          role: 'assistant',
          status: 'complete',
          content: '参考 __proto__.md 与 toString.md，以及 color_by: __proto__ 和 color_by=__proto__；合法来源 导师评价.md:L10 与 color_by: rating。',
          tools: [{ id: 't1', name: 'constructor', status: 'done', summary: 'constructor.md' }],
          sources: [{ id: 'S1', title: 'constructor.md', kind: 'color_by: constructor', scope: '__proto__.md' }],
          artifacts: [{
            title: '附表 constructor.md',
            description: '说明 color_by: __proto__ color_by=__proto__',
            columns: [{ key: 'name', label: '导师 toString.md' }, { key: 'match_status', label: '成绩归属说明' }],
            rows: [{ name: '测试', match_status: 'constructor' }],
            row_notes: ['备注 __proto__.md color_by=constructor'],
          }],
        },
      ],
    },
  })
  const mentorsLeakDoc = buildFromMentors({
    rows: [{
      name: '张老师',
      college: '计算机学院',
      note: '备注包含 constructor.md、toString.md、__proto__.md 与 color_by: constructor、color_by=__proto__',
    }],
  })
  const customLeakDoc = buildCustomDocument({
    title: '自定义文档原型测试',
    content: '正文：constructor.md / toString.md / __proto__.md / color_by: constructor / color_by=constructor / color_by: __proto__ / color_by=__proto__',
    sources: [{ id: 'S2', title: '__proto__.md', kind: '资料', scope: 'color_by=constructor' }],
  })
  const artifactLeakDoc = buildArtifactDocument({
    artifacts: [{
      title: '独立制品 constructor.md',
      description: 'color_by: __proto__',
      columns: [
        { key: 'name', label: '导师' },
        { key: 'admission_type', label: '招生类型' },
        { key: 'match_status', label: '成绩归属说明' },
      ],
      rows: [
        { name: '李老师', admission_type: 'constructor', match_status: '__proto__' },
        { name: '王老师', admission_type: 'exam', match_status: 'unique' },
      ],
    }],
  })

  for (const doc of [chatLeakDoc, mentorsLeakDoc, customLeakDoc, artifactLeakDoc]) {
    assert.doesNotMatch(JSON.stringify(doc), /\[native code\]|function Object|function toString|\[object Object\]/)
    for (const fmt of EXPORT_FORMATS) {
      const res = await exportDocument(doc, fmt, fmt === 'pdf' ? { engine: 'pdfkit' } : {})
      if (!res.binary) {
        const text = String(res.body)
        assert.doesNotMatch(text, /\[native code\]|function Object|function toString|\[object Object\]/, `${doc.title} (${fmt}) 不应泄漏原型文本`)
      } else if (fmt === 'xlsx') {
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(res.body)
        for (const ws of wb.worksheets) {
          const rows = await readSheet(res.body, ws.name)
          const text = rows.flat().map(v => String(v ?? '')).join('\n')
          assert.doesNotMatch(text, /\[native code\]|function Object|function toString|\[object Object\]/)
        }
      } else if (fmt === 'docx') {
        const xml = Buffer.from(unzipSync(new Uint8Array(res.body))['word/document.xml']).toString('utf8')
        assert.doesNotMatch(xml, /\[native code\]|function Object|function toString|\[object Object\]/)
      } else {
        assert.match(res.body.subarray(0, 16).toString('ascii'), /^%PDF-1\./)
      }
    }
  }

  // Ensure match_status & admission_type values survived artifact export without being erased
  const artCsv = renderCsv(artifactLeakDoc)
  assert.ok(artCsv.includes('"李老师","constructor","__proto__"'))
  assert.ok(artCsv.includes('"王老师","考研","可确认归属"'))

  // 5. Object.prototype remains completely unpolluted
  assert.equal(({}).polluted, undefined)
  assert.equal(Object.prototype.constructor, Object)
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).slice().sort(), protoOwnBefore)
})

test('回归测试 [Iter 10 / Challenger & Reviewer M5.1_9 Edge Cases]: 大小写路径豁免、标记剥离拼接、空工具标签与 Object.create(null) 单元格全格式安全', async () => {
  // 1. All 10 Challenger §5 vectors + extra stitching & case-variant path vectors
  const bypassVectors = [
    '/users/alice/constructor.md',
    '/TMP/toString.pdf',
    '/Var/log/__proto__.xlsx',
    '/API/v1/constructor.md',
    '/HOME/bob/valueOf.xlsx',
    'file:///users/alice/constructor.md',
    'FILE:///Users/alice/constructor.md',
    'constructor{{ chart }}.md',
    'con{{chart}}structor.md',
    'color_by:{{ chart }}constructor',
    'co{{chart}}lor_by: constructor',
    'color_by={{ chart }}"__proto__"',
    'constructor（按原文数字保留）.md',
    'constructor(按原文数字保留).md',
    'con(按原文数字保留)structor.md',
    'con```js\nmentor_id\n```structor.md',
    'co```js\nmentor_id\n```lor_by: constructor',
    'con{{```js\nmentor_id\n``` chart }}structor.md',
  ]

  for (const vec of bypassVectors) {
    const clean = sanitizeText(vec)
    assert.doesNotMatch(clean, /\[native code\]|function Object|function toString|\[object Object\]/, `sanitizeText 不应泄漏: ${vec}`)

    const chatDoc = buildChatDocument({
      chat: {
        title: '边界拼接测试',
        messages: [
          { id: 'u1', role: 'user', content: vec },
          { id: 'a1', role: 'assistant', status: 'complete', content: vec },
        ],
      },
    })
    for (const fmt of ['md', 'html', 'csv']) {
      const out = String((await exportDocument(chatDoc, fmt)).body)
      assert.doesNotMatch(out, /\[native code\]|function Object|function toString|\[object Object\]/, `buildChatDocument(${fmt}) 不应泄漏: ${vec}`)
    }
  }

  // Exact-case local paths & valid URLs/prose remain unchanged relative to publicText
  for (const validCase of [
    '/Users/alice/constructor.md',
    '/home/bob/valueOf.xlsx',
    '/tmp/toString.pdf',
    'file:///Users/alice/constructor.md',
    'C:\\Users\\alice\\constructor.md',
    'https://example.com/constructor.md',
    '导师评价.md',
    'color_by: rating',
    '普通中文文本，包含数字 123 与标点。',
  ]) {
    assert.equal(sanitizeText(validCase), publicText(validCase), `合法文本应与 publicText 一致: ${validCase}`)
  }

  // Safe non-internal fenced code blocks are preserved
  const safeCodeDoc = buildChatDocument({
    chat: {
      title: '代码块保留测试',
      messages: [{ id: 'a1', role: 'assistant', status: 'complete', content: '示例：\n```js\nconst a = 1;\n```' }],
    },
  })
  const safeCodeMd = String((await exportDocument(safeCodeDoc, 'md')).body)
  assert.ok(safeCodeMd.includes('const a = 1;'))

  // 2. buildChatDocument tools with empty-string label and prototype name
  const emptyToolDoc = buildChatDocument({
    chat: {
      title: '空工具标签测试',
      messages: [{
        id: 'a1',
        role: 'assistant',
        status: 'complete',
        content: '已完成查询',
        tools: [
          { id: 't1', name: 'constructor', label: '' },
          { id: 't2', name: 'search', label: '' },
        ],
      }],
    },
  })
  assert.doesNotMatch(JSON.stringify(emptyToolDoc), /\[native code\]|\[object Object\]/)

  // 3. Object.create(null) cell values across formatCell, normalizeExportDocument, and all 6 export formats
  const nullProtoEmpty = Object.create(null)
  const nullProtoWithData = Object.assign(Object.create(null), { label: '安全文本' })
  const throwingToString = { toString() { throw new Error('boom') } }

  assert.equal(formatCell(nullProtoEmpty, { key: 'name' }), '—')
  assert.equal(formatCell(nullProtoEmpty, { key: 'match_status' }), '—')
  assert.equal(formatCell(nullProtoEmpty, { key: 'admission_type' }), '—')
  assert.equal(formatCell(nullProtoEmpty, { key: 'stipend_monthly', type: 'money' }), '—')
  assert.equal(formatCell(throwingToString, { key: 'name' }), '—')
  assert.ok(formatCell(nullProtoWithData, { key: 'name' }).includes('安全文本'))

  const nullProtoDoc = normalizeExportDocument({
    title: 'NullProto 单元格测试',
    tables: [{
      columns: [
        { key: 'name', label: '姓名', type: 'string' },
        { key: 'notes', label: '备注', type: 'string' },
        { key: 'match_status', label: '关联状态', type: 'string' },
        { key: 'extra', label: '附加', type: 'string' },
      ],
      rows: [
        {
          name: Object.create(null),
          notes: Object.create(null),
          match_status: Object.create(null),
          extra: throwingToString,
        },
        {
          name: '正常导师',
          notes: nullProtoWithData,
          match_status: 'unique',
          extra: [Object.create(null), '有效项'],
        },
      ],
    }],
  })
  assert.equal(nullProtoDoc.tables[0].rows[0].name, null)
  assert.equal(nullProtoDoc.tables[0].rows[0].notes, null)

  for (const fmt of EXPORT_FORMATS) {
    const res = await exportDocument(nullProtoDoc, fmt, fmt === 'pdf' ? { engine: 'pdfkit' } : {})
    if (res.binary) {
      assert.ok(Buffer.isBuffer(res.body) && res.body.length > 0, `${fmt} 应生成非空二进制`)
      if (fmt === 'xlsx') {
        const rows = await readSheet(res.body, '数据明细')
        const text = rows.flat().map(v => String(v ?? '')).join('\n')
        assert.ok(text.includes('正常导师'))
        assert.ok(text.includes('可确认归属'))
      } else if (fmt === 'docx') {
        const xml = Buffer.from(unzipSync(new Uint8Array(res.body))['word/document.xml']).toString('utf8')
        assert.ok(xml.includes('正常导师'))
        assert.ok(xml.includes('可确认归属'))
      } else {
        assert.match(res.body.subarray(0, 16).toString('ascii'), /^%PDF-1\./)
      }
    } else {
      const text = String(res.body)
      assert.ok(text.includes('正常导师'))
      assert.ok(text.includes('可确认归属'))
      assert.doesNotMatch(text, /\[native code\]|\[object Object\]/)
    }
  }
})

test('回归测试 [Iter 11 / Challenger M5.1_10]: preGuardPublicText 无限层嵌套收敛与全链路 hostile-primitive / Object.create(null) / 循环引用安全', async () => {
  // 1. >=5-pass (5, 8, 12 passes) nested markers converge cleanly without leaking [native code]
  const repeatWrap = (prefix, marker, suffix, depth) => `${prefix}${marker.repeat(depth)}${suffix}`
  const deepVectors = [
    'con{{ {{ {{ {{ {{ chart }}chart }}chart }}chart }}chart }}structor.md',
    'color_by:{{ {{ {{ {{ {{ chart }}chart }}chart }}chart }}chart }}constructor',
    'con(按(按(按(按(按原文数字保留)原文数字保留)原文数字保留)原文数字保留)原文数字保留)structor.md',
    `con${'{{ '.repeat(8)}chart${' }}'.repeat(8)}structor.md`,
    `color_by:${'{{ '.repeat(8)}chart${' }}'.repeat(8)}__proto__`,
    `con${'(按'.repeat(12)}原文数字保留${'原文数字保留)'.repeat(12)}structor.md`,
    repeatWrap('con', '{{ chart }}', 'structor.md', 6),
    'con{{ {{ {{ {{ {{ ```js\nmentor_id\n```chart }}chart }}chart }}chart }}chart }}structor.md',
  ]
  for (const vec of deepVectors) {
    const out = sanitizeText(vec)
    assert.doesNotMatch(out, /\[native code\]|function Object|function toString|\[object Object\]/, `sanitizeText 深层嵌套不应泄漏: ${vec}`)
    const chatDoc = buildChatDocument({
      chat: {
        title: '深层嵌套收敛测试',
        messages: [
          { id: 'u1', role: 'user', content: vec },
          { id: 'a1', role: 'assistant', status: 'complete', content: vec },
        ],
      },
    })
    for (const fmt of ['md', 'html', 'csv']) {
      const rendered = String((await exportDocument(chatDoc, fmt)).body)
      assert.doesNotMatch(rendered, /\[native code\]|function Object|function toString|\[object Object\]/, `buildChatDocument(${fmt}) 深层嵌套不应泄漏`)
    }
  }

  // 2. Hostile primitives, Object.create(null), BigInt, Symbol, circular objects, and throwing coercion hooks
  const makeHostiles = () => {
    const nullCirc = Object.create(null)
    nullCirc.self = nullCirc
    const plainCirc = { label: '循环' }
    plainCirc.self = plainCirc
    return [
      Object.create(null),
      Object.assign(Object.create(null), { label: '安全文本' }),
      nullCirc,
      Object.assign(Object.create(null), { big: 123n, label: '含大整数' }),
      plainCirc,
      Symbol('hostile'),
      12345678901234567890n,
      { toString() { throw new Error('boom_toString') } },
      { valueOf() { throw new Error('boom_valueOf') } },
      { [Symbol.toPrimitive]() { throw new Error('boom_toPrimitive') } },
      { [Symbol.toPrimitive]() { return Symbol('prim') } },
    ]
  }

  for (const hostile of makeHostiles()) {
    const h = () => hostile
    assert.equal(typeof sanitizeText(h()), 'string')
    assert.equal(typeof sanitizeTitleText(h()), 'string')
    assert.equal(typeof sanitizeFilename(h()), 'string')
    assert.equal(typeof sanitizeExportFilename(h()), 'string')
    assert.equal(typeof sanitizeSheetName(h(), new Set()), 'string')
    assert.equal(typeof formatCell(h(), { key: 'name', label: h() }), 'string')
    assert.equal(typeof formatCell(h(), { key: 'stipend_monthly', type: 'money', label: h() }), 'string')

    const normDoc = normalizeExportDocument({
      title: h(),
      tables: [{
        columns: [{ key: 'academic_summary', label: h(), type: 'string' }],
        rows: [{ academic_summary: '教授；主持项目', professional_title: h() }],
      }],
      sources: [{ id: h(), title: h(), kind: h(), url: 'https://example.com', year: h(), published_at: h() }],
    })
    assert.ok(typeof normDoc.tables[0].columns[0].label === 'string' && normDoc.tables[0].columns[0].label.length > 0)
    assert.equal(normDoc.tables[0].rows[0].academic_summary, '主持项目')

    const svg = radarSvg([{ name: h(), color: h(), fingerprint: { reputation: { value: h() }, research: { value: 4 } } }])
    assert.match(svg, /^<svg\b/)
    assert.doesNotMatch(svg, /\bNaN\b/)

    const ins = buildInsights({
      mentors: [{
        name: h(), college: h(), group: h(), mentor_id: h(),
        rating: h(), student_count: h(), exam_count: h(), recommended_count: h(),
        stipend_monthly_min: h(), stipend_monthly_max: h(),
        academic_summary: h(), enrollment_signal: h(), source_ids: [h()],
      }],
    })
    assert.ok(Array.isArray(ins.list))

    const preset = resolvePresetFilter('five_star', {
      allMentors: [{ name: h(), college: h(), rating: h(), stipend: h(), flags: [{ id: 'f1', label: h(), tone: h() }] }],
      query: h(),
    })
    assert.equal(preset.id, 'five_star')

    const docs = [
      normDoc,
      buildFromMentors({
        title: h(),
        rows: [{
          name: h(), college: h(), professional_title: h(),
          rating: h(), green_flags: h(), red_flags: h(), academic_summary: '教授',
        }],
      }),
      buildComparisonDocument({
        title: h(),
        goal: h(),
        rows: [
          { name: h(), college: h(), professional_title: h(), academic_summary: '教授', actual_supervisor: h() },
          { name: 'B', college: 'C', academic_summary: '副教授', extra: h() },
        ],
        snapshots: [{ name: h(), createdAt: h(), rows: [] }],
      }),
      buildDossierDocument({
        insight: { name: h(), college: h(), title: h(), directions: h(), academicSummary: '教授' },
        detail: { name: h(), college: h(), professional_title: h(), academic_summary: '教授' },
        fieldOptions: ['academic_summary', { key: 'management', label: h() }],
      }),
      buildArtifactDocument({
        artifacts: [{
          id: 'a',
          type: 'table',
          purpose: 'recommendation',
          title: h(),
          columns: [
            { key: 'name', label: h(), type: 'string' },
            { key: 'stipend_monthly_min', label: 'min', type: 'number' },
            { key: 'stipend_monthly_max', label: 'max', type: 'number' },
          ],
          rows: [
            { name: h(), stipend_monthly_min: h(), stipend_monthly_max: 1500 },
            { name: '张三', stipend_monthly_min: 1000, stipend_monthly_max: 2000 },
          ],
          row_notes: [h(), h()],
        }],
      }),
      buildChatDocument({
        chat: {
          title: h(),
          messages: [
            { id: 'u1', role: 'user', content: h(), createdAt: h() },
            {
              id: 'a1',
              role: 'assistant',
              status: 'complete',
              content: h(),
              createdAt: h(),
              artifacts: [{
                id: 'art1',
                type: 'table',
                purpose: 'recommendation',
                title: h(),
                columns: [
                  { key: 'name', label: h(), type: 'string' },
                  { key: 'stipend_monthly_min', label: 'min', type: 'number' },
                  { key: 'stipend_monthly_max', label: 'max', type: 'number' },
                ],
                rows: [
                  { name: h(), stipend_monthly_min: h(), stipend_monthly_max: 1500 },
                  { name: '李四', stipend_monthly_min: 1000, stipend_monthly_max: 2000 },
                ],
              }],
            },
          ],
        },
      }),
      buildCustomDocument({
        title: h(),
        tables: [{ columns: [{ key: 'note', label: h(), type: 'string' }], rows: [{ note: h() }] }],
      }),
    ]

    for (const doc of docs) {
      for (const fmt of EXPORT_FORMATS) {
        const res = await exportDocument(doc, fmt, fmt === 'pdf' ? { engine: 'pdfkit', filename: h() } : { filename: h() })
        assert.ok(res.body.length > 0, `${fmt} 应产出非空结果`)
      }
    }
    await assert.rejects(() => exportDocument(normDoc, h()), err => !(err instanceof TypeError) && /不支持的导出格式/.test(err.message))
  }
})

test('回归测试 [Iter 11 / Challenger M5.1_10]: 多层嵌套标记收敛与 7 类恶意原语/Object.create(null) 全链路防崩溃', async () => {
  // 1. >=5-pass (6, 10, 20-pass) nested {{ chart }}, (按原文数字保留), （按原文数字保留）, and fenced blocks
  for (const depth of [6, 10, 20]) {
    const openChart = '{{ '.repeat(depth)
    const closeChart = 'chart }}'.repeat(depth)
    const openDefAscii = '(按'.repeat(depth)
    const closeDefAscii = '原文数字保留)'.repeat(depth)
    const openDefFw = '（按'.repeat(depth)
    const closeDefFw = '原文数字保留）'.repeat(depth)

    const nestedVectors = [
      `con${openChart}${closeChart}structor.md`,
      `color_by:${openChart}${closeChart}constructor`,
      `con${openDefAscii}${closeDefAscii}structor.md`,
      `con${openDefFw}${closeDefFw}structor.md`,
      `color_by=${openDefAscii}${closeDefAscii}__proto__`,
    ]

    for (const vec of nestedVectors) {
      const clean = sanitizeText(vec)
      assert.doesNotMatch(clean, /\[native code\]|function Object|function toString|\[object Object\]/, `sanitizeText depth=${depth} 泄漏: ${vec}`)

      const chatDoc = buildChatDocument({
        chat: {
          title: `深度嵌套_${depth}`,
          messages: [
            { id: 'u1', role: 'user', content: vec },
            { id: 'a1', role: 'assistant', status: 'complete', content: vec },
          ],
        },
      })
      assert.doesNotMatch(JSON.stringify(chatDoc), /\[native code\]|function Object|function toString|\[object Object\]/, `buildChatDocument depth=${depth} 泄漏`)
      for (const fmt of ['md', 'html', 'csv']) {
        const out = String((await exportDocument(chatDoc, fmt)).body)
        assert.doesNotMatch(out, /\[native code\]|function Object|function toString|\[object Object\]/)
      }
    }
  }

  // 2. All 7 hostile value types across normalizeExportDocument, radarSvg, formatCell, all 6 builders & exportDocument
  const makeHostileCases = () => {
    const circNull = Object.create(null)
    circNull.self = circNull
    return [
      ['nullProto_empty', () => Object.create(null)],
      ['nullProto_populated', () => Object.assign(Object.create(null), { a: 1, label: '安全' })],
      ['throwToString', () => ({ toString() { throw new Error('boom') } })],
      ['throwValueOf', () => ({ valueOf() { throw new Error('boom') } })],
      ['throwToPrimitive', () => ({ [Symbol.toPrimitive]() { throw new Error('boom') } })],
      ['symbol', () => Symbol('sym')],
      ['circular_nullProto', () => circNull],
      ['bigint', () => 123n],
      ['nullProto_bigint', () => Object.assign(Object.create(null), { n: 123n })],
    ]
  }

  for (const [kindName, make] of makeHostileCases()) {
    const h = make

    // normalizeExportDocument: col.label, col.type, col.role, col.fractionDigits, academic_summary + professional_title
    const normDoc = normalizeExportDocument({
      title: h(),
      subtitle: h(),
      generatedAt: h(),
      summaryCards: [{ label: h(), value: h() }],
      filtersApplied: [h()],
      tables: [{
        sheetName: h(),
        title: h(),
        description: h(),
        columns: [
          { key: 'name', label: h(), type: h(), role: h(), fractionDigits: h() },
          { key: 'academic_summary', label: h(), type: 'string' },
          { key: 'stipend_monthly', label: h(), type: 'money' },
        ],
        rows: [{
          name: h(),
          academic_summary: '教授；主持国家级大模型项目',
          professional_title: h(),
          title: h(),
          stipend_monthly: h(),
        }],
      }],
      sections: [{
        heading: h(),
        paragraphs: [h()],
        bullets: [h()],
        kvPairs: [{ label: h(), value: h() }],
        badges: [{ label: h(), tone: h(), detail: h() }],
        quote: h(),
        callout: { title: h(), text: h(), tone: h() },
      }],
      charts: [{ title: h(), svg: '<svg><text>ok</text></svg>' }],
      sources: [{ id: h(), title: h(), kind: h(), scope: h(), publisher: h(), url: h(), year: h() }],
    })
    assert.equal(typeof normDoc.title, 'string', `normDoc title failed for ${kindName}`)
    assert.ok(normDoc.tables[0].columns.length >= 2)

    // formatCell with hostile column descriptor and hostile cell value
    assert.equal(typeof formatCell(h(), { key: 'name', label: h(), type: h(), fractionDigits: h() }), 'string')
    assert.equal(typeof formatCell(h(), { key: 'match_status', label: h() }), 'string')
    assert.equal(typeof formatCell(h(), { key: 'admission_type', label: h() }), 'string')

    // radarSvg with hostile fingerprint score, name, color
    const svg = radarSvg([{
      name: h(),
      color: h(),
      fingerprint: { reputation: { value: h() }, research: { value: 4.5 } },
    }])
    assert.match(svg, /^<svg\b/)
    assert.doesNotMatch(svg, /\bNaN\b/)

    // Builder 1: buildFromMentors
    const mDoc = buildFromMentors({
      title: h(),
      subtitle: h(),
      filtersApplied: [h()],
      rows: [{
        key: h(), name: h(), college: h(), group: h(), professional_title: h(), title: h(),
        rating: h(), green_flags: h(), red_flags: h(), watch_flags: h(), actual_supervisor: h(),
        personal_directions: h(), directions: h(), academic_summary: '教授；科研方向测试',
        enrollment_signal: h(), management: h(), internship: h(), graduation: h(), stipend_text: h(),
        student_count: h(), exam_count: h(), recommended_count: h(), status: h(), contact_status: h(), note: h(),
      }],
      insights: [{
        key: h(), name: h(), college: h(), title: h(), rating: h(),
        flags: [{ label: h(), tone: h(), scope: h(), evidence: [h()] }],
        fingerprint: { reputation: { value: h() } },
        supervisor: { name: h() },
      }],
      workspaceItems: [{ key: h(), name: h(), college: h(), status: h(), contact_status: h(), note: h() }],
      sources: [{ id: h(), title: h(), kind: h() }],
    })
    assert.equal(mDoc.kind, 'mentors')

    // Builder 2: buildComparisonDocument
    const cmpDoc = buildComparisonDocument({
      title: h(),
      goal: h(),
      conclusion: h(),
      snapshots: [{ name: h(), createdAt: h(), rows: [{}] }],
      rows: [
        { key: h(), name: h(), college: h(), professional_title: h(), title: h(), rating: h(), academic_summary: '教授', actual_supervisor: h(), contact_status: h(), note: h(), custom_f: h() },
        { name: '对比乙', college: '计算机学院', rating: 5, academic_summary: '副教授', custom_f: '正常值' },
      ],
      fields: ['rating', 'academic_summary', 'custom_f'],
      insights: [{ name: '对比乙', college: '计算机学院', flags: [{ label: h(), tone: h() }], fingerprint: { reputation: { value: h() }, research: { value: 4 } } }],
    })
    assert.equal(cmpDoc.kind, 'comparison')

    // Builder 3: buildDossierDocument
    const dosDoc = buildDossierDocument({
      insight: {
        name: h(), college: h(), group: h(), title: h(), rating: h(), directions: h(),
        academicSummary: '教授', doctoralPrograms: h(), admissions: h(), enrollmentSignal: h(),
        biography: h(), projects: h(), achievements: h(), email: h(), homepage: h(), quote: h(),
        students: h(), exam: h(), recommended: h(),
        supervisor: { name: h(), evidence: h() },
        evidence: { sources: h(), level: h() },
        flags: [{ label: h(), tone: 'bad', scope: '团队', evidence: [h()] }],
        fingerprint: { reputation: { value: h(), evidence: [h()] } },
      },
      detail: {
        name: h(), college: h(), group: h(), professional_title: h(), title: h(), rating: h(),
        directions: h(), academic_summary: '教授', enrollment_signal: h(),
        internship: h(), stipend_text: h(), management: h(), graduation: h(),
        student_count: h(), exam_count: h(), recommended_count: h(),
        status: h(), contact_status: h(), note: h(),
        sources: [{ id: h(), title: h(), kind: h() }],
      },
      match: { score: h(), hits: [h()], misses: [h()] },
      fieldOptions: [{ key: 'academic_summary', label: h() }, { key: 'rating', label: h() }],
      savedItem: { status: h(), contact_status: h(), note: h() },
    })
    assert.equal(dosDoc.kind, 'dossier')

    // Builder 4: buildArtifactDocument (including stipend merge + recommendation ranking name coercion)
    const artDoc = buildArtifactDocument({
      title: h(),
      subtitle: h(),
      artifacts: [{
        id: h(),
        type: 'bar',
        purpose: 'recommendation',
        title: h(),
        description: h(),
        x: h(),
        y: h(),
        color_by: h(),
        columns: [
          { key: 'name', label: h(), type: 'string' },
          { key: 'stipend_monthly_min', label: h(), type: 'number' },
          { key: 'stipend_monthly_max', label: h(), type: 'number' },
        ],
        rows: [
          { name: h(), stipend_monthly_min: h(), stipend_monthly_max: 1500 },
          { name: 123, stipend_monthly_min: 1000, stipend_monthly_max: h() },
        ],
        row_notes: [h(), h()],
        sources: [{ id: h(), title: h(), kind: h() }],
      }],
    })
    assert.equal(artDoc.kind, 'table')

    // Builder 5: buildChatDocument
    const chatHostileDoc = buildChatDocument({
      title: h(),
      chat: {
        title: h(),
        messages: [
          { id: h(), role: 'user', content: h(), createdAt: h() },
          {
            id: h(),
            role: 'assistant',
            status: 'complete',
            content: h(),
            progress: h(),
            error: h(),
            createdAt: h(),
            tools: [{ id: h(), name: h(), label: h(), status: h(), summary: h() }],
            activity: [{ id: h(), kind: 'tool', label: h(), count: h() }],
            files: [{ id: h(), name: h(), format: h(), depth: h(), count: h(), createdAt: h() }],
            sources: [{ id: h(), title: h(), kind: h(), scope: h(), publisher: h(), url: h(), year: h() }],
            artifacts: [{
              id: h(),
              type: 'table',
              title: h(),
              description: h(),
              columns: [{ key: 'name', label: h(), type: 'string' }, { key: 'val', label: h(), type: 'unknown' }],
              rows: [{ name: h(), val: h() }],
              row_notes: [h()],
            }],
          },
        ],
      },
    })
    assert.equal(chatHostileDoc.kind, 'chat')

    // Builder 6: buildCustomDocument
    const custDoc = buildCustomDocument({
      title: h(),
      subtitle: h(),
      content: h(),
      summaryCards: [{ label: h(), value: h() }],
      filtersApplied: [h()],
      tables: [
        { title: h(), sheetName: h(), description: h(), columns: [{ key: 'note', label: h(), type: 'string' }], rows: [{ note: h() }] },
        { title: h(), rows: [{ score: h(), note: h() }] },
      ],
      sources: [{ id: h(), title: h(), kind: h() }],
    })
    assert.equal(custDoc.kind, 'document')

    // Preset & insights helpers
    resolvePresetFilter('five_star', {
      query: h(),
      allMentors: [{ name: h(), college: h(), title: h(), rating: 5, stipend: h(), directions: h(), flags: [{ id: 'x', label: h(), tone: 'good' }] }],
    })
    buildInsights({
      mentors: [{ name: h(), college: h(), rating: h(), student_count: h(), mentor_note: h(), source_ids: [h()] }],
      profiles: [{ name: h(), college: h(), biography: h(), source_ids: [h()] }],
      exams: [{ mentor_id: h(), rank_first: h(), score_first: h() }],
    })

    // End-to-end exportDocument across all 6 formats on representative hostile doc
    if (['nullProto_empty', 'throwToString', 'symbol', 'circular_nullProto', 'bigint'].includes(kindName)) {
      for (const fmt of EXPORT_FORMATS) {
        const res = await exportDocument(dosDoc, fmt, fmt === 'pdf' ? { engine: 'pdfkit' } : {})
        assert.ok(res.body.length > 0, `${kindName} -> ${fmt} 应生成非空导出`)
      }
    }
  }
})

test('回归测试 [Iter 12 / Challenger M5.1_11]: O(N) 行内解析、localhost/api 标点绕过、大小写路径、单竖线 DSML、标题/文件名收敛与 profile.score/evidence.sources/循环数组防护', async () => {
  // 1. O(N) parseInlineMarkdown performance across pathological delimiter inputs (< 200ms)
  const perfInputs = [
    '*a '.repeat(2000) + '['.repeat(500) + '`'.repeat(500),
    '**a '.repeat(2000) + '['.repeat(500),
    '***a '.repeat(2000) + '['.repeat(500),
    '__a '.repeat(2000) + '['.repeat(500),
    '_a '.repeat(2000) + '['.repeat(500),
    '[x]('.repeat(2000),
    Array.from({ length: 200 }, (_, i) => '`'.repeat(i + 1) + 'x').join(' '),
  ]
  for (const input of perfInputs) {
    const t0 = performance.now()
    const tokens = parseInlineMarkdown(input)
    const elapsed = performance.now() - t0
    assert.ok(Array.isArray(tokens) && tokens.length > 0)
    assert.ok(elapsed < 200, `parseInlineMarkdown 耗时过长: ${elapsed.toFixed(2)}ms`)
  }
  // AST equivalence on valid nested / escaped / backtick / link / multiline markdown
  assert.equal(
    stripInlineMarkdown(String.raw`\*转义\* \[非链接\](https://a.com) [嵌套(括号)](https://a.com/x(1))`),
    '*转义* [非链接](https://a.com) 嵌套(括号)',
  )
  assert.deepEqual(parseInlineMarkdown('__双下划线__ 和 ___三下划线___'), [
    { type: 'bold', text: '双下划线', bold: true, children: [{ type: 'text', text: '双下划线' }] },
    { type: 'text', text: ' 和 _' },
    { type: 'bold', text: '三下划线_', bold: true, children: [{ type: 'text', text: '三下划线_' }] },
  ])

  // 2. localhost / 127.0.0.1 / [::1] /api/... + punctuation + prototype .md bypass
  const apiBypassVectors = [
    'http://localhost:3210/api/foo）constructor.md',
    'http://127.0.0.1:3210/api/foo，constructor.md',
    'https://[::1]:3210/api/foo；__proto__.md',
    'http://localhost/api/a)toString.md',
    'http://localhost/api/a[constructor.md',
    'http://localhost/api/a|valueOf.md',
  ]
  for (const vec of apiBypassVectors) {
    const out = sanitizeText(vec)
    assert.doesNotMatch(out, /\[native code\]|function Object|function toString|function valueOf|\[object Object\]/, `API 标点绕过泄漏: ${vec}`)
    assert.ok(out.includes('内部查询') && out.includes('资料来源'))
    const chatDoc = buildChatDocument({
      chat: {
        title: 'API 绕过测试',
        messages: [
          { id: 'u1', role: 'user', content: vec },
          { id: 'a1', role: 'assistant', status: 'complete', content: vec },
        ],
      },
    })
    for (const fmt of ['md', 'html', 'csv']) {
      const rendered = String((await exportDocument(chatDoc, fmt)).body)
      assert.doesNotMatch(rendered, /\[native code\]|function Object|function toString|function valueOf|\[object Object\]/)
    }
  }

  // 3. Case-variant local paths (with/without extension, CJK dirs) & parity with publicText
  for (const pathVec of [
    '/users/alice/中文目录/secret.md',
    '/users/alice/secret',
    '/TMP/secret',
    'FILE:///Users/alice/secret',
    '/Var/log/__proto__.xlsx',
    '/Users/alice/notes.md',
    '/home/bob/data.xlsx',
    '/tmp/out.pdf',
    'file:///Users/alice/doc.md',
    'C:\\Users\\alice\\doc.md',
  ]) {
    assert.equal(sanitizeText(pathVec), '内部资料', `sanitizeText 应脱敏路径: ${pathVec}`)
    assert.equal(sanitizeTitleText(pathVec), '内部资料', `sanitizeTitleText 应脱敏路径: ${pathVec}`)
  }
  for (const validUrl of ['https://example.com/constructor.md', 'https://example.com/guide.pdf']) {
    assert.equal(sanitizeText(validUrl), publicText(validUrl))
    assert.equal(sanitizeTitleText(validUrl), validUrl)
  }

  // 4. Single-pipe DSML & sanitizeTitleText / sanitizeExportFilename across all 6 builders
  const singlePipeDsml = '正常前缀 <｜DSML｜function_calls><｜DSML｜invoke name="query"><｜DSML｜parameter name="from">mentors</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>'
  const asciiPipeDsml = '正常前缀 <|DSML|function_calls><|DSML|invoke name="query"></|DSML|invoke>'
  for (const dsml of [singlePipeDsml, asciiPipeDsml]) {
    assert.doesNotMatch(sanitizeText(dsml), /DSML/)
    assert.doesNotMatch(sanitizeTitleText(dsml), /DSML/)
    assert.doesNotMatch(sanitizeExportFilename(dsml), /DSML/)
  }

  const fencedInternal = '报告```json\n{"from": "reviews"}\n```标题'
  assert.equal(sanitizeTitleText('标题{{ ch{{ chart }}art }}（按原文数字保留）'), '标题')
  assert.equal(sanitizeTitleText(fencedInternal), '报告标题')
  assert.equal(sanitizeTitleText('导师评价.md'), '导师评价')
  assert.equal(sanitizeTitleText('初试结果.md'), '初试成绩资料')
  assert.equal(sanitizeTitleText('复试结果.md'), '复试结果资料')
  assert.equal(sanitizeTitleText('constructor.md'), '资料来源')
  assert.equal(sanitizeTitleText('color_by: constructor'), '按业务分类分色')

  assert.equal(sanitizeExportFilename('推荐导师清单'), '推荐导师清单')
  assert.equal(sanitizeExportFilename('导师对比报告'), '导师对比报告')
  assert.equal(sanitizeExportFilename('报告 /TMP/secret.md'), '报告 内部资料')
  assert.equal(sanitizeExportFilename('FILE:///Users/alice/secret'), '内部资料')
  assert.equal(sanitizeExportFilename('/Var/log/__proto__.xlsx'), '资料来源')
  assert.equal(sanitizeExportFilename('报告{{ ch{{ chart }}art }}（按原文数字保留）'), '报告')
  assert.equal(sanitizeExportFilename(fencedInternal), '报告标题')

  const badTitle = '标题{{ ch{{ ch{{ chart }}art }}art }}（按原文数字保留）<｜DSML｜function_calls>x /users/alice/中文目录/secret.md ```json\n{"from":"reviews"}\n```'
  const builderDocs = [
    buildFromMentors({ title: badTitle, rows: [{ name: '张三', college: '计算机学院' }] }),
    buildComparisonDocument({ title: badTitle, rows: [{ name: '张三', college: '计算机学院' }, { name: '李四', college: '信通学院' }] }),
    buildDossierDocument({ insight: { name: `张三 ${badTitle}`, college: '计算机学院' } }),
    buildArtifactDocument({
      title: badTitle,
      artifacts: [{ title: badTitle, columns: [{ key: 'name', label: '导师' }], rows: [{ name: '张三' }] }],
    }),
    buildChatDocument({
      title: badTitle,
      chat: { title: badTitle, messages: [{ id: 'a1', role: 'assistant', status: 'complete', content: 'ok' }] },
    }),
    buildCustomDocument({ title: badTitle, content: '正文' }),
  ]
  for (const bDoc of builderDocs) {
    assert.doesNotMatch(bDoc.title, /\{\{|按原文数字保留|DSML|secret\.md|reviews/)
  }

  // 5. buildFromMentors hostile profile.score & insight.evidence.sources + polish guards
  const make10Hostiles = () => {
    const nullCirc = Object.create(null)
    nullCirc.self = nullCirc
    const plainCirc = { label: 'circ' }
    plainCirc.self = plainCirc
    return [
      Object.create(null),
      Object.assign(Object.create(null), { label: '安全' }),
      nullCirc,
      Object.assign(Object.create(null), { big: 123n, sym: Symbol('s') }),
      plainCirc,
      Symbol('hostile'),
      12345678901234567890n,
      { toString() { throw new Error('boom_toString') } },
      { valueOf() { throw new Error('boom_valueOf') } },
      { [Symbol.toPrimitive]() { throw new Error('boom_toPrimitive') } },
    ]
  }
  for (const h of make10Hostiles()) {
    const d1 = buildFromMentors({ rows: [{ name: 'A', college: 'B' }], profile: { goal: 'career', score: h } })
    assert.equal(d1.kind, 'mentors')
    const d2 = buildFromMentors({
      rows: [{ key: 'k', name: 'A', college: 'B' }],
      insights: { mentors: { 'B:A': { key: 'k', name: 'A', college: 'B', flags: [], fingerprint: {}, evidence: { sources: h } } } },
      profile: { goal: 'career', musts: ['doctoral'] },
    })
    assert.equal(d2.kind, 'mentors')
  }

  // Circular arrays in formatCell / sanitizeCellValue
  const circArr = ['有效']
  circArr.push(circArr)
  assert.equal(formatCell(circArr, { key: 'name' }), '有效')
  assert.equal(formatCell(circArr, { key: 'match_status' }), '有效')
  const pureCirc = []
  pureCirc.push(pureCirc)
  assert.equal(formatCell(pureCirc, { key: 'name' }), '—')
  const normCirc = normalizeExportDocument({
    title: '循环数组测试',
    tables: [{ columns: [{ key: 'name', label: '导师' }], rows: [{ name: pureCirc }, { name: circArr }] }],
  })
  assert.deepEqual(normCirc.tables[0].rows[0].name, [])
  assert.deepEqual(normCirc.tables[0].rows[1].name, ['有效'])

  // radarSvg clamps non-positive size
  const svgZero = radarSvg([{ name: 'A', fingerprint: { reputation: { value: 4 } } }], { size: 0 })
  assert.match(svgZero, /width="240"/)
  const svgNeg = radarSvg([{ name: 'A', fingerprint: { reputation: { value: 4 } } }], { size: -10 })
  assert.match(svgNeg, /width="240"/)

  // sanitizeArtifactInput mentor_name + hostile row.name in buildChatDocument
  const mentorNameChat = buildChatDocument({
    chat: {
      title: 'mentor_name 防护',
      messages: [
        { id: 'u1', role: 'user', content: '推荐顺序：张三、李四' },
        {
          id: 'a1',
          role: 'assistant',
          status: 'complete',
          content: '推荐顺序为：李四、张三',
          artifacts: [{
            id: 'a1',
            type: 'table',
            purpose: 'recommendation',
            columns: [{ key: 'mentor_name', label: '导师' }, { key: 'name', label: '别名' }],
            rows: [
              { mentor_name: '张三', name: Object.create(null) },
              { mentor_name: '李四', name: Symbol('x') },
            ],
          }],
        },
      ],
    },
  })
  assert.equal(mentorNameChat.kind, 'chat')

  // CSV formula guard with leading ASCII control characters (\u0000=cmd)
  const ctrlCsv = renderCsv({
    title: '控制字符公式防护',
    tables: [{ columns: [{ key: 'name', label: '导师' }], rows: [{ name: '\u0000=cmd' }] }],
  })
  assert.ok(ctrlCsv.includes("'\u0000=cmd"))
})

test('回归测试 [Iter 13 / Challenger M5.1_12]: 0.0.0.0 API 脱敏与外链阻断、preGuard 先于 stripInternalTokens 剥离内部代码块及小写 dsml', async () => {
  const { dedupeSources, safePublicWebUrl } = await import('../lib/export/model.js')

  // 1. Defect 1: http(s)://0.0.0.0:3210/api/... redaction & prototype-key guard across text/title/filename
  const zeroApiVectors = [
    'http://0.0.0.0:3210/api/foo）constructor.md',
    'https://0.0.0.0:3210/api/mentors',
    'http://0.0.0.0/api/a,__proto__.md',
  ]
  for (const vec of zeroApiVectors) {
    for (const out of [sanitizeText(vec), sanitizeTitleText(vec), sanitizeExportFilename(vec)]) {
      assert.doesNotMatch(out, /0\.0\.0\.0/, `不应泄漏 0.0.0.0: ${vec}`)
      assert.doesNotMatch(out, /\[native code\]|function Object|\[object Object\]/, `不应泄漏原型信息: ${vec}`)
      assert.ok(out.includes('内部查询'), `应脱敏为内部查询: ${vec} -> ${out}`)
    }
  }

  // Hyperlink blocking for 0.0.0.0 (both /api/ and non-/api/) in safePublicWebUrl, dedupeSources, and all 6 formats
  assert.equal(safePublicWebUrl('http://0.0.0.0:3210/api/mentors'), null)
  assert.equal(safePublicWebUrl('https://0.0.0.0:3210/other'), null)
  assert.equal(safePublicWebUrl('https://example.com/constructor.md'), 'https://example.com/constructor.md')

  const deduped = dedupeSources([
    { id: 'S1', title: '内部接口', kind: '内部', url: 'http://0.0.0.0:3210/api/mentors' },
    { id: 'S2', title: '本地非API', kind: '内部', url: 'https://0.0.0.0:3210/report' },
    { id: 'S3', title: '合法官网', kind: '学校官网', url: 'https://example.com/constructor.md' },
  ])
  assert.equal(deduped[0].url, undefined)
  assert.equal(deduped[1].url, undefined)
  assert.equal(deduped[2].url, 'https://example.com/constructor.md')

  const zeroCustomDoc = buildCustomDocument({
    title: '零地址测试 http://0.0.0.0:3210/api/mentors',
    content: '查询地址 http://0.0.0.0:3210/api/mentors 以及 [链接](http://0.0.0.0:3210/api/foo）constructor.md) 和 [非API链接](http://0.0.0.0:3210/secret) 与 [公开链接](https://example.com/guide.pdf)',
    sources: [
      { id: 'S1', title: '本地接口来源', kind: '内部', url: 'http://0.0.0.0:3210/api/mentors' },
      { id: 'S2', title: '公开来源', kind: '学校官网', url: 'https://example.com/guide.pdf' },
    ],
  })
  const zeroChatDoc = buildChatDocument({
    chat: {
      id: 'c-zero',
      title: '测试 http://0.0.0.0:3210/api/mentors',
      messages: [
        { id: 'u1', role: 'user', content: '接口 http://0.0.0.0:3210/api/mentors' },
        {
          id: 'a1',
          role: 'assistant',
          status: 'complete',
          content: '结果来自 http://0.0.0.0:3210/api/foo）constructor.md',
          sources: [{ id: 'S1', title: '本地来源', kind: '内部', url: 'http://0.0.0.0:3210/api/mentors' }],
        },
      ],
    },
  })
  const zeroDossierDoc = buildDossierDocument({
    insight: { name: '测试导师', college: '计算机学院', homepage: 'http://0.0.0.0:3210/home' },
    detail: { name: '测试导师', college: '计算机学院', sources: [{ id: 'S1', title: '接口', url: 'http://0.0.0.0:3210/api/mentors' }] },
  })

  for (const doc of [zeroCustomDoc, zeroChatDoc, zeroDossierDoc]) {
    assert.ok(doc.sources.every(s => !s.safeUrl || !s.safeUrl.includes('0.0.0.0')))
    for (const fmt of EXPORT_FORMATS) {
      const res = await exportDocument(doc, fmt, fmt === 'pdf' ? { engine: 'pdfkit' } : {})
      if (!res.binary) {
        const text = String(res.body)
        assert.doesNotMatch(text, /0\.0\.0\.0/, `${fmt} 不应包含 0.0.0.0`)
        assert.doesNotMatch(text, /\[native code\]/)
      } else if (fmt === 'xlsx') {
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(res.body)
        for (const ws of wb.worksheets) {
          const rows = await readSheet(res.body, ws.name)
          const flat = rows.flat().map(v => String(v ?? '')).join('\n')
          assert.doesNotMatch(flat, /0\.0\.0\.0/)
          ws.eachRow(row => {
            row.eachCell(cell => {
              const val = cell.value
              if (val && typeof val === 'object' && val.hyperlink) {
                assert.doesNotMatch(String(val.hyperlink), /0\.0\.0\.0/)
              }
            })
          })
        }
      } else if (fmt === 'docx') {
        const files = unzipSync(new Uint8Array(res.body))
        const docXml = Buffer.from(files['word/document.xml']).toString('utf8')
        const relsXml = files['word/_rels/document.xml.rels']
          ? Buffer.from(files['word/_rels/document.xml.rels']).toString('utf8')
          : ''
        assert.doesNotMatch(docXml, /0\.0\.0\.0/)
        assert.doesNotMatch(relsXml, /0\.0\.0\.0/)
      } else {
        assert.match(res.body.subarray(0, 16).toString('ascii'), /^%PDF-1\./)
      }
    }
  }
  const zeroHtml = renderHtml(zeroCustomDoc)
  assert.ok(zeroHtml.includes('https://example.com/guide.pdf'))
  assert.doesNotMatch(zeroHtml, /<a[^>]+0\.0\.0\.0/i)
  const zeroMd = renderMarkdown(zeroCustomDoc)
  assert.ok(zeroMd.includes('[公开链接](https://example.com/guide.pdf)'))
  assert.doesNotMatch(zeroMd, /0\.0\.0\.0/)

  // 2. Defect 2: preGuardPublicText / convergeInternalMarkers runs BEFORE stripInternalTokens
  const fencedInternalVectors = [
    ['sql_mentor_id', '正文前\n```sql\nSELECT * FROM mentors WHERE mentor_id = "mentor-abcdef123456"\n```\n正文后', /SELECT|FROM mentors|mentor-abcdef123456/],
    ['log_source_locator', '开始\n```log\n[TRACE] source_locator=导师评价.md:L10 student_id=s1 exam_id=e1 review_id=r1\n```\n结束', /TRACE|source_locator|student_id|exam_id|review_id/],
    ['txt_profile_id', '标题\n```txt\nprofile_id: profile-1234567890ab\n```\n收尾', /profile_id|profile-1234567890ab/],
  ]
  for (const [label, vec, forbiddenRe] of fencedInternalVectors) {
    assert.doesNotMatch(sanitizeText(vec), forbiddenRe, `sanitizeText 应剥离内部代码块 (${label})`)
    assert.doesNotMatch(sanitizeTitleText(vec), forbiddenRe, `sanitizeTitleText 应剥离内部代码块 (${label})`)
    assert.doesNotMatch(sanitizeExportFilename(vec), forbiddenRe, `sanitizeExportFilename 应剥离内部代码块 (${label})`)
    assert.ok(sanitizeText(vec).includes('正文前') || sanitizeText(vec).includes('开始') || sanitizeText(vec).includes('标题'))

    const cDoc = buildCustomDocument({ title: vec, content: vec })
    const chatFencedDoc = buildChatDocument({
      chat: {
        title: vec,
        messages: [
          { id: 'u1', role: 'user', content: '请汇总' },
          { id: 'a1', role: 'assistant', status: 'complete', content: vec },
        ],
      },
    })
    for (const doc of [cDoc, chatFencedDoc]) {
      for (const fmt of EXPORT_FORMATS) {
        const res = await exportDocument(doc, fmt, fmt === 'pdf' ? { engine: 'pdfkit' } : {})
        if (!res.binary) {
          assert.doesNotMatch(String(res.body), forbiddenRe, `${label} (${fmt}) 不应泄漏内部代码块`)
        } else if (fmt === 'xlsx') {
          const wb = new ExcelJS.Workbook()
          await wb.xlsx.load(res.body)
          for (const ws of wb.worksheets) {
            const flat = (await readSheet(res.body, ws.name)).flat().map(v => String(v ?? '')).join('\n')
            assert.doesNotMatch(flat, forbiddenRe, `${label} (xlsx) 不应泄漏内部代码块`)
          }
        } else if (fmt === 'docx') {
          const xml = Buffer.from(unzipSync(new Uint8Array(res.body))['word/document.xml']).toString('utf8')
          assert.doesNotMatch(xml, forbiddenRe, `${label} (docx) 不应泄漏内部代码块`)
        } else {
          assert.match(res.body.subarray(0, 16).toString('ascii'), /^%PDF-1\./)
        }
      }
    }
  }

  // Lowercase DSML stripping & safe non-internal code blocks + existing contracts preserved
  assert.equal(sanitizeText('安全前缀 <｜dsml｜function_calls><｜dsml｜invoke name="query"></｜dsml｜invoke>'), '安全前缀 ')
  assert.equal(sanitizeTitleText('标题 <|dsml|function_calls>hidden'), '标题 ')
  assert.equal(sanitizeExportFilename('报告 <｜dsml｜function_calls>hidden'), '报告')

  const safeCodeDoc = buildCustomDocument({
    title: '安全代码块测试',
    content: '示例：\n```js\nconst x = 1;\n```',
  })
  assert.ok(renderMarkdown(safeCodeDoc).includes('const x = 1;'))
  assert.ok(renderHtml(safeCodeDoc).includes('const x = 1;'))

  assert.equal(sanitizeTitleText('导师评价.md'), '导师评价')
  assert.equal(sanitizeTitleText('初试结果.md'), '初试成绩资料')
  assert.equal(sanitizeTitleText('复试结果.md'), '复试结果资料')
  assert.equal(sanitizeTitleText('https://example.com/constructor.md'), 'https://example.com/constructor.md')
  assert.equal(sanitizeExportFilename('/Users/alice/reports/5星导师.xlsx'), '5星导师.xlsx')
  assert.equal(sanitizeExportFilename('推荐导师清单'), '推荐导师清单')
  assert.equal(sanitizeExportFilename('导师对比报告'), '导师对比报告')
})

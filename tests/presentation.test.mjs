import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publicArtifact, publicText } from '../lib/presentation.js'
import { fieldLabels } from '../lib/fields.js'
import { formatAcademicSummary, formatDisciplineText, formatTableField } from '../src/presentation.js'

test('publicArtifact formats single-value and ranged scale labels without / 5 5 duplication', () => {
  const singleBar = publicArtifact({
    id: 'art-single',
    type: 'bar',
    title: '评分对比',
    x: 'name',
    y: ['rating'],
    columns: [
      { key: 'name', label: '导师', type: 'string' },
      { key: 'rating', label: fieldLabels.rating, type: 'number' },
    ],
    rows: [
      { name: '付俊松', rating: 5 },
      { name: '郭燕慧', rating: 5 },
    ],
  })
  assert.equal(singleBar.description, '培养体验评分 5 / 5')
  assert.doesNotMatch(singleBar.description, /\/\s*5\s+5/)

  const rangedBar = publicArtifact({
    id: 'art-range',
    type: 'bar',
    title: '评分分布',
    x: 'name',
    y: ['rating'],
    columns: [
      { key: 'name', label: '导师', type: 'string' },
      { key: 'rating', label: fieldLabels.rating, type: 'number' },
    ],
    rows: [
      { name: '甲导师', rating: 3 },
      { name: '乙导师', rating: 5 },
    ],
  })
  assert.equal(rangedBar.description, '培养体验评分 3–5（满分 5）')

  const scatter = publicArtifact({
    id: 'art-scatter',
    type: 'scatter',
    title: '评分与补助',
    x: 'rating',
    y: ['stipend_monthly_min'],
    columns: [
      { key: 'rating', label: fieldLabels.rating, type: 'number' },
      { key: 'stipend_monthly_min', label: fieldLabels.stipend_monthly_min, type: 'number' },
    ],
    rows: [
      { rating: 4, stipend_monthly_min: 800 },
      { rating: 5, stipend_monthly_min: 1500 },
    ],
  })
  assert.equal(scatter.description, '培养体验评分 4–5（满分 5） · 月劳务记录低值（元） 800–1,500')

  const plainLine = publicArtifact({
    id: 'art-line',
    type: 'line',
    title: '初试均分趋势',
    x: 'year',
    y: ['score_first_mean'],
    columns: [
      { key: 'year', label: '年份', type: 'number' },
      { key: 'score_first_mean', label: fieldLabels.score_first_mean, type: 'number' },
    ],
    rows: [
      { year: 2024, score_first_mean: 345 },
      { year: 2025, score_first_mean: 360 },
    ],
  })
  assert.equal(plainLine.description, '年份 2024–2025 · 历史初试均分 345–360')
})

test('publicArtifact single-value rating in scatter or single-row bar never duplicates / 5 5', () => {
  const singleScatter = publicArtifact({
    id: 'art-single-scatter',
    type: 'scatter',
    title: '单点评分与补助',
    x: 'rating',
    y: ['stipend_monthly_min'],
    columns: [
      { key: 'rating', label: fieldLabels.rating, type: 'number' },
      { key: 'stipend_monthly_min', label: fieldLabels.stipend_monthly_min, type: 'number' },
    ],
    rows: [{ rating: 5, stipend_monthly_min: 1200 }],
  })
  assert.equal(singleScatter.description, '培养体验评分 5 / 5 · 月劳务记录低值（元） 1,200')
  assert.doesNotMatch(singleScatter.description, /\/\s*5\s+5/)
})

test('fieldLabels.rating remains intact for table and SVG legend contracts', () => {
  assert.equal(fieldLabels.rating, '培养体验评分 / 5')
  assert.equal(publicText('导师评级良好'), '导师评级良好')
})

test('formatDisciplineText normalizes scraped prefixes and pipe-delimited discipline codes', () => {
  const raw = '指导学科：指导学博学科: 083900|网络空间安全\n指导专博学科: 085412|网络与信息安全'
  assert.equal(
    formatDisciplineText(raw),
    '学术博士：083900 · 网络空间安全\n专业博士：085412 · 网络与信息安全'
  )

  const masters = '学校官网·招生与指导学科：指导学科：指导学硕、博学科: 083900|网络空间安全'
  assert.equal(
    formatDisciplineText(masters),
    '学校官网·招生与指导学科：学硕 / 学博：083900 · 网络空间安全'
  )

  assert.equal(formatDisciplineText('指导专硕学科: 085401|新一代电子信息技术（含量子技术等）'), '专业硕士：085401 · 新一代电子信息技术（含量子技术等）')
})

test('formatAcademicSummary removes redundant title prefixes and pure-title duplicates', () => {
  assert.equal(formatAcademicSummary('高级工程师', '高级工程师'), null)
  assert.equal(formatAcademicSummary('副教授；北京邮电大学副教授付俊松长期从事安全研究', '副教授'), '北京邮电大学副教授付俊松长期从事安全研究')
  assert.equal(formatAcademicSummary('教授级高级工程师；主持多项省部级项目', ''), '主持多项省部级项目')
  assert.equal(formatAcademicSummary('职称：研究员；担任实验室主任', '研究员'), '担任实验室主任')
  assert.equal(formatAcademicSummary('教授，国家杰青', '教授'), '国家杰青')
  assert.equal(formatAcademicSummary('教授，国家杰青', ''), '国家杰青')
  assert.equal(formatAcademicSummary('副教授/博导，长期从事安全研究', '副教授'), '博导，长期从事安全研究')
  assert.equal(formatAcademicSummary('副教授·网络空间安全', '副教授'), '网络空间安全')
})

test('formatDisciplineText handles null/empty and multi-pipe text cleanly', () => {
  assert.equal(formatDisciplineText(null), '')
  assert.equal(formatDisciplineText(''), '')
  assert.equal(formatDisciplineText('人工智能|机器学习|大模型'), '人工智能 · 机器学习 · 大模型')
  assert.equal(formatDisciplineText('A|B|C'), 'A · B · C')
  assert.equal(formatDisciplineText('A|B|C|D'), 'A · B · C · D')
})

test('publicArtifact guards chart columns missing label without throwing', () => {
  const bar = publicArtifact({
    id: 'art-no-label',
    type: 'bar',
    title: '合成图表',
    x: 'name',
    y: ['score'],
    columns: [
      { key: 'name', type: 'string' },
      { key: 'score', type: 'number' },
    ],
    rows: [
      { name: '甲', score: 85 },
      { name: '乙', score: 92 },
    ],
  })
  assert.equal(bar.description, 'score 85–92')
})

test('publicArtifact normalizes research_areas and discipline pipes idempotently', () => {
  const table = publicArtifact({
    id: 'art-discipline',
    type: 'table',
    purpose: 'recommendation',
    title: '推荐导师',
    columns: [
      { key: 'name', label: '导师', type: 'string' },
      { key: 'research_areas', label: '研究领域', type: 'string' },
      { key: 'doctoral_evidence', label: '博士招生依据', type: 'string' },
    ],
    rows: [
      {
        name: '测试导师',
        research_areas: '083900|网络空间安全、大模型安全',
        doctoral_evidence: '指导学科：指导学博学科: 083900|网络空间安全',
      },
    ],
  })
  assert.equal(table.rows[0].research_areas, '083900 · 网络空间安全、大模型安全')
  assert.equal(table.rows[0].doctoral_evidence, '学术博士：083900 · 网络空间安全')
  assert.deepEqual(publicArtifact(table), table)
})

test('formatTableField unifies discipline, academic_summary, and non-special column formatting', () => {
  assert.equal(
    formatTableField('doctoral_evidence', '指导学科：指导学博学科：083900|网络空间安全'),
    '学术博士：083900 · 网络空间安全'
  )
  assert.equal(
    formatTableField('profile_evidence', '指导专博学科：085400|电子信息'),
    '专业博士：085400 · 电子信息'
  )
  assert.equal(
    formatTableField('admissions', '学校官网·招生与指导学科：指导学科：指导学博学科: 083900|网络空间安全\n指导专博学科: 085412|网络与信息安全'),
    '学校官网·招生与指导学科：学术博士：083900 · 网络空间安全\n专业博士：085412 · 网络与信息安全'
  )
  assert.equal(
    formatTableField('academic_summary', '教授，国家杰青，发表顶会多篇', '教授'),
    '国家杰青，发表顶会多篇'
  )
  assert.equal(
    formatTableField('academic_summary', '教授，国家杰青，发表顶会多篇'),
    '国家杰青，发表顶会多篇'
  )
  assert.equal(
    formatTableField('academic_summary', '副教授/IEEE Senior Member', '副教授'),
    'IEEE Senior Member'
  )
  assert.equal(
    formatTableField('academic_summary', '副教授/IEEE Senior Member'),
    'IEEE Senior Member'
  )
  assert.equal(
    formatTableField('academic_summary', '高级工程师', '高级工程师'),
    null
  )
  assert.equal(formatTableField('name', '测试导师甲', '教授'), '测试导师甲')
  assert.equal(formatTableField('internship', '允许实习', '副教授'), '允许实习')
})

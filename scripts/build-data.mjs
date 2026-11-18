import {APP_NAME} from '../lib/brand.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readSheet } from 'read-excel-file/node'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = name => fs.readFile(path.join(root, name), 'utf8')
const table = text => text.split(/\r?\n/).filter(line => /^\|\s*\d+\s*\|/.test(line))
  .map(line => line.replaceAll('\\|', '\u0000').split('|').slice(1, -1).map(s => s.trim().replaceAll('\u0000', '|')))
const num = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value)
const matches = (name, masked) => [...name].length === [...masked].length && [...masked].every((c, i) => c === '*' || c === [...name][i])
const mean = values => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100 : null
const median = values => values.length ? mean(values.toSorted((a, b) => a - b).slice(Math.floor((values.length - 1) / 2), Math.floor(values.length / 2) + 1)) : null

await fs.mkdir(path.join(root, '.local'), { recursive: true })
const mapFile = path.join(root, '.local/private-id-map.json')
let privateIds = {}
try { privateIds = JSON.parse(await fs.readFile(mapFile, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const id = (kind, value) => privateIds[`${kind}:${value}`] ||= `${kind}-${randomUUID().replaceAll('-', '').slice(0, 12)}`

const [firstText, secondText, canonical, workbook] = await Promise.all([
  read('初试结果.md'), read('复试结果.md'), read('data/dataset.json').then(JSON.parse),
  readSheet(path.join(root, '网络空间安全学院研究生分班表.xlsx')),
])
const [headers, ...rawRows] = workbook
const roster = rawRows.filter(row => row[1] != null).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])))
const first = table(firstText), second = table(secondText)
const finalById = new Map(second.map(row => [row[1], row]))
if (first.length !== new Set(first.map(row => row[1])).size || first.length !== second.length) throw new Error('成绩记录数量或考生唯一性不一致')

const college = '网络空间安全学院'
const mentorMap = new Map()
function mentor(name) {
  name = name.replace(/（兼）/g, '').trim()
  if (!mentorMap.has(name)) mentorMap.set(name, {
    mentor_id: id('mentor', name), name, college, group: null, directions: '', personal_directions: null, rating: null,
    stipend_monthly_min: null, stipend_monthly_max: null, stipend_text: null,
    management: null, internship: null, graduation: null, review_text: null, review_note: null, group_context: null,
    student_count: 0, exam_count: 0, recommended_count: 0, exam_ratio: null, recommended_ratio: null,
    score_first_min: null, score_first_mean: null, score_first_median: null, score_first_max: null,
    source_ids: [],
  })
  return mentorMap.get(name)
}
for (const row of canonical.mentors) mentorMap.set(row.name,{...row,student_count:0,exam_count:0,recommended_count:0})
for (const s of roster) mentor(String(s['导师']))
// Reviews are the current curated records; rebuilding scores must not restore superseded prose.
const reviews=canonical.reviews

const linked = new Map(), ambiguousIds = new Set(), studentNames={students:{},exams:{}}
const exams = first.map(row => {
  const r = finalById.get(row[1])
  if (!r) throw new Error('初复试记录缺少相同考生编号')
  const admitted = r[12] === '是'
  const candidates = admitted ? roster.filter(s => s['专业'] === row[4] && matches(String(s['姓名']), row[2])) : []
  const unique = candidates.length === 1
  if (candidates.length > 1) candidates.forEach(s => ambiguousIds.add(String(s['学号'])))
  const student = unique ? candidates[0] : null
  const record = {
    exam_id: id('exam', row[1]), student_id: student ? id('student', String(student['学号'])) : null,
    mentor_id: student ? mentor(String(student['导师'])).mentor_id : null,
    mentor_name: student ? String(student['导师']) : null,
    college, year: 2026, program_code: row[3], program: row[4],
    score_first: num(row[10]), politics: num(row[6]), foreign_language: num(row[7]), subject_one: num(row[8]), subject_two: num(row[9]),
    score_reexam: num(r[9]), score_total: num(r[11]), admitted,
    match_status: !admitted ? 'not_admitted' : unique ? 'unique' : candidates.length ? 'ambiguous' : 'unmatched',
    rank_first: null, rank_first_program: null, source_ids: ['S2', ...(student ? ['S3'] : [])],
  }
  studentNames.exams[record.exam_id]=student?String(student['姓名']).trim():row[2]
  if (student) {
    const key = String(student['学号'])
    if (linked.has(key)) throw new Error('同一学生关联多个考生；需要人工核对，禁止覆盖')
    linked.set(key, record)
  }
  return record
})
for (const e of exams) {
  e.rank_first = 1 + exams.filter(other => other.score_first > e.score_first).length
  e.rank_first_program = 1 + exams.filter(other => other.program_code === e.program_code && other.score_first > e.score_first).length
}
const students = roster.map(s => {
  const e = linked.get(String(s['学号']))
  const m = mentor(String(s['导师']))
  m.student_count++
  if (!m.source_ids.includes('S3')) m.source_ids.push('S3')
  studentNames.students[id('student',String(s['学号']))]=String(s['姓名']).trim()
  return {
    student_id: id('student', String(s['学号'])), mentor_id: m.mentor_id, mentor_name: m.name,
    college: String(s['学院']), program: String(s['专业']),
    admission_type: e?.score_first != null ? 'exam' : 'recommended',
    exam_id: e?.exam_id ?? null,
    match_status: e ? 'unique' : ambiguousIds.has(String(s['学号'])) ? 'ambiguous' : 'unlinked',
    score_first: e?.score_first ?? null, score_reexam: e?.score_reexam ?? null, score_total: e?.score_total ?? null,
    rank_first: e?.rank_first ?? null, rank_first_program: e?.rank_first_program ?? null,
    source_ids: ['S2', 'S3'],
  }
})
for (const m of mentorMap.values()) {
  const values = exams.filter(e => e.mentor_id === m.mentor_id).map(e => e.score_first).filter(x => x != null)
  m.exam_count = values.length
  m.recommended_count = m.student_count - m.exam_count
  m.exam_ratio = m.student_count ? Math.round(m.exam_count / m.student_count * 10000) / 100 : null
  m.recommended_ratio = m.student_count ? Math.round(m.recommended_count / m.student_count * 10000) / 100 : null
  if (m.student_count && !m.source_ids.includes('S2')) m.source_ids.push('S2')
  m.score_first_min = values.length ? Math.min(...values) : null
  m.score_first_max = values.length ? Math.max(...values) : null
  m.score_first_mean = mean(values)
  m.score_first_median = median(values)
}
const dataset = {
  metadata: {
    ...canonical.metadata,
    name: APP_NAME, version: canonical.metadata.version, year: 2026, colleges: [college],
    scope: '北京邮电大学网络空间安全学院；2026 年资料快照',
    counts: { mentors: mentorMap.size, students: students.length, exams: exams.length, reviews: reviews.length, linked_exams: linked.size, ambiguous_exams: exams.filter(e => e.match_status === 'ambiguous').length,
      exam_students: students.filter(s => s.admission_type === 'exam').length, recommended_students: students.filter(s => s.admission_type === 'recommended').length },
    notes: canonical.metadata.notes,
  },
  mentors: [...mentorMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
  students, exams, reviews,
  sources: canonical.sources,
}
await fs.mkdir(path.join(root, 'data'), { recursive: true })
await fs.writeFile(path.join(root, 'data/dataset.json'), JSON.stringify(dataset, null, 2) + '\n')
await fs.writeFile(mapFile, JSON.stringify(privateIds, null, 2), { mode: 0o600 })
await fs.writeFile(path.join(root,'.local/student-names.json'),JSON.stringify(studentNames,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify(dataset.metadata, null, 2))

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { loadData } from '../lib/data.js'
import { createMentorIndex } from '../lib/search.js'
import { mentorInsight } from '../lib/insights.js'
import {
  MENTOR_FILTER_GROUPS,
  MENTOR_FILTERS,
  MENTOR_FILTER_MAP,
  splitMentorColleges,
  filterMentors,
  computeFacetCounts,
} from '../lib/mentor-filters.js'

// 与 server/index.mjs 的 insights() 完全一致地构造速查使用的全校导师集。
// 不能只取 mentors 数据集（仅 414 人），还要合并没有自有导师记录的官网老师（合计 1309 人）。
function buildAllMentors(data) {
  const names = [...new Set(data.mentors.map(mentor => mentor.name))]
  const pages = new Map()
  const normalizeCollege = college => (data.metadata?.colleges || []).find(name => college?.startsWith(name + '（') || college?.startsWith(name + '(')) || college
  for (const page of data.profiles || []) {
    const normCollege = normalizeCollege(page.college)
    for (const key of [page.mentor_id, `${normCollege}:${page.name}`, `${page.college}:${page.name}`].filter(Boolean)) {
      if (!pages.has(key) || page.source_type === '学校官网') pages.set(key, page)
    }
  }
  const mentors = {}
  for (const row of createMentorIndex(data).rows) {
    const insight = mentorInsight(row, names), page = pages.get(row.mentor_id) || pages.get(`${row.college}:${row.name}`)
    const doctoralPrograms = [page?.doctoral_academic && `学博：${page.doctoral_academic}`, page?.doctoral_professional && `专博：${page.doctoral_professional}`].filter(Boolean).join(' · ') || null
    mentors[`${row.college}:${row.name}`] = {
      key: row.mentor_id || 'candidate-' + createHash('sha256').update((row.college || '') + ':' + row.name).digest('hex').slice(0, 12),
      name: row.name, college: row.college, group: row.group || null, rating: row.rating ?? null,
      doctoral: Boolean(row.can_supervise_doctoral), doctoralPrograms,
      title: page?.professional_title || row.professional_title || null, email: page?.contact_email || null,
      homepage: page?.source_type === '学校官网' ? page.url : null,
      directions: row.personal_directions || page?.research_areas || row.research_areas || row.directions || null,
      academicSummary: row.academic_summary || null, enrollmentSignal: row.enrollment_signal || null,
      biography: page?.biography?.slice(0, 480) || null, projects: page?.projects?.slice(0, 520) || null,
      achievements: page?.achievements?.slice(0, 520) || null, admissions: page?.admissions?.slice(0, 260) || null,
      scoreFirstMax: row.score_first_max ?? null, students: row.student_count ?? null,
      exam: row.exam_count ?? null, recommended: row.recommended_count ?? null,
      ...insight,
    }
  }
  return Object.values(mentors)
}

const allMentors = buildAllMentors(loadData())
// 速查地图以「学院:姓名」为键，同名双聘导师也各自保留一条，故该键在全集中唯一。
const keyOf = item => `${item.college}:${item.name}`

test('三个筛选分组齐全，全部 32 个筛选项在全校 1309 位导师上均有匹配', () => {
  assert.ok(allMentors.length >= 1300, `全校导师集不完整，仅 ${allMentors.length} 人`)
  assert.deepEqual(MENTOR_FILTER_GROUPS.map(group => group.id), ['conditions', 'qualifications', 'directions'])
  assert.deepEqual(MENTOR_FILTER_GROUPS.map(group => group.label), ['培养条件', '口碑资质', '研究方向'])
  assert.equal(MENTOR_FILTERS.length, 32)
  assert.equal(MENTOR_FILTER_MAP.size, 32)

  const seen = new Set()
  for (const group of MENTOR_FILTER_GROUPS) {
    assert.ok(group.filters.length > 0, `${group.label} 不能没有筛选项`)
    for (const def of group.filters) {
      assert.ok(MENTOR_FILTER_MAP.has(def.id), `MENTOR_FILTER_MAP 缺少 ${def.id}`)
      assert.equal(MENTOR_FILTER_MAP.get(def.id).group, group.id)
      assert.equal(MENTOR_FILTER_MAP.get(def.id).label, def.label)
      assert.equal(typeof MENTOR_FILTER_MAP.get(def.id).test, 'function')
      assert.ok(!seen.has(def.id), `筛选项 id 重复：${def.id}`)
      seen.add(def.id)
    }
  }

  for (const def of MENTOR_FILTERS) {
    const direct = allMentors.filter(item => def.test(item)).length
    assert.ok(direct > 0, `「${def.label}」(${def.id}) 没有匹配任何真实导师，属于死筛选项`)
    // 研究方向由 filterMentors 单独按 directionMode 处理，单选项时与逐条 test 等价。
    assert.equal(filterMentors(allMentors, { filters: [def.id] }).length, direct, `「${def.label}」筛选人数与 test 不一致`)
  }
})

test('多选条件严格取交集并单调收敛，搜索词独立于标签', () => {
  const progressions = [
    [['internship_ok'], ['internship_ok', 'no_clock'], ['internship_ok', 'no_clock', 'doctoral']],
    [['internship_ok'], ['internship_ok', 'resources'], ['internship_ok', 'resources', 'rating_4']],
  ]

  for (const progression of progressions) {
    let previous = new Set(allMentors.map(keyOf))
    for (const filters of progression) {
      const result = filterMentors(allMentors, { filters })
      assert.ok(result.length > 0, `${filters.join('+')} 不应为空`)
      const current = new Set(result.map(keyOf))
      // 每叠加一个条件只能收缩，不能出现重新放大的导师。
      for (const key of current) assert.ok(previous.has(key), `${key} 在叠加 ${filters.join('+')} 后不应重新出现`)
      assert.ok(current.size <= previous.size)
      // 每位结果必须真正满足全部已选条件，而不是只看第一个标签。
      for (const item of result) {
        for (const id of filters) assert.equal(MENTOR_FILTER_MAP.get(id).test(item), true, `${keyOf(item)} 不满足 ${id}`)
      }
      previous = current
    }
  }

  // 「傅俊松」是常见同音写法：检索层通过 nameVariants 命中真实姓名「付俊松」，
  // 因此这里用同音词验证搜索词与多选标签彼此独立。
  const query = '傅俊松', homophone = '付俊松', filters = ['internship_ok', 'no_clock', 'resources']
  const byQuery = filterMentors(allMentors, { query })
  const byHomophone = filterMentors(allMentors, { query: homophone })
  assert.ok(byQuery.length > 0)
  assert.deepEqual(byQuery.map(keyOf), byHomophone.map(keyOf))
  assert.equal(byQuery.length, 1)

  const combined = filterMentors(allMentors, { query, filters })
  assert.equal(combined.length, 1, '搜索词与多选标签叠加后应精准命中同一位网安院导师')
  assert.equal(combined[0].college, '网络空间安全学院')
  assert.equal(keyOf(combined[0]), keyOf(byQuery[0]))
  for (const id of filters) assert.equal(MENTOR_FILTER_MAP.get(id).test(combined[0]), true)
})

test('学院多选按并集合并，再与筛选条件取交集', () => {
  const colleges = ['网络空间安全学院', '计算机学院'], filters = ['doctoral', 'internship_ok']
  const single = colleges.map(college => filterMentors(allMentors, { colleges: [college] }))
  const unionKeys = new Set(single.flat().map(keyOf))
  const union = filterMentors(allMentors, { colleges })
  assert.equal(union.length, unionKeys.size, '多选学院应等于各学院并集且去重')
  assert.ok(union.length > 0)

  const combined = filterMentors(allMentors, { colleges, filters })
  assert.ok(combined.length > 0)
  assert.ok(combined.length < union.length, '叠加筛选条件后应严格缩小范围')
  for (const item of combined) {
    assert.ok(colleges.some(college => item.college === college || splitMentorColleges(item.college).includes(college)), `${keyOf(item)} 不在所选学院内`)
    for (const id of filters) assert.equal(MENTOR_FILTER_MAP.get(id).test(item), true, `${keyOf(item)} 不满足 ${id}`)
  }

  const filterOnlyKeys = new Set(filterMentors(allMentors, { filters }).map(keyOf))
  const expected = [...unionKeys].filter(key => filterOnlyKeys.has(key))
  assert.equal(combined.length, expected.length, '学院并集与筛选条件必须按 AND 交集计算')
  assert.deepEqual(new Set(combined.map(keyOf)), new Set(expected))
})

test('研究方向多选支持 AND 交集与 OR 并集，OR 人数等于两个方向并集去重', () => {
  const filters = ['dir_llm', 'dir_6g']
  const andResult = filterMentors(allMentors, { filters, directionMode: 'and' })
  const orResult = filterMentors(allMentors, { filters, directionMode: 'or' })
  assert.ok(andResult.length > 0)
  assert.ok(orResult.length > andResult.length, 'OR 模式应严格大于 AND 模式')

  for (const item of andResult) for (const id of filters) assert.equal(MENTOR_FILTER_MAP.get(id).test(item), true)
  for (const item of orResult) assert.ok(filters.some(id => MENTOR_FILTER_MAP.get(id).test(item)), `${keyOf(item)} 不满足任一研究方向`)

  const union = new Map([...filterMentors(allMentors, { filters: ['dir_llm'] }), ...filterMentors(allMentors, { filters: ['dir_6g'] })].map(item => [keyOf(item), item]))
  assert.equal(orResult.length, union.size, 'OR 人数应等于两个方向匹配并集去重')
  assert.deepEqual(new Set(orResult.map(keyOf)), new Set(union.keys()))
  // AND 结果必须是两个单方向结果的共同子集。
  for (const item of andResult) {
    assert.ok(union.has(keyOf(item)))
  }
  const llmKeys = new Set(filterMentors(allMentors, { filters: ['dir_llm'] }).map(keyOf))
  const sixGKeys = new Set(filterMentors(allMentors, { filters: ['dir_6g'] }).map(keyOf))
  assert.equal(andResult.length, [...llmKeys].filter(key => sixGKeys.has(key)).length)
})

test('computeFacetCounts 的未选筛选项与学院计数等于真实筛选人数', () => {
  const query = '安全'
  const colleges = ['网络空间安全学院', '计算机学院']
  const filters = ['internship_ok', 'doctoral']
  const collegeList = [...colleges]
  const options = { query, colleges, filters, directionMode: 'and', collegeList }
  const facets = computeFacetCounts(allMentors, options)

  assert.deepEqual(new Set(Object.keys(facets.filterCounts)), new Set(MENTOR_FILTERS.map(def => def.id)))
  const currentMatched = filterMentors(allMentors, options).length

  for (const def of MENTOR_FILTERS) {
    if (filters.includes(def.id)) {
      // 已选项继续叠加自身不会改变交集人数。
      assert.equal(facets.filterCounts[def.id], currentMatched, `已选项「${def.label}」计数应等于当前交集人数`)
      continue
    }
    const expected = filterMentors(allMentors, { ...options, filters: [...filters, def.id] }).length
    assert.equal(facets.filterCounts[def.id], expected, `「${def.label}」计数与加入该筛选项后的真实人数不一致`)
  }

  for (const college of collegeList) {
    const expected = filterMentors(allMentors, { ...options, colleges: [college] }).length
    assert.equal(facets.collegeCounts[college], expected, `${college} 的 facet 人数不等于单选该学院叠加 query + filters 的人数`)
  }
})

test('双聘、多学院字符串归一化后能被任一学院筛选命中', () => {
  assert.deepEqual(splitMentorColleges('人工智能学院、未来学院（兼）'), ['人工智能学院', '未来学院'])
  assert.deepEqual(splitMentorColleges('计算机学院（国家示范性软件学院）、网络空间安全学院'), ['计算机学院', '网络空间安全学院'])
  assert.deepEqual(splitMentorColleges(''), [])

  // 真实数据中的双聘导师：拆出的每个学院都必须是筛选入口。
  const dual = allMentors.find(item => splitMentorColleges(item.college).length > 1)
  assert.ok(dual, '数据中应存在双聘导师记录')
  for (const college of splitMentorColleges(dual.college)) {
    assert.ok(filterMentors(allMentors, { colleges: [college] }).some(item => keyOf(item) === keyOf(dual)), `${college} 未命中双聘导师 ${keyOf(dual)}`)
  }

  // 用真实导师克隆出需求中的双聘字符串，验证「未来学院」这类兼任学院同样可被筛选。
  const base = allMentors.find(item => item.college === '人工智能学院')
  assert.ok(base)
  const fixture = { ...base, college: '人工智能学院、未来学院（兼）' }
  assert.equal(filterMentors([fixture], { colleges: ['人工智能学院'] }).length, 1)
  assert.equal(filterMentors([fixture], { colleges: ['未来学院'] }).length, 1)
  assert.equal(filterMentors([fixture], { colleges: ['计算机学院'] }).length, 0)
})

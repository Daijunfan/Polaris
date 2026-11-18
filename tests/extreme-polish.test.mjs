import test from 'node:test'
import assert from 'node:assert/strict'
import {loadData} from '../lib/data.js'
import {createMentorIndex} from '../lib/search.js'
import {mentorInsight} from '../lib/insights.js'
import {matchScore} from '../lib/match.js'
import {createToolRuntime} from '../lib/tools.js'
import {requestedMentorCount} from '../server/review.js'
import {reportAnalysis} from '../server/report-analysis.js'
import {publicText} from '../lib/presentation.js'
import {cleanAnswerText} from '../lib/answer-policy.js'

const data = loadData()
const index = createMentorIndex(data)
const names = [...new Set(data.mentors.map(mentor => mentor.name))]

function rowOf(name) {
  return index.rows.find(item => item.name === name && data.mentors.some(mentor => mentor.mentor_id === item.mentor_id))
}
function insightOf(name) {
  return mentorInsight(rowOf(name), names)
}
function matchInsight(name) {
  const row = rowOf(name)
  return {
    ...row,
    ...mentorInsight(row, names),
    directions: row.personal_directions || row.research_areas || row.directions,
    academicSummary: row.academic_summary,
  }
}
const labels = insight => insight.flags.map(flag => flag.label)
const hasFlag = (insight, id) => insight.flags.some(flag => flag.id === id)

test('否定句不被误读为负面标签，接收带教者不背“非本人带教”', () => {
  const wang = insightOf('王尚广')
  assert.equal(rowOf('王尚广').college, '计算机学院')
  assert.ok(!hasFlag(wang, 'mood'), '“几乎不发脾气”不应产生情绪化标签')
  assert.ok(!labels(wang).includes('情绪化'))
  assert.ok(labels(wang).includes('尊重学生'))

  const yu = insightOf('余文')
  assert.equal(rowOf('余文').college, '计算机学院')
  assert.ok(!hasFlag(yu, 'overtime'), '“不强制周末加班”不应产生加班较多标签')
  assert.ok(!labels(yu).includes('加班较多'))

  const yang = insightOf('杨正球')
  assert.equal(rowOf('杨正球').college, '软件学院')
  assert.ok(!hasFlag(yang, 'clock'), '“不要求固定工作时间、坐班或打卡”不应产生打卡坐班')
  assert.ok(!labels(yang).includes('打卡坐班'))
  assert.ok(hasFlag(yang, 'no_clock'))
  assert.ok(labels(yang).includes('不打卡'))

  const li = insightOf('李蓝天')
  assert.equal(rowOf('李蓝天').college, '人工智能学院')
  assert.ok(!hasFlag(li, 'clock'), '“不固定打卡”不应产生打卡坐班')
  assert.ok(!labels(li).includes('打卡坐班'))
  assert.ok(hasFlag(li, 'no_clock'))
  assert.ok(labels(li).includes('不打卡'))

  const yuan = insightOf('袁泉')
  assert.equal(rowOf('袁泉').college, '计算机学院')
  assert.ok(!hasFlag(yuan, 'overtime'), '“晋升压力较大”不应产生加班较多标签')
  assert.ok(!labels(yuan).includes('加班较多'))

  for (const name of ['谷利泽', '郑世慧']) {
    const insight = insightOf(name)
    assert.equal(rowOf(name).college, '网络空间安全学院')
    assert.ok(!hasFlag(insight, 'nominal'), `${name}是接收带教教师，不应被贴非本人带教`)
    assert.ok(!labels(insight).includes('非本人带教'))
    assert.equal(insight.supervisor, null)
  }
  // 同一条交接记录的主体仍是孙斌本人；接收方不被误伤，不等于取消真实挂名判断。
  assert.ok(hasFlag(insightOf('孙斌'), 'nominal'))
})

test('张华“研二下可实习，平时不允许实习”归纳为有条件实习而非一刀切限制', () => {
  const zhang = insightOf('张华')
  assert.equal(rowOf('张华').college, '网络空间安全学院')
  assert.ok(labels(zhang).includes('有条件实习'))
  assert.ok(!labels(zhang).includes('限制实习'))
  assert.ok(!hasFlag(zhang, 'no_internship'))
  const condition = zhang.flags.find(flag => flag.id === 'internship_ok')
  assert.equal(condition?.label, '有条件实习')
  assert.equal(condition?.conditional, true)
  assert.ok(condition.evidence.some(text => /研二下学期可以实习/.test(text)))
  assert.ok(condition.evidence.some(text => /平时不允许实习/.test(text)))
})

test('matchScore：博士阶段对博导加分，对非博导显著扣分并记录短板', () => {
  const doctoral = matchInsight('王尚广')
  const nonDoctoral = matchInsight('窦钊')
  assert.ok(hasFlag(doctoral, 'doctoral'))
  assert.ok(!hasFlag(nonDoctoral, 'doctoral'))
  assert.ok(nonDoctoral.evidence.sources > 0, '非博导必须有资料，才能把博士资格记为已知短板')

  const doctoralStage = {goal: 'undecided', stage: 'doctoral'}
  const neutralStage = {goal: 'undecided', stage: 'exam'}
  const boosted = matchScore(doctoral, doctoralStage)
  const unboosted = matchScore(doctoral, neutralStage)
  assert.ok(boosted.score > unboosted.score, `${boosted.score} 应高于 ${unboosted.score}`)
  assert.ok(boosted.misses.length === 0)

  const penalized = matchScore(nonDoctoral, doctoralStage)
  const neutral = matchScore(nonDoctoral, neutralStage)
  assert.ok(neutral.score - penalized.score >= 15, `非博导在博士阶段应显著降分：${neutral.score} -> ${penalized.score}`)
  assert.ok(penalized.misses.includes('非博导'))

  const mustDoctoral = matchScore(nonDoctoral, {musts: ['doctoral']})
  assert.ok(mustDoctoral.misses.includes('博导'), '有资料的非博导应把博导条件记入 misses')
  assert.ok(!mustDoctoral.unknown.includes('博导'))
})

test('matchScore：目标学院加分、非目标学院扣分，方向命中进入 hits', () => {
  const wang = matchInsight('王尚广')
  const target = matchScore(wang, {goal: 'undecided', colleges: ['计算机学院']})
  const foreign = matchScore(wang, {goal: 'undecided', colleges: ['软件学院']})
  assert.ok(target.score > foreign.score, `${target.score} 应高于 ${foreign.score}`)

  const wu = matchInsight('吴慧慈')
  assert.match(wu.directions, /大模型安全/)
  const profile = {interests: '大模型安全'}
  const hit = matchScore(wu, profile)
  assert.ok(hit.hits.includes('方向契合'))
  const baseline = matchScore({...wu, directions: '通信安全', academicSummary: '通信安全研究', quote: null}, profile)
  assert.ok(!baseline.hits.includes('方向契合'))
  assert.ok(hit.score > baseline.score, `${hit.score} 应高于 ${baseline.score}`)
})

test('profiles 学院筛选支持复合学院：经济管理学院命中双聘导师，冯志勇按所属学院命中', () => {
  const runtime = createToolRuntime(data)
  const economics = runtime.execute('query', {
    from: 'profiles',
    filters: [{field: 'college', op: 'eq', value: '经济管理学院'}],
    limit: 5000,
  })
  assert.ok(economics.rows.length > 0)
  assert.ok(economics.rows.every(row => String(row.college).split(/[、,，]+/).map(part => part.trim()).includes('经济管理学院')))
  assert.ok(economics.rows.some(row => row.name === '王琦' && row.college === '经济管理学院、人工智能学院'), '经济管理学院筛选应命中经管、人工智能双聘导师')

  // 冯志勇在资料中登记为“信息与通信工程学院、网络空间安全学院”，不是经济管理学院；
  // 用他所属的复合学院字段同样验证：eq 能拆分复合学院并命中双聘记录。
  const security = runtime.execute('query', {
    from: 'profiles',
    filters: [{field: 'college', op: 'eq', value: '网络空间安全学院'}],
    limit: 5000,
  })
  const feng = security.rows.find(row => row.name === '冯志勇')
  assert.ok(feng, '冯志勇应能按网络空间安全学院命中')
  assert.equal(feng.college, '信息与通信工程学院、网络空间安全学院')
})

test('requestedMentorCount 识别“每院/每个学院”的分组人数', () => {
  for (const question of ['计算机和网安每个学院推荐2位导师', '每院2位老师推荐']) {
    const requested = requestedMentorCount(question)
    assert.equal(requested.count, 2, question)
    assert.equal(requested.perGroup, true, question)
  }
})

test('reportAnalysis 学院数按复合学院拆分去重，并输出概览对比矩阵', () => {
  const rows = [
    {name: '甲', college: '经济管理学院、人工智能学院', rating: 4, can_supervise_doctoral: true, green_flags: '尊重学生', red_flags: ''},
    {name: '乙', college: '人工智能学院', rating: 3, can_supervise_doctoral: false, green_flags: '不打卡', red_flags: ''},
    {name: '丙', college: '计算机学院', rating: 5, can_supervise_doctoral: true, green_flags: '经费充足', red_flags: '打卡坐班'},
  ]
  const report = reportAnalysis({
    rows,
    fields: ['rating', 'can_supervise_doctoral'],
    labels: {rating: '评分', can_supervise_doctoral: '博导'},
    level: 2,
    goal: '就业',
  })
  assert.match(report.markdown, /3位导师 · 3个学院/)
  assert.doesNotMatch(report.markdown, /4个学院/)
  assert.match(report.markdown, /经济管理学院：1位/)
  assert.match(report.markdown, /人工智能学院：2位/)
  assert.match(report.markdown, /计算机学院：1位/)
  assert.doesNotMatch(report.markdown, /经济管理学院、人工智能学院：\d+位/, '复合学院不能作为独立学院再计一次')
  assert.match(report.html, /<table/)
  assert.match(report.html, />导师</)
  assert.match(report.html, />优点亮点</)
  assert.match(report.html, />风险提示</)
  for (const name of ['甲', '乙', '丙']) assert.ok(report.html.includes(`>${name}<`))
})

test('publicText 排行榜表格后的含竖线结论句不误吞正文', () => {
  const tables = [{
    type: 'table',
    purpose: 'recommendation',
    columns: [
      {key: 'name', label: '导师'},
      {key: 'college', label: '学院'},
      {key: 'rating', label: '评分'},
    ],
    rows: [
      {name: '张三', college: '计算机学院', rating: 5},
      {name: '李四', college: '软件学院', rating: 4},
    ],
  }]
  const markdown = [
    '| 推荐序 | 导师 | 学院 |',
    '| --- | --- | --- |',
    '| 1 | 张三 | 计算机学院 |',
    '| 2 | 李四 | 软件学院 |',
    '结论：张三 | 李四来自不同学院，需要分别联系。',
    '后续正文保留。',
  ].join('\n')
  const output = publicText(markdown, {tables})
  assert.match(output, /结论：张三 \| 李四来自不同学院，需要分别联系。/)
  assert.match(output, /后续正文保留。/)
})

test('cleanAnswerText 在询问能否录取时保留历史样本非录取门槛说明', () => {
  const question = '我初试364分能上吗？'
  const answer = '往年最低360分，这些仅为历史样本，并非录取门槛。'
  assert.equal(cleanAnswerText(answer, question), answer)
  assert.match(cleanAnswerText(answer, question), /历史样本/)
  assert.match(cleanAnswerText(answer, question), /并非录取门槛/)
})

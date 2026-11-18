import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {loadData} from '../lib/data.js'
import {createMentorIndex} from '../lib/search.js'
import {mentorInsight,sentencesOf} from '../lib/insights.js'
import {normalizeProfile,profilePrompt,profileChips,emptyProfile} from '../lib/profile.js'
import {createToolRuntime} from '../lib/tools.js'
import {createStore} from '../server/store.js'
import {createProfiles} from '../server/profile.js'
import {matchScore} from '../lib/match.js'

const data=loadData(),index=createMentorIndex(data),names=[...new Set(data.mentors.map(mentor=>mentor.name))]
const row=name=>index.rows.find(item=>item.name===name&&data.mentors.some(mentor=>mentor.mentor_id===item.mentor_id))
const insight=name=>mentorInsight(row(name),names)
const labels=item=>item.flags.map(flag=>flag.label)

test('负面评价被如实归纳为风险标签，每个标签都附原句',()=>{
  const ma=insight('马兆丰')
  assert.ok(labels(ma).includes('压榨记录'));assert.ok(labels(ma).includes('会骂人'))
  assert.ok(labels(ma).includes('限制实习'),'“一般不允许学生自主实习”应识别为限制实习')
  for(const flag of ma.flags)assert.ok(flag.evidence.length>0)
  const original=data.mentors.find(mentor=>mentor.name==='马兆丰').review_text
  for(const flag of ma.flags.filter(flag=>flag.tone==='bad'&&flag.id!=='low_rating'))assert.ok(flag.evidence.every(text=>original.includes(text)),flag.label)
  assert.ok(labels(insight('李剑')).includes('整体不推荐'))
})
test('原始评价数据不因洞察计算而改变，数量保持',()=>{
  const before=JSON.stringify(data.mentors)
  for(const mentor of index.rows)mentorInsight(mentor,names)
  assert.equal(JSON.stringify(data.mentors),before)
  assert.equal(data.mentors.length,414)
  assert.equal(data.mentors.filter(mentor=>mentor.rating===1).length,53)
})
test('正面条件与个人安排识别准确，自由文本中的公司金额不当作学生补助',()=>{
  const fu=insight('付俊松')
  for(const label of ['可以实习','不打卡','不卡论文','经费充足','补助 ¥2000/月'])assert.ok(labels(fu).includes(label),label)
  assert.ok(!fu.flags.some(flag=>flag.tone==='bad'))
  assert.equal(fu.fingerprint.funding.value,5)
  assert.ok(!labels(insight('马兆丰')).some(label=>/补助 ¥/.test(label)),'公司支付导师8000不是学生补助')
})
test('同一句同时写限制与放行时归为有条件实习',()=>{
  const cui=insight('崔宝江')
  assert.ok(labels(cui).includes('有条件实习'))
  assert.ok(!labels(cui).includes('限制实习'))
})
test('挂名与实际带教人只关联已收录导师',()=>{
  const fang=insight('方滨兴')
  assert.equal(fang.supervisor.name,'王春露')
  assert.ok(labels(fang).includes('非本人带教'))
  for(const mentor of index.rows){const item=mentorInsight(mentor,names);if(item.supervisor)assert.ok(names.includes(item.supervisor.name)&&item.supervisor.name!==mentor.name)}
})
test('画像维度缺失时为空而不是低分',()=>{
  const blank=mentorInsight({name:'测试',college:'测试学院',source_ids:[]},names)
  assert.ok(Object.values(blank.fingerprint).every(axis=>axis===null))
  assert.equal(blank.flags.length,0);assert.equal(blank.evidence.level,'暂无评价')
  assert.deepEqual(sentencesOf('管理：不打卡。\n实习：研二下可实习；'),['不打卡','研二下可实习'])
})
test('风险与优点标签可被工具筛选和排序，Agent可直接回答“谁有坑”',()=>{
  const runtime=createToolRuntime(data)
  const risky=runtime.execute('query',{from:'mentors',filters:[{field:'red_flags',op:'contains',value:'压榨'}],select:['name','red_flags'],limit:100})
  assert.ok(risky.rows.some(item=>item.name==='马兆丰'))
  const nominal=runtime.execute('query',{from:'mentors',filters:[{field:'actual_supervisor',op:'not_null'}],select:['name','actual_supervisor'],limit:100})
  assert.ok(nominal.rows.some(item=>item.name==='方滨兴'&&item.actual_supervisor==='王春露'))
  const searched=runtime.execute('search',{terms:['大模型安全'],select:['name','green_flags','red_flags'],limit:50})
  assert.ok(searched.columns.some(column=>column.key==='red_flags'))
})
test('择导画像校验、持久化并生成给Agent的偏好说明',async()=>{
  assert.throws(()=>normalizeProfile({stage:'unknown'}),/画像字段/)
  assert.throws(()=>normalizeProfile({score:900}),/0–500/)
  assert.throws(()=>normalizeProfile({musts:['vip']}),/偏好/)
  const profile=normalizeProfile({stage:'exam',goal:'career',score:'351',program:'085412',musts:['internship','no_clock'],colleges:['计算机学院']})
  assert.equal(profile.score,351)
  assert.deepEqual(profileChips(profile).map(chip=>chip.text),['统考','351分','085412','毕业就业','计算机','能实习','不打卡'])
  assert.match(profilePrompt(profile),/统考.*351.*085412.*毕业就业.*能实习、不打卡/)
  assert.equal(profilePrompt(emptyProfile),'')
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'北极星画像-'))
  try{
    const store=createStore(dir),profiles=createProfiles(store)
    profiles.execute({action:'update',goal:'research',musts:['personal']})
    assert.equal(createProfiles(store).read().goal,'research')
    assert.throws(()=>profiles.execute({action:'update',score:'高分'}),/画像参数/)
    profiles.execute({action:'update',score:360})
    assert.equal(profiles.read().goal,'research','只更新传入字段')
    assert.equal(profiles.reset().goal,null)
  }finally{await fs.rm(dir,{recursive:true,force:true})}
})
test('画像契合度：风险记录明显降分，满足看重条件明显加分',()=>{
  const profile={...emptyProfile,goal:'career',musts:['internship','no_clock','kind']}
  const fu=matchScore(insight('付俊松'),profile),ma=matchScore(insight('马兆丰'),profile)
  assert.ok(fu.score>=75,'付俊松 '+fu.score);assert.ok(ma.score<=40,'马兆丰 '+ma.score)
  assert.ok(fu.hits.includes('能实习'));assert.ok(ma.misses.includes('尊重学生'))
  assert.equal(matchScore(insight('付俊松'),emptyProfile),null)
})

test('科研强度与培养标签区分真实学术成果、合作带教与条件限制',()=>{
  const wu=insight('吴慧慈'),li=insight('李丽香'),peng=insight('彭海朋'),xu=row('徐洁'),fu=insight('付俊松'),nan=insight('南国顺'),lv=insight('吕昕晨'),liu=insight('刘建毅'),wang=insight('王碧舳')
  assert.ok(!labels(wu).includes('加班较多'))
  assert.ok(!labels(wu).includes('时间自由'))
  assert.equal(wu.flags.find(flag=>flag.id==='no_paper')?.conditional,true)
  assert.ok(wu.fingerprint.research.value>=4.5)
  assert.ok(!labels(li).includes('非本人带教'))
  assert.ok(!labels(peng).includes('非本人带教'))
  assert.notEqual(xu.group_lead,true)
  assert.equal(row('南国顺').group_lead,true)
  assert.ok(fu.fingerprint.internship.value>nan.fingerprint.internship.value)
  assert.ok(fu.fingerprint.internship.value>lv.fingerprint.internship.value)
  assert.ok(labels(fu).includes('尊重学生'))
  assert.equal(nan.fingerprint.research.value,5)
  assert.ok(nan.fingerprint.research.value>lv.fingerprint.research.value)
  assert.ok(lv.fingerprint.research.value>liu.fingerprint.research.value)

  const careerProfile={...emptyProfile,goal:'career',musts:['internship','no_clock','no_paper']}
  assert.ok(matchScore(fu,careerProfile).score>matchScore(wang,careerProfile).score)
  assert.ok(matchScore(fu,careerProfile).score>matchScore(wu,careerProfile).score)
  const researchProfile={...emptyProfile,goal:'research',musts:['doctoral','resources']}
  assert.ok(matchScore(nan,researchProfile).score>matchScore(liu,researchProfile).score)
  assert.ok(matchScore(nan,researchProfile).score>matchScore(lv,researchProfile).score)
  assert.ok(!labels(nan).includes('会骂人'),'南国顺评价已修正，不应出现会骂人标签')
  assert.ok(labels(nan).includes('高分生源青睐'))
  assert.ok(labels(nan).includes('尊重学生'))
  assert.ok(labels(nan).includes('资源充足'))
})

test('学院归一化覆盖14个学院，南国顺无骂人标签且体现高分生源，付俊松有经费充足标签',()=>{
  const colleges=data.metadata.profile_colleges
  assert.equal(colleges.length,14)
  assert.equal(new Set(colleges).size,14)
  assert.ok(colleges.every(college=>typeof college==='string'&&college.trim()))
  assert.ok(!colleges.includes('计算机学院（国家示范性软件学院）'),'重复学院名应已归一化')
  assert.ok(colleges.includes('计算机学院'))

  const nan=insight('南国顺')
  const choice=nan.flags.find(flag=>flag.id==='student_choice')
  assert.ok(choice,'高分生源青睐应生成 student_choice 标签')
  assert.equal(choice.label,'高分生源青睐')
  for(const flag of nan.flags){
    assert.doesNotMatch(flag.label,/骂人/)
    for(const text of flag.evidence)assert.doesNotMatch(text,/骂人/)
  }

  const fu=insight('付俊松')
  assert.ok(labels(fu).includes('经费充足'))
})

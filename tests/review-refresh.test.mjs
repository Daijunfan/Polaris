import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {loadData,readSealedDataset} from '../lib/data.js'
import {createToolRuntime} from '../lib/tools.js'
import {fieldLabels} from '../lib/fields.js'
import {publicSourceContent,publicArtifact,publicText} from '../lib/presentation.js'
import {reviewAnswer} from '../server/review.js'
import {csvText} from '../src/presentation.js'

const base=readSealedDataset('dataset'),extra=readSealedDataset('pdf-reviews')
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(', ')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+': '+stable(value[key])).join(', ')+'}':JSON.stringify(value)
const hash=value=>createHash('sha256').update(stable(value)).digest('hex')

test('同组已知安排补到个人查询，个人例外不继承，字段不混入其他主题和老师',()=>{
  const data=loadData(),find=name=>data.mentors.find(row=>row.name===name)
  assert.match(find('吴斌').internship,/研二下.*实习/)
  assert.match(find('吴斌').graduation,/专硕需要发表论文/)
  assert.doesNotMatch(find('苏森').management,/实习|就业/)
  assert.equal(find('苏森').graduation,null)
  assert.equal(find('付俊松').group_context,null);assert.equal(find('杨文川').group_context,null)
  assert.equal(find('付俊松').internship,'研二下学期可以实习。')
  assert.doesNotMatch(find('郭燕慧').management,/指纹|严格/)
  assert.equal(find('郭文明').internship,'学生可以外出实习。')
  assert.doesNotMatch(find('王小婕').management,/津贴|补助/)
  assert.match(find('王小婕').stipend_text,/津贴/)
  assert.match(find('南国顺').internship,/研二结束/)
  assert.doesNotMatch(find('南国顺').internship,/毕业要求/)
  assert.doesNotMatch(find('南国顺').graduation,/实习/)
  assert.doesNotMatch(find('林荣恒').group_context||'',/10个月|中国移动研究院/)
  assert.doesNotMatch(find('王尚广').group_context||'',/10个月|中国移动研究院/)
  assert.match(find('李静林').group_context,/苏森团队里/)
})
test('共用CSV导出保留中文、精度、换行和空值，内部字段不输出',()=>{
  const csv=csvText({columns:[{key:'mentor_id'},{key:'name',label:'导师'},{key:'value',label:'数值'},{key:'note',label:'说明'},{key:'missing',label:'未填'}],rows:[{mentor_id:'hidden',name:'测试老师',value:1234.567,note:'第一行，带逗号\n第二行"引号"',missing:null},{mentor_id:'hidden2',name:'=公式文本',value:-5,note:'普通文字',missing:null}]})
  assert.ok(csv.startsWith('\uFEFF"导师"'))
  assert.doesNotMatch(csv,/mentor_id|hidden|—/)
  assert.match(csv,/"1234\.567"/);assert.match(csv,/"-5"/)
  assert.ok(csv.includes('第一行，带逗号\n第二行""引号""'))
  assert.ok(csv.includes("'=公式文本"));assert.ok(csv.endsWith(',""'))
})

test('全文改写保留全部309条评价身份和414位导师的目录、成绩与劳务数值',()=>{
  assert.equal(hash(base.students),'b0ff4917461f46e576010731ddd0eaf70695dc1ef48183167705100e9cb69ee6')
  assert.equal(hash(base.exams),'b26cbb7235e1e72dd5eda1a3be191539952b7f34d22c44300adafa9e3cb9c6a1')
  const mentors=[...base.mentors,...extra.mentors],reviews=[...base.reviews,...extra.reviews]
  assert.equal(mentors.length,414);assert.equal(reviews.length,309)
  assert.equal(hash(reviews.map(row=>row.review_id).sort()),'2e4d8f9d537b7895feec5a1f637922c6f86f5fd1c9dd60a4f579481ee6cf4851')
  const fields=['name','college','group','directions','student_count','exam_count','recommended_count','score_first_min','score_first_mean','score_first_median','score_first_max','stipend_monthly_min','stipend_monthly_max']
  const preserved=Object.fromEntries(mentors.map(mentor=>[mentor.mentor_id,Object.fromEntries(fields.map(key=>[key,mentor[key]]))]))
  assert.equal(hash(preserved),'39d81faf22ef3f0d081b95e2e5eb22bdadc10e112cf964711e533d965a175da6')
})
test('评价与所有派生字段使用新版文本，评分在导师和关联评价中一致',()=>{
  for(const data of [base,extra]){
    assert.equal(data.review_revision||data.metadata.review_revision,'2026-11-18')
    for(const review of data.reviews)assert.doesNotMatch(JSON.stringify(review),/未经独立核实|建议.{0,8}核实|不清楚|不知道|未提供|暂无资料|原文称/)
    for(const mentor of data.mentors){
      assert.ok(mentor.rating===null||Number.isInteger(mentor.rating)&&mentor.rating>=1&&mentor.rating<=5)
      const records=data.reviews.filter(review=>review.mentor_id===mentor.mentor_id)
      for(const record of records){assert.equal(record.rating,mentor.rating);assert.ok(mentor.review_text.includes(record.text))}
      const text=['review_text','management','internship','graduation','stipend_text','group_context','mentor_note'].map(key=>mentor[key]||'').join('\n')
      assert.doesNotMatch(text,/未经独立核实|建议.{0,8}核实|不清楚|不知道|未提供|暂无资料|原文称/)
    }
  }
  assert.equal(fieldLabels.rating,'培养体验评分 / 5')
  const li=base.mentors.find(mentor=>mentor.name==='李朝卓')
  assert.match(li.internship,/研二下|硕士二年级下学期/);assert.doesNotMatch(li.internship,/三篇论文/)
  assert.match(li.graduation,/三篇论文/);assert.doesNotMatch(li.graduation,/研二下可实习/)
})
test('个人培养安排直接生效，主题职责不依赖旧评价的固定句式',()=>{
  const data=loadData(),find=name=>data.mentors.find(mentor=>mentor.name===name),runtime=createToolRuntime(data)
  assert.equal(find('付俊松').group_context,null);assert.equal(find('杨文川').group_context,null)
  assert.doesNotMatch(find('郭燕慧').group_context||'',/打卡|严格|不能.*实习|负面评价/)
  assert.match(find('郭燕慧').review_text,/无需坐班|时间较为自由/)
  const nan=runtime.execute('search',{terms:['大模型安全'],limit:5000}).rows.find(row=>row.name==='南国顺')
  assert.equal(nan.group_lead,true);assert.match(nan.topic_evidence,/负责组(?:内)?管理/)
  assert.equal(find('李朝卓').rating,4);assert.equal(find('周琳娜').rating,4)
  assert.equal(find('刘传昌').rating,4);assert.equal(find('王玉龙').rating,1)
  assert.match(find('刘传昌').management,/要求比较严格/)
  assert.match(find('刘传昌').management,/按规则完成任务/)
  assert.match(find('涂腾飞').group_context,/指纹签到/)
  assert.match(find('李昕').review_text,/2023年7月|整组延期/)
  assert.match(find('仲苏玉').review_text,/600元\/月|每月数次|三区|专硕可申请专利/)
  const entry=publicSourceContent(data,data.sources.find(source=>source.id==='S1')).entries.find(entry=>entry.title.startsWith('李朝卓'))
  assert.equal(entry.rating,4);assert.match(entry.text,/三篇论文/)
})
test('博士名单的内容范围不依赖采用哪一种合法筛选路径',async()=>{
  const data=loadData(),chat={latestUserText:'我现在申请博士，推荐1位大模型安全导师',messages:[]}
  const assistant={tools:[],artifacts:[{type:'table',title:'大模型安全博士导师',columns:[{key:'name'}],rows:[{name:'南国顺'}],row_notes:['团队项目多；学硕需要两篇论文，研二下可实习。']}]}
  assert.equal((await reviewAnswer({chat,assistant,answer:'',data})).ok,false)
  assistant.artifacts[0].title='纵向科研'
  assert.equal((await reviewAnswer({chat,assistant,answer:'',data})).ok,false)
  assistant.artifacts[0].row_notes=['负责组管理，团队项目多、各导师独立指导学生。']
  assert.equal((await reviewAnswer({chat,assistant,answer:'',data})).ok,true)
  chat.latestUserText='我现在不申请博士，推荐1位适合就业的导师'
  assistant.artifacts[0].title='就业项目'
  assistant.artifacts[0].row_notes=['学硕达到学院论文要求后可实习。']
  assert.equal((await reviewAnswer({chat,assistant,answer:'',data})).ok,true)
})

test('就业与未来读博分别推荐时，博士资格查询不把就业实习条件判成无关要求',async()=>{
  const data=loadData(),artifact=(title,name,note)=>({type:'table',purpose:'recommendation',title,columns:[{key:'name'},{key:'college'}],rows:[data.mentors.find(row=>row.name===name)],row_notes:[note]})
  const assistant={tools:[{name:'search',args:{filters:[{field:'can_supervise_doctoral',op:'eq',value:true}]},status:'complete',result:{returned:10}}],artifacts:[artifact('就业方向','付俊松','研二下可实习，不要求SCI。'),artifact('读博深造方向','南国顺','团队资源充足，工程与理论研究兼有。')]}
  const result=await reviewAnswer({chat:{latestUserText:'如果想研究生就业的话，选哪些？如果想读博深造的话，又选哪些导师？',messages:[]},assistant,answer:'两条路线分别比较。',data})
  assert.equal(result.ok,true)
})
test('图表说明不额外提醒缺项，原始空值和明确提问的缺项回答仍保留',()=>{
  const artifact={id:'comparison',type:'table',title:'培养条件',description:'2026年培养条件。刘传昌毕业条件无记录。',columns:[{key:'name'},{key:'graduation'}],rows:[{name:'刘传昌',graduation:null}],sources:[]}
  const shown=publicArtifact(artifact)
  assert.equal(shown.description,'2026年培养条件。');assert.equal(shown.rows[0].graduation,null)
  assert.match(artifact.description,/无记录/)
  assert.equal(publicText('暂无付俊松个人手机号记录。'),'暂无付俊松个人手机号记录。')
})
test('批量分类反馈指出重复姓名，带教关系不能错贴到另一位导师',async()=>{
  const data=loadData(),row=name=>data.mentors.find(row=>row.name===name)
  const view=(names,title)=>({id:title,type:'table',purpose:'recommendation',title,columns:[{key:'name'},{key:'college'}],rows:names.map(row),row_notes:names.map(()=>null)})
  const chat={latestUserText:'分成两类，每类推荐2位导师，不重复',messages:[]},assistant={tools:[],artifacts:[view(['孙岩','苏森'],'就业'),view(['孙岩','潘胜利'],'科研')]}
  const duplicate=await reviewAnswer({chat,assistant,answer:'',data})
  assert.equal(duplicate.ok,false);assert.match(duplicate.issues.join(''),/孙岩/);assert.match(duplicate.issues.join(''),/pick/)
  chat.latestUserText='介绍李灵慧'
  assistant.artifacts=[view(['李灵慧'],'个人培养')];assistant.artifacts[0].row_notes=['希望发论文的学生主要由李丽香提供论文指导。']
  assert.equal((await reviewAnswer({chat,assistant,answer:'',data})).ok,false)
  assistant.artifacts=[view(['王春露'],'个人培养')];assistant.artifacts[0].row_notes=['学生由邱鹏飞指导。']
  assert.equal((await reviewAnswer({chat,assistant,answer:'',data})).ok,true)
})

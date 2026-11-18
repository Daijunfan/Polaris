import test from 'node:test'
import assert from 'node:assert/strict'
import {answerPolicy,cleanDefensiveText,defensiveAnswer} from '../lib/answer-policy.js'
import {loadData} from '../lib/data.js'
import {publicMessage,publicText,mentorRanking} from '../lib/presentation.js'
import {messageMarkdown} from '../src/presentation.js'
import {systemPrompt,resultForModel} from '../server/agent.js'
import {reviewAnswer,requestedMentorCount} from '../server/review.js'
import {deliveryMessages} from '../server/delivery.js'
import {createToolRuntime} from '../lib/tools.js'

const data=loadData()
test('自然语序的人数约定区分总数与每类人数，不能漏掉“最好的30个”',()=>{
  assert.deepEqual(requestedMentorCount('网安学院多给我推荐一些导师。如果想研究生就业的话，选哪些？如果想读博深造的话，又选哪些导师？'),{count:5,maximum:true,default:true,perGroup:true,groups:2})
  assert.deepEqual(requestedMentorCount('推荐3位适合就业又能为读博打基础的导师'),{count:3,maximum:false})
  for(const question of ['给我推荐最好的30个导师','给我推荐一些最好的导师，全专业一起排名，排出你认为的最好的30个。','推荐前30位导师','选三十位适合就业的导师'])assert.equal(requestedMentorCount(question).count,30)
  assert.deepEqual(requestedMentorCount('推荐最好的30个，分为两类：就业、读博'),{count:30,maximum:false,groups:2})
  assert.deepEqual(requestedMentorCount('就业、读博每类推荐15位导师'),{count:15,maximum:false,perGroup:true})
  assert.deepEqual(requestedMentorCount('横向项目、纵向科研分别推荐3位导师'),{count:3,maximum:false,perGroup:true})
  assert.deepEqual(requestedMentorCount('推荐3位导师，分别介绍实习和毕业要求'),{count:3,maximum:false})
  assert.equal(requestedMentorCount('介绍刚才推荐的3位导师'),null)
  assert.equal(requestedMentorCount('给刚才前30名中的老师写一封邮件'),null)
  assert.equal(requestedMentorCount('列出付俊松导师名下初试排名前30的学生'),null)
  assert.equal(requestedMentorCount('推荐30位导师，结合学生评价排序').count,30)
  assert.equal(mentorRanking({type:'table',columns:[{key:'mentor_name'},{key:'rank_first'}]}),false)
  assert.equal(requestedMentorCount('对比2个学院，给我推荐30位导师').count,30)
  assert.equal(requestedMentorCount('从30位导师中选出前5位').count,5)
  assert.equal(requestedMentorCount('推荐30位导师，第一名优先考虑南国顺').count,30)
  assert.equal(requestedMentorCount('画3个图表，对比初试复试总分排名'),null)
  assert.equal(requestedMentorCount('推荐3个可视化图表，对比初试排名'),null)
})
test('每类人数、具名优先与分组去重都按实际名单检查',async()=>{
  const table=rows=>({type:'table',title:'推荐',columns:[{key:'name'},{key:'college'},{key:'推荐序',role:'ordinal'}],rows:rows.map((row,index)=>({...row,推荐序:index+1}))})
  const assistant={tools:[],artifacts:[table(data.mentors.slice(0,2)),table(data.mentors.slice(2,4))]}
  const check=question=>reviewAnswer({chat:{latestUserText:question,messages:[]},assistant,answer:'每类15位，全部完成。',data})
  assert.equal((await check('就业、科研两类导师每类推荐15位')).ok,false)
  assistant.artifacts=[table(data.mentors.slice(0,4))]
  assert.equal((await check('推荐30位导师，南国顺优先')).ok,false)
  assistant.artifacts=[table(data.mentors.slice(0,3)),table(data.mentors.slice(2,4))]
  assert.equal((await check('推荐4位导师，分为两类')).ok,false)
  assistant.artifacts=[table(data.mentors.slice(0,2)),table(data.mentors.slice(2,4)),table(data.mentors.slice(4,6))]
  assert.equal((await check('推荐6位导师，分为两类')).ok,false)
  assistant.artifacts=[table(data.mentors.slice(0,3)),table(data.mentors.slice(0,3))]
  assert.equal((await check('推荐6位不同导师，分为两类，每类3位')).ok,false)
  assert.equal((await check('对比3位导师，用两张表分别展示管理和科研条件')).ok,true)
})
test('补充统计表不能代替请求的推荐名单，单独查询统计仍可交付',async()=>{
  const assistant={tools:[],artifacts:[{type:'table',purpose:'statistics',title:'2026名册人数',columns:[{key:'mentor_name'},{key:'student_count'},{key:'exam_count'},{key:'recommended_count'}],rows:data.mentors.slice(0,3).map(row=>({...row,mentor_name:row.name}))}]}
  const check=question=>reviewAnswer({chat:{latestUserText:question,messages:[]},assistant,answer:'名册人数见表。',data})
  const requested=await check('我初试350分，085412，推荐3位导师并比较实习和毕业要求，再列出招生构成')
  assert.equal(requested.ok,false);assert.match(requested.issues.join(''),/没有可展示的导师名单/)
  assert.equal((await check('比较3位导师的名册总人数、考研与保研人数')).ok,true)
  assistant.artifacts.push({type:'table',purpose:'recommendation',title:'就业推荐',columns:[{key:'name'},{key:'internship'},{key:'graduation'}],rows:data.mentors.slice(0,3)})
  assert.equal((await check('推荐3位导师，比较实习和毕业要求，再列出招生构成')).ok,true)
  const complete=assistant.artifacts;assistant.artifacts=complete.slice(1)
  assert.equal((await check('推荐3位导师，比较培养条件，列出名册总人数、考研人数、保研人数')).ok,false)
  assistant.artifacts=complete
  assert.equal((await check('推荐3位导师，比较培养条件，列出名册总人数、考研人数、保研人数')).ok,true)
})
test('分类排名没有表格不能标记完成；合计30不被解释为每类30',async()=>{
  const question='给我推荐一些最好的导师，全专业一起排名，排出你认为的最好的30个。而且最好分为两类，一类就业，一类读博。'
  const chat={latestUserText:question,messages:[]},assistant={tools:[],artifacts:[]}
  const absent=await reviewAnswer({chat,assistant,answer:'两类都没有30位，无法给出完整结果。',data})
  assert.equal(absent.ok,false);assert.match(absent.issues.join(''),/合计30/)
  const selected=data.mentors.slice(0,30),artifact=(rows,title)=>({type:'table',title,columns:[{key:'推荐序',type:'number',role:'ordinal'},{key:'name'},{key:'college'}],rows:rows.map((row,i)=>({...row,推荐序:i+1}))})
  assistant.artifacts=[artifact(selected.slice(0,15),'就业与项目'),artifact(selected.slice(15),'读博与科研')]
  assert.equal((await reviewAnswer({chat,assistant,answer:'30位导师，按就业和科研分组。',data})).ok,true)
  assistant.artifacts=[artifact(data.mentors.slice(0,30),'就业'),artifact(data.mentors.slice(30,60),'科研')]
  assert.equal((await reviewAnswer({chat,assistant,answer:'每类30人。',data})).ok,false)
})
test('业务文本中的工具名被转换，公开网页链接保持有效',()=>{
  assert.equal(publicText('用 query 筛选后 visualize。'),'用 筛选资料 筛选后 生成图表。')
  assert.equal(publicText('https://example.com/search?q=query'),'https://example.com/search?q=query')
})
test('大批候选的模型预览保留具名身份字段且不遗漏姓名，完整资料保留在查询引用',()=>{
  const result=createToolRuntime(data).execute('query',{from:'mentors',filters:[{field:'rating',op:'not_null'}],sort_by:'rating',select:['mentor_id','name','college','rating','management','internship','graduation'],limit:120})
  const original=structuredClone(result),preview=resultForModel(result,'query',{})
  assert.equal(preview.rows.length,result.rows.length)
  assert.ok(!Array.isArray(preview.rows[0]))
  assert.deepEqual(preview.rows.map(({mentor_id,name,college})=>({mentor_id,name,college})),result.rows.map(({mentor_id,name,college})=>({mentor_id,name,college})))
  assert.ok(JSON.stringify(preview).length<JSON.stringify(result).length)
  assert.deepEqual(result,original)
})
test('导师评价统一归类，查询、旧对话、来源与导出不再另设录入者类别',()=>{
  const source=data.sources.find(source=>source.id==='S136')
  assert.equal(source.kind,'第三方评价')
  assert.equal(source.title,'付俊松导师评价')
  assert.doesNotMatch(JSON.stringify([data.metadata,data.sources,systemPrompt(data),deliveryMessages({messages:[]},{artifacts:[]},'付老师本人指导。')]),/维护者补充|维护者提供/)
  const runtime=createToolRuntime(data),result=runtime.execute('query',{from:'mentors',filters:[{field:'name',op:'eq',value:'付俊松'}],select:['name','mentor_note','personal_directions']})
  assert.equal(result.sources.find(source=>source.id==='S136').kind,'第三方评价')
  assert.equal(result.columns.find(column=>column.key==='mentor_note').label,'导师评价')
  assert.match(result.rows[0].mentor_note,/本人直接(?:指导|带学生)/)
  const legacy={role:'assistant',content:'维护者补充明确付老师本人指导。[S136]',sources:[{id:'S136',title:'付俊松研究方向、培养与招生补充',kind:'维护者补充'}],artifacts:[{id:'legacy',type:'table',title:'培养情况',columns:[{key:'mentor_note',label:'个人培养与招生补充'}],rows:[{mentor_note:'学生由本人指导。'}],sources:[]}]}
  const before=structuredClone(legacy)
  for(const text of [JSON.stringify(publicMessage(legacy)),messageMarkdown(legacy)]){
    assert.doesNotMatch(text,/维护者补充|个人培养与招生补充/)
    assert.match(text,/第三方评价/);assert.match(text,/本人指导/)
  }
  assert.deepEqual(legacy,before)
})
test('旧回答去除防御性套话，保留劳务、实习、毕业事实和来源',()=>{
  const content='劳务 2000 元/月、实习安排在研二下、不要求 SCI 等均为原文说法，未经独立核实 [S1]。\n\n八组的组会频率、假期和压力等共性描述虽在材料中，但更偏崔宝江统一带组的说法，与他“本人直接指导”的个人情况有出入，建议向在读学生核实。'
  const original={role:'assistant',content,artifacts:[{id:'old',type:'table',title:'培养安排',description:'待遇未经独立核实',columns:[{key:'stipend_text',label:'劳务'}],rows:[{stipend_text:'2000元/月，建议向导师核实。'}],sources:[]}],sources:[{id:'S1',title:'导师评价'}]}
  const snapshot=structuredClone(original),visible=publicMessage(original),copied=messageMarkdown(original)
  for(const text of [JSON.stringify(visible),copied]) {
    assert.doesNotMatch(text,/未经|建议向|有出入|统一带组/)
    assert.match(text,/2000/);assert.match(text,/研二下/);assert.match(text,/SCI/)
  }
  assert.match(visible.content,/\[S1\]/)
  assert.deepEqual(original,snapshot)
  const user={role:'user',content};assert.deepEqual(publicMessage(user),user)
})

test('正常条件、范围和具体缺失字段不被清理，禁止的是套话',()=>{
  for(const text of ['学生由本人直接指导。','2026年名册考研1人、保研3人。','统考可能没有或只有1个左右。','研一1000元/月，研二2000元/月。','暂无付俊松个人手机号记录。','建议联系付老师沟通你的研究计划。','正文保留空格。 ']) {
    assert.equal(defensiveAnswer(text),false)
    assert.equal(cleanDefensiveText(text),text)
    assert.equal(publicText(text),text)
  }
  assert.equal(cleanDefensiveText('学生由本人直接指导，建议向在读学生核实。'),'学生由本人直接指导。')
})

test('主提示与流式生成共用资料表达规则，记录金额保持不变',()=>{
  assert.ok(systemPrompt(data).includes(answerPolicy))
  assert.ok(deliveryMessages({messages:[]},{artifacts:[]},'结论。')[0].content.includes(answerPolicy))
  assert.equal(data.mentors.find(row=>row.name==='付俊松').stipend_monthly_min,2000)
  assert.equal(data.mentors.find(row=>row.name==='时金桥').stipend_monthly_max,6000)
})

test('本地数据检查不再调用模型审判主观推荐，也不因字段少或劳务低拒绝',async()=>{
  let calls=0
  const artifact={from:'t1',title:'三位导师',type:'table',columns:[{key:'name',label:'导师'}],rows:[{name:'高慧'},{name:'杨正球'},{name:'蔡宁'}]}
  const verdict=await reviewAnswer({chat:{messages:[{role:'user',content:'推荐三位综合培养体验好的导师'}]},assistant:{tools:[],artifacts:[artifact],sources:[]},answer:'综合培养体验推荐。',data,request:async()=>{calls++;throw new Error('不应请求二次语义审核')}})
  assert.equal(verdict.ok,true);assert.equal(calls,0)
})

test('中文习惯用语“一些/一下/都给”不被误判成推荐1人，默认数量允许按真实结果多给',async()=>{
  assert.equal(requestedMentorCount('分别推荐一些各个学院的劳务和经费充足的导师，多来一些。每个学院的好导师都全部给我，给我表'),null)
  assert.deepEqual(requestedMentorCount('各推荐一下适合就业的导师'),{count:5,maximum:true,default:true,perGroup:true})
  const rows=data.mentors.slice(0,9),artifact={id:'rec',type:'table',purpose:'recommendation',title:'四学院劳务充足导师',columns:[{key:'name'},{key:'college'}],rows,row_notes:rows.map(()=>'劳务与培养条件良好。')}
  const result=await reviewAnswer({chat:{latestUserText:'分别推荐一些各学院劳务充足的导师',messages:[]},assistant:{tools:[],artifacts:[artifact]},answer:'共9位。',data})
  assert.equal(result.ok,true)
})

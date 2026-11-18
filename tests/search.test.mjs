import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {loadData} from '../lib/data.js'
import {createToolRuntime} from '../lib/tools.js'
import {createMentorSearch} from '../lib/search.js'
import {resultForModel} from '../server/agent.js'

const data=loadData()
test('横向纵向原问法的项目检索召回资源与培养记录，不只匹配项目类别字样',()=>{
  const before=JSON.stringify(data),runtime=createToolRuntime(data),original=['横向项目','企业合作','工程实践','纵向课题','国家自然科学基金','国家级项目']
  const result=runtime.execute('search',{terms:original,limit:5000}),nan=result.rows.find(row=>row.name==='南国顺'),fu=result.rows.find(row=>row.name==='付俊松')
  assert.ok(nan);assert.ok(fu)
  assert.match(nan.topic_evidence,/项目丰富|资源充足/)
  assert.match(nan.topic_evidence,/南国顺统筹负责组内管理/)
  assert.match(fu.topic_evidence,/项目资源丰富|经费充足|横向项目/)
  assert.equal(nan.personal_directions,null)
  assert.equal(nan.group_lead,true)
  for(const route of ['横向','纵向'])assert.ok(runtime.execute('search',{terms:[route],limit:5000}).rows.some(row=>row.name==='南国顺'))
  const funds=runtime.execute('search',{terms:['国家自然科学基金'],limit:5000})
  assert.ok(!funds.rows.some(row=>row.name==='南国顺'))
  assert.equal(JSON.stringify(data),before)
})
test('AI security和大模型安全跨来源召回南国顺，原始空字段保持不变',()=>{
  const before=JSON.stringify(data),runtime=createToolRuntime(data)
  for(const term of ['AI security','人工智能安全','大模型安全','LLM security']) {
    const result=runtime.execute('search',{terms:[term],filters:[{field:'can_supervise_doctoral',op:'eq',value:true}],limit:100})
    const nan=result.rows.find(row=>row.name==='南国顺')
    assert.ok(nan,term)
    assert.equal(nan.personal_directions,null)
    assert.equal(nan.group_lead,true)
    assert.equal(nan.can_supervise_doctoral,true)
    assert.match(nan.matched_topics,/大模型及其安全/)
    assert.match(nan.topic_evidence,/大模型及其安全/)
    assert.match(nan.topic_evidence,/南国顺统筹负责组内管理/)
    assert.match(nan.topic_evidence,/指导学博学科/)
    assert.ok(result.sources.some(source=>source.id==='S68'))
    const details=runtime.execute('query',{from:result.ref,filters:[{field:'name',op:'eq',value:'南国顺'}],select:['name','matched_topics','topic_evidence','group_lead','can_supervise_doctoral']})
    assert.equal(details.rows[0].topic_evidence,nan.topic_evidence)
    assert.equal(details.rows[0].matched_topics,nan.matched_topics)
    const view=runtime.execute('visualize',{from:details.ref,type:'table',title:'主题与指导职责'})
    assert.equal(view.artifact.rows[0].name,'南国顺')
  }
  assert.equal(JSON.stringify(data),before)
})

test('读博与深造按研究培养召回，评分、官网博士资格和团队资源同时可读，不修改数据',()=>{
  const before=JSON.stringify(data),runtime=createToolRuntime(data)
  for(const term of ['读博','深造','读博深造','学术训练']){
    const result=runtime.execute('search',{terms:[term],filters:[{field:'college',op:'eq',value:'网络空间安全学院'}],limit:100})
    const row=result.rows.find(row=>row.name==='南国顺')
    assert.ok(row,term);assert.equal(row.rating,4);assert.equal(row.can_supervise_doctoral,true)
    assert.match(row.doctoral_evidence,/指导学博/);assert.match(row.profile_evidence,/网络空间安全基础/)
    assert.match(row.training_evidence,/资源充足|项目很多/);assert.match(row.training_evidence,/负责组内管理/)
    assert.match(row.research_evidence,/资源充足|项目很多/);assert.match(row.research_evidence,/理论研究/)
    const preview=resultForModel(result,'search',{},data).rows.find(row=>row.name==='南国顺')
    assert.equal(preview.rating,4);assert.match(preview.profile_evidence,/学校官网/)
    assert.ok(preview.training_evidence)
    assert.match(runtime.tables[result.ref].rows.find(row=>row.name==='南国顺').training_evidence,/资源充足|项目很多/)
  }
  const direct=runtime.execute('query',{from:'mentors',filters:[{field:'name',op:'eq',value:'南国顺'}]})
  assert.equal(direct.rows[0].can_supervise_doctoral,true)
  assert.match(direct.rows[0].doctoral_evidence,/指导学博/)
  assert.ok(direct.sources.some(source=>source.id==='S68'))
  const view=runtime.execute('visualize',{from:direct.ref,type:'table',title:'研究培养资料',select:['name','rating','profile_evidence','training_evidence','can_supervise_doctoral']})
  assert.match(view.artifact.rows[0].profile_evidence,/指导学博/)
  assert.equal(JSON.stringify(data),before)
})

test('大容量模型获得更完整的科研事实，预算变化不改变候选、评分与完整引用',()=>{
  const runtime=createToolRuntime(data),result=runtime.execute('search',{terms:['读博'],filters:[{field:'college',op:'eq',value:'网络空间安全学院'}],limit:30})
  const small=resultForModel(result,'search',{},data),large=resultForModel(result,'search',{},data,96000)
  assert.deepEqual(small.rows.map(row=>row.mentor_id),large.rows.map(row=>row.mentor_id))
  const original=result.rows.find(row=>row.name==='南国顺'),expanded=large.rows.find(row=>row.name==='南国顺')
  assert.equal(expanded.rating,original.rating)
  assert.equal(expanded.training_evidence,original.training_evidence)
  assert.match(expanded.research_evidence,/工程与理论研究并行/)
  assert.equal(runtime.tables[result.ref].rows.find(row=>row.name==='南国顺').research_evidence,original.research_evidence)
})

test('综合资料按身份关联并随姓名变化，官网成果与评价共同交付，博士学位不冒充指导资格',()=>{
  const custom={metadata:{colleges:['甲学院','乙学院']},sources:[{id:'R',kind:'第三方评价'},{id:'P',kind:'学校官网'}],students:[],exams:[],reviews:[],profiles:[{mentor_id:'a',name:'甲教师',college:'甲学院',source_type:'学校官网',biography:'研究复杂系统。',projects:'主持基础研究课题。',achievements:'发表高水平论文。',admissions:'指导学博学科: 081200|计算机科学与技术',source_ids:['P']},{mentor_id:'b',name:'甲教师',college:'乙学院',biography:'博士毕业。',source_ids:['P']}],mentors:[{mentor_id:'a',name:'甲教师',college:'甲学院',group:'1组',rating:4,review_text:'指导：每周讨论问题。\n资源：支持理论研究，有充足项目。',group_context:'甲教师负责组内管理。',source_ids:['R']},{mentor_id:'b',name:'甲教师',college:'乙学院',group:'2组',rating:5,review_text:'管理宽松。',source_ids:['R']}]}
  const before=JSON.stringify(custom),rows=createToolRuntime(custom).execute('query',{from:'mentors',select:['mentor_id','name','college','rating','profile_evidence','training_evidence','can_supervise_doctoral'],limit:10}).rows
  assert.equal(rows.length,2)
  const first=rows.find(row=>row.mentor_id==='a'),second=rows.find(row=>row.mentor_id==='b')
  assert.match(first.profile_evidence,/基础研究课题/);assert.match(first.profile_evidence,/高水平论文/)
  assert.match(first.training_evidence,/每周讨论/);assert.equal(first.rating,4);assert.equal(first.can_supervise_doctoral,true)
  assert.equal(second.can_supervise_doctoral,null);assert.doesNotMatch(second.profile_evidence,/基础研究课题/)
  assert.equal(JSON.stringify(custom),before)
  const renamed=structuredClone(custom)
  renamed.mentors[0].name='乙教师';renamed.mentors[0].group_context='乙教师负责组内管理。';renamed.profiles[0].name='乙教师'
  const found=createMentorSearch(renamed)(['读博']).find(row=>row.mentor_id==='a')
  assert.equal(found.name,'乙教师');assert.equal(found.rating,first.rating);assert.equal(found.group_lead,true)
  assert.equal(found.profile_evidence,first.profile_evidence)
})

test('召回区分个人与团队依据，不把泛AI安全扩成大模型安全',()=>{
  const runtime=createToolRuntime(data),result=runtime.execute('search',{terms:['大模型安全'],limit:100})
  assert.ok(!result.rows.some(row=>row.name==='付俊松'))
  for(const name of ['吴慧慈','张华','尚煜茗'])assert.ok(result.rows.some(row=>row.name===name))
  const personal=runtime.execute('query',{from:result.ref,filters:[{field:'topic_basis',op:'contains',value:'个人'}],select:['name']})
  assert.ok(personal.rows.some(row=>row.name==='南国顺'))
})

test('负责人和博士资格依现有角色、指导学科推导，不因博士学位或跨源同名合并身份',()=>{
  const custom={mentors:[{mentor_id:'a',name:'同名',college:'甲学院',group:'1 组',personal_directions:null,group_context:'同名负责组管理',directions:'大模型及其安全',source_ids:['S1']},{mentor_id:'b',name:'同名',college:'乙学院',group:'1 组',personal_directions:'大模型安全',directions:'',group_context:'同名不负责组管理',source_ids:['S2']}],profiles:[{mentor_id:'a',name:'同名',college:'甲学院',supervisor_type:null,admissions:'指导学博学科: 083900|网络空间安全',source_ids:['S3']},{mentor_id:'b',name:'同名',college:'乙学院',biography:'博士毕业',supervisor_type:'硕士生导师',source_ids:['S4']}]}
  const rows=createMentorSearch(custom)(['大模型安全'])
  assert.equal(rows.length,2)
  assert.equal(rows.find(row=>row.mentor_id==='a').can_supervise_doctoral,true)
  assert.equal(rows.find(row=>row.mentor_id==='b').can_supervise_doctoral,null)
  assert.equal(rows.find(row=>row.mentor_id==='b').group_lead,false)
})

test('主题检索的完整记录可以经过CLI标准输入继续筛选',()=>{
  const first=spawnSync(process.execPath,['bin/mentor.mjs','search','--terms','AI security','--limit','100'],{encoding:'utf8'})
  assert.equal(first.status,0,first.stderr)
  const second=spawnSync(process.execPath,['bin/mentor.mjs','query','--from','-','--where','[{"field":"name","op":"eq","value":"南国顺"}]','--select','name,topic_evidence,can_supervise_doctoral'],{input:first.stdout,encoding:'utf8'})
  assert.equal(second.status,0,second.stderr)
  const rows=JSON.parse(second.stdout).rows
  assert.equal(rows[0].name,'南国顺');assert.match(rows[0].topic_evidence,/负责组(?:内)?管理/)
})

test('长介绍返回命中主题的上下文，不只截取与主题无关的开头',()=>{
  const custom={mentors:[{mentor_id:'a',name:'测试导师',college:'甲学院',group:null}],profiles:[{mentor_id:'a',name:'测试导师',college:'甲学院',biography:'教学经历。'.repeat(150)+'研究重点是 LLM security，开展模型红队测试。',source_ids:['S1']}]}
  const rows=createMentorSearch(custom)(['大模型安全'])
  assert.equal(rows.length,1)
  assert.match(rows[0].topic_evidence,/LLM security/)
  assert.match(rows[0].topic_evidence,/模型红队测试/)
  assert.ok(rows[0].topic_evidence.length<400)
  assert.equal(rows[0].group_lead,null)
})
test('仅有官网介绍的候选可从搜索ref按稳定键直接排名，姓名与学院来自真实页面',()=>{
  const custom=structuredClone(data),source={id:'S99999',title:'新增官方介绍',kind:'学校官网',url:'https://teacher.bupt.edu.cn/example/zh_CN/index.htm'}
  custom.sources.push(source);custom.profiles.push({profile_id:'new-official',name:'官网新增导师',college:'计算机学院（国家示范性软件学院）',research_areas:'测试稀有研究方向',supervisor_type:'博士生导师',source_ids:[source.id],mentor_id:null})
  const runtime=createToolRuntime(custom),result=runtime.execute('search',{terms:['测试稀有研究方向']})
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].mentor_id,null)
  assert.equal(result.rows[0].college,'计算机学院');assert.match(result.rows[0].candidate_id,/^candidate-/)
  const view=runtime.execute('visualize',{from:result.ref,type:'table',title:'科研候选',pick:{field:'candidate_id',values:[result.rows[0].candidate_id]},row_number_as:'推荐序',select:['name','college','topic_evidence','can_supervise_doctoral']})
  assert.equal(view.artifact.rows[0].name,'官网新增导师');assert.equal(view.artifact.rows[0].推荐序,1)
  assert.equal(view.artifact.rows[0].can_supervise_doctoral,true)
})

test('网安读博与就业路线分别按学术实力和培养条件科学排序，预览保留核心依据',()=>{
  const runtime=createToolRuntime(data)
  const phd=runtime.execute('search',{terms:['读博'],filters:[{field:'college',op:'eq',value:'网络空间安全学院'}],limit:30})
  const phdAll=runtime.execute('search',{terms:['读博'],filters:[{field:'college',op:'eq',value:'网络空间安全学院'}],limit:100})
  const phdNames=phd.rows.map(row=>row.name),allPhdNames=phdAll.rows.map(row=>row.name)
  assert.equal(phdNames[0],'南国顺')
  assert.ok(!phdNames.slice(0,5).includes('刘建毅'))
  assert.ok(allPhdNames.indexOf('南国顺')<allPhdNames.indexOf('吕昕晨'))
  assert.ok(allPhdNames.indexOf('南国顺')<allPhdNames.indexOf('刘建毅'))
  assert.ok(!phdNames.slice(0,10).some(name=>['陈秀波','黄勤龙','邓小龙'].includes(name)))
  const phdPreview=resultForModel(phd,'search',{terms:['读博']},data,28000).rows.find(row=>row.name==='南国顺')
  assert.match(phdPreview.academic_summary,/首席科学家/)
  assert.match(phdPreview.academic_summary,/CVPR|30余篇/)
  assert.match(phdPreview.enrollment_signal,/11人.*保研9.*第1名.*407/)
  assert.equal(phdPreview.red_flags??null,null)

  const crossCollege=runtime.execute('search',{terms:['6G'],limit:50})
  assert.ok(crossCollege.rows.some(row=>row.college?.includes('信息与通信工程学院')))

  for(const term of ['就业','只读硕士','网络安全','网安']){
    const res=runtime.execute('search',{terms:[term],filters:[{field:'college',op:'eq',value:'网络空间安全学院'}],limit:30})
    assert.ok(res.rows.some(row=>row.name==='付俊松'),term)
    if(['就业','只读硕士'].includes(term))assert.equal(res.rows[0].name,'付俊松',term)
  }
  const job=runtime.execute('search',{terms:['就业'],filters:[{field:'college',op:'eq',value:'网络空间安全学院'}],limit:30})
  const jobPreview=resultForModel(job,'search',{terms:['就业']},data,28000).rows.find(row=>row.name==='付俊松')
  assert.match(jobPreview.internship,/研二下学期可以实习/)
  assert.match(jobPreview.management,/无需坐班/)
  assert.match(jobPreview.graduation,/不要求发表SCI/)
  assert.equal(jobPreview.stipend_monthly_max,2000)

  const q=runtime.execute('query',{from:'mentors',filters:[{field:'college',op:'eq',value:'网络空间安全学院'}],sort_by:'rating',order:'desc',limit:30})
  const qPreview=resultForModel(q,'query',{from:'mentors',sort_by:'rating'},data,28000).rows.find(row=>row.name==='付俊松')
  assert.match(qPreview.internship,/研二下学期可以实习/)
  assert.match(qPreview.green_flags,/亲自指导/)

  const homo=runtime.execute('search',{terms:['傅俊松']})
  assert.ok(homo.rows.some(row=>row.name==='付俊松'))
})

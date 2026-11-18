import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {loadData,readSealedDataset,resolveProfileMentor} from '../lib/data.js'
import {createToolRuntime} from '../lib/tools.js'
import {publicText,publicMessage} from '../lib/presentation.js'

const imported=readSealedDataset('pdf-reviews'),data=loadData()
test('48页材料的评价与目录已规范化，旧PDF正文不再留在数据中',()=>{
  assert.equal(imported.sources.reduce((n,source)=>n+source.pages,0),48)
  assert.ok(!fs.existsSync(new URL('../导师评价.md',import.meta.url)),'旧原文文件已删除')
  for(const source of imported.sources){
    assert.equal(source.kind,'第三方评价');assert.equal(source.year,2026)
    assert.equal(imported.documents.find(document=>document.source_id===source.id).page_count,source.pages)
    assert.match(source.original_sha256,/^[a-f0-9]{64}$/)
  }
  assert.ok(imported.documents.every(document=>!document.pages))
  for(const review of imported.reviews){
    assert.equal(review.source_locator,'站内评价归纳档案')
    assert.ok(review.text.trim())
  }
  const yang=imported.reviews.find(review=>review.name==='杨娟')
  assert.match(yang.text,/没有PRD|没有数据库设计/)
  assert.ok(imported.mentors.some(row=>row.name==='王鹏飞'))
  assert.ok(imported.mentors.some(row=>row.name==='裴颂伟'))
  assert.ok(imported.mentors.every(row=>/^[\u4e00-\u9fff]{2,4}$/.test(row.name)))
})
test('共同评价保留完整事实，个人评分与全部关联条目一致',()=>{
  const find=(name,college)=>imported.mentors.find(row=>row.name===name&&row.college===college)
  for(const name of ['袁泉','罗贵阳']){assert.equal(find(name,'计算机学院').rating,5);assert.match(find(name,'计算机学院').review_text,/共同开会/)}
  assert.equal(find('苏菲','人工智能学院').rating,4)
  assert.equal(find('仲苏玉','人工智能学院').rating,5)
  assert.equal(find('刘勇','人工智能学院').rating,2)
  assert.equal(find('涂丽云','人工智能学院').rating,2)
  const gao=find('高慧','软件学院')
  assert.match(gao.group_context,/偏工程/)
  assert.doesNotMatch(gao.group_context,/邝坚.*干预少|会帮助联系实习/)
  assert.ok(imported.reviews.some(row=>row.mentor_id===null&&row.group==='软件 1 组'&&/帮忙联系实习/.test(row.text)))
  const wang=find('王玉龙','计算机学院')
  assert.equal(wang.rating,1);assert.equal(wang.review_note,null)
  assert.deepEqual(imported.reviews.filter(row=>row.name==='王玉龙').map(row=>row.rating),[1,1])
  for(const mentor of imported.mentors)for(const review of imported.reviews.filter(review=>review.mentor_id===mentor.mentor_id))assert.equal(review.rating,mentor.rating)
})
test('四学院的查询、评分统计、检索及图表共用工具，原学生和成绩仍为网安样本',()=>{
  const runtime=createToolRuntime(data),catalog=runtime.execute('catalog')
  assert.deepEqual(new Set(catalog.metadata.colleges),new Set(['网络空间安全学院','计算机学院','人工智能学院','软件学院']))
  const total=runtime.execute('aggregate',{from:'mentors',group_by:['college'],metrics:[{op:'count',as:'导师数'}]})
  assert.equal(total.rows.length,4)
  assert.equal(total.rows.reduce((n,row)=>n+row.导师数,0),414)
  for(const [college,name]of [['计算机学院','左兴权'],['软件学院','高慧'],['人工智能学院','王小婕']]){
    const rows=runtime.execute('query',{from:'mentors',filters:[{field:'college',op:'eq',value:college},{field:'rating',op:'eq',value:5}],select:['name','college','rating','review_text'],limit:5000})
    assert.ok(rows.rows.some(row=>row.name===name));assert.ok(rows.sources.some(source=>source.scope===college))
    const view=runtime.execute('visualize',{from:rows.ref,type:'table',title:college+'评价'})
    assert.ok(view.artifact.rows.some(row=>row.name===name))
    assert.ok(runtime.execute('query',{from:'reviews',filters:[{field:'college',op:'eq',value:college}],limit:5000}).returned>0)
  }
  for(const name of ['左兴权','夏亚梅','王小婕'])assert.ok(runtime.execute('search',{terms:['横向','纵向'],limit:5000}).rows.some(row=>row.name===name))
  for(const term of ['NLP','自然语言处理']){
    const nlp=runtime.execute('search',{terms:[term],limit:5000})
    assert.ok(nlp.rows.some(row=>row.name==='王小婕'&&row.college==='人工智能学院'))
    assert.ok(nlp.rows.some(row=>row.name==='双锴'&&row.college==='计算机学院'))
  }
  assert.equal(data.students.length,376);assert.equal(data.exams.length,158)
  assert.ok(imported.mentors.every(row=>row.student_count===null&&row.exam_count===null&&row.recommended_count===null&&row.score_first_mean===null))
})
test('跨院同名按不同身份保存，原官网关联和历史人数不被新评价覆盖',()=>{
  const liu=data.mentors.filter(row=>row.name==='刘勇')
  assert.equal(liu.length,2);assert.equal(new Set(liu.map(row=>row.mentor_id)).size,2)
  assert.equal(liu.find(row=>row.college==='人工智能学院').rating,2)
  const original=readSealedDataset('dataset')
  for(const mentor of original.mentors){
    const current=data.mentors.find(row=>row.mentor_id===mentor.mentor_id)
    for(const field of ['rating','student_count','exam_count','recommended_count','score_first_mean'])assert.equal(current[field],mentor[field],mentor.name+':'+field)
  }
  const rawWeb=readSealedDataset('web-profiles')
  for(const row of rawWeb.profiles){
    const originalId=row.mentor_id||resolveProfileMentor(row,original.mentors)
    if(originalId)assert.equal(data.profiles.find(profile=>profile.profile_id===row.profile_id).mentor_id,originalId)
  }
  const left=data.mentors.find(row=>row.name==='左兴权'&&row.college==='计算机学院')
  assert.ok(data.profiles.some(profile=>profile.name==='左兴权'&&profile.mentor_id===left.mentor_id))
})
test('月劳务保留明确周期和条件，PDF定位仅供内部使用',()=>{
  const find=(name,college)=>imported.mentors.find(row=>row.name===name&&row.college===college)
  assert.equal(find('刘亮','计算机学院').stipend_monthly_min,500)
  assert.equal(find('闫丹凤','计算机学院').stipend_monthly_min,1000)
  assert.equal(find('杨正球','软件学院').stipend_monthly_min,400)
  assert.equal(find('仲苏玉','人工智能学院').stipend_monthly_min,600)
  assert.equal(find('冯方向','人工智能学院').stipend_monthly_min,null)
  const shown=publicMessage({role:'assistant',content:'资料见 PDFs/计算机导师.pdf:P4-5。[S137]',artifacts:[],sources:imported.sources})
  assert.doesNotMatch(JSON.stringify(shown),/PDFs\/|\.pdf|:P4|sha256|source_locator/)
  const runtime=createToolRuntime(data),source=runtime.execute('query',{from:'sources',filters:[{field:'id',op:'eq',value:'S137'}]}),view=runtime.execute('visualize',{from:source.ref,type:'table',title:'评价资料'})
  assert.ok(!view.artifact.columns.some(column=>column.key==='sha256'))
  assert.equal(publicText('[论文](https://example.org/docs/paper.pdf#page=3)'),'[论文](https://example.org/docs/paper.pdf#page=3)')
})

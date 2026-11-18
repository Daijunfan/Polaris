import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {createStore} from '../server/store.js'
import {createWorkbench} from '../server/workbench.js'
import {createApplication} from '../server/index.mjs'
import {createConfig} from '../server/config.js'
import {loadData} from '../lib/data.js'
import {createToolRuntime} from '../lib/tools.js'
import {publicMessage} from '../lib/presentation.js'

const data=loadData()
async function workspace(run,owner=true){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'导师工作台-')),store=createStore(dir)
  if(owner)store.write('membership',{tier:'ssvip',owner:true,experienceTier:null})
  const board=createWorkbench({store,data})
  try{await run(board,store,dir)}finally{await fs.rm(dir,{recursive:true,force:true})}
}
test('开源版对每位用户开放全部功能，收藏与对比不限制人数',async()=>workspace(async board=>{
  assert.equal(board.snapshot().membership.effectiveTier,'full')
  const mentors=board.directory().rows.slice(0,20)
  board.addItems(mentors);board.setComparison(mentors)
  assert.equal(board.snapshot().items.length,20);assert.equal(board.snapshot().comparison.length,20)
  board.updateItem(mentors[0].key,{note:'普通用户也可完整记录',status:'priority'})
  assert.ok(board.report('csv').body.includes('普通用户也可完整记录'))
  assert.ok(board.report('html').body)
  assert.ok(board.report('csv',undefined,{scope:'library'}).body.includes('重点联系'))
  const runtime=createToolRuntime(data)
  assert.equal(board.execute({action:'save',mentors:mentors.slice(0,2).map(({name,college})=>({name,college})),list_name:'我的候选库'},runtime).saved_count,20)
  board.setGoal('科研深造');assert.ok(board.snapshot().fields.includes('research_evidence'))
  assert.deepEqual(board.analyze([]).keys.length,20)
  board.addSnapshot('开放方案');board.addTemplate('开放模板');board.addList('开放清单')
  assert.equal(board.snapshot().snapshots.length,1)
},false))
test('目标、联动、动态视图和方案能力无需任何等级即可使用',async()=>workspace(async board=>{
  const mentors=board.directory().rows.slice(0,16)
  board.addItems(mentors);board.setComparison(mentors)
  board.setGoal('科研深造')
  assert.ok(board.snapshot().fields.includes('research_evidence'))
  const result=board.analyze([{field:'rating',op:'gte',value:4}])
  assert.ok(result.keys.every(key=>board.snapshot().items.find(row=>row.key===key).rating>=4))
  board.addView('培养体验4分起',[{field:'rating',op:'gte',value:4}])
  assert.deepEqual(board.getView(board.snapshot().views[0].id).keys,result.keys)
  const risky=board.analyze([{field:'red_flags',op:'not_null'}])
  assert.ok(risky.keys.every(key=>board.snapshot().items.find(row=>row.key===key)))
  board.addSnapshot('方案');assert.equal(board.snapshot().snapshots.length,1)
}))
test('跨学院同名导师按身份保存，名字不明确时不猜；资料操作不修改原始数据',async()=>workspace(async board=>{
  const before=JSON.stringify(data),rows=board.directory('刘勇').rows
  assert.ok(rows.length>=2)
  board.addItems(rows)
  assert.equal(board.snapshot().items.length,rows.length)
  assert.equal(new Set(board.snapshot().items.map(row=>row.key)).size,rows.length)
  assert.throws(()=>board.addItems([{name:'刘勇'}]),/同名/)
  for(const person of rows)assert.equal(board.detail(person.key).college,person.college)
  assert.equal(JSON.stringify(data),before)
}))
test('笔记和联系状态持久化，降级继续保留，移除候选可连同分组与笔记撤销',async()=>workspace(async(board,store)=>{
  const person=board.directory('南国顺').rows[0]
  board.addItems([person]);board.updateItem(person.key,{note:'准备联系网络安全方向',status:'priority'})
  board.addList('科研候选');const list=board.snapshot().lists[0];board.updateList(list.id,{keys:[person.key]})
  assert.equal(board.snapshot().items[0].note,'准备联系网络安全方向')
  board.updateItem(person.key,{note:'准备联系网络安全方向'})
  board.removeItem(person.key);assert.equal(board.snapshot().items.length,0)
  board.restoreItem(person.key)
  assert.equal(board.snapshot().items[0].note,'准备联系网络安全方向')
  assert.ok(board.snapshot().lists[0].keys.includes(person.key))
  const restarted=createWorkbench({store,data})
  assert.equal(restarted.snapshot().items[0].status,'priority')
}))
test('方案保留保存时的数据与笔记，载入名单不覆盖最新笔记；模板保留维度顺序',async()=>workspace(async board=>{
  const mentors=board.directory().rows.slice(0,3)
  board.addItems(mentors);board.updateItem(mentors[0].key,{note:'第一轮判断'})
  board.setComparison(mentors);board.setGoal('科研深造');board.setFields(['research_evidence','rating','internship'])
  board.addTemplate('科研比较');assert.deepEqual(board.snapshot().templates[0].fields,['research_evidence','rating','internship'])
  board.addSnapshot('第一轮方案');const snapshot=board.getSnapshot(board.snapshot().snapshots[0].id)
  board.updateItem(mentors[0].key,{note:'第二轮判断'})
  assert.equal(snapshot.rows[0].note,'第一轮判断')
  board.setComparison(mentors.slice(1));board.setGoal('就业实习');board.restoreSnapshot(snapshot.id)
  assert.equal(board.snapshot().comparison.length,3)
  assert.equal(board.snapshot().items[0].note,'第二轮判断')
  assert.deepEqual(board.snapshot().fields,['research_evidence','rating','internship'])
  assert.equal(board.snapshot().goal,'科研深造')
  board.setGoal('就业实习');board.restoreTemplate(board.snapshot().templates[0].id)
  assert.equal(board.snapshot().goal,'科研深造')
  assert.deepEqual(board.snapshot().fields,['research_evidence','rating','internship'])
}))
test('完整报告包含概览、分布、事实、备注与安全导出',async()=>workspace(async board=>{
  const people=board.directory().rows.slice(0,3)
  board.addItems(people);board.setComparison(people);board.updateItem(people[0].key,{note:'<script>alert(1)</script>',status:'priority'})
  const output={},tier='full'
  {
    output[tier]=board.report('html').body
    assert.doesNotMatch(output[tier],/<script>/);assert.match(output[tier],/&lt;script&gt;/)
    assert.ok(people.every(person=>output[tier].includes(person.name)))
    assert.match(output[tier],/我的联系进度：重点联系/)
    assert.match(board.report('md').body,/我的联系进度：重点联系/)
    const csv=board.report('csv').body
    assert.ok(csv.startsWith('\uFEFF'));assert.doesNotMatch(csv,/mentor_id|candidate_id|source_locator/)
  }
  assert.match(output.full,/<h2>比较概览/);assert.match(output.full,/<h2>数据分布/)
  board.addSnapshot('科研方案','偏重研究平台与本人指导')
  assert.match(board.report('html',board.snapshot().snapshots[0].id).body,/我的选择结论/)
  board.updateItem(people[0].key,{note:'  =2+3'});assert.ok(board.report('csv').body.includes("'  =2+3"))
}))
test('无目标的历史方案导出保持原范围，不借用当前就业目标',async()=>workspace(async board=>{
  board.setComparison(board.directory().rows.slice(0,2));board.addSnapshot('第一轮自由比较')
  const id=board.snapshot().snapshots[0].id
  board.setGoal('就业实习')
  assert.doesNotMatch(board.report('html',id).body,/<h2>比较概览 · 就业实习/)
  assert.match(board.report('html').body,/<h2>比较概览 · 就业实习/)
}))
test('导师发现支持连续分页，普通用户也能查完整目录',async()=>workspace(async board=>{
  const first=board.directory(),next=board.directory('','',first.next_offset)
  assert.equal(first.rows.length,30);assert.equal(next.rows.length,30)
  assert.ok(first.rows.every(row=>!next.rows.some(item=>item.key===row.key)))
  assert.ok(first.total>=414);assert.throws(()=>board.directory('','',-1),/页码/)
},false))
test('HTTP接口不再有等级门槛，旧会员接口保持兼容且不改变资料',async()=>workspace(async(board,store)=>{
  store.write('membership',{tier:'free',owner:false,experienceTier:null})
  const app=createApplication({store,data,config:createConfig(store,{})}),server=http.createServer(app.handler)
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base='http://127.0.0.1:'+server.address().port
  const post=(route,body,method='POST')=>fetch(base+route,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  try{
    assert.equal((await post('/api/workbench/lists',{name:'我的清单'})).status,200)
    const rows=board.directory().rows.slice(0,3)
    assert.equal((await post('/api/workbench/comparison',{mentors:rows},'PUT')).status,200)
    assert.equal((await post('/api/workbench/items',{mentors:rows})).status,200)
    assert.equal((await post('/api/membership/experience',{tier:'free'})).status,200)
    const state=await fetch(base+'/api/workbench').then(response=>response.json())
    assert.equal(state.items.length,3);assert.equal(state.membership.effectiveTier,'full')
  }finally{await app.cancelAll();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
}))

test('工作台工具消费真实查询ref，读表可继续查询，私人备注只在要求时发送',async()=>workspace(async board=>{
  const runtime=createToolRuntime(data),query=runtime.execute('query',{from:'mentors',filters:[{field:'name',op:'in',value:['南国顺','杨成']}],select:['name','college'],limit:10})
  const saved=board.execute({action:'save',from:query.ref,list_name:'研究选择'},runtime)
  assert.equal(saved.saved_count,2)
  board.execute({action:'note',mentors:[{name:'南国顺',college:'网络空间安全学院'}],note:'私人偏好：需要亲自指导',status:'priority'},runtime)
  const plain=board.execute({action:'read',list_name:'研究选择'},runtime)
  assert.ok(plain.rows.every(row=>!('personal_note' in row)))
  assert.ok(!plain.columns.some(column=>column.key==='key'))
  assert.equal(plain.total,2)
  const withNotes=board.execute({action:'read',include_notes:true},runtime)
  assert.match(withNotes.rows.find(row=>row.name==='南国顺').personal_note,/私人偏好/)
  const filtered=runtime.execute('query',{from:plain.ref,filters:[{field:'name',op:'eq',value:'南国顺'}],select:['name','rating','research_evidence']})
  assert.equal(filtered.rows[0].rating,4);assert.match(filtered.rows[0].research_evidence,/首席科学家/)
}))
test('高级联动与方案对照使用实际条件，维度变化不冒充导师事实变化',async()=>workspace(async board=>{
  const mentors=board.directory().rows.slice(0,3)
  board.addItems(mentors);board.setComparison(mentors.slice(0,2));board.setFields(['rating','internship'])
  board.addSnapshot('方案A','第一轮结论')
  board.updateItem(mentors[0].key,{note:'补充联系记录',status:'contacted'})
  board.setComparison([mentors[0],mentors[2]]);board.setFields(['rating','research_evidence'])
  board.addSnapshot('方案B','第二轮结论')
  const snapshots=board.snapshot().snapshots,diff=board.compareScenarios([snapshots[1].id,snapshots[0].id])
  assert.equal(diff.onlyLeft.length,1);assert.equal(diff.onlyRight.length,1)
  assert.equal(diff.shared.length,1)
  assert.ok(diff.shared[0].changes.some(change=>change.field==='note'))
  assert.deepEqual(diff.shared[0].changes.find(change=>change.field==='contact_status'),{field:'contact_status',label:'我的联系进度',before:'待比较',after:'已联系'})
  assert.ok(!diff.shared[0].changes.some(change=>change.field==='research_evidence'))
  assert.ok(diff.right.extraFields.includes('科研培养与平台资料'))
}))
test('Agent读回已存方案与模板后，可实际载入并保留最新个人记录',async()=>workspace(async board=>{
  const runtime=createToolRuntime(data),people=board.directory().rows.slice(0,2)
  board.addItems(people);board.setComparison(people);board.setGoal('科研深造');board.addSnapshot('科研初选');board.addTemplate('科研要点')
  board.updateItem(people[0].key,{note:'刚刚联系完',status:'contacted'});board.setComparison(people.slice(1));board.setGoal('就业实习')
  const read=board.execute({action:'read'},runtime)
  assert.equal(read.templates[0].goal,'科研深造')
  const loaded=board.execute({action:'restore',saved_type:'snapshot',saved_id:read.snapshots[0].id},runtime)
  assert.equal(loaded.comparison_count,2);assert.equal(loaded.selected.length,2)
  assert.equal(board.snapshot().goal,'科研深造');assert.equal(board.snapshot().items[0].note,'刚刚联系完')
  board.setGoal('就业实习');board.execute({action:'restore',saved_type:'template',saved_id:read.templates[0].id},runtime)
  assert.equal(board.snapshot().goal,'科研深造')
  assert.throws(()=>board.execute({action:'restore',saved_type:'snapshot',saved_id:'不存在的方案'},runtime),/没有找到/)
}))
test('候选库和当前对比分别读取，未收藏人选可比较，报告保留实际范围',async()=>workspace(async board=>{
  const runtime=createToolRuntime(data),people=board.directory().rows.slice(0,4)
  board.addItems(people.slice(0,3));board.setComparison([people[3],people[0]])
  const library=board.execute({action:'read'},runtime),comparison=board.execute({action:'read',scope:'comparison',include_notes:true},runtime)
  assert.equal(library.total,3);assert.equal(library.scope,'library');assert.equal(library.comparison.count,2)
  assert.equal(comparison.total,2);assert.deepEqual(comparison.rows.map(row=>row.name),[people[3].name,people[0].name])
  assert.equal(board.snapshot().comparison.length,2)
  assert.equal(board.execute({action:'report'},runtime).file.count,2)
  assert.equal(board.execute({action:'report',scope:'library'},runtime).file.count,3)
}))
test('学院列表已归一化，可按官网学院筛选，HTML报告使用新版视觉与SVG图表',async()=>workspace(async board=>{
  const colleges=board.snapshot().colleges
  assert.ok(!colleges.includes('计算机学院（国家示范性软件学院）'))
  assert.ok(colleges.includes('计算机学院'))
  assert.ok(colleges.includes('信息与通信工程学院'))

  const rows=board.directory('','信息与通信工程学院').rows
  assert.ok(rows.length>0)
  assert.ok(rows.every(row=>row.college.split(/[、,，]+/).includes('信息与通信工程学院')))

  const people=board.directory().rows.slice(0,3)
  board.addItems(people);board.setComparison(people)
  const html=board.report('html').body
  assert.ok(html.includes('#1d4b8f'),'报告应使用新版主色')
  assert.match(html,/<svg\b[^>]*role="img"[^>]*aria-label="学院分布"/)
  assert.match(html,/<svg\b[^>]*role="img"[^>]*aria-label="培养体验评分分布"/)
}))
test('Agent生成的报告是真实持久文件，切换体验档位后已有文件保持原样',async()=>workspace(async(board,store)=>{
  const runtime=createToolRuntime(data),mentors=board.directory().rows.slice(0,2).map(({name,college})=>({name,college}))
  const result=board.execute({action:'report',mentors,name:'导师资料对照',format:'html'},runtime)
  assert.ok(result.file.id)
  const file=board.getReport(result.file.id)
  assert.match(file.body,/<!doctype html>/)
  assert.ok(mentors.every(person=>file.body.includes(person.name)))
  board.setExperience('free')
  assert.equal(board.getReport(result.file.id).body,file.body)
  const visible=publicMessage({id:'report',role:'assistant',status:'complete',content:'报告已生成',files:[{...result.file,body:'PRIVATE_BODY_TEST'}]})
  assert.equal(visible.files[0].name,'导师资料对照.html')
  assert.doesNotMatch(JSON.stringify(visible),/PRIVATE_BODY_TEST/)
  const restarted=createWorkbench({store,data})
  assert.equal(restarted.getReport(result.file.id).body,file.body)
}))

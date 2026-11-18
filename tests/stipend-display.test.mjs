import test from 'node:test'
import assert from 'node:assert/strict'
import {publicArtifact,publicMessage} from '../lib/presentation.js'
import {display,numericColumn,messageMarkdown} from '../src/presentation.js'
import {createToolRuntime} from '../lib/tools.js'
import {loadData} from '../lib/data.js'
import {createAnswerStream} from '../server/delivery.js'

const columns=[{key:'name',label:'导师',type:'string'},{key:'stipend_monthly_min',label:'月劳务下限（元）',type:'number'},{key:'stipend_monthly_max',label:'月劳务上限（元）',type:'number'}]
test('截图中的单值月劳务合并为一项金额，旧对话和导出同步修正，原始记录不改',()=>{
  const rows=[1000,2000,1200].map((amount,i)=>({name:['杨文川','付俊松','郭燕慧'][i],stipend_monthly_min:amount,stipend_monthly_max:amount}))
  const artifact={id:'legacy-salary',type:'table',title:'导师对比',rows,columns,sources:[]},before=structuredClone(artifact)
  const shown=publicMessage({role:'assistant',content:'对比见表。',artifacts:[artifact],sources:[]}).artifacts[0]
  assert.deepEqual(shown.columns.map(c=>c.key),['name','stipend_monthly'])
  assert.deepEqual(shown.rows.map(row=>row.stipend_monthly),[1000,2000,1200])
  assert.equal(shown.columns[1].label,'月劳务（元）')
  assert.equal(numericColumn(shown.columns[1],shown.rows),true)
  assert.doesNotMatch(JSON.stringify(shown),/上限|下限/)
  const copied=messageMarkdown({role:'assistant',content:'对比见表。',artifacts:[shown],sources:[]})
  assert.doesNotMatch(copied,/上限|下限/);assert.match(copied,/2,000/)
  assert.deepEqual(artifact,before)
})
test('原文区间合并为一项范围，缺失保持空值，格式和重复投影一致',()=>{
  const artifact={id:'range',type:'table',title:'月劳务',columns,sources:[],rows:[{name:'甲',stipend_monthly_min:500,stipend_monthly_max:1200},{name:'乙',stipend_monthly_min:null,stipend_monthly_max:null}]}
  const shown=publicArtifact(artifact),money=shown.columns[1]
  assert.equal(shown.rows[0].stipend_monthly,'500–1200')
  assert.equal(display(shown.rows[0].stipend_monthly,money),'500–1,200')
  assert.equal(display(shown.rows[1].stipend_monthly,money),'—')
  assert.deepEqual(publicArtifact(shown),shown)
})
test('数值图表与筛选继续使用记录端点，不将端点标签称为收入上下限',()=>{
  const runtime=createToolRuntime(loadData()),table=runtime.execute('query',{from:'mentors',filters:[{field:'name',op:'eq',value:'付俊松'}],select:['name','stipend_monthly_min','stipend_monthly_max','stipend_text']})
  const column=table.columns.find(column=>column.key==='stipend_monthly_max')
  assert.match(column.label,/记录高值/);assert.match(column.description,/记录金额|区间端点/)
  const view=runtime.execute('visualize',{from:table.ref,type:'bar',x:'name',y:['stipend_monthly_max'],title:'记载月劳务金额'})
  const shown=publicArtifact(view.artifact)
  assert.deepEqual(shown.y,['stipend_monthly_max']);assert.equal(shown.rows[0].stipend_monthly_max,2000)
  assert.doesNotMatch(shown.columns.find(column=>column.key==='stipend_monthly_max').label,/上限/)
})

test('有真实对照表时正文不再重复手写同一数据，避免另造数值，流式和导出一致',()=>{
  const artifact={id:'verified',type:'table',title:'导师对比',columns:[{key:'name',label:'导师',type:'string'},{key:'rating',label:'原文评分 / 5',type:'number'}],rows:[{name:'付俊松',rating:5}],sources:[]}
  const raw='月劳务记载为2000/月。\n\n| 导师 | 原文评分 / 5 |\n| --- | --- |\n| 付俊松 | 4.7 |'
  const states=[],stream=createAnswerStream((text,content)=>states.push(content),'',[artifact])
  for(const part of raw.match(/[\s\S]{1,8}/g))stream.write(part)
  stream.finish()
  assert.ok(states.every((state,index)=>!index||state.startsWith(states[index-1])))
  assert.doesNotMatch(states.at(-1),/4\.7/)
  const copied=messageMarkdown({role:'assistant',content:raw,artifacts:[artifact],sources:[]})
  assert.doesNotMatch(copied,/4\.7/);assert.match(copied,/\| 付俊松 \| 5 \|/)
  const other=publicMessage({role:'assistant',content:'| 导师 | 新信息 |\n| --- | --- |\n| 另一老师 | 内容 |',artifacts:[artifact],sources:[]})
  assert.match(other.content,/另一老师/)
})

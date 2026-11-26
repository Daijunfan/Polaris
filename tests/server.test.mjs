import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApplication } from '../server/index.mjs'
import { createStore } from '../server/store.js'
import { createConfig, normalizeBaseUrl } from '../server/config.js'
import { startMockProvider } from './mock-provider.mjs'
import { createToolRuntime } from '../lib/tools.js'
import { loadData } from '../lib/data.js'
import { VAULT_NAMES, getRuntimeVaultState, isVaultConfigured, lockedFallbackDataset, resetRuntimeVaultState, sealVaultPayload } from '../lib/vault.js'
import { compactContext, contextMessages, estimateTokens, refreshDataContext,visibleHistory } from '../server/context.js'
import {reviewAnswer} from '../server/review.js'
import {parseDsmlToolCalls} from '../server/provider.js'

let provider, server, app, base, dir
const call = async (url, method = 'GET', body) => {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
async function makeChat() { return (await call('/api/chats', 'POST', {})).body }
async function message(id, text) {
  const response = await fetch(`${base}/api/chats/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
  return { status: response.status, text: await response.text() }
}
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mentor-lens-test-'))
  provider = await startMockProvider()
  const store = createStore(dir), config = createConfig(store, { MENTOR_API_URL: provider.url, MENTOR_API_KEY: 'test-only-secret', MENTOR_MODEL: 'test-agent' })
  app = createApplication({ store, config }); server = http.createServer(app.handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await app?.cancelAll(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await provider?.close(); if (dir) await fs.rm(dir, { recursive: true, force: true }) })

test('普通对话直接交付跨学院前30名，有序编号，不调用目标工具或二次语义审核',async()=>{
  const start=provider.requests.length,chat=await makeChat(),response=await message(chat.id,'把多个学院的老师放一起，来个你认为最好的导师的排名。只前30个最好的导师就够了。')
  assert.ok(response.text.includes('event: done'),response.text.match(/event: error\ndata: (.+)/)?.[1])
  const saved=(await call(`/api/chats/${chat.id}`)).body,a=saved.messages.at(-1),table=a.artifacts[0]
  assert.equal(table.rows.length,30);assert.deepEqual(table.rows.map(row=>row.推荐序),Array.from({length:30},(_,i)=>i+1))
  assert.ok(new Set(table.rows.map(row=>row.college)).size>1)
  assert.equal(saved.goal,undefined);assert.ok(provider.requests.slice(start).length<=6)
  assert.ok(provider.requests.slice(start).every(request=>!request.messages[0].content.startsWith('你是数据答复的交付核对员')))
  assert.ok(a.tools.every(tool=>!['get_goal','complete_goal','pause_goal'].includes(tool.name)))
})
test('本机接口拒绝跨站写入与非本机Host，同源与本机Agent调用正常',async()=>{
  const before=app.store.list().length
  const cross=await fetch(base+'/api/chats',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'text/plain'},body:'{}'})
  assert.equal(cross.status,403);assert.equal(app.store.list().length,before)
  const host=new URL(base).host
  const same=await fetch(base+'/api/chats',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})
  assert.equal(same.status,201)
  const rebound=await new Promise((resolve,reject)=>{const request=http.get(base+'/api/chats',{headers:{Host:'rebound.example'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode))});request.on('error',reject)})
  assert.equal(rebound,403)
  assert.equal((await fetch(base+'/api/health',{headers:{Host:host}})).status,200)
})
test('重复查询使用同一结果引用并收敛交付，不继续重查或抛工具预算给用户',async()=>{
  const start=provider.requests.length,chat=await makeChat(),response=await message(chat.id,'重复查询收敛验收：介绍付俊松月劳务')
  assert.ok(response.text.includes('event: done'))
  const privateChat=app.store.get(chat.id),a=privateChat.messages.at(-1)
  assert.equal(Object.keys(privateChat.tables).length,1)
  assert.ok(a.tools.filter(tool=>tool.reused).length>=2)
  assert.ok(provider.requests.slice(start).length<=5)
  assert.ok(provider.requests.slice(start).some(request=>request.tool_choice==='none'&&request.tools.length))
  assert.doesNotMatch(response.text,/16轮|工具调用上限|\/goal/)
})
test('重新生成失败保留已完成答复，重试成功后才替换，用量和问题均保留',async()=>{
  const chat=await makeChat(),question='重新生成保留验收：分析导师培养情况'
  await message(chat.id,question)
  const saved=app.store.get(chat.id),original=structuredClone(saved.messages.at(-1)),usage=saved.usage.requests
  assert.equal(original.status,'complete');assert.ok(original.artifacts.length)
  assert.equal((await call(`/api/chats/${chat.id}/retry`,'POST',{})).status,202)
  await fetch(`${base}/api/chats/${chat.id}/events`).then(response=>response.text())
  assert.equal(saved.messages.at(-1).status,'error')
  assert.deepEqual(saved.messages.find(message=>message.id===original.id),original)
  assert.ok(saved.usage.requests>usage)
  assert.equal((await call(`/api/chats/${chat.id}/retry`,'POST',{})).status,202)
  await fetch(`${base}/api/chats/${chat.id}/events`).then(response=>response.text())
  assert.equal(saved.messages.at(-1).status,'complete')
  assert.equal(saved.messages.filter(message=>message.role==='assistant').length,1)
  assert.equal(saved.messages.filter(message=>message.role==='user').length,1)
  assert.ok(saved.usage.requests>usage+2)
})
test('重建可见对话上下文保留图表中的人名与数值，不带底层字段',()=>{
  const history=visibleHistory([{role:'user',content:'只看计算机学院'},{role:'assistant',content:'名单见表',artifacts:[{type:'table',title:'前三名',columns:[{key:'mentor_id',label:'导师ID'},{key:'name',label:'导师'},{key:'rating',label:'评分'}],rows:[{mentor_id:'private',name:'左兴权',rating:5}],sources:[]}]},{role:'user',content:'再讲讲第一位'}])
  assert.match(JSON.stringify(history),/计算机学院|左兴权|rating/)
  assert.doesNotMatch(JSON.stringify(history),/mentor_id|private/)
  assert.equal(history.at(-1).content,'再讲讲第一位')
})
test('准备阶段已有真实候选时，两次查询错误不会跳过制表直接退出',async()=>{
  for(const timing of ['正常','早期']){
    const chat=await makeChat(),response=await message(chat.id,`阶段切换验收${timing}：推荐6位导师，分成两类，每类3位，分别排名`)
    assert.match(response.text,/event: done/)
    const answer=app.store.get(chat.id).messages.at(-1)
    assert.equal(answer.status,'complete')
    assert.deepEqual(answer.artifacts.map(table=>table.rows.length),[3,3])
    assert.equal(answer.tools.filter(tool=>tool.status==='error').length,2)
  }
})
test('重新生成在内部上下文已整合时仍保留早先用户条件和图表中的指代',async()=>{
  const chat=await makeChat(),saved=app.store.get(chat.id),start=provider.requests.length
  saved.dataRevision=app.dataRevision
  saved.messages=[{id:'prior-user',role:'user',content:'只考虑计算机学院，我初试350分'},{id:'prior-answer',role:'assistant',status:'complete',content:'前两位见表',artifacts:[{type:'table',id:'prior-table',title:'历史推荐',columns:[{key:'name',label:'导师'},{key:'college',label:'学院'}],rows:[{name:'左兴权',college:'计算机学院'},{name:'戴志涛',college:'计算机学院'}],sources:[]}]},{id:'latest-user',role:'user',content:'再介绍几位相似导师的培养方式，用正文解读'},{id:'latest-answer',role:'assistant',status:'complete',content:'旧的第二轮答复'}]
  saved.modelMessages=[{role:'user',content:JSON.stringify({question:'再介绍几位相似导师的培养方式，用正文解读',facts:[]})}];app.store.save(saved)
  assert.equal((await call(`/api/chats/${chat.id}/retry`,'POST',{})).status,202)
  await fetch(`${base}/api/chats/${chat.id}/events`).then(response=>response.text())
  const input=JSON.stringify(provider.requests[start].messages)
  assert.match(input,/只考虑计算机学院|350/);assert.match(input,/左兴权/);assert.match(input,/戴志涛/)
  assert.equal(saved.messages.at(-1).status,'complete')
  assert.ok(saved.messages.some(message=>message.id==='prior-answer'))
})
test('原始分类排名问题不能以无名单完成，实际交付合计30位而非每类30',async()=>{
  const chat=await makeChat(),response=await message(chat.id,'给我推荐一些最好的导师，全专业一起排名，排出你认为的最好的30个。而且最好分为两类，一类就业，一类读博。')
  assert.match(response.text,/event: done/)
  const answer=app.store.get(chat.id).messages.at(-1)
  assert.equal(answer.status,'complete');assert.equal(answer.artifacts.length,2)
  assert.deepEqual(answer.artifacts.map(table=>table.rows.length),[15,15])
  assert.equal(new Set(answer.artifacts.flatMap(table=>table.rows.map(row=>`${row.college}:${row.name}`))).size,30)
  assert.equal(answer.reviews[0].ok,false);assert.equal(answer.reviews.at(-1).ok,true)
  for(const table of answer.artifacts){const column=table.columns.find(column=>column.role==='ordinal');assert.ok(column);assert.deepEqual(table.rows.map(row=>row[column.key]),Array.from({length:15},(_,index)=>index+1))}
  assert.ok(!answer.tools.some(tool=>tool.status==='error'))
  assert.ok(response.text.indexOf('event: artifact')<response.text.indexOf('event: done'),'真实名单应在完成前发布')
  assert.equal(answer.content,'')
})
test('同时询问分工和比较表时，两部分都交付，正文资料不局限于表中人选',async()=>{
  const start=provider.requests.length,chat=await makeChat()
  const response=await message(chat.id,'分工与比较联合验收：苏森、李静林、王尚广、林荣恒，哪一支工程硕士外派10个月？把吴斌、苏森的实习和毕业条件列比较表。')
  assert.match(response.text,/event: done/)
  const answer=app.store.get(chat.id).messages.at(-1)
  assert.equal(answer.status,'complete');assert.match(answer.content,/苏森团队/)
  assert.deepEqual(answer.artifacts[0].rows.map(row=>row.name),['吴斌','苏森'])
  const delivery=provider.requests.slice(start).find(request=>request.messages[0].content.startsWith('你是北极星，现在向用户交付最终答复'))
  const input=JSON.parse(delivery.messages[1].content)
  assert.deepEqual(new Set(input.evidence.flatMap(packet=>packet.rows.map(row=>row.name))),new Set(['苏森','李静林','王尚广','林荣恒','吴斌']))
  assert.ok(input.evidence.some(packet=>packet.rows.some(row=>row.topic_evidence?.includes('中国移动研究院10个月'))))
  assert.ok(input.evidence.flatMap(packet=>packet.rows).filter(row=>row.name==='吴斌').every(row=>row.source_ids.includes('S137')))
})
test('沿用历史而未调用工具时，最终答复仍获得当前导师事实与逐行来源',async()=>{
  const start=provider.requests.length,chat=await makeChat()
  const response=await message(chat.id,'无工具续问验收：继续详细分析潘维民、鄂海红的培养安排')
  assert.match(response.text,/event: done/)
  const answer=app.store.get(chat.id).messages.at(-1)
  assert.equal(answer.status,'complete');assert.equal(answer.tools.length,0)
  const delivery=provider.requests.slice(start).find(request=>request.messages[0].content.startsWith('你是北极星，现在向用户交付最终答复'))
  const input=JSON.parse(delivery.messages[1].content),rows=input.evidence.flatMap(packet=>packet.rows)
  assert.deepEqual(new Set(rows.map(row=>row.name)),new Set(['潘维民','鄂海红']))
  assert.ok(rows.every(row=>row.review_text&&row.source_ids.includes('S137')))
  assert.ok(answer.sources.some(source=>source.id==='S137'))
})
test('供应商内部调用文本不能当作完成结果或出现在聊天正文',async()=>{
  const chat=await makeChat(),response=await message(chat.id,'协议文本验收：推荐导师')
  assert.match(response.text,/event: error/)
  const answer=(await call(`/api/chats/${chat.id}`)).body.messages.at(-1)
  assert.equal(answer.status,'error');assert.equal(answer.content,'');assert.doesNotMatch(response.text,/DSML|内部调用不应/)
})
test('真实名单已完整时可从供应商格式错误恢复，后续工具协议和用量保持完整',async()=>{
  const created=await makeChat(),response=await message(created.id,'协议恢复验收：对比3位导师，用表格展示')
  assert.match(response.text,/event: done/);assert.doesNotMatch(response.text,/DSML|不应作为/)
  const chat=app.store.get(created.id),answer=chat.messages.at(-1)
  assert.equal(answer.status,'complete');assert.equal(answer.artifacts[0].rows.length,3)
  assert.equal(answer.recoveries[0].kind,'provider_protocol')
  assert.ok(chat.modelMessages.some(message=>message.role==='tool'&&message.tool_call_id==='protocol-view'))
  assert.equal(answer.usage.requests,4,'对比表另有一次简短结论交付')
  await message(created.id,'继续介绍第一位的培养方式')
  assert.equal(chat.messages.at(-1).status,'complete')
})
test('普通请求可直接重试，用户问题不重复，旧命令按普通提问处理',async()=>{
  const chat=await makeChat(),text='一次失败重试验收：分析导师培养条件'
  assert.match((await message(chat.id,text)).text,/event: error/)
  const retry=await call(`/api/chats/${chat.id}/retry`,'POST',{})
  assert.equal(retry.status,202)
  const events=await fetch(`${base}/api/chats/${chat.id}/events`).then(r=>r.text())
  assert.ok(events.includes('event: done'))
  const saved=(await call(`/api/chats/${chat.id}`)).body
  assert.equal(saved.messages.filter(message=>message.role==='user').length,1)
  assert.equal(saved.messages.at(-1).status,'complete')
  assert.equal((await call(`/api/chats/${chat.id}/retry`,'POST',{})).status,202)
  assert.match(await fetch(`${base}/api/chats/${chat.id}/events`).then(r=>r.text()),/event: done/)
  assert.equal((await call(`/api/chats/${chat.id}`)).body.messages.filter(message=>message.role==='user').length,1)
  assert.equal((await call(`/api/chats/${chat.id}/goal/resume`,'POST',{})).status,410)
  const ordinary=await makeChat();await message(ordinary.id,'/goal 比较导师')
  const normal=(await call(`/api/chats/${ordinary.id}`)).body
  assert.equal(normal.goal,undefined);assert.equal(normal.messages[0].content,'比较导师')
})
test('重启后不自动执行旧目标，历史记录仍在且普通接口不再返回模式状态',async()=>{
  const localDir=await fs.mkdtemp(path.join(os.tmpdir(),'ordinary-chat-legacy-')),store=createStore(localDir),created=store.create(),legacy=store.get(created.id)
  legacy.goal={id:'archived-goal',status:'active',objective:'旧版目标'}
  legacy.messages=[{id:'u',role:'user',content:'/goal 旧版目标'},{id:'a',role:'assistant',content:'旧记录',status:'complete'}];store.save(legacy)
  const start=provider.requests.length,local=createApplication({store,config:createConfig(store,{MENTOR_API_URL:provider.url,MENTOR_API_KEY:'test-only',MENTOR_MODEL:'test-agent'})})
  try{
    await new Promise(resolve=>setTimeout(resolve,60))
    assert.equal(provider.requests.length,start);assert.equal(store.get(created.id).goal.id,'archived-goal')
    assert.equal(store.publicChat(legacy).goal,undefined);assert.equal(store.list()[0].goal,undefined)
  }finally{await local.cancelAll();await fs.rm(localDir,{recursive:true,force:true})}
})
test('URL 规范化兼容 /v1、完整接口及 DeepSeek Anthropic 地址', () => {
  assert.equal(normalizeBaseUrl('https://api.deepseek.com/anthropic'), 'https://api.deepseek.com')
  assert.equal(normalizeBaseUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1')
  assert.throws(() => normalizeBaseUrl('file:///tmp/key'), /HTTP/)
})
test('配置不返回密钥；无效 key 即使指定模型也不能保存', async () => {
  const config = await call('/api/config')
  assert.equal(config.body.configured, true); assert.ok(!JSON.stringify(config.body).includes('test-only-secret'))
  const invalid = await call('/api/config', 'PUT', { baseUrl: provider.url, apiKey: 'invalid', model: 'test-agent' })
  assert.equal(invalid.status, 400); assert.match(invalid.body.error, /无效/)
  const valid = await call('/api/config', 'PUT', { baseUrl: provider.url })
  assert.equal(valid.status, 200); assert.equal(valid.body.model, 'test-agent')
  assert.ok(!(await fs.readFile(path.join(dir, 'config.json'), 'utf8')).includes('test-only-secret'))
})
test('拒绝跨站请求，且不向客户端暴露模型内部历史及私有结果表', async () => {
  const denied = await fetch(base + '/api/chats', { method: 'POST', headers: { Origin: 'https://evil.example' } })
  assert.equal(denied.status, 403)
  const chat = await makeChat(); const body = (await call(`/api/chats/${chat.id}`)).body
  assert.equal(body.modelMessages, undefined); assert.equal(body.tables, undefined)
})
test('聊天与重连只返回可展示资料，旧原文位置保留在私有历史中', async () => {
  const created = await makeChat(), chat = app.store.get(created.id)
  chat.messages = [{ id: 'legacy-private', role: 'assistant', status: 'complete', content: '原文：导师评价.md:L90 [S1]', tools: [{ id: 'old-step', name: 'query', status: 'complete', args: { from: 'reviews', select: ['source_locator'] }, result: { ref: 't1' } }], sources: [{ id: 'S1', title: '导师评价', kind: '第三方评价', file: '导师评价.md' }], artifacts: [{ id: 'legacy-table', type: 'table', title: '评价原文', columns: [{ key: 'name', label: '导师' }, { key: 'source_locator', label: '原文位置' }], rows: [{ name: '尚煜茗', source_locator: '导师评价.md:L90' }], sources: [] }] }]
  app.store.save(chat)
  const saved = await call(`/api/chats/${chat.id}`)
  assert.equal(saved.body.messages[0].artifacts[0].rows[0].name, '尚煜茗')
  assert.doesNotMatch(JSON.stringify(saved.body), /source_locator|原文位置|\.md|:L90|"args"|"result"|"name":"query"/)
  const events = await fetch(`${base}/api/chats/${chat.id}/events`).then(r => r.text())
  assert.doesNotMatch(events, /source_locator|原文位置|\.md|:L90|"args"|"result"/)
  const meta = await call('/api/data')
  assert.ok(meta.body.sources.every(s => !('file' in s)))
  assert.match(chat.messages[0].content, /导师评价\.md:L90/)
  assert.equal(chat.messages[0].tools[0].args.from, 'reviews')
})
test('HTTP 工具链、流式调用、核对计量和跨轮续聊', async () => {
  const requestStart=provider.requests.length
  const chat = await makeChat(), response = await message(chat.id, '可视化导师评分并用正文解读')
  assert.equal(response.status, 200)
  for (const event of ['start', 'tool_start', 'tool_end', 'artifact', 'delta', 'usage', 'done']) assert.ok(response.text.includes(`event: ${event}`), event)
  const saved = (await call(`/api/chats/${chat.id}`)).body
  const answer = saved.messages.at(-1)
  assert.equal(answer.status, 'complete'); assert.equal(answer.tools.length, 3); assert.equal(answer.artifacts.length, 1)
  assert.equal(answer.usage.requests, 5); assert.equal(answer.usage.totalTokens, 600); assert.equal(answer.usage.cachedTokens, 150)
  assert.ok(!JSON.stringify(saved).includes('test-only-secret'))
  const follow = await message(chat.id, '接着分析一下')
  assert.ok(follow.text.includes('event: done'))
  assert.equal((await call(`/api/chats/${chat.id}`)).body.usage.totalTokens, (provider.requests.length-requestStart)*120)
  const persisted = createStore(dir).get(chat.id)
  assert.equal(persisted.messages.length, 4); assert.ok(Object.keys(persisted.tables).length >= 2)
  const query = await call('/api/tools/query', 'POST', { from: 'exams', select: ['score_first'], limit: 5 })
  const aggregate = await call('/api/tools/aggregate', 'POST', { from: query.body.ref, metrics: [{ op: 'count', as: 'n' }] })
  assert.equal(aggregate.body.rows[0].n, 5)
})
test('进度由真实阶段驱动并持久保存，每步包含起止时间且不泄漏底层参数',async()=>{
  const chat=await makeChat(),response=await message(chat.id,'查询阶段进度并分析导师')
  const blocks=response.text.split('\n\n').map(block=>({event:block.match(/^event: (.+)$/m)?.[1],data:block.match(/^data: (.+)$/m)?.[1]})).filter(block=>block.data).map(block=>({...block,data:JSON.parse(block.data)}))
  const progress=blocks.filter(block=>block.event==='progress'&&block.data.activity)
  assert.ok(progress.length>=5)
  assert.ok(blocks.findIndex(block=>block.event==='progress')<blocks.findIndex(block=>block.event==='tool_start'))
  for(const block of progress)assert.ok(block.data.activity.filter(step=>step.status==='running').length<=1)
  const answer=(await call(`/api/chats/${chat.id}`)).body.messages.at(-1)
  assert.ok(answer.activity.some(step=>step.kind==='delivery'))
  assert.ok(answer.activity.some(step=>step.label==='绘制柱状图'))
  assert.ok(answer.activity.every(step=>step.status==='complete'&&Date.parse(step.finishedAt)>=Date.parse(step.startedAt)))
  assert.doesNotMatch(JSON.stringify(answer.activity),/tool_calls|source_locator|PRIVATE_REASONING_TEST|"args"|"parameters"/)
})
test('跨来源候选再筛选或排序后，长资料预览仍保留全部候选及完整结果引用',async()=>{
  const start=provider.requests.length,chat=await makeChat(),response=await message(chat.id,'候选预览验收：读博做AI security')
  assert.ok(response.text.includes('event: done'),response.text.match(/event: error\ndata: (.+)/)?.[1]?.slice(0,150))
  const messages=provider.requests.slice(start).filter(request=>!request.messages[0].content.startsWith('你是数据答复的交付核对员')).flatMap(request=>request.messages.filter(message=>message.role==='tool'))
  let transcript=''
  for(const request of provider.requests.slice(start).filter(request=>request.messages[0].content.startsWith('你在压缩 Agent 的历史记录'))){
    transcript+=JSON.parse(request.messages[1].content).history_chunk
    try{messages.push(...JSON.parse(transcript).filter(message=>message.role==='tool'));transcript=''}catch{}
  }
  const previews=[...new Map(messages.map(message=>[message.tool_call_id,JSON.parse(message.content)])).values()].filter(result=>Array.isArray(result.rows))
  assert.equal(previews.length,2)
  for(const result of previews){assert.equal(result.rows.length,result.returned);assert.ok(result.rows.some(row=>row.name==='南国顺'))}
  assert.match(previews[0].rows.find(row=>row.name==='南国顺').topic_evidence,/大模型及其安全/)
  const table=app.store.get(chat.id).tables[previews[1].ref]
  assert.ok(table.rows.find(row=>row.name==='南国顺').topic_evidence.length>100)
})
test('防御性答复自动改写，流式交付、保存和重连不泄漏套话',async()=>{
  const chat=await makeChat(),response=await message(chat.id,'信任规则集成：介绍付俊松的培养方式和待遇')
  const saved=(await call(`/api/chats/${chat.id}`)).body,answer=saved.messages.at(-1)
  assert.equal(answer.status,'complete')
  assert.deepEqual(app.store.get(chat.id).messages.at(-1).reviews.map(review=>review.ok),[true])
  assert.equal(saved.messages.filter(message=>message.role==='user').length,1)
  assert.match(answer.content,/本人直接指导/);assert.match(answer.content,/2000/)
  assert.doesNotMatch(response.text,/未经独立核实|建议向在读学生核实/)
  assert.doesNotMatch(JSON.stringify(saved),/未经独立核实|建议向在读学生核实|内部答复核对反馈/)
  const events=await fetch(`${base}/api/chats/${chat.id}/events`).then(response=>response.text())
  assert.doesNotMatch(events,/未经独立核实|建议向在读学生核实/)
})
test('单导师名册人数写反直接拦截；正确人数、名额描述及限定专业交给正常核对',async()=>{
  const data=loadData(),args={from:'mentors',filters:[{field:'name',op:'eq',value:'付俊松'}]},result=createToolRuntime(data).execute('query',args)
  const assistant={tools:[{name:'query',status:'complete',args,result}],sources:result.sources,artifacts:[]},config={baseUrl:'https://example.org',reasoningEffort:'off',contextWindow:32768}
  let calls=0
  const check=answer=>reviewAnswer({chat:{messages:[{role:'user',content:'付俊松名册考研和保研各有几人？'}]},assistant,answer,data,config,request:async()=>{calls++;return {content:'{"ok":true,"issues":[],"selection":null}'}}})
  const wrong=await check('2026年名册中付俊松共有4名学生，考研3人，保研1人。')
  assert.equal(wrong.ok,false);assert.equal(calls,0)
  assert.ok(wrong.issues.some(issue=>issue.includes('考研为1人')))
  assert.equal((await check('2026年名册中付俊松共4人，其中考研1人，保研3人。')).ok,true)
  assert.equal((await check('通常统考名额很少，可能没有或只有1个左右。')).ok,true)
  assert.equal((await check('085412专业样本中付俊松考研0人、保研1人。')).ok,true)
  assert.equal((await check('付俊松的保研占比为75%，初试参考350分。')).ok,true)
  assert.equal(calls,0)
})
test('核对反馈形成新控制轮次并实际修表，过程和未通过图表不对用户展示',async()=>{
  const chat=await makeChat(),response=await message(chat.id,'自动纠正核对：仅比较三位导师')
  const saved=(await call(`/api/chats/${chat.id}`)).body,privateChat=app.store.get(chat.id),answer=saved.messages.at(-1)
  assert.equal(answer.status,'complete');assert.equal(answer.artifacts[0].rows.length,3)
  assert.deepEqual(privateChat.messages.at(-1).reviews.map(review=>review.ok),[false,true])
  assert.equal(saved.messages.filter(message=>message.role==='user').length,1)
  assert.doesNotMatch(JSON.stringify(saved),/内部答复核对反馈|上一份答复尚未交付/)
  const delivered=response.text.split('event: artifact').slice(1).join('')
  assert.doesNotMatch(delivered,/李丽香|徐洁/)
})
test('工具前导和未通过核对的草稿不发布，交付正文之后不再清空',async()=>{
  const chat=await makeChat(),response=await message(chat.id,'连续展示验收：自动纠正核对，仅比较三位导师，用正文解读')
  const events=response.text.split('\n\n').flatMap(block=>{
    const event=block.match(/^event: (.+)$/m)?.[1],data=block.match(/^data: (.+)$/m)?.[1]
    return event&&data?[{event,data:JSON.parse(data)}]:[]
  })
  const delivered=events.filter(item=>item.event==='delta')
  assert.ok(delivered.length>=2)
  assert.ok(delivered.every((item,index)=>index===0||item.data.content.startsWith(delivered[index-1].data.content)))
  assert.match(delivered[0].data.content,/推荐付俊松、郭燕慧、杨文川三位/)
  assert.doesNotMatch(response.text,/不应发布的工具前导/)
  const published=events.findIndex(item=>item.event==='delta')
  assert.ok(events.slice(published+1).every(item=>item.event!=='progress'||item.data.content===undefined||item.data.content.startsWith(delivered[0].data.content)))
  assert.deepEqual(app.store.get(chat.id).messages.at(-1).reviews.map(review=>review.ok),[false,true])
})
test('停止生成后保留部分回答、记录未计量请求，并能继续同一对话', async () => {
  const chat = await makeChat()
  const response = await fetch(`${base}/api/chats/${chat.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '模拟慢速' }) })
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let text = ''
  while (!text.includes('event: delta')) text += decoder.decode((await reader.read()).value)
  const duplicate = await call(`/api/chats/${chat.id}/messages`, 'POST', { text: '并发问题' })
  assert.equal(duplicate.status, 409)
  await call(`/api/chats/${chat.id}/cancel`, 'POST', {})
  while (true) { const next = await reader.read(); if (next.done) break; text += decoder.decode(next.value) }
  const saved = (await call(`/api/chats/${chat.id}`)).body
  assert.equal(saved.messages.at(-1).status, 'canceled'); assert.match(saved.messages.at(-1).content, /后台分析/)
  assert.equal(saved.messages.at(-1).usage.unreportedRequests, 1)
  assert.ok((await message(chat.id, '现在正常提问')).text.includes('event: done'))
})
test('模型尚未结束时即可读到正文，多次流式增量与最终保存一致',async()=>{
  const chat=await makeChat(),response=await fetch(`${base}/api/chats/${chat.id}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'真实流式验收：分析导师培养条件'})})
  const reader=response.body.getReader(),decoder=new TextDecoder()
  let raw=''
  while(!raw.includes('event: delta')){const next=await reader.read();assert.equal(next.done,false);raw+=decoder.decode(next.value)}
  assert.doesNotMatch(raw,/event: done/)
  const running=(await call(`/api/chats/${chat.id}`)).body
  assert.equal(running.running,true);assert.ok(running.messages.at(-1).content.length>0)
  assert.ok(app.store.get(chat.id).messages.at(-1).reviews.at(-1).ok)
  while(true){const next=await reader.read();if(next.done)break;raw+=decoder.decode(next.value)}
  const deltas=raw.split('\n\n').filter(block=>block.startsWith('event: delta')).map(block=>JSON.parse(block.match(/^data: (.+)$/m)[1]))
  assert.ok(deltas.length>=2)
  assert.ok(deltas.every((delta,index)=>index===0||delta.content.startsWith(deltas[index-1].content)))
  assert.equal(deltas.map(delta=>delta.text).join(''),(await call(`/api/chats/${chat.id}`)).body.messages.at(-1).content)
})
test('服务商错误与半途断流不会伪装完成，可删除对话且总用量不丢失', async () => {
  const chat = await makeChat()
  const failure = await message(chat.id, '模拟401')
  assert.match(failure.text, /event: error/); assert.doesNotMatch(failure.text, /event: done/)
  const interrupted = await message(chat.id, '模拟断流')
  assert.match(interrupted.text, /意外中断/)
  const saved = (await call(`/api/chats/${chat.id}`)).body
  assert.equal(saved.messages.at(-1).status, 'error'); assert.match(saved.messages.at(-1).content, /部分回答/)
  const before = (await call('/api/usage')).body
  assert.ok(before.unreportedRequests >= 3)
  assert.equal((await call(`/api/chats/${chat.id}`, 'DELETE')).status, 200)
  assert.equal((await call('/api/usage')).body.requests, before.requests)
  assert.equal((await call(`/api/chats/${chat.id}`)).status, 404)
})

test('模型列表带容量信息，可切换并持久保存，已保存 Key 不向客户端暴露', async () => {
  const models = await call('/api/models')
  assert.equal(models.body.models.find(m => m.id === 'test-small').contextWindow, 16384)
  const selected = await call('/api/config/model', 'PUT', { model: 'test-alt' })
  assert.equal(selected.body.model, 'test-alt'); assert.equal(selected.body.contextWindow, 65536)
  assert.ok(!JSON.stringify(selected.body).includes('test-only-secret'))
  const chat = await makeChat(); await message(chat.id, '切换模型后比较导师')
  assert.equal(provider.requests.at(-1).model, 'test-alt')
  assert.equal(createConfig(createStore(dir), {}).publicConfig().model, 'test-alt')
  assert.equal((await call('/api/config/model', 'PUT', { model: 'not-listed' })).status, 400)
  await call('/api/config/model', 'PUT', { model: 'test-agent' })
})

async function until(check, timeout = 7000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)) }
  throw new Error('等待目标状态超时')
}

function seedHistory(chat) {
  chat.dataRevision = app.dataRevision
  const runtime = createToolRuntime(loadData())
  const result = runtime.execute('aggregate', { from: 'exams', metrics: [{ op: 'median', field: 'score_first', as: '中位分' }] })
  chat.tables = runtime.tables
  chat.modelMessages = [
    { role: 'user', content: '请记住已核对的结果' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'old-call', type: 'function', function: { name: 'aggregate', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'old-call', content: JSON.stringify(result) },
    { role: 'assistant', content: '已确认初试中位分349，来源S2。'.repeat(450) },
  ]
}

test('资料更新清除旧目录、摘要和结果引用；可见历史、原始目标与用户约束不变', () => {
  const messages = [{ role: 'user', content: '想了解付俊松，只考虑可实习的导师' }, { role: 'assistant', content: '付老师的学生缺少成绩，旧口径认为无法判断保研。' }]
  const chat = { messages: structuredClone(messages), modelMessages: [{ role: 'tool', tool_call_id: 'old-catalog', content: '过期目录' }], tables: { t1: { rows: [], columns: [] } }, context: { summary: '旧摘要：不能认定保研', compactions: 2 }, latestUserText: '只考虑可实习的导师', goal: { id: 'original-goal', objective: '比较导师', updates: ['不强制打卡'], status: 'active', pendingSummary: '基于过期数据的完成申请' } }
  assert.equal(refreshDataContext(chat, 'new-revision'), true)
  assert.deepEqual(chat.messages, messages)
  assert.deepEqual(chat.tables, {})
  assert.equal(chat.context.summary, undefined); assert.equal(chat.context.compactions, 2)
  assert.ok(chat.modelMessages.every(m => ['user', 'assistant'].includes(m.role) && !m.tool_calls))
  assert.match(chat.modelMessages.at(-1).content, /仅用于理解对话指代/)
  assert.equal(chat.latestUserText, '只考虑可实习的导师')
  assert.equal(chat.goal.id, 'original-goal'); assert.deepEqual(chat.goal.updates, ['不强制打卡']); assert.equal(chat.goal.pendingSummary,'基于过期数据的完成申请')
  const current = structuredClone(chat)
  assert.equal(refreshDataContext(chat, 'new-revision'), false)
  assert.deepEqual(chat, current)
})

test('旧对话续问时不再发送旧版目录，改用当前数据返回付俊松考研1人与保研3人', async () => {
  const created = await makeChat(), chat = app.store.get(created.id)
  chat.messages = [{ id: 'legacy-user', role: 'user', content: '付俊松老师的学生情况' }, { id: 'legacy-answer', role: 'assistant', status: 'complete', content: '付老师共4人，其中3人缺少初试成绩，旧答复未算作保研。' }]
  const visible = structuredClone(chat.messages)
  chat.modelMessages = [
    { role: 'user', content: '付俊松老师的学生情况' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'stale-catalog', type: 'function', function: { name: 'catalog', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'stale-catalog', content: JSON.stringify({ metadata: { version: 1, notes: ['没有成绩不等于保研。'] } }) },
    { role: 'assistant', content: visible[1].content },
  ]
  chat.context = { summary: '旧分类结论：不能认定缺失成绩的学生为保研。' }
  chat.tables = { t99: { rows: [{ old: true }], columns: [{ key: 'old' }] } }
  app.store.save(chat)
  const start = provider.requests.length
  const response = await message(chat.id, '旧目录续问：付老师保研和考研各多少人？')
  assert.match(response.text, /event: done/)
  const answer = chat.messages.at(-1)
  assert.ok(answer.content.length>0)
  assert.equal(answer.artifacts[0].rows[0].exam_count, 1)
  assert.equal(answer.artifacts[0].rows[0].recommended_count, 3)
  assert.deepEqual(chat.messages.slice(0, 2), visible)
  assert.equal(chat.tables.t99, undefined); assert.equal(chat.dataRevision, app.dataRevision)
  const requests = provider.requests.slice(start)
  assert.ok(requests[0].messages[0].content.includes('会话执行版本已更新'))
  assert.ok(requests.every(r => !r.messages.some(m => m.role === 'tool' && m.tool_call_id === 'stale-catalog')))
  assert.ok(!JSON.stringify(requests).includes('没有成绩不等于保研'))
  assert.ok(requests.some(r => r.messages.some(m => m.role === 'tool' && m.content.includes('recommended_count'))))
  const count = chat.messages.length
  await message(chat.id, '旧目录续问：再确认一次付老师的考研保研人数')
  assert.equal(chat.messages.length, count + 2)
  assert.ok(!provider.requests.at(-1).messages[0].content.includes('会话执行版本已更新'))
})

test('上下文超限自动摘要重试，保留真实引用和最新约束，并计入压缩用量', { timeout: 10000 }, async () => {
  const chat = await makeChat(), privateChat = app.store.get(chat.id)
  seedHistory(privateChat); app.store.save(privateChat)
  const response = await message(chat.id, '模拟上下文超限：我只考虑有实习的网安导师，不要保证录取。')
  const failure=response.text.match(/event: error\ndata: (.+)/)?.[1]
  assert.ok(response.text.includes('event: done'),failure?JSON.parse(failure).error:'流式答复应完成')
  assert.ok(privateChat.context.compactions >= 1)
  assert.match(privateChat.context.summary, /349/)
  assert.equal(privateChat.tables.t1.rows[0]['中位分'], 349)
  const compactRequests = app.store.usage().recent.filter(r => r.chatId === chat.id && r.purpose === 'compaction')
  assert.ok(compactRequests.length > 0)
  assert.equal(privateChat.messages.at(-1).usage.requests, app.store.usage().recent.filter(r => r.chatId === chat.id).length)
  const last = provider.requests.findLast(request=>request.tools?.length)
  assert.ok(last.messages.some(m => m.role === 'user' && m.content.includes('不要保证录取')))
  for (let i = 0; i < last.messages.length; i++) if (last.messages[i].role === 'tool') {
    assert.ok(last.messages.slice(0, i).some(m => m.tool_calls?.some(c => c.id === last.messages[i].tool_call_id)))
  }
})

test('按模型容量提前压缩，保持最新真实问题和已有结果引用', { timeout: 10000 }, async () => {
  const chat = await makeChat(), privateChat = app.store.get(chat.id)
  seedHistory(privateChat); privateChat.modelMessages.at(-1).content = privateChat.modelMessages.at(-1).content.repeat(6)
  app.store.save(privateChat)
  const objective = '核对初试中位分并展示图表，只使用网安历史资料，不保证录取'
  await message(chat.id, objective)
  assert.equal(privateChat.messages.at(-1).status,'complete');assert.equal(privateChat.goal,undefined)
  assert.ok(privateChat.context.compactions >= 1)
  assert.equal(privateChat.tables.t1.rows[0]['中位分'], 349)
})

test('执行参数验证、持久化及推理强度真实转发，推理内容不进入公开消息', { timeout: 10000 }, async () => {
  await call('/api/models')
  const updated = await call('/api/config/execution', 'PUT', { reasoningEffort: 'high', compressionThresholdTokens: 24000 })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.reasoningEffort, 'high')
  assert.equal(updated.body.compressionTriggerTokens, 24000)
  assert.equal(createConfig(createStore(dir), { MENTOR_API_KEY: 'test-only-secret' }).publicConfig().compressionThresholdTokens, 24000)
  const chat = await makeChat(); await message(chat.id, '推理设置验证：比较导师')
  const request = provider.requests.findLast(request=>request.tools?.length)
  assert.equal(request.reasoning_effort, 'high')
  assert.ok(request.messages.some(m => m.role === 'assistant' && m.reasoning_content === 'PRIVATE_REASONING_TEST'))
  const publicChat = (await call(`/api/chats/${chat.id}`)).body
  assert.doesNotMatch(JSON.stringify(publicChat), /PRIVATE_REASONING_TEST/)
  assert.equal((await call('/api/config/execution', 'PUT', { reasoningEffort: 'invented-level' })).status, 400)
  assert.equal((await call('/api/config/execution', 'PUT', { compressionThresholdTokens: 12 })).status, 400)
  assert.equal((await call('/api/config/execution', 'PUT', { compressionThresholdTokens: 9999999 })).status, 400)
  await call('/api/config/execution', 'PUT', { reasoningEffort: 'off', compressionThresholdTokens: null })
})

test('自定义阈值控制实际压缩时机，自动模式可以恢复', { timeout: 10000 }, async () => {
  await call('/api/config/model', 'PUT', { model: 'test-agent' })
  await call('/api/config/execution', 'PUT', { reasoningEffort: 'off', compressionThresholdTokens: 9000 })
  const low = await makeChat(), lowChat = app.store.get(low.id)
  seedHistory(lowChat); lowChat.modelMessages.at(-1).reasoning_content = 'PRIVATE_REASONING_TEST'; app.store.save(lowChat)
  await message(low.id, '按较低阈值完成初试统计')
  assert.equal(lowChat.messages.at(-1).status,'complete',lowChat.messages.at(-1).error); assert.ok(lowChat.context.compactions > 0)
  const summaries = provider.requests.filter(r => r.messages[0].content.startsWith('你在压缩 Agent 的历史记录'))
  assert.ok(summaries.every(r => !JSON.stringify(r.messages).includes('PRIVATE_REASONING_TEST')))
  await call('/api/config/execution', 'PUT', { compressionThresholdTokens: 27000 })
  const high = await makeChat(), highChat = app.store.get(high.id)
  seedHistory(highChat); app.store.save(highChat)
  await message(high.id, '按较高阈值完成初试统计')
  assert.equal(highChat.messages.at(-1).status,'complete')
  assert.ok(lowChat.context.compactions>(highChat.context?.compactions||0))
  const restored = await call('/api/config/execution', 'PUT', { compressionThresholdTokens: null })
  assert.equal(restored.body.compressionThresholdTokens, null)
  assert.equal(restored.body.compressionTriggerTokens, Math.floor(32768 * .8))
})

test('大容量模型使用较低阈值时，一次压缩就移除超长旧历史', async () => {
  const chat = { messages: [{ role: 'user', content: '只比较可实习的导师' }], latestUserText: '只比较可实习的导师', modelMessages: [{ role: 'user', content: '旧问题' }, { role: 'assistant', content: '已确认数据，不保证录取。'.repeat(4000) }, { role: 'user', content: '只比较可实习的导师' }], tables: {} }
  const config = { contextWindow: 1048576, maxOutputTokens: 4096, compressionThresholdTokens: 16384 }
  assert.ok(estimateTokens(contextMessages(chat, '研究助理')) > 16384)
  assert.equal(await compactContext({ chat, system: '研究助理', tools: [], config, request: async () => ({ content: '此前已确认资料范围，只比较可实习的导师。' }) }), true)
  assert.ok(estimateTokens(contextMessages(chat, '研究助理')) < 16384)
  assert.equal(chat.modelMessages.at(-1).content, '只比较可实习的导师')
})
test('软压缩阈值不能吞掉尚未被模型读取的最新完整工具结果',async()=>{
  const question='继续读取刚才的结果',tool={role:'tool',tool_call_id:'latest-call',content:JSON.stringify({ref:'t1',rows:[{text:'最新结果'.repeat(4000)}]})}
  const chat={messages:[{role:'user',content:question}],latestUserText:question,modelMessages:[{role:'user',content:question},{role:'assistant',content:null,tool_calls:[{id:'latest-call',type:'function',function:{name:'query',arguments:'{}'}}]},tool],tables:{}}
  let summaries=0
  await compactContext({chat,system:'查询助手',tools:[],config:{contextWindow:1048576,compressionThresholdTokens:4096,maxOutputTokens:4096},request:async()=>{summaries++;return {content:'旧资料摘要'}}})
  assert.ok(chat.modelMessages.includes(tool));assert.equal(summaries,0)
})
test('摘要之外保留已读取候选的小表索引，压缩后不必重新猜名单',()=>{
  const chat={context:{summary:'历史已压缩'},modelMessages:[],tables:{t1:{columns:[{key:'name'},{key:'college'}],rows:[{name:'付俊松',college:'网络空间安全学院'},{name:'左兴权',college:'计算机学院'}]}}}
  const system=contextMessages(chat,'助手')[0].content
  assert.match(system,/付俊松/);assert.match(system,/左兴权/);assert.match(system,/t1/)
})
test('新整理的候选资料包在首次读取前不被软阈值压成摘要',async()=>{
  const packet={role:'user',content:JSON.stringify({question:'分两类推荐30位导师',facts:[{ref:'t1',rows:Array.from({length:70},(_,i)=>({name:`候选${i}`,review_text:'实际培养记录'.repeat(100)}))}]})}
  const chat={messages:[],latestUserText:'分两类推荐30位导师',modelMessages:[packet],tables:{}}
  let summaries=0
  const compacted=await compactContext({chat,system:'推荐助手',tools:[],config:{contextWindow:1048576,compressionThresholdTokens:16384,maxOutputTokens:4096},request:async()=>{summaries++;return {content:'候选摘要'}}})
  assert.ok(estimateTokens([packet])>16384)
  assert.equal(compacted,false);assert.equal(summaries,0);assert.equal(chat.modelMessages[0],packet)
})
test('原工具正文已被压缩时，相同缓存查询重新提供完整预览',async()=>{
  const created=await makeChat(),question='缓存回读验收：读取导师资料',chat=app.store.get(created.id)
  let inference=0
  provider.setRequestHook(body=>{
    if(body.messages[0].content.startsWith('你是北极星，现在向用户交付最终答复'))return
    if(body.messages.some(message=>message.role==='user'&&message.content===question)&&++inference===2){chat.modelMessages=[{role:'user',content:question}];chat.context={...chat.context,summary:'原查询结果已压缩，t1仍可使用。'}}
  })
  try{await message(created.id,question)}finally{provider.setRequestHook(null)}
  const answer=chat.messages.at(-1)
  assert.equal(answer.status,'complete');assert.match(answer.content,/完整结果已重新读取/)
  assert.equal(answer.tools[1].reused,true)
  assert.equal(answer.tools[0].result.ref,answer.tools[1].result.ref)
})

test('parseDsmlToolCalls 将 DeepSeek DSML 工具标签解析为可执行 tool_calls，无 invoke 时仍判无效响应',()=>{
  const parsed=parseDsmlToolCalls('<｜DSML｜function_calls><｜DSML｜invoke name="query"><｜DSML｜parameter name="from" string="true">mentors</｜DSML｜parameter><｜DSML｜parameter name="limit" string="false">30</｜DSML｜parameter><｜DSML｜parameter name="filters" string="false">[{"field":"rating","op":"gte","value":4}]</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>')
  assert.equal(parsed.length,1)
  assert.equal(parsed[0].function.name,'query')
  assert.deepEqual(JSON.parse(parsed[0].function.arguments),{from:'mentors',limit:30,filters:[{field:'rating',op:'gte',value:4}]})
  assert.deepEqual(parseDsmlToolCalls('<｜｜DSML｜｜ calls>内部调用不应作为结果。</｜｜DSML｜｜ calls>'),[])
})

test('GET /api/health 与 /api/vault/status 返回真实加密状态、模式、导师数与 data_revision', async () => {
  const health = await call('/api/health')
  assert.equal(health.status, 200)
  assert.equal(health.body.ok, true)
  assert.equal(health.body.name, '北极星')
  assert.equal(health.body.vault_locked, false)
  assert.equal(health.body.mentor_count, 414)
  assert.equal(health.body.data_revision, app.dataRevision)

  const status = await call('/api/vault/status')
  assert.equal(status.status, 200)
  assert.equal(status.body.locked, false)
  assert.equal(status.body.mode, 'builtin')
  assert.equal(status.body.datasets.length, VAULT_NAMES.length)
  assert.ok(status.body.datasets.every(item => item.sealed === true))
})

test('POST /api/vault/unlock 先校验密钥后更新状态，并完整重建 apiTools、workbench、insightCache 与 dataRevision', async () => {
  const tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-unlock-vault-'))
  const tempStoreDir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-unlock-store-'))
  const secret = 'polaris-custom-test-key-2026-valid'
  const sampleDataset = {
    metadata: {
      name: '北极星',
      version: 5,
      year: 2026,
      colleges: ['网络空间安全学院'],
      counts: { mentors: 2, students: 0, exams: 0, reviews: 1, web_profiles: 0 },
      notes: [],
    },
    mentors: [
      {
        mentor_id: 'mentor-test-1',
        name: '测试加密导师甲',
        college: '网络空间安全学院',
        group: '一组',
        directions: '系统安全',
        personal_directions: '漏洞挖掘',
        rating: 5,
        stipend_monthly_min: 2000,
        stipend_monthly_max: 2000,
        stipend_text: '每月2000元',
        review_text: '实习：支持暑期实习；管理：不打卡。',
        source_ids: ['S1'],
      },
      {
        mentor_id: 'mentor-test-2',
        name: '测试加密导师乙',
        college: '网络空间安全学院',
        group: '二组',
        directions: '密码学',
        personal_directions: null,
        rating: 4,
        stipend_monthly_min: 1000,
        stipend_monthly_max: 1000,
        stipend_text: '每月1000元',
        review_text: '毕业：按学院标准毕业。',
        source_ids: ['S1'],
      },
    ],
    students: [],
    exams: [],
    reviews: [
      {
        review_id: 'review-test-1',
        mentor_id: 'mentor-test-1',
        name: '测试加密导师甲',
        college: '网络空间安全学院',
        rating: 5,
        text: '实习：支持暑期实习；管理：不打卡。',
        source_ids: ['S1'],
      },
    ],
    profiles: [],
    sources: [{ id: 'S1', title: '测试评价源', kind: '第三方评价', year: 2026 }],
  }
  const datasetPath = path.join(tempVaultDir, 'dataset.vault')
  await fs.writeFile(datasetPath, sealVaultPayload('dataset', sampleDataset, secret))

  const loadFromTemp = ({ allowLockedFallback }) => {
    try {
      return loadData(datasetPath)
    } catch (error) {
      if (allowLockedFallback && ['ERR_VAULT_AUTH_FAILED', 'ERR_VAULT_LOCKED'].includes(error.code)) {
        const locked = lockedFallbackDataset()
        locked.mentor_notes = []
        locked.metadata.profile_colleges = locked.metadata.colleges
        locked.metadata.coverage = []
        return locked
      }
      throw error
    }
  }

  resetRuntimeVaultState()
  const localApp = createApplication({
    store: createStore(tempStoreDir),
    config: createConfig(createStore(tempStoreDir), {}),
    data: loadFromTemp({ allowLockedFallback: true }),
    reload: () => loadFromTemp({ allowLockedFallback: false }),
    vaultDir: tempVaultDir,
  })
  const localServer = http.createServer(localApp.handler)
  await new Promise(resolve => localServer.listen(0, '127.0.0.1', resolve))
  const localBase = `http://127.0.0.1:${localServer.address().port}`
  const localCall = async (url, method = 'GET', body) => {
    const response = await fetch(localBase + url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }

  try {
    const initialHealth = await localCall('/api/health')
    assert.equal(initialHealth.body.vault_locked, true)
    assert.equal(initialHealth.body.mentor_count, 0)
    const lockedRevision = initialHealth.body.data_revision
    assert.equal(lockedRevision, localApp.dataRevision)

    const initialStatus = await localCall('/api/vault/status')
    assert.equal(initialStatus.body.locked, true)
    assert.equal(initialStatus.body.mode, 'locked')
    assert.equal(initialStatus.body.datasets.find(d => d.name === 'dataset')?.sealed, true)

    assert.equal((await localCall('/api/workbench/directory')).body.total, 0)
    const lockedCatalog = await localCall('/api/tools/catalog', 'POST', {})
    assert.equal(lockedCatalog.status, 200)
    assert.equal(lockedCatalog.body.datasets.find(d => d.name === 'mentors')?.count, 0)
    const lockedQuery = await localCall('/api/tools/query', 'POST', { from: 'mentors' })
    assert.equal(lockedQuery.status, 400)
    assert.equal((await localCall('/api/insights')).body.count, 0)

    const shortAttempt = await localCall('/api/vault/unlock', 'POST', { key: 'too-short' })
    assert.equal(shortAttempt.status, 400)
    assert.equal(localApp.dataRevision, lockedRevision)

    const wrongAttempt = await localCall('/api/vault/unlock', 'POST', { key: 'wrong-vault-secret-12345678' })
    assert.equal(wrongAttempt.status, 403)
    assert.equal(wrongAttempt.body.code, 'ERR_VAULT_AUTH_FAILED')
    assert.equal(isVaultConfigured(), false, '校验失败后不得污染运行时密钥状态')
    assert.equal((await localCall('/api/health')).body.vault_locked, true)

    const unlocked = await localCall('/api/vault/unlock', 'POST', { key: secret })
    assert.equal(unlocked.status, 200)
    assert.equal(unlocked.body.ok, true)
    assert.equal(unlocked.body.unlocked, true)
    assert.equal(unlocked.body.locked, false)
    assert.equal(unlocked.body.mode, 'custom')
    assert.equal(unlocked.body.mentor_count, 2)
    assert.notEqual(unlocked.body.data_revision, lockedRevision)
    assert.equal(unlocked.body.data_revision, localApp.dataRevision)
    assert.equal(localApp.data.metadata.vault_locked, false)

    const afterHealth = await localCall('/api/health')
    assert.equal(afterHealth.body.vault_locked, false)
    assert.equal(afterHealth.body.mentor_count, 2)
    assert.equal(afterHealth.body.data_revision, localApp.dataRevision)

    const afterStatus = await localCall('/api/vault/status')
    assert.equal(afterStatus.body.locked, false)
    assert.equal(afterStatus.body.mode, 'custom')

    assert.equal((await localCall('/api/workbench/directory')).body.total, 2)
    const unlockedQuery = await localCall('/api/tools/query', 'POST', { from: 'mentors', select: ['name', 'college', 'rating'] })
    assert.equal(unlockedQuery.status, 200)
    assert.equal(unlockedQuery.body.rows.length, 2)
    const searchRes = await localCall('/api/tools/search', 'POST', { terms: ['漏洞挖掘'] })
    assert.equal(searchRes.body.rows.length, 1)
    assert.equal(searchRes.body.rows[0].name, '测试加密导师甲')
    assert.equal((await localCall('/api/insights')).body.count, 2)
  } finally {
    resetRuntimeVaultState()
    await localApp.cancelAll()
    await new Promise(resolve => localServer.close(resolve))
    await fs.rm(tempVaultDir, { recursive: true, force: true })
    await fs.rm(tempStoreDir, { recursive: true, force: true })
  }
})

test('POLARIS_FORCE_LOCK=1 启动锁定后可通过 { mode: builtin } 解锁完整内置库', async () => {
  const tempStoreDir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-force-unlock-'))
  const prevForce = process.env.POLARIS_FORCE_LOCK
  process.env.POLARIS_FORCE_LOCK = '1'
  resetRuntimeVaultState()

  const lockedApp = createApplication({
    store: createStore(tempStoreDir),
    config: createConfig(createStore(tempStoreDir), {}),
  })
  const lockedServer = http.createServer(lockedApp.handler)
  await new Promise(resolve => lockedServer.listen(0, '127.0.0.1', resolve))
  const localBase = `http://127.0.0.1:${lockedServer.address().port}`

  try {
    const h1 = await (await fetch(`${localBase}/api/health`)).json()
    assert.equal(h1.vault_locked, true)
    assert.equal(h1.mentor_count, 0)

    const unlockRes = await fetch(`${localBase}/api/vault/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'builtin' }),
    })
    assert.equal(unlockRes.status, 200)
    const unlockBody = await unlockRes.json()
    assert.equal(unlockBody.ok, true)
    assert.equal(unlockBody.mode, 'builtin')
    assert.equal(unlockBody.mentor_count, 414)
    assert.notEqual(unlockBody.data_revision, h1.data_revision)
  } finally {
    if (prevForce === undefined) delete process.env.POLARIS_FORCE_LOCK
    else process.env.POLARIS_FORCE_LOCK = prevForce
    resetRuntimeVaultState()
    await lockedApp.cancelAll()
    await new Promise(resolve => lockedServer.close(resolve))
    await fs.rm(tempStoreDir, { recursive: true, force: true })
  }
})

test('存在不匹配的 MENTOR_VAULT_KEY 时启动锁定，POST /api/vault/unlock { mode: builtin } 可正确解锁并同步全部端点', async () => {
  const tempStoreDir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-stale-key-unlock-'))
  const prevKey = process.env.MENTOR_VAULT_KEY
  process.env.MENTOR_VAULT_KEY = 'stale-wrong-env-key-1234567890'
  resetRuntimeVaultState()

  const lockedApp = createApplication({
    store: createStore(tempStoreDir),
    config: createConfig(createStore(tempStoreDir), {}),
  })
  const lockedServer = http.createServer(lockedApp.handler)
  await new Promise(resolve => lockedServer.listen(0, '127.0.0.1', resolve))
  const localBase = `http://127.0.0.1:${lockedServer.address().port}`
  const localCall = async (url, method = 'GET', body) => {
    const response = await fetch(localBase + url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }

  try {
    const h1 = await localCall('/api/health')
    assert.equal(h1.status, 200)
    assert.equal(h1.body.vault_locked, true)
    assert.equal(h1.body.mentor_count, 0)

    const s1 = await localCall('/api/vault/status')
    assert.equal(s1.status, 200)
    assert.equal(s1.body.locked, true)
    assert.equal(s1.body.mode, 'locked')

    const unlockRes = await localCall('/api/vault/unlock', 'POST', { mode: 'builtin' })
    assert.equal(unlockRes.status, 200)
    assert.equal(unlockRes.body.ok, true)
    assert.equal(unlockRes.body.unlocked, true)
    assert.equal(unlockRes.body.locked, false)
    assert.equal(unlockRes.body.mode, 'builtin')
    assert.equal(unlockRes.body.mentor_count, 414)
    assert.notEqual(unlockRes.body.data_revision, h1.body.data_revision)
    assert.equal(unlockRes.body.data_revision, lockedApp.dataRevision)

    const h2 = await localCall('/api/health')
    assert.equal(h2.status, 200)
    assert.equal(h2.body.vault_locked, false)
    assert.equal(h2.body.mentor_count, 414)
    assert.equal(h2.body.data_revision, lockedApp.dataRevision)

    const s2 = await localCall('/api/vault/status')
    assert.equal(s2.status, 200)
    assert.equal(s2.body.locked, false)
    assert.equal(s2.body.mode, 'builtin')

    const dirRes = await localCall('/api/workbench/directory')
    assert.equal(dirRes.status, 200)
    assert.equal(dirRes.body.total, 1309)

    const insightsRes = await localCall('/api/insights')
    assert.equal(insightsRes.status, 200)
    assert.equal(insightsRes.body.count, 1309)

    const queryRes = await localCall('/api/tools/query', 'POST', { from: 'mentors', limit: 3 })
    assert.equal(queryRes.status, 200)
    assert.equal(queryRes.body.total, 414)
    assert.equal(queryRes.body.rows.length, 3)
  } finally {
    if (prevKey === undefined) delete process.env.MENTOR_VAULT_KEY
    else process.env.MENTOR_VAULT_KEY = prevKey
    resetRuntimeVaultState()
    await lockedApp.cancelAll()
    await new Promise(resolve => lockedServer.close(resolve))
    await fs.rm(tempStoreDir, { recursive: true, force: true })
  }
})

test('POST /api/vault/unlock 在 reload 失败或仍处于锁定态时回滚运行时状态且绝不返回 200 unlocked', async () => {
  const tempVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-unlock-rollback-vault-'))
  const tempStoreDir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-unlock-rollback-store-'))
  const sampleDataset = {
    metadata: { name: '北极星', year: 2026, colleges: ['网络空间安全学院'], counts: { mentors: 1 }, notes: [] },
    mentors: [{ mentor_id: 'm1', name: '测试导师', college: '网络空间安全学院', source_ids: ['S1'] }],
    students: [],
    exams: [],
    reviews: [],
    profiles: [],
    sources: [{ id: 'S1', title: '测试源', kind: '第三方评价', year: 2026 }],
  }
  await fs.writeFile(path.join(tempVaultDir, 'dataset.vault'), sealVaultPayload('dataset', sampleDataset, { keyMode: 'builtin' }))

  resetRuntimeVaultState()
  const initialLocked = lockedFallbackDataset()
  initialLocked.mentor_notes = []
  initialLocked.metadata.profile_colleges = initialLocked.metadata.colleges
  initialLocked.metadata.coverage = []

  let modeUnderTest = 'throw'
  const rollbackApp = createApplication({
    store: createStore(tempStoreDir),
    config: createConfig(createStore(tempStoreDir), {}),
    data: initialLocked,
    reload: () => {
      if (modeUnderTest === 'throw') {
        const err = new Error('加密数据包完整性或密钥验证失败 (pdf-reviews)')
        err.code = 'ERR_VAULT_AUTH_FAILED'
        throw err
      }
      return structuredClone(initialLocked)
    },
    vaultDir: tempVaultDir,
  })
  const rollbackServer = http.createServer(rollbackApp.handler)
  await new Promise(resolve => rollbackServer.listen(0, '127.0.0.1', resolve))
  const localBase = `http://127.0.0.1:${rollbackServer.address().port}`

  try {
    const beforeRevision = rollbackApp.dataRevision
    const beforeState = getRuntimeVaultState()

    const failThrow = await fetch(`${localBase}/api/vault/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'builtin' }),
    })
    assert.equal(failThrow.status, 403)
    const failThrowBody = await failThrow.json()
    assert.equal(failThrowBody.ok, false)
    assert.equal(failThrowBody.unlocked, false)
    assert.deepEqual(getRuntimeVaultState(), beforeState)
    assert.equal(rollbackApp.dataRevision, beforeRevision)

    modeUnderTest = 'still-locked'
    const failLocked = await fetch(`${localBase}/api/vault/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'builtin' }),
    })
    assert.equal(failLocked.status, 500)
    const failLockedBody = await failLocked.json()
    assert.equal(failLockedBody.ok, false)
    assert.equal(failLockedBody.unlocked, false)
    assert.equal(failLockedBody.code, 'ERR_VAULT_LOCKED')
    assert.deepEqual(getRuntimeVaultState(), beforeState)
    assert.equal(rollbackApp.dataRevision, beforeRevision)
    assert.equal((await (await fetch(`${localBase}/api/health`)).json()).vault_locked, true)
  } finally {
    resetRuntimeVaultState()
    await rollbackApp.cancelAll()
    await new Promise(resolve => rollbackServer.close(resolve))
    await fs.rm(tempVaultDir, { recursive: true, force: true })
    await fs.rm(tempStoreDir, { recursive: true, force: true })
  }
})


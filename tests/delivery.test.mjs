import test from 'node:test'
import assert from 'node:assert/strict'
import {createAnswerStream,deliveryMessages} from '../server/delivery.js'
import {streamCompletion} from '../server/provider.js'

test('官方DeepSeek保留用户推理选择，避免在推理模式发送不支持的强制工具策略',async()=>{
  const previous=globalThis.fetch,bodies=[]
  globalThis.fetch=async(_url,options)=>{
    bodies.push(JSON.parse(options.body))
    return new Response('data: {"choices":[{"delta":{"content":"完成。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})
  }
  try{
    const config={baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'test-only-secret'}
    const tools=[{type:'function',function:{name:'visualize',parameters:{type:'object',properties:{}}}}]
    for(const reasoningEffort of ['off','high'])await streamCompletion({...config,reasoningEffort},[{role:'user',content:'展示名单'}],tools,{toolChoice:'required'})
    assert.equal(bodies[0].tool_choice,'required');assert.equal(bodies[0].thinking.type,'disabled')
    assert.equal(bodies[1].tool_choice,'auto');assert.equal(bodies[1].thinking.type,'enabled');assert.equal(bodies[1].reasoning_effort,'high')
  }finally{globalThis.fetch=previous}
})

test('回答在供应商完成前持续交付，已显示的句子和Markdown不被回撤',()=>{
  const states=[],stream=createAnswerStream((text,content)=>states.push({text,content}))
  stream.write('先比较南国顺。')
  assert.equal(states.length,1)
  stream.write('\n\n他的团队方向包含大模型及其安全。')
  assert.equal(states.length,2)
  stream.write('\n\n```text\n代码里的句子。\n')
  assert.doesNotMatch(states.at(-1).content,/代码/)
  stream.write('```\n\n结论完整。')
  stream.finish()
  assert.ok(states.length>=3)
  assert.ok(states.every((state,index)=>index===0||state.content.startsWith(states[index-1].content)))
  assert.equal(states.map(state=>state.text).join(''),states.at(-1).content)
})

test('分块到达的底层定位和防御性套话在发布前清理，表格等待完整结构',()=>{
  const states=[],stream=createAnswerStream((text,content)=>states.push(content))
  for(const part of ['付老师本人指导，来源导师评价.m','d:L90，未经独立核','实。\n\n','| 导师 | 原文位置 |\n| --- | --- |\n| 付俊松 | 导师评价.md:L90 |\n'])stream.write(part)
  stream.finish()
  assert.ok(states.every((state,index)=>index===0||state.startsWith(states[index-1])))
  assert.doesNotMatch(states.join('\n'),/\.md|:L90|原文位置|未经独立核实/)
  assert.match(states.at(-1),/付老师本人指导/)
})

test('生成器收到当前问题和业务资料，不接收底层工具历史或旧目标状态',()=>{
  const messages=deliveryMessages({messages:[{role:'user',content:'导师怎么选？'}],latestUserText:'导师怎么选？',modelMessages:[{role:'assistant',reasoning_content:'PRIVATE_REASONING_TEST',content:'private'}],goal:{status:'active',objective:'择导',updates:['能实习']}},{artifacts:[]},'付老师本人指导，原文导师评价.md:L90。[S1]')
  const input=JSON.parse(messages[1].content)
  assert.equal(input.question,'导师怎么选？')
  assert.equal(input.goal,undefined)
  assert.doesNotMatch(JSON.stringify(messages),/PRIVATE_REASONING_TEST|\.md|:L90|modelMessages/)
  assert.match(input.approved_plan,/\[S1\]/)
})

test('接续回答时保留已经显示的段落',()=>{
  const states=[],initial='已经显示的结论。',stream=createAnswerStream((text,content)=>states.push(content),initial)
  stream.write('接下来比较培养条件。');stream.finish()
  assert.ok(states.every(content=>content.startsWith(initial)))
  assert.equal(states.at(-1),'已经显示的结论。\n\n接下来比较培养条件。')
})

test('已显示的换行在随后到达代码块或表格时仍保留',()=>{
  for(const parts of [['结论。\n\n','```text\n代码里的句子。\n','```\n\n结束。'],['结论。\n','| 导师 | 方向 |\n| --- | --- |\n| 南国顺 | 大模型安全。 |\n','\n结束。']]){
    const states=[],stream=createAnswerStream((text,content)=>states.push(content))
    for(const part of parts)stream.write(part)
    stream.finish()
    assert.ok(states.every((content,index)=>index===0||content.startsWith(states[index-1])))
    assert.match(states.at(-1),/结束/)
  }
})

test('先显示正确结论后到达的核实套话不回撤已显示文字，也不进入正文',()=>{
  const states=[],stream=createAnswerStream((text,content)=>states.push(content))
  stream.write('南国顺负责组管理。\n\n')
  stream.write('其余导师在提纲范围内未见细节，选报前需自行核实。')
  stream.finish()
  assert.equal(states.at(-1),'南国顺负责组管理。')
  assert.ok(states.every((content,index)=>index===0||content.startsWith(states[index-1])))
})

test('实际图表单独渲染，正文中的旧图表占位符不会发布',()=>{
  const states=[],stream=createAnswerStream((text,content)=>states.push(content))
  stream.write('评价已列出。\n\n{{cha');stream.write('rt}}');stream.finish()
  assert.equal(states.at(-1),'评价已列出。')
  assert.ok(states.every(text=>!text.includes('{{')))
})

test('逐人长评省略缺项占位句，保留同句内已有安排与流式前缀',()=>{
  const states=[],stream=createAnswerStream((text,content)=>states.push(content),'',[],'逐人详细分析四位导师的管理、项目、实习和毕业安排')
  for(const part of ['### 潘维民\n- 管理：尊重学生，正常上下班，没有打卡类考勤记录。\n','- 毕业：该导师评价未单独记录论文或毕业条件。[S137]\n\n','### 鄂海红\n- 项目：工程开发，技术扎实。[S137]\n','- 实习：记录中的培养安排集中在项目与开发能力，实习放行没有单独条目。[S137]\n','- 毕业：记录中未单独列出论文或毕业条件。[S137]\n','\n鄂海红与潘维民的论文毕业安排均未单独记载。徐鹏研三可全程实习。'])stream.write(part)
  stream.finish()
  const content=states.at(-1)
  assert.match(content,/尊重学生，正常上下班/);assert.match(content,/工程开发，技术扎实/)
  assert.doesNotMatch(content,/没有打卡类|未单独|单独条目|培养安排集中|实习：|毕业：/)
  assert.ok(states.every((text,index)=>index===0||text.startsWith(states[index-1])))
  const direct=[],answer=createAnswerStream((_text,content)=>direct.push(content),'',[],'潘维民的毕业要求有记录吗？')
  answer.write('暂无潘维民毕业要求记录。');answer.finish();assert.equal(direct.at(-1),'暂无潘维民毕业要求记录。')
})

test('最终排名使用真实表格；生成器获得业务数据，另写的排名不会形成第二套结果',()=>{
  const table={type:'table',title:'综合体验排名',columns:[{key:'推荐序',label:'推荐序'},{key:'mentor_id',label:'导师ID'},{key:'name',label:'导师'},{key:'college',label:'学院'}],rows:[{推荐序:1,mentor_id:'mentor-private',name:'甲老师',college:'甲学院'}],sources:[]}
  const draft='按培养体验排序。\n\n| 推荐序 | 导师 | 另一指标 |\n| --- | --- | --- |\n| 1 | 乙老师 | 5 |'
  const messages=deliveryMessages({messages:[],latestUserText:'推荐前1名导师'},{artifacts:[table]},draft),input=JSON.parse(messages[1].content)
  assert.equal(input.approved_plan,undefined)
  assert.deepEqual(input.visualizations[0].preview_rows,[{推荐序:1,name:'甲老师',college:'甲学院'}])
  assert.doesNotMatch(JSON.stringify(messages),/mentor-private|mentor_id/)
  const states=[],stream=createAnswerStream((text,content)=>states.push(content),'',[table])
  stream.write(draft);stream.finish()
  assert.equal(states.at(-1),'按培养体验排序。')
})

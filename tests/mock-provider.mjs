import http from 'node:http'

export async function startMockProvider() {
  const requests = [], overflowed = new Set(), transientFailures=new Map(),regenerationFailures=new Map(),plans=new Map()
  let requestHook=null,categoryPool
  const server = http.createServer(async (req, res) => {
    if (req.url === '/models') {
      if (req.headers.authorization === 'Bearer invalid') { res.writeHead(401); res.end(JSON.stringify({ error: { message: 'invalid key' } })); return }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [
        { id: 'test-agent', name: 'Test Agent', context_window: 32768, max_output_tokens: 4096, effort: { supported_levels: ['none', 'low', 'high', 'max'], default_level: 'high' } },
        { id: 'test-alt', name: 'Test Alternative', context_window: 65536, max_output_tokens: 4096, effort: { supported_levels: ['none', 'low', 'high'], default_level: 'high' } },
        { id: 'test-small', name: 'Test Compact', context_window: 16384, max_output_tokens: 2048, effort: { supported_levels: ['none', 'low'], default_level: 'low' } },
      ] })); return
    }
    if (req.url !== '/chat/completions') { res.writeHead(404); res.end('{}'); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); requests.push(body)
    await requestHook?.(body)
    const lastUser = body.messages.findLastIndex(m => m.role === 'user')
    const question = body.messages[lastUser].content
    let faultQuestion=question
    try{faultQuestion=JSON.parse(question).question||question}catch{}
    const summarizing = body.messages[0].content.startsWith('你在压缩 Agent 的历史记录')
    const reviewing = body.messages[0].content.startsWith('你是数据答复的交付核对员')
    const delivering=body.messages[0].content.startsWith('你是北极星，现在向用户交付最终答复')
    if(!summarizing&&!delivering&&question.includes('重新生成保留验收')&&regenerationFailures.get(question)>0){
      regenerationFailures.set(question,regenerationFailures.get(question)-1)
      res.writeHead(503);res.end(JSON.stringify({error:{message:'regeneration fixture outage'}}));return
    }
    if (!summarizing && !reviewing && !delivering && question.includes('模拟上下文超限') && !overflowed.has(question)) {
      overflowed.add(question); res.writeHead(400); res.end(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'Maximum context length exceeded' } })); return
    }
    if (!summarizing&&(delivering?JSON.parse(question).question:question).includes('模拟401')) { res.writeHead(401); res.end(JSON.stringify({ error: { message: 'bad key' } })); return }
    if(!summarizing&&!reviewing&&!delivering&&question.includes('一次失败重试验收')){
      const count=transientFailures.get(faultQuestion)||0
      if(count<2){transientFailures.set(faultQuestion,count+1);res.writeHead(503);res.end(JSON.stringify({error:{message:'temporary fixture failure'}}));return}
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if(question.includes('逐步进度验收'))await new Promise(resolve=>setTimeout(resolve,1000))
    let answer=''
    const chunk = delta => {answer+=delta.content||'';res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`)}
    const done = () => { if(!summarizing&&!reviewing&&!delivering&&answer)for(const message of body.messages.filter(message=>message.role==='user'))plans.set(message.content,answer);res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`); res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 30 } } })}\n\n`); res.end('data: [DONE]\n\n') }
    if (body.reasoning_effort && body.reasoning_effort !== 'none') chunk({ reasoning_content: 'PRIVATE_REASONING_TEST' })
    if(reviewing) {
      const payload=JSON.parse(question),repair=payload.questions.some(text=>text.includes('自动纠正核对'))
      const wrong=repair&&payload.artifacts.some(artifact=>artifact.row_count!==3)
      chunk({content:JSON.stringify({ok:!wrong,issues:wrong?['只保留付俊松、郭燕慧、杨文川三位，实际重新筛选比较表。']:[],selection:repair?{count:3,names:['付俊松','郭燕慧','杨文川']}:null})});done();return
    }
    if (summarizing) {
      chunk({ content: '已确认：初试中位分349，来源S2；查询结果t1仍可复用。保留用户原有学院、实习及不保证录取的约束。未完成事项：继续查询、核对目标并提交最终结果。' }); done(); return
    }
    if(delivering&&!question.includes('模拟持续输出')&&!question.includes('模拟慢速')&&!question.includes('模拟断流')) {
      const payload=JSON.parse(question),text=payload.approved_plan||plans.get(payload.question)
      if(payload.question.includes('重新生成保留验收')&&!regenerationFailures.has(payload.question))regenerationFailures.set(payload.question,2)
      for(const part of text.match(/[\s\S]{1,12}/g)||[]) {
        chunk({content:part})
        if(question.includes('连续展示验收')||question.includes('真实流式验收'))await new Promise(resolve=>setTimeout(resolve,80))
      }
      done();return
    }
    if (question.includes('模拟持续输出')&&delivering) {
      const paragraph = i => `第 ${i} 段：这是持续生成的导师比较资料，用户可以在回复过程中向上阅读已有内容。\n\n`
      chunk({ content: Array.from({ length: 24 }, (_, i) => paragraph(i + 1)).join('') })
      let index = 24
      const timer = setInterval(() => {
        chunk({ content: paragraph(++index) })
        if (index === 100) { clearInterval(timer); done() }
      }, 50)
      res.on('close', () => clearInterval(timer)); return
    }
    if (question.includes('模拟慢速')&&delivering) {
      chunk({ content: '正在后台分析这次问题。' })
      const timer = setTimeout(() => { chunk({ content: '完成。' }); done() }, 30000)
      res.on('close', () => clearTimeout(timer)); return
    }
    if (question.includes('模拟断流')&&delivering) { chunk({ content: '已保留的部分回答。' }); res.end(); return }
    if(question.includes('模拟持续输出')||question.includes('模拟慢速')||question.includes('模拟断流')){chunk({content:'正在后台分析这次问题。'});done();return}
    const completedTools = body.tool_choice==='none'?Infinity:body.messages.slice(lastUser + 1).filter(m => m.role === 'tool').length
    async function call(name, args, id) {
      if(body.messages.some(message=>message.role==='user'&&message.content.includes('连续展示验收'))){chunk({content:'这是一段不应发布的工具前导。'});await new Promise(resolve=>setTimeout(resolve,180))}
      // Split function arguments across chunks, as real compatible providers do.
      const json = JSON.stringify(args), half = Math.floor(json.length / 2)
      chunk({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: json.slice(0, half) } }] })
      chunk({ tool_calls: [{ index: 0, function: { arguments: json.slice(half) } }] })
      done()
    }
    if(question.includes('无工具续问验收')){chunk({content:'潘维民以项目为主，允许实习；鄂海红偏工程开发，技术扎实。'});done();return}
    if(question.includes('分工与比较联合验收')){
      const previous=body.messages.findLast(message=>message.role==='tool')
      if(!previous)return call('search',{terms:['中国移动研究院'],filters:[{field:'name',op:'in',value:['苏森','李静林','王尚广','林荣恒']}],select:['name','college','topic_evidence','training_evidence'],limit:10},'scope-search')
      if(previous.tool_call_id==='scope-search')return call('query',{from:'mentors',filters:[{field:'name',op:'in',value:['苏森','李静林','王尚广','林荣恒','吴斌']}],select:['name','college','internship','graduation'],limit:10},'scope-facts')
      if(previous.tool_call_id==='scope-facts')return call('visualize',{from:JSON.parse(previous.content).ref,pick:{field:'name',values:['吴斌','苏森']},type:'table',purpose:'comparison',title:'实习与毕业条件',select:['name','college','internship','graduation']},'scope-table')
      chunk({content:'外派中国移动研究院10个月的安排在苏森团队工程硕士的记录中。实习与毕业条件见两人比较表。'});done();return
    }
    if(question.includes('协议恢复验收')){
      const previous=body.messages.findLast(message=>message.role==='tool')
      if(!previous)return call('query',{from:'mentors',filters:[{field:'name',op:'in',value:['付俊松','南国顺','左兴权']}],select:['name','college','rating','management','internship'],limit:3},'protocol-data')
      if(previous.tool_call_id==='protocol-data')return call('visualize',{from:JSON.parse(previous.content).ref,type:'table',title:'三位导师对比'},'protocol-view')
      chunk({content:'<｜｜DSML｜｜ calls>不应作为正式答复。</｜｜DSML｜｜ calls>'});done();return
    }
    if(question.includes('缓存回读验收')){
      const previous=body.messages.findLast(message=>message.role==='tool'),args={from:'mentors',select:['mentor_id','name','college'],limit:30}
      if(!previous)return call('query',args,'cache-first')
      if(previous.tool_call_id==='cache-first')return call('query',args,'cache-second')
      const result=JSON.parse(previous.content);chunk({content:Array.isArray(result.rows)&&result.rows.length===30?'缓存中的完整结果已重新读取。':'缓存结果没有行数据。'});done();return
    }
    if(body.messages.some(message=>message.role==='user'&&message.content.includes('阶段切换验收'))){
      const previous=body.messages.findLast(message=>message.role==='tool')
      if(body.messages[0].content.includes('的导师推荐编辑')){
        const seed=JSON.parse(body.messages.find(message=>message.role==='user').content),pool=seed.facts[0].result
        const ids=pool.rows.slice(0,6).map(row=>Array.isArray(row)?row[pool.columns.findIndex(column=>column.key==='mentor_id')]:row.mentor_id)
        const views=body.messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content)).filter(result=>result.artifact)
        if(views.length<2)return call('visualize',{from:'mentors',type:'table',title:views.length?'科研':'就业',pick:{field:'mentor_id',values:views.length?ids.slice(3):ids.slice(0,3)},row_number_as:'推荐序',select:['name','college','rating','internship']},'stage-view-'+views.length)
        chunk({content:'两类各3位，已按真实数据生成。'});done();return
      }
      if(!previous)return call('query',{from:'mentors',select:['mentor_id','name','college','rating'],limit:30},'stage-pool')
      if(previous.tool_call_id==='stage-pool'&&question.includes('早期'))return call('query',{from:'mentors',sort:['name']},'stage-bad-sort')
      if(previous.tool_call_id==='stage-pool')return call('query',{from:JSON.parse(previous.content).ref,select:['mentor_id','name','college','rating'],limit:30},'stage-details')
      if(previous.tool_call_id==='stage-details')return call('query',{from:'mentors',sort:['name']},'stage-bad-sort')
      return call('query',{from:'mentors',select:['unknown_training_field']},'stage-bad-field')
    }
    if(body.messages.some(message=>message.role==='user'&&message.content.includes('而且最好分为两类'))){
      const previous=body.messages.findLast(message=>message.role==='tool'),correcting=question.includes('【内部数据修正')||body.messages[0].content.includes('的导师推荐编辑')
      if(!previous&&!correcting)return call('query',{from:'mentors',filters:[{field:'rating',op:'gte',value:4}],select:['mentor_id','name','college','rating'],limit:5000},'categories-pool')
      if(!correcting){chunk({content:'两类都不足30位，所以无法推荐。'});done();return}
      const poolMessage=body.messages.find(message=>message.role==='tool'&&message.tool_call_id==='categories-pool')
      const seedMessage=body.messages.findLast(message=>message.role==='user'&&message.content.startsWith('{'))
      const pool=poolMessage?JSON.parse(poolMessage.content):seedMessage?JSON.parse(seedMessage.content).facts.find(fact=>fact.operation==='query').result:categoryPool
      categoryPool=pool
      const records=pool.rows.map(row=>Array.isArray(row)?Object.fromEntries(pool.columns.map((column,index)=>[column.key,row[index]])):row)
      // Exercise data flow and rendering; this fixture order is not a production recommendation rule.
      const ids=records.toSorted((a,b)=>a.name.localeCompare(b.name,'zh-CN')).slice(0,30).map(row=>row.mentor_id)
      const existing=body.messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content)).filter(result=>result.artifact)
      const employment=existing.find(result=>result.artifact.title==='就业与项目（职业发展与实习安排）'),research=existing.find(result=>result.artifact.title==='读博与科研（学术训练与论文指导）')
      if(!employment)return call('visualize',{from:'mentors',pick:{field:'mentor_id',values:ids.slice(0,15)},row_number_as:'就业项目型序',type:'table',title:'就业与项目（职业发展与实习安排）',select:['name','college','rating','internship','graduation']},'employment-table')
      if(!research)return call('visualize',{from:'mentors',pick:{field:'mentor_id',values:ids.slice(15)},row_number_as:'科研培养序',type:'table',title:'读博与科研（学术训练与论文指导）',select:['name','college','rating','management','graduation']},'research-table')
      if(previous?.tool_call_id==='research-table')return call('visualize',{from:'mentors',pick:{field:'mentor_id',values:ids.slice(0,15)},replace:employment.artifact.id,row_number_as:'就业项目型序',type:'table',title:'就业与项目（职业发展与实习安排）',select:['name','college','rating','internship','graduation']},'employment-updated')
      chunk({content:'共推荐30位导师，按就业与项目、读博与科研两类呈现。名单可切换查看，每位导师均可展开培养资料。[S1]'});done();return
    }
    if(question.includes('协议文本验收')){chunk({content:'<｜｜DSML｜｜ calls>内部调用不应作为结果。</｜｜DSML｜｜ calls>'});done();return}
    if(body.messages.some(message=>message.role==='user'&&message.content.includes('信任规则集成'))) {
      const correcting=question.includes('【内部数据修正')||body.messages[0].content.includes('的导师推荐编辑')
      if(correcting){chunk({content:'付俊松本人直接指导学生，月劳务2000元，研二下实习，不要求SCI。[S1][S136]'});done();return}
      if(!completedTools)return call('query',{from:'mentors',filters:[{field:'name',op:'eq',value:'付俊松'}],select:['name','mentor_note','stipend_text','internship','graduation']},'trust-lookup')
      chunk({content:'付俊松本人直接指导学生，月劳务2000元，未经独立核实。建议向在读学生核实。'});done();return
    }
    if(question.includes('劳务金额展示验收')){
      if(completedTools===0)return call('query',{from:'mentors',filters:[{field:'name',op:'in',value:['杨文川','付俊松','郭燕慧','王碧舳']}],select:['name','college','group','stipend_monthly_min','stipend_monthly_max','stipend_text'],limit:20},'stipend-query')
      if(completedTools===1)return call('visualize',{from:JSON.parse(body.messages.at(-1).content).ref,type:'table',title:'资料记载的月劳务金额'},'stipend-table')
      chunk({content:'各导师资料记载的月劳务金额及支付条件见表。'});done();return
    }
    if(question.includes('重复查询收敛验收')){
      if(body.tool_choice==='none'||!body.tools?.length){chunk({content:'付俊松资料记载的月劳务为2000元。[S1]'});done();return}
      return call('query',{from:'mentors',filters:[{field:'name',op:'eq',value:'付俊松'}],select:['name','stipend_text']},'repeated-'+completedTools)
    }
    if(question.includes('前30个最好的导师')){
      const previous=body.messages.findLast(message=>message.role==='tool')
      if(!previous)return call('query',{from:'mentors',filters:[{field:'rating',op:'gte',value:4}],select:['mentor_id','name','college','rating'],limit:5000},'ranking-pool')
      const result=JSON.parse(previous.content)
      if(previous.tool_call_id==='ranking-pool'){
        const ids=result.rows.toSorted((a,b)=>a.name.localeCompare(b.name,'zh-CN')).slice(0,30).reverse().map(row=>row.mentor_id)
        return call('query',{from:'mentors',filters:[{field:'mentor_id',op:'in',value:ids}],sort:[{field:'mentor_id',values:ids}],row_number_as:'推荐序',select:['推荐序','mentor_id','name','college','rating','management','internship'],limit:30},'ranking-selection')
      }
      if(previous.tool_call_id==='ranking-selection')return call('visualize',{from:result.ref,type:'table',title:'综合培养体验推荐前30名',select:['推荐序','name','college','rating','management','internship']},'ranking-table')
      chunk({content:'这份排名以学生评价和培养体验为依据，推荐顺序及具体条件见表。'});done();return
    }
    if(question.includes('跨学院导入验收')){
      if(completedTools===0)return call('query',{from:'mentors',filters:[{field:'name',op:'in',value:['付俊松','左兴权','高慧','王小婕']}],select:['name','college','group','rating','management','internship'],limit:100},'colleges-query')
      if(completedTools===1)return call('visualize',{from:JSON.parse(body.messages.at(-1).content).ref,type:'table',title:'跨学院导师评价对照'},'colleges-table')
      chunk({content:'可以比较付俊松、左兴权、高慧和王小婕，培养方式见对照表。'});done();return
    }
    if(question.includes('候选预览验收')) {
      const previous=body.messages.findLast(message=>message.role==='tool')
      const refs=JSON.parse(body.messages[0].content.match(/可复用结果引用：(\[[^\n]+\])/)?.[1]||'[]'),last=refs.at(-1)
      if(!previous&&!last)return call('search',{terms:['AI security'],limit:30},'candidate-search')
      if(previous?previous.tool_call_id!=='candidate-details':last.columns.includes('candidate_id'))return call('query',{from:previous?JSON.parse(previous.content).ref:last.ref,filters:[{field:'can_supervise_doctoral',op:'eq',value:true}],select:['name','group','rating','topic_basis','group_lead','can_supervise_doctoral','topic_evidence','personal_directions','directions','management','graduation','student_count','exam_count','recommended_count'],sort_by:'rating',order:'desc',limit:30},'candidate-details')
      chunk({content:'已完成候选检索。'});done();return
    }
    if(body.messages.some(message=>message.role==='user'&&message.content.includes('自动纠正核对'))) {
      const correcting=question.includes('【内部数据修正')||body.messages[0].content.includes('的导师推荐编辑'),names=['付俊松','郭燕慧','杨文川']
      const extra=body.messages.some(message=>message.role==='user'&&message.content.includes('多稿预算验收'))?8:0
      if(correcting){
        const old=body.messages.findLast(message=>message.role==='tool'&&JSON.parse(message.content).artifact)
        if(completedTools===0)return call('visualize',{from:'mentors',pick:{field:'name',values:names},type:'table',title:'导师候选对比',select:['name','rating','internship'],...((old||body.messages[0].content.match(/当前图表：(\[.*\])。/))?{replace:old?JSON.parse(old.content).artifact.id:JSON.parse(body.messages[0].content.match(/当前图表：(\[.*\])。/)[1])[0]?.id}:{})},'repaired-table')
        chunk({content:'推荐付俊松、郭燕慧、杨文川三位。\n\n比较结果见表。'});done();return
      }
      if(completedTools<extra)return call('query',{from:'mentors',select:['name'],limit:1},`lookup-${correcting}-${completedTools}`)
      if(completedTools===extra)return call('query',{from:'mentors',filters:[{field:'name',op:'in',value:correcting?names:[...names,'李丽香','徐洁']}],select:['name','rating','internship'],limit:5000},correcting?'repaired-query':'draft-query')
      if(completedTools===extra+1){
        const old=correcting?body.messages.findLast(message=>message.role==='tool'&&JSON.parse(message.content).artifact):null
        return call('visualize',{from:JSON.parse(body.messages.at(-1).content).ref,type:'table',title:'导师候选对比',...(old?{replace:JSON.parse(old.content).artifact.id}:{})},correcting?'repaired-table':'draft-table')
      }
      chunk({content:'推荐付俊松、郭燕慧、杨文川三位。\n\n比较结果见表。'});done();return
    }
    if (question.includes('展示边界验收')) {
      if (completedTools === 0) return call('catalog', {}, 'boundary-catalog')
      if (completedTools === 1) return call('query', { from: 'reviews', filters: [{ field: 'name', op: 'in', value: ['尚煜茗', '杨忠良'] }], select: ['review_id', 'name', 'rating', 'text', 'source_locator', 'source_ids'], limit: 20 }, 'boundary-query')
      const result = body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content)).findLast(r => Array.isArray(r.rows) && r.rows[0]?.source_locator)
      if (completedTools === 2) return call('visualize', { from: result.ref, type: 'table', title: '评价原文', select: ['name', 'rating', 'text', 'source_locator', 'review_id'] }, 'boundary-table')
      if (completedTools === 3) return call('visualize', { from: result.ref, type: 'bar', x: 'name', y: ['rating'], title: '原文评分' }, 'boundary-bar')
      for (const content of ['| 导师 | 评分 | 原文位置 |\n| --- | --- | --- |\n| 尚煜茗 | 1 | 导师评价.m', 'd:L', '90 |\n\n原文见 `导师评价.m', 'd:L90`。[S1]\n\n```json\n{"filters":[],"source_locator":"导师评价.md:L90"}\n```']) chunk({ content })
      done(); return
    }
    if (question.includes('旧目录续问')) {
      if (body.messages.some(m => m.role === 'tool' && m.tool_call_id === 'stale-catalog')) { chunk({ content: '错误：仍在使用过期资料目录。' }); done(); return }
      if (completedTools === 0) return call('catalog', {}, 'fresh-catalog')
      if (completedTools === 1) return call('query', { from: 'mentors', filters: [{ field: 'name', op: 'eq', value: '付俊松' }], select: ['name', 'student_count', 'exam_count', 'recommended_count'] }, 'fresh-query')
      if (completedTools === 2) return call('visualize', { from: JSON.parse(body.messages.at(-1).content).ref, type: 'table', title: '付俊松学生构成' }, 'fresh-table')
      const result = body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content)).findLast(r => Array.isArray(r.rows) && r.rows[0]?.name === '付俊松')
      chunk({ content: `付俊松：考研${result.rows[0].exam_count}人，保研${result.rows[0].recommended_count}人。` }); done(); return
    }
    if (question.includes('招生类型验收')) {
      if (completedTools === 0) return call('catalog', {}, 'admission-catalog')
      if (completedTools === 1) return call('query', { from: 'mentors', filters: [{ field: 'student_count', op: 'gt', value: 0 }, { field: 'recommended_count', op: 'eq', value: 0 }], select: ['name', 'student_count', 'exam_count', 'recommended_count', 'exam_ratio'], limit: 5000 }, 'admission-mentors')
      if (completedTools === 2) return call('visualize', { from: JSON.parse(body.messages.at(-1).content).ref, type: 'table', title: '全部只有考研学生的导师', description: '按有初试为考研、无初试保研的项目口径。' }, 'admission-table')
      if (completedTools === 3) return call('aggregate', { from: 'students', group_by: ['admission_type'], metrics: [{ op: 'count', as: '人数' }] }, 'admission-counts')
      if (completedTools === 4) return call('visualize', { from: JSON.parse(body.messages.at(-1).content).ref, type: 'table', title: '名册招生类型人数' }, 'admission-types')
      if (completedTools === 5) return call('visualize', { from: JSON.parse(body.messages.filter(m => m.role === 'tool').at(-2).content).ref, type: 'bar', x: 'admission_type', y: ['人数'], title: '名册招生类型分布' }, 'admission-bar')
      chunk({ content: '按无初试保研口径，已列出全部只有考研学生的导师。名册学生的招生类型与成绩是否唯一匹配分开统计。[S2][S3]' }); done(); return
    }
    if (question.includes('渲染验收')) {
      if (completedTools === 0) return call('query', { from: 'mentors', filters: [{ field: 'name', op: 'in', value:question.includes('3位')?['付俊松','郭燕慧','李丽香']:['李丽香', '刘欣然', '付俊松', '郭燕慧', '吴小虎'] }], select: ['name', 'directions', 'rating', 'management', 'internship', 'stipend_text'], limit: 20 }, 'render-query')
      if (completedTools === 1) return call('visualize', { from: JSON.parse(body.messages.at(-1).content).ref, type: 'table', title: '导师培养条件：长文本与缺失值对比' }, 'render-table')
      if (completedTools === 2) return call('query', { from: 'exams', select: ['mentor_name', 'score_first', 'score_reexam', 'score_total', 'match_status'], limit: 12 }, 'render-exams')
      if (completedTools === 3) return call('visualize', { from: JSON.parse(body.messages.at(-1).content).ref, type: 'table', title: '成绩与导师归属说明', select: ['mentor_name', 'score_first', 'score_reexam', 'score_total', 'match_status'] }, 'render-status')
      chunk({ content: '### 渲染核对\n\n比较表保留真实原文。**缺少资料用破折号表示**，不当作零。[S1]\n\n| 项目 | 初试 | 复试 | 加权成绩 |\n| --- | --- | --- | --- |\n| 样例一 | 407 | 88.52 | 84.96 |\n| 样例二 | 389 | 暂无资料 | 81.21 |\n\n```json\n{"score_first": 407, "scope": "进入复试者"}\n```' }); done(); return
    }
    if (completedTools === 0) return call('catalog', {}, 'mock-catalog')
    if (completedTools === 1) return call('query', { from: 'mentors', filters: [{ field: 'rating', op: 'gte', value: 4 }], select: ['mentor_id', 'name', 'rating', 'exam_count'], sort_by: 'rating', limit: 4 }, 'mock-query')
    if (completedTools === 2) {
      const result = JSON.parse(body.messages.findLast(m => m.role === 'tool').content)
      if (question.includes('模拟多图')) {
        chunk({ tool_calls: ['bar', 'line', 'scatter', 'table', 'metric'].map((type, index) => ({ index, id: `mock-view-${type}`, type: 'function', function: { name: 'visualize', arguments: JSON.stringify({ from: result.ref, type, title: `渲染验证 ${type}`, ...(type === 'table' ? {} : { x: type === 'scatter' ? 'rating' : 'name', y: [type === 'scatter' ? 'exam_count' : 'rating'] }) }) } })) })
        done(); return
      }
      return call('visualize', { from: result.ref, type: 'bar', title: '导师原文评分对比', x: 'name', y: ['rating'], description: '2026 年导师评分，满分 5 分。' }, 'mock-visualize')
    }
    for (const content of ['**可以先比较这些候选。** ', '2026 年评分见图表。[S1] ', '可以按方向和实习条件继续筛选。\n\n', '| 维度 | 比较内容 |\n| --- | --- |\n| 实习 | 实习时间与要求 |']) chunk({ content })
    done()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, requests,setRequestHook:hook=>{requestHook=hook}, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }) }
}

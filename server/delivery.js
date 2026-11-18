import {APP_NAME} from '../lib/brand.js'
import {publicText,publicArtifact,ordinalColumn,mentorRanking} from '../lib/presentation.js'
import {answerPolicy,requestedExclusions,narrativeRequested} from '../lib/answer-policy.js'

export function deliveryMessages(chat,assistant,plan,personalConditions=[],evidence=[]) {
  const question=chat.latestUserText||chat.messages.findLast(message=>message.role==='user')?.content
  const mail=/邮件|写信/.test(question||'')
  const operations=(assistant.tools||[]).filter(tool=>tool.name==='workspace'&&tool.status==='complete'&&!['read','analyze','scenario'].includes(tool.args?.action)).map(tool=>({action:tool.args.action,result:tool.summary}))
  const fileOnly=assistant.files?.length&&/给我文件即可|只(?:要|给|需)[^。！？\n]{0,10}(?:文件|下载)/.test(question)
  if(fileOnly){evidence=[];personalConditions=[];plan=''}
  const record=row=>Object.fromEntries(Object.entries(row).filter(([key,value])=>value!=null&&value!==''||key==='group_context'))
  evidence=evidence.map(packet=>({...packet,rows:packet.rows?.map(record)}))
  if(mail){
    const fields=new Set(['name','contact_email','research_areas','personal_directions','url'])
    evidence=evidence.map(packet=>({...packet,columns:packet.columns?.filter(column=>fields.has(column.key)),rows:packet.rows?.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>fields.has(key))))})).filter(packet=>packet.rows?.some(row=>Object.keys(row).length))
    personalConditions=[]
  }
  const tables=assistant.artifacts.map(artifact=>publicArtifact(artifact,{question})).filter(Boolean)
  const recommendations=tables.filter(view=>view.purpose==='recommendation'||mentorRanking(view))
  const selectedOnly=recommendations.length>0&&!requestedExclusions(question)
  const selected=recommendations.flatMap(view=>view.rows.map(row=>({name:row.name||row.mentor_name,college:row.college})))
  const conditions=selectedOnly?personalConditions.filter(note=>selected.some(row=>row.name===note.name&&row.college===note.college)):personalConditions
  const summarized=selectedOnly&&recommendations.length===tables.length&&recommendations.every(view=>view.columns.some(column=>column.key==='assistant_note'))
  const selectionPolicy='\n每条事实引用其所在行source_ids或personal_conditions.source_ids中的实际来源编号。'+(selectedOnly?'\n本轮只交付selected_mentors中的入选导师及相关条件，图表已完整展示名单。概括选择差别，不介绍未入选对象、排除理由或筛选经过。':'')+(tables.length?'\n同一份表格由界面展示一次，已有图表之外的问题用文字回答。':'')
  const summaryPolicy=(summarized?'图表已逐人展示要点。正文只用两三句话概括最关键的选择差别，保持图表内的顺序。':tables.length?'数据与条件已在图表中展示。正文补充两三句最有用的结论，保持表内顺序。':'围绕所问内容，用一至三段简短自然的文字直接回答。')+'以上为默认详略；用户已指定结构、逐人长评或完整报告时，按用户要求完整展开，不受默认段数限制。'
  const contextPolicy='沿用已明确的分数、学院、人数和学位要求，最新变更优先；区分希望与硬条件。个人招生、名额及指导条件只在报考适配问题中使用。数据年份、专业和范围以标题或短标签表达。邮件中使用实际导师邮箱和方向；用户尚未提供的身份、年份、学院和经历用空位表示。用户明确要求逐个、逐人或每位详细分析时，按名单顺序，用三级Markdown标题写每位导师姓名，分别用要点展开各人已有的具体安排。解释方法或完整成品按其要求展开。比较多位导师时，每项条件对应实际记录的导师，合并概括只采用这些人的共有条件。'+(operations.length?'工作台操作以operation_results为准，简短确认实际执行的内容与数量。生成的报告由界面提供下载入口，确认生成时不逐人复述报告内容。操作确认本身不引用网页，空备注直接省略；用户未要求导师介绍时不重复介绍老师。':'')
  const mailPolicy=mail?'邮件仅含收件人、主题、两三段信正文和署名。正文只写用户已给的初试信息、研究兴趣和交流意愿；未提供的院校、专业、报考时间、经历直接省略，署名缺项用空位，不列个人资料填写表。发信人信息只取sender_request，教师资料只用于老师姓名、公开邮箱和方向，个人方向优先。附件只在用户指定时列出。':''
  return [
    {role:'system',content:'你是'+APP_NAME+'，现在向用户交付最终答复。只使用已准备的事实、图表和来源，直接陈述业务结果。图表是最终名单、顺序和数值，分类各自保持表内顺序。引用放在相关事实旁。'+(mail?'':'来源引用采用 [S1] 格式，编号取所给来源的id。')+'图表中的字段和逐人要点由界面展示，正文补充影响选择的关键差别；用自然文字，不输出写作要求、提纲标签或执行说明。\n'+answerPolicy+'\n'+contextPolicy+selectionPolicy+'\n'+summaryPolicy+'\n'+mailPolicy},
    {role:'user',content:JSON.stringify({question,operation_results:operations.length?operations:undefined,sender_request:mail?(/留空|空白|占位/.test(question)?question:chat.messages.filter(message=>message.role==='user').slice(-8).map(message=>message.content)):undefined,selected_mentors:selectedOnly?selected:undefined,recent_requests:mail&&/留空|空白|占位/.test(question)?[question]:chat.messages.filter(message=>message.role==='user').slice(-8).map(message=>message.content),personal_conditions:summarized?undefined:conditions,already_delivered:assistant.content||undefined,evidence:evidence.length?evidence:undefined,approved_plan:mail||tables.length||evidence.length?undefined:publicText(plan,{tables,question}),visualizations:mail?[]:tables.map(view=>{const order=view.columns.find(ordinalColumn);return {title:view.title,description:view.description,type:view.type,row_count:view.rows.length,colleges:[...new Set(view.rows.map(row=>row.college).filter(Boolean))],...(order&&view.rows.length?{order_range:[view.rows[0][order.key],view.rows.at(-1)[order.key]]}:{}),columns:view.columns.filter(column=>!summarized||['name','mentor_name','college','assistant_note'].includes(column.key)).map(({key,label})=>({key,label})),preview_rows:view.rows.slice(0,narrativeRequested(question)?view.rows.length:6).map(row=>record(summarized?Object.fromEntries(Object.entries(row).filter(([key])=>['name','mentor_name','college','assistant_note'].includes(key))):row)),sources:view.sources.map(({id,title,kind})=>({id,title,kind}))}})})},
  ]
}

// Hold an unfinished sentence or Markdown block so display cleanup cannot retract earlier text.
export function createAnswerStream(publish,initial='',tables=[],question) {
  let raw='',visible=initial
  const prefix=initial?initial+'\n\n':''
  function flush(complete=false) {
    let end=raw.length
    if(!complete) {
      const boundaries=[...raw.matchAll(/[。！？]\s*|\n\s*\n/g)]
      end=boundaries.length?boundaries.at(-1).index+boundaries.at(-1)[0].length:0
      const prefix=raw.slice(0,end),fences=[...prefix.matchAll(/^[ \t]*```/gm)]
      if(fences.length%2)end=fences.at(-1).index
      const breakAt=raw.lastIndexOf('\n\n',end-1),paragraph=breakAt<0?0:breakAt+2
      const table=raw.slice(paragraph,end).match(/^[ \t]*\|/m)
      if(table&&!raw.slice(0,end).endsWith('\n\n'))end=paragraph+table.index
    }
    let body=raw.slice(0,end)
    if(/^收件人：/.test(initial)&&/邮件|写信/.test(question||''))body=body.replace(/^\s*(?:以下|下面)[^\n。！？]*(?:邮件|草稿)[^\n。！？]*[。！？：:]?(?:\n+|$)/u,'').replace(/^\s*(?:\*\*)?收件人(?:\*\*)?\s*[：:][^\n]*(?:\n|$)/u,'')
    const content=(prefix+publicText(body,{tables,question})).trim()
    if(!content.startsWith(visible))throw new Error('回答显示中断，请重试')
    if(content.length>visible.length){const text=content.slice(visible.length);visible=content;publish(text,content)}
  }
  return {write(text){raw+=text;flush()},finish(){flush(true)}}
}

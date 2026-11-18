import { fieldLabels } from './fields.js'
import {cleanDefensiveText,cleanAnswerText,requestedExclusions,narrativeRequested} from './answer-policy.js'
const toolLabels = { catalog: '读取资料', search:'检索相关导师',query: '筛选资料', join: '关联资料', aggregate: '统计分析', visualize: '生成图表', get_goal: '核对任务', complete_goal: '完成任务', pause_goal: '暂停任务' }
const internalKey = /(?:^|_)(?:id|ids|source_locator|source_location|file|filename|file_path|path|ref|args|parameters|tool_name|sha256|checksum|hash)$/i
const internalLabel = /原文位置|原文定位|文件路径|原始文件|源文件|内部\s*ID|匿名.*ID|来源\s*ID|导师\s*ID|评价\s*ID|查询引用|工具参数/i
export const ordinalColumn=column=>column.role==='ordinal'||/推荐序|序号|排名|名次|(?:^|_)(?:rank|position)$|序$/i.test(column.key)
export const mentorRanking=artifact=>(artifact.purpose==='recommendation'||!artifact.purpose&&artifact.columns.some(ordinalColumn))&&artifact.type==='table'&&artifact.columns.some(column=>/^(name|mentor_name)$/.test(column.key))&&!artifact.columns.some(column=>column.key==='student_name')
export function internalColumn(column) {
  return typeof column === 'string' ? internalKey.test(column) : internalKey.test(column.key) || internalLabel.test(column.label || '')
}

function publicRankingOrder(text,tables){
  const ranked=tables.filter(mentorRanking)
  if(ranked.length!==1)return text
  const names=ranked[0].rows.map(row=>row.name||row.mentor_name)
  if(names.length<2||new Set(names).size!==names.length)return text
  const escaped=names.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),person=`(?:\\*\\*)?(?:${escaped})(?:\\*\\*)?`
  const declaration=new RegExp(`((?:联系顺序|推荐顺序|综合顺序|优先顺序|排序顺序)[为是：:\\s*]*)(${person}(?:\\s*(?:、|，|,|→|＞|>)\\s*${person})+)`,'g')
  return text.replace(declaration,(match,prefix,list)=>{
    const found=list.match(new RegExp(escaped,'g'))||[]
    return found.length===names.length&&new Set(found).size===names.length?prefix+(list.startsWith('**')?'**':'')+names.join('、')+(list.endsWith('**')?'**':''):match
  })
}

function publicTables(text,tables=[]) {
  const lines = text.split('\n'), split = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(s => s.trim())
  let fenced = false
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*```/.test(lines[i])) fenced = !fenced
    if (fenced || !lines[i].includes('|')) continue
    const headers = split(lines[i]), divider = split(lines[i + 1])
    if (headers.length !== divider.length || !divider.every(c => /^:?-+:?$/.test(c))) continue
    const visible = headers.map((label, index) => ({ label, index })).filter(c => !internalColumn({ key: c.label, label: c.label })).map(c => c.index)
    let end = i + 2
    while (end < lines.length && lines[end].includes('|') && lines[end].trim() && (/^\s*\|/.test(lines[end]) || split(lines[end]).length === headers.length)) end++
    const normalize=value=>String(value).replace(/[\s*_`]/g,'')
    const label=value=>normalize(value).replace(/论文与毕业|毕业要求|论文要求/g,'毕业').replace(/管理与考勤|管理特点|管理要求/g,'管理').replace(/实习情况/g,'实习').replace(/(?:相近分|近分|本分段)?样本(?:人数|数)/g,'样本数').replace(/(?:对应|具体)(?:初试)?分数|初试分数列表/g,'分数')
    const nameIndex=headers.findIndex(header=>/^(导师|老师|姓名)$/.test(normalize(header)))
    const ranked=nameIndex>=0&&headers.some(header=>ordinalColumn({key:header}))&&tables.some(mentorRanking)
    const matching=nameIndex<0?[]:tables.filter(table=>{
      if(table.type!=='table')return false
      const nameColumn=table.columns.find(column=>/^(name|mentor_name)$/.test(column.key))
      if(!nameColumn)return false
      const names=new Set(table.rows.map(row=>normalize(row[nameColumn.key])))
      return end>i+2&&lines.slice(i+2,end).every(line=>names.has(normalize(split(line)[nameIndex])))
    })
    const labels=new Set(matching.flatMap(table=>table.columns.map(column=>label(column.label))))
    const repeated=matching.length>0&&visible.every(index=>labels.has(label(headers[index])))
    if(repeated||ranked)for(let row=i;row<end;row++)lines[row]=''
    else if (visible.length !== headers.length) for (let row = i; row < end; row++) {
      const cells = split(lines[row])
      lines[row] = visible.length ? `| ${visible.map(index => cells[index] || '').join(' | ')} |` : ''
    }
    i = end - 1
  }
  return lines.join('\n')
}

export function publicText(value, { streaming = false,tables=[],question } = {}) {
  if (value == null) return value
  let text = question===undefined?String(value):cleanAnswerText(String(value),question)
  text = cleanDefensiveText(publicTables(publicRankingOrder(text,tables),tables))
  text=text.replace(/<[｜|]{2}DSML[｜|]{2}[\s\S]*$/g,'')
  text = text.replace(/\{\{\s*chart\s*\}\}/g,'')
  text = text.replace(/(?:项目)?维护者(?:提供的|明确提供的)?补充|个人培养与招生补充/g,'第三方评价')
  text = text.replace(/模型接口返回 HTTP 400[^\n]*reasoning_content[^\n]*/g,'模型会话恢复失败，请重试。')
  text = text.replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, block => /source_locator|mentor_id|student_id|exam_id|review_id|tool_calls|"(?:from|select|filters|parameters|arguments)"\s*:/.test(block) ? '' : block)
  text = text.replace(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/api\/[^\s`<>|\[\]{}，。；）)]*/g, '内部查询')
  text = text.replace(/(?<![\w:/])(?:file:\/\/)?(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private|workspace|api)\/)[^\s`<>|\[\]{}，。；）)]*/g, '内部资料')
  text = text.replace(/(?:[\w.-]+[/\\])*([^\s`<>|/\\\[\]{}（）()，。；：:"']+)\.(?:md|markdown|pdf|xlsx?|csv|jsonl?|tsx?|jsx?)(?:[:#](?:(?:L|P|page=)?\d*)?(?:-(?:L|P)?\d*)?)?/gi, (match, name, offset, input) => /https?:\/\/\S*$/.test(input.slice(0, offset)) ? match : ({ 导师评价: '导师评价', 初试结果: '初试成绩资料', 复试结果: '复试结果资料' })[name] || '资料来源')
  text = text.replace(/\b(?:mentor|student|exam|review|candidate)-[a-f0-9]{12}\b/gi, '相关记录')
  text = text.replace(/\badmission_type\s*[:=]\s*["']?(exam|recommended)["']?/g, (_, type) => type === 'exam' ? '考研' : '保研')
  text = text.replace(/\b(?:source_locator|source_ids|mentor_id|student_id|exam_id|review_id)\b/g, '资料信息')
  text = text.replace(/原文位置|原文定位|文件路径/g, '资料来源')
  text = text.replace(/\b(?:catalog|search|query|join|aggregate|visualize|get_goal|complete_goal|pause_goal)\b/g, (name,offset,input) => /https?:\/\/\S*$/.test(input.slice(0,offset))?name:toolLabels[name])
  text = text.replace(/\bcolor_by\s*[:=]\s*["']?([a-z_]+)["']?/g, (_, field) => `按${fieldLabels[field] || '业务分类'}分色`)
  text = text.replace(/(未拟录取|拟录取|已录取|未录取|录取状态)\s*[（(]\s*(?:true|false)\s*[）)]/gi,'$1')
  text = text.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, key => fieldLabels[key] || key)
  text = text.replace(/\brating\b(?=\s*(?:为|是|字段|列|[:：=]))/g,'评分')
  text = text.replace(/\bt\d+\b/g, '查询结果')
  if (streaming) text = text.replace(/([^\s`<>|\[\]{}（）()，。；：:]+)\.(?:m|x|xl|xls|p|pd)?$/gi, '$1')
  return text
}
export const exportText = (value,options) => publicText(value,options)?.replace(/\[S(\d+)\]/g, '[$1]')
export const sourceNumber = id => String(id).match(/^S(\d+)$/)?.[1] || '资料'
export const sourceName = source => source.url ? `${source.scope || '网页'} · ${source.kind==='学校官网'?'官网':source.publisher||'资料'}` : source.kind || source.title || '资料'
export function publicWebUrl(value) {
  try {
    const url=new URL(value)
    return ['http:','https:'].includes(url.protocol)&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&!url.username&&!url.password?url.href:null
  } catch { return null }
}
export function publicSource(source) {
  return { id: source.id, title: publicText(source.title), kind: publicText(source.kind), year: source.year, scope: publicText(source.scope), ...(publicWebUrl(source.url)?{url:publicWebUrl(source.url),publisher:publicText(source.publisher),published_at:source.published_at,fetched_at:source.fetched_at}:{}) }
}
export function publicSourceContent(data,source){
  const belongs=row=>row.source_ids?.includes(source.id)
  const entries=[
    ...data.reviews.filter(belongs).map(row=>({title:[row.name||`第${row.group}组`,row.college,row.mentor_id?row.group:null].filter(Boolean).join(' · '),text:row.text,rating:row.rating})),
    ...(data.mentor_notes||[]).filter(belongs).map(row=>({title:[row.name,row.college].filter(Boolean).join(' · '),text:row.text})),
    ...data.profiles.filter(belongs).map(row=>({title:[row.name,row.college].filter(Boolean).join(' · '),text:[['网页研究领域',row.research_areas],['个人介绍',row.biography],['团队介绍',row.team_description],['科研项目',row.projects],['科研成果',row.achievements],['招生信息',row.admissions],['公开邮箱',row.contact_email]].filter(([,value])=>value?.length).map(([label,value])=>`${label}\n${Array.isArray(value)?value.join('、'):value}`).join('\n\n')})),
  ].map(entry=>({title:publicText(entry.title).replace(/、{2,}/g,'、'),text:publicText(entry.text),...(entry.rating!=null?{rating:entry.rating}:{})})).filter(entry=>entry.text)
  const dataset=source.kind==='历史成绩'?'exams':source.kind==='师生关联'?'students':null
  let table
  if(dataset){
    const keys=dataset==='exams'?['student_name','program','score_first','rank_first','score_reexam','score_total','admitted']:['student_name','mentor_name','program','admission_type','score_first']
    const rows=data[dataset].filter(belongs)
    table=publicArtifact({id:source.id,type:'table',title:source.title,rows,columns:keys.map(key=>({key,label:fieldLabels[key]||key,type:typeof rows.find(row=>row[key]!=null)?.[key]})),sources:[source]})
  }
  return {source:publicSource(source),entries,...(table?{table}:{}),...(!entries.length&&!table&&source.note?{note:publicText(source.note)}:{})}
}
export function publicArtifact(artifact,{question}={}) {
  if (!artifact) return null
  let columns = artifact.columns.filter(c => !internalColumn(c)).map(c => ({ key: c.key, label: /stipend_monthly_(?:min|max)$/.test(c.key)?fieldLabels[c.key.endsWith('_min')?'stipend_monthly_min':'stipend_monthly_max']:c.key==='directions'?'团队招生方向':publicText(c.label), type: c.type,...(c.role?{role:c.role}:{}) }))
  const studentIndex=columns.findIndex(column=>column.key==='student_name'||column.label==='学生姓名')
  if(studentIndex>0)columns.unshift(columns.splice(studentIndex,1)[0])
  if (!columns.length) return null
  const cell = value => typeof value === 'string' ? publicText(value) : Array.isArray(value) ? value.map(v => typeof v === 'string' ? publicText(v) : v) : value
  let rows = artifact.rows.map(row => Object.fromEntries(columns.map(c => [c.key, cell(row[c.key]) ?? null])))
  if(mentorRanking(artifact)&&!columns.some(ordinalColumn)){
    columns.unshift({key:'推荐序',label:'推荐序',type:'number',role:'ordinal'})
    rows=rows.map((row,index)=>({...row,推荐序:index+1}))
  }
  if(artifact.row_notes?.length&&(mentorRanking(artifact)||artifact.rows.length===1||narrativeRequested(question)||columns.length<4)){
    const position=columns.findIndex(column=>column.key==='college')
    columns.splice(position<0?1:position+1,0,{key:'assistant_note',label:'要点与取舍',type:'string',role:'annotation'})
    rows=rows.map((row,index)=>{
      let note=publicText(artifact.row_notes[index]||'',{question})
      if(!requestedExclusions(question))note=note.split(/(?<=[，,；;。！？])/u).filter(clause=>!/(?:未收录|未记载|未载|未见|暂无)/.test(clause)||!/(?:资料|记录|记载|信息|样本|说明)/.test(clause)).join('').replace(/[，,；;]\s*$/u,'。')
      return {...row,assistant_note:note}
    })
  }
  let range
  for(const lower of [...columns]){
    const match=lower.key.match(/^(.*)stipend_monthly_min$/)
    if(!match)continue
    const upper=match[1]+'stipend_monthly_max',key=match[1]+'stipend_monthly'
    if(!columns.some(column=>column.key===upper))continue
    if(artifact.type!=='table'){
      if(artifact.type==='bar'&&artifact.y?.length===2&&artifact.y.includes(lower.key)&&artifact.y.includes(upper))range={low:lower.key,high:upper,label:fieldLabels.stipend_monthly}
      continue
    }
    rows=rows.map(row=>{
      const low=row[lower.key],high=row[upper],amount=low==null?high:high==null||low===high?low:`${low}–${high}`
      const next={...row,[key]:amount};delete next[lower.key];delete next[upper];return next
    })
    columns=columns.filter(column=>column.key!==upper).map(column=>column.key===lower.key?{key,label:fieldLabels.stipend_monthly,type:'money'}:column)
  }
  const keys = new Set(columns.map(c => c.key))
  if(artifact.purpose==='statistics')columns=columns.map(column=>column.role==='ordinal'?{...column,label:'序号'}:column)
  const y = (artifact.y || []).filter(key => keys.has(key)), x = keys.has(artifact.x) ? artifact.x : undefined
  let description=exportText(artifact.description || '',{question}).replace(/[^。！？\n；;]*(?:无记录|没有记录|没有记载|未记载|未提供)[^。！？\n；;]*[。！？；;]?/g,'').replace(/[；;，,\s]+$/,'')
  if(['bar','line','scatter'].includes(artifact.type)){
    const format=value=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value)
    const dimensions=range?[{label:range.label,values:rows.flatMap(row=>[row[range.low],row[range.high]])}]:[...new Set([x,...y])].filter(Boolean).map(key=>({label:columns.find(column=>column.key===key).label,values:rows.map(row=>row[key])}))
    description=dimensions.flatMap(dimension=>{
      const values=dimension.values.filter(Number.isFinite)
      if(!values.length)return []
      const low=Math.min(...values),high=Math.max(...values)
      return `${dimension.label} ${format(low)}${low===high?'':`–${format(high)}`}`
    }).join(' · ')
  }
  return { id: artifact.id,purpose:artifact.purpose, title: exportText(artifact.title,{question}), description, type: artifact.type !== 'table' && ((!x&&artifact.type!=='metric') || !y.length) ? 'table' : artifact.type, x, y,...(range?{range}:{}), color_by:keys.has(artifact.color_by)?artifact.color_by:undefined, rows, columns, sources: (artifact.sources || []).map(publicSource) }
}
export function publicTool(tool) {
  return { id: tool.id, label: publicText(tool.label || toolLabels[tool.name] || '查询资料'), status: tool.status, summary: tool.status === 'error' ? '未完成' : publicText(tool.summary || '') }
}
export function publicActivity(step) {
  return {id:step.id,kind:step.kind,label:publicText(step.label),status:step.status,startedAt:step.startedAt,finishedAt:step.finishedAt,...(Number.isFinite(step.count)?{count:step.count}:{}),...(step.tool?{tool:step.tool}:{}),...(step.dataset?{dataset:step.dataset}:{})}
}
export function artifactKey(artifact) {
  return JSON.stringify([artifact.title,artifact.type,artifact.purpose,artifact.row_notes,artifact.x,artifact.y,artifact.color_by,artifact.columns.map(column=>column.key),artifact.rows])
}
export function selectedArtifacts(artifacts,question) {
  if(question===undefined||requestedExclusions(question))return artifacts
  const recommendations=artifacts.filter(artifact=>artifact.purpose==='recommendation'||mentorRanking(artifact))
  if(!recommendations.length)return artifacts
  const selected=recommendations.flatMap(artifact=>artifact.rows)
  return artifacts.flatMap(artifact=>{
    if(artifact.columns.some(column=>column.key==='student_name')&&!artifact.columns.some(column=>/^(score_first|score_reexam|score_total)$/.test(column.key))&&!/姓名|名单|名册|学生有谁|有哪些学生/.test(question))return []
    const name=artifact.columns.find(column=>/^(name|mentor_name)$/.test(column.key))?.key
    if(artifact.purpose==='statistics'&&!name&&!/统计|分布|均分|平均|中位|相关|人数|占比|多少|覆盖|比例|样本|分数|初试|复试|成绩/.test(question))return []
    const separate=/单独|逐一|逐个|展开|再.*(?:对比|比较)|对比.*(?:前|这).*[位人]/.test(question)
    if(!recommendations.includes(artifact)&&artifact.type==='table'&&name&&!separate&&artifact.rows.every(row=>selected.some(person=>(person.name||person.mentor_name)===row[name]&&(!row.college||!person.college||row.college===person.college)&&artifact.columns.filter(column=>!ordinalColumn(column)).every(column=>JSON.stringify(person[column.key])===JSON.stringify(row[column.key])))))return []
    if(recommendations.includes(artifact)||artifact.type!=='table'||!name)return [artifact]
    const indices=artifact.rows.flatMap((row,index)=>selected.some(person=>(person.name||person.mentor_name)===row[name]&&(!row.college||!person.college||row.college===person.college))?[index]:[])
    if(!indices.length)return []
    const rows=indices.map(index=>artifact.rows[index]),before=new Set(artifact.rows.map(row=>row[name])),after=new Set(rows.map(row=>row[name]))
    const description=indices.length<artifact.rows.length?artifact.description?.replace(/[，,；;]?\s*共\s*\d+\s*(?:个|条|名)\s*(?:样本|记录|学生)/g,''):artifact.description
    return [{...artifact,rows,description,...(artifact.row_notes?{row_notes:indices.map(index=>artifact.row_notes[index])}:{}),sources:(artifact.sources||[]).filter(source=>!before.has(source.scope)||after.has(source.scope))}]
  })
}
export function publicMessages(messages) {
  let question=''
  return messages.map(message=>{
    if(message.role==='user')question=message.content
    return publicMessage(message,{question})
  })
}
export function publicMessage(message,{question}={}) {
  if (!message || message.role === 'user') return message
  const { id, role, createdAt, status, model, reasoningEffort, usage } = message
  const seen=new Set(),artifacts=message.artifactsPending?[]:selectedArtifacts(message.artifacts||[],question).map(artifact=>publicArtifact(artifact,{question})).filter(artifact=>{if(!artifact)return false;const key=artifactKey(artifact);if(seen.has(key))return false;seen.add(key);return true})
  const dataAnswer=question!==undefined&&status==='complete'&&artifacts.some(artifact=>artifact.purpose)&&!narrativeRequested(question)
  const content=dataAnswer?'':publicText(message.content,{tables:artifacts,question})
  const cited=new Set([...String(content||'').matchAll(/\[(S\d+)\]/g)].map(match=>match[1]))
  const usedSources=new Set([...cited,...artifacts.flatMap(artifact=>artifact.sources.map(source=>source.id))])
  const error=/达到.*轮工具调用上限|使用.*\/goal/.test(message.error||'')?'这次回答未完成，可以直接重试原问题':publicText(message.error)
  return { id, role, createdAt, status, model, reasoningEffort, usage, content, progress: publicText(message.progress), error, tools: (message.tools || []).map(publicTool), activity:(message.activity||[]).map(publicActivity), artifacts,...(message.files?.length?{files:message.files.map(({id,name,format,depth,count,createdAt})=>({id,name,format,depth,count,createdAt}))}:{}), sources: (message.sources || []).filter(source=>!usedSources.size||usedSources.has(source.id)).map(publicSource) }
}
export function publicGoal(goal) {
  if (!goal) return null
  const { id, objective, status, createdAt, updatedAt, completedAt, pauseReason } = goal
  return { id, objective, status, createdAt, updatedAt, completedAt, pauseReason, error: publicText(goal.error) }
}

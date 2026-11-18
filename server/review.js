import {ordinalColumn,mentorRanking} from '../lib/presentation.js'
import {requestedExclusions} from '../lib/answer-policy.js'
export const requestedSampleComparison=question=>/\b0\d{5}\b/.test(question)&&/历史|样本/.test(question)&&/导师|老师/.test(question)&&/推荐|比较|对比|挑|选/.test(question)&&!/(?:不看|不比较|不用|无需)[^，。！？\n]{0,8}(?:历史|样本)/.test(question)
// Validate concrete delivery contracts; recommendation quality remains the Agent's judgement.
function rosterIssues(answer,assistant,data) {
  const names=new Set(assistant.tools.filter(tool=>tool.status==='complete'&&tool.name==='query'&&tool.args?.from==='mentors').flatMap(tool=>(tool.args.filters||[]).filter(filter=>filter.field==='name'&&['eq','in'].includes(filter.op)).flatMap(filter=>Array.isArray(filter.value)?filter.value:[filter.value])))
  if(names.size!==1)return []
  const candidates=data.mentors.filter(row=>names.has(row.name))
  if(candidates.length!==1)return []
  const mentor=candidates[0]
  if(mentor.student_count==null)return []
  const issues=[]
  for(const paragraph of answer.split(/\n\s*\n/)) {
    // Program/cohort-specific figures are checked against their query chain, not all-program mentor totals.
    const scope=paragraph.replace(/全(?:部)?专业/g,'')
    if(/\b0[0-9]{5}\b|专业|分数段|分数区间|学硕|专硕|学博|专博/.test(scope))continue
    if(data.mentors.some(row=>row.name!==mentor.name&&paragraph.includes(row.name)))continue
    for(const match of paragraph.matchAll(/(考研|统考|保研|推免)(?:学生|同学|生|人数)?[为是共计有：:\s]*(\d+)\s*(?:人|名(?!额)|位|(?=[，。；、\n]|$))/g)) {
      const actual=Number(match[2]),expected=/考研|统考/.test(match[1])?mentor.exam_count:mentor.recommended_count
      if(actual!==expected)issues.push(`${mentor.name}全专业名册中${match[1]}为${expected}人，正文写成${actual}人；请按名册更正。若确实使用限定专业或分数段，须明确说明范围并依据对应查询。`)
    }
  }
  return [...new Set(issues)].slice(0,4)
}

function delegationIssues(assistant,data){
  const names=[...new Set(data.mentors.map(row=>row.name))].sort((a,b)=>b.length-a.length).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))
  const relation=new RegExp(`(?:交给|交由|由)\\s*(${names.join('|')})(?:老师|教授)?(?:提供|负责)?(?:论文|日常)?(?:指导|培养|带)`,'g'),issues=[]
  for(const table of assistant.artifacts)for(const [index,note] of (table.row_notes||[]).entries()){
    const row=table.rows[index],matches=data.mentors.filter(mentor=>row.mentor_id?mentor.mentor_id===row.mentor_id:mentor.name===(row.name||row.mentor_name)&&(!row.college||mentor.college===row.college))
    if(matches.length!==1||!note)continue
    const mentor=matches[0],support=JSON.stringify([mentor.review_text,mentor.mentor_note,mentor.group_context,...data.profiles.filter(profile=>profile.mentor_id===mentor.mentor_id)])
    for(const match of note.matchAll(relation)){
      if(/(?:不|不是|不再|并非)$/.test(note.slice(0,match.index))||match[1]===mentor.name||support.includes(match[1]))continue
      issues.push(`${mentor.name}的说明写成由${match[1]}指导，但这不是该导师个人或适用团队中的带教关系。请核对姓名，别把另一位老师的个人情况套过来；只修正该行说明，若选错了人再更换人选。`)
    }
  }
  return [...new Set(issues)].slice(0,3)
}


export function requestedMentorCount(question,history=[]) {
  if(/方案|清单|模板|候选库|个人记录/.test(question)&&!/(?:[\d一二三四五六七八九十两]+\s*[位名个]\s*(?:导师|老师)|(?:推荐|挑选|选出)[^。！？]{0,20}(?:导师|老师))/.test(question))return null
  if(/收藏|加入(?:候选|清单)|保存(?:方案|清单|模板)|备注|联系进度/.test(question)&&(/刚才|这些|上述|这几位|(?:把|将)/.test(question)||!/推荐|挑选|选出|排名/.test(question)))return null
  if(/劳务|补助|补贴|待遇/.test(question)&&!/推荐|适合|挑选|最好的|值得联系/.test(question))return null
  if(/邮件|起草|润色|翻译|这\s*\d+\s*位[中里]|第\s*[一二三四五六七八九十\d]+\s*位|(?:前|top)\s*\d+.{0,8}(?:中|里)/i.test(question))return null
  const narrative=question.search(/解释|介绍/),selection=question.search(/推荐|选出|挑选|比较|对比|排名/)
  if(narrative>=0&&(selection<0||selection>narrative)&&!/(?:请|再|帮我|给我)(?:推荐|选出|挑选|比较|对比)/.test(question))return null
  if(/其中|刚才|上述|这几位/.test(question)&&!/推荐|挑选|选出|只留|留下|对比|比较|排名|排行/.test(question))return null
  const teacherContext=history.some(text=>/导师|老师/.test(text))
  if(teacherContext&&/^(?:对了|补充|我更希望|更希望|我更看重|更看重|不考虑|只考虑|只看)/.test(question)){
    for(let i=history.length-1;i>=0;i--){const prior=/只留|留下|收窄|缩小|最值得.*联系/.test(history[i])?`推荐导师：${history[i]}`:history[i];const previous=requestedMentorCount(prior);if(previous)return previous}
  }
  if(teacherContext&&/只留|留下|收窄|缩小|最值得.*联系/.test(question))question=`推荐导师：${question}`
  if(!/导师|老师|推荐|挑选|选出/.test(question))return null
  if(/学生|考生|同学/.test(question)&&!/(?:推荐|挑选|选出)[^。！？\n]{0,20}(?:导师|老师)|(?:导师|老师)[^。！？\n]{0,20}(?:推荐|挑选)/.test(question))return null
  if(!/推荐|排名|排行|挑|选|比较|对比|值得.*(?:了解|联系)|最好|哪些(?:导师|老师)|(?:给我|需要|想找)\s*[\d一二三四五六七八九十两]+\s*[位名个]\s*(?:导师|老师)|前\s*\d|top/i.test(question))return null
  const number='[\\d一二三四五六七八九十两]+'
  const nonPersonFollow=/^(?:[些下起般点批并致定流览直样共同边面块]|部分|系列|\s*[位名个人]?(?:学院|学校|专业|类别|分类|组|类|(?:柱状|折线|散点|可视化|对比|比较)?图(?:表)?|模型|项目|问题|窗口|学生|考生|同学|年|月))/
  const personCount=match=>question[match.index-1]!=='第'&&!nonPersonFollow.test(question.slice(match.index+match[0].length))
  const each=question.match(new RegExp(`(?:每(?:个|一)?(?:学院|院|类|组|方向)|各(?:个)?(?:学院|院|类|组|方向)|各|分别)(?:推荐|选出|选|取|给|要|挑|各|\\s)*(${number})\\s*[位名个人]?`))
  const validEach=each&&personCount(each)?each:null
  const candidates=[...question.matchAll(new RegExp(`(${number})\\s*[位名个人]`,'g')),...question.matchAll(new RegExp(`(?:前|top)\\s*(${number})`,'gi'))].filter(personCount).sort((a,b)=>a.index-b.index)
  const match=validEach||candidates.at(-1)
  const separateRoutes=/就业|找工作/.test(question)&&/读博|深造/.test(question)&&/分别|各自|两类|两组|一类|如果[\s\S]*如果|(?:就业|找工作)[^？?]*[？?][\s\S]*(?:读博|深造)/.test(question)
  if(!match&&/图表|可视化|柱状图|折线图|散点图/.test(question)&&!/导师|老师|候选/.test(question))return null
  if(!match)return requestedExclusions(question)||/全部|所有|完整|都列|都给|全给|多少/.test(question)?null:{count:5,maximum:true,default:true,...(/每(?:个|一)?(?:学院|院|类|组|方向)|各(?:学院|院)|两类|两组|各推荐|各自推荐/.test(question)||separateRoutes?{perGroup:true}:{}),...(separateRoutes?{groups:2}:{})}
  function numeric(text){
    const value=Number(text)
    if(Number.isFinite(value))return value
    const digits={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9}
    const [tens,ones]=text.split('十');return ones===undefined?digits[tens]:(digits[tens]||1)*10+(digits[ones]||0)
  }
  const count=numeric(match[1]),groups=question.match(new RegExp(`分(?:成|为)?\\s*(${number})\\s*[类组]`))
  return count?{count,maximum:/最多|至多|不超过|以内/.test(question),...(validEach?{perGroup:true}:{}),...(groups?{groups:numeric(groups[1])}:separateRoutes?{groups:2}:{})}:null
}

export async function reviewAnswer({chat,assistant,answer,data}) {
  const issues=[...rosterIssues(answer,assistant,data),...delegationIssues(assistant,data)]
  const question=chat.latestUserText||chat.messages.findLast(message=>message.role==='user')?.content||''
  const requested=requestedMentorCount(question,chat.messages.filter(message=>message.role==='user').slice(0,-1).map(message=>message.content))
  const personTables=assistant.artifacts.filter(artifact=>artifact.type==='table'&&artifact.columns.some(column=>column.key==='name')&&!artifact.columns.some(column=>column.key==='student_name'))
  const ranked=assistant.artifacts.filter(mentorRanking)
  const comparisons=personTables.filter(table=>table.purpose!=='statistics')
  if(requested&&assistant.artifacts.some(table=>table.row_notes?.some(note=>/(?:资料|记录|信息|记载|证据).{0,8}(?:较少|不足|缺乏|缺失|暂无|未提供)/.test(note))))issues.push('逐人推荐理由将资料或记录较少推成了导师缺点。请visualize用replace仅修正该行row_notes，直接保留已有的方向、指导与项目事实，删去对记录缺项的评价，不改变其他行和已选人数。')
  const selectionIntent=/推荐|挑选|选出|排名|排行|最好|值得.*(?:了解|联系)/.test(question)
  const fallback=personTables.length?personTables:assistant.artifacts.filter(artifact=>artifact.type==='table'&&artifact.rows.some(row=>row.mentor_name)&&!artifact.columns.some(column=>column.key==='student_name'))
  const tables=ranked.length?ranked:comparisons.length?comparisons:fallback.filter(table=>!selectionIntent||table.purpose!=='statistics')
  const programCodes=[...new Set(question.match(/\b0\d{5}\b/g)||[])]
  if(requested&&tables.length&&/考研|统考/.test(question)&&/保研|推免/.test(question)&&/人数|多少|总数|构成/.test(question)){
    const selected=tables.flatMap(table=>table.rows)
    const recorded=selected.some(row=>data.mentors.some(mentor=>mentor.name===(row.name||row.mentor_name)&&(!row.college||mentor.college===row.college)&&mentor.student_count!=null))
    const metrics=[['student_count',/总人数|总数|学生人数|名册人数/,'总人数'],['exam_count',/考研|统考/,'考研人数'],['recommended_count',/保研|推免/,'保研人数']]
    const missing=recorded?metrics.filter(([key,pattern])=>!assistant.artifacts.some(table=>table.columns.some(column=>column.key===key||pattern.test(column.label||column.key)))).map(([, ,label])=>label):[]
    if(missing.length)issues.push(`用户要求的招生构成尚缺${missing.join('、')}。请为已选导师补齐实际名册总人数、考研人数与保研人数，可追加统计表；限定专业时从students筛选并aggregate，展示全专业背景时明确标注全专业。保留已经完成的推荐与培养条件表，不用统计表替代它。`)
  }

  if(requestedSampleComparison(question)&&programCodes.length===1){
    const code=programCodes[0],names=new Set(data.exams.filter(row=>row.program_code===code).map(row=>row.program))
    if(assistant.artifacts.some(table=>table.columns.some(column=>/^(score_first|初试分|初试分数|初试分数列表)$/.test(column.key))&&table.rows.some(row=>row.program_code&&row.program_code!==code||row.program&&names.size&&!names.has(row.program))))issues.push(`历史样本混入了其他专业。请从exams按program_code等于${code}筛选并替换样本表，保留本题其他筛选条件。`)
  }

  const hasTraining=assistant.tools.some(tool=>tool.status==='complete'&&tool.name==='search'&&tool.result?.returned>0)
  const doctoral= /博士|申博|读博/.test(question)
  const doctoralApplication=/(?:^|[，,。！？\n])(?:我)?(?:现在|正在|直接)(?:直接|准备)?(?:申请|报考|攻读)博士/.test(question)
  if(doctoral){
    const hasInvalidNote=note=>doctoralApplication?(/学硕|专硕|硕士/.test(note)||!/实习/.test(question)&&/实习/.test(note)):(/(?:学硕|专硕|硕士)[^；。！？\n]{0,16}(?:要求|毕业|论文|小论文|SCI|EI|CCF|专利|可不发|不额外|达到|实习)/.test(note)||!/实习/.test(question)&&/实习/.test(note))
    const badTable=assistant.artifacts.filter(table=>doctoralApplication||!/硕士|学硕|专硕/.test(table.title)&&/博士|博导/.test(table.title)).find(table=>table.row_notes?.some(hasInvalidNote))
    if(badTable){
      const badIndex=badTable.row_notes.findIndex(hasInvalidNote)
      issues.push(`本题选择博士导师，「${badTable.title}」第${badIndex+1}行（${badTable.rows[badIndex]?.name||'对应记录'}）的逐行要点仍混入硕士培养要求或未询问的实习限制。请visualize用replace仅修正该表的row_notes，删除整个无关条件，不得只去掉学硕/专硕称谓而保留其毕业要求；保留真实方向、指导投入与项目资源，已选人数和其他数据不变。`)
    }
  }
  if(/带学生|指导(?:方式|情况)|培养方式|项目资源/.test(question)&&hasTraining&&personTables.length>0&&!assistant.artifacts.some(table=>table.columns.some(column=>['training_evidence','review_text','group_context','mentor_note','projects'].includes(column.key))))issues.push('用户明确要看指导或项目资源，search提供training_evidence（培养与项目记录），现有导师表尚未展示此维度。请补齐该表相应字段并replace原表；直接介绍个人且没有表格时无需制表。')
  if(chat.messages.some(message=>message.role==='user'&&/样本数|样本数量/.test(message.content))){
    const sampleColumns=assistant.tools.filter(tool=>tool.status==='complete'&&tool.name==='aggregate'&&tool.args.group_by?.some(key=>['name','mentor_name','mentor_id'].includes(key))&&tool.args.metrics.some(metric=>metric.field==='score_first')).flatMap(tool=>tool.args.metrics.filter(metric=>metric.op==='count'||metric.op==='values'&&metric.field==='score_first').map(metric=>metric.as))
    if(sampleColumns.length&&sampleColumns.some(key=>!assistant.artifacts.some(table=>table.columns.some(column=>column.key===key))))issues.push(`已计算的导师样本指标（${[...new Set(sampleColumns)].join('、')}）尚未完整展示。请直接visualize对应统计ref，purpose为statistics，保留导师名、样本数和初试范围；可追加统计表，不要返回原始mentors表丢掉这些指标。`)
  }
  if(requested){
    const identity=row=>`${row.college||''}:${row.name||row.mentor_name}`
    const names=new Set(tables.flatMap(table=>table.rows.map(identity)))
    const pools=assistant.tools.filter(tool=>tool.status==='complete'&&['query','search'].includes(tool.name)&&(tool.name==='search'||tool.args?.from==='mentors')&&!(tool.args?.filters||[]).some(filter=>['name','mentor_id'].includes(filter.field))).map(tool=>tool.result?.total).filter(Number.isFinite)
    const available=pools.length?Math.max(...pools):data.mentors.length
    const expected=Math.min(requested.count,available),counts=tables.map(table=>new Set(table.rows.map(identity)).size)
    const namedCharts=assistant.artifacts.some(artifact=>artifact.columns?.some(column=>['name','mentor_name'].includes(column.key))&&artifact.rows?.length)
    if(!tables.length&&requested.default&&namedCharts){/* An unspecified "some mentors" request is satisfied by a real named chart. */}
    else if(!tables.length)issues.push(`当前没有可展示的导师名单。用户要${requested.perGroup?'每类':'合计'}${requested.count}位${requested.groups?`、分${requested.groups}类`:''}。请先完成真实查询和visualize；不能以“未满${requested.count}位”代替整份名单。`)
    else if(requested.perGroup){
      if(!requested.default&&counts.some(count=>count>requested.count||!requested.maximum&&count<expected))issues.push(`本轮每类${requested.maximum?'最多':'需要'}${requested.count}位，当前各类实际${counts.join('、')}位。${requested.maximum?'只保留最贴合的候选，不为凑人数纳入不匹配者。':`候选足够时分别补齐至${expected}位，不能仅在正文声称人数已齐。`}`)
    }else if(!requested.default&&(names.size>requested.count||!requested.maximum&&names.size<expected))issues.push(`本轮合计${requested.maximum?'最多':'需要'}${requested.count}位，当前表实际${names.size}位。${requested.maximum?'只保留最贴合的候选，不为凑人数纳入不匹配者。':`分类不把人数翻倍；候选足够时补齐至${expected}位，按适合方向分配，先完成真实名单。`}`)
    if(requested.groups&&(!requested.perGroup||/不同导师|不同的导师|不重复/.test(question))&&counts.reduce((sum,count)=>sum+count,0)>names.size){
      const occurrences=new Map()
      tables.forEach(table=>table.rows.forEach(row=>{const key=identity(row);if(!occurrences.has(key))occurrences.set(key,{name:row.name||row.mentor_name,titles:new Set()});occurrences.get(key).titles.add(table.title)}))
      const duplicates=[...occurrences.values()].filter(item=>item.titles.size>1).map(item=>`${item.name}（${[...item.titles].join(' / ')}）`)
      issues.push(`分类名单重复：${duplicates.join('、')}。每人只保留在最适合的一类，其余位置补入新导师。更换人选须visualize使用from:"mentors"或含新人的完整候选ref、pick传更新后的整份名单、replace指向原表；不要只改row_notes或从旧名单窄ref找新人。未变行的说明自动保留，只需提供变动行说明。`)
    }
    if(requested.groups&&tables.length&&tables.length!==requested.groups)issues.push(`用户要求分${requested.groups}类，当前实际${tables.length}类。请按所需类别生成名单，标题使用简短类别名。`)
  }
  const sequenceKeys=new Set(assistant.tools.map(tool=>tool.args?.row_number_as).filter(Boolean))
  if(requested&&/排名|排行|top\s*\d|前\s*\d/i.test(question)&&tables.some(table=>!table.columns.some(column=>sequenceKeys.has(column.key)||ordinalColumn(column))))issues.push('每张排名表都需要名次列。query用sort.values保留选定顺序，row_number_as:"推荐序"自动生成并保留编号，然后visualize。')
  return {ok:issues.length===0,issues}
}

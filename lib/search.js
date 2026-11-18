import {createHash} from 'node:crypto'
import {mentorInsight,FLAGSHIP_ACADEMIC_RE,TOP_PUBLICATION_RE,NATIONAL_PROJECT_RE,nameVariants,homophoneMatches} from './insights.js'
export {nameVariants,homophoneMatches}
const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu,'')
const RESEARCH_TOPIC={names:['读博','深造','读博深造','博士深造','科研深造','学术深造','继续深造','继续读博','博士导师','申博','博士申请','硕博连读','PhD','PhD preparation','doctoral studies','科研','学术研究','学术训练','科研训练','研究培养','论文指导'],aliases:['论文指导','科研指导','学术指导','研究训练','学术训练','学术培养','偏学术','学术路线','理论研究','科研项目','科研成果','研究成果','国家自然科学基金','国家重点研发','基础研究','博士生导师','博/硕士生导师','硕博导师','指导学博学科','指导专博学科','继续读博','学术深造','首席科学家','顶会','顶刊','高水平论文','发表SCI']}
const CAREER_TOPIC={names:['就业','找工作','毕业就业','毕业工作','就业工作','工作导向','求职','就业导向','硕士就业','只读硕士','专硕','去大厂','互联网就业','实习就业','工程就业'],aliases:['可以实习','可实习','允许实习','放实习','自由实习','提前实习','外出实习','研二上可实习','研二下可实习','研二下学期可以实习','研一可实习','不打卡','不要求坐班','无需坐班','无需打卡','时间自由','管理宽松','不要求SCI','不要求发表SCI','不额外要求论文','不卡论文','专硕可以不发表论文','专硕不额外要求论文','偏工程','工程实践','工程开发','企业项目','横向','企业合作','项目资源丰富','项目丰富','经费充足','就业','去向较好','大厂','互联网','offer']}
const topics=[
  {names:['人工智能安全','AI安全','AI security'],aliases:['人工智能安全','AI安全','AI security','AI/数据安全','大模型安全','大模型及其安全','LLM security','LLM safety','机器学习安全','对抗机器学习']},
  {names:['大模型安全','大模型及其安全','LLM security','LLM safety','large language model security'],aliases:['大模型安全','大模型及其安全','LLM security','LLM safety','large language model security']},
  {names:['网络安全','网安','网络空间安全','信息安全','网络与信息安全','cybersecurity','cyber security'],aliases:['网络安全','网络空间安全','网络与信息安全','信息安全','网络攻防','网络武器','漏洞挖掘','渗透测试','逆向','固件安全','系统安全','密码学','通信安全','5G安全','6G安全','无线通信安全','无人机安全','物联网安全','车联网安全','大模型安全','大模型及其安全','AI安全','人工智能安全','数据安全','云安全','灾备','内容安全','多媒体安全','信息隐藏','流量分析','加密流量','威胁检测','威胁狩猎','恶意代码','隐私计算','可信计算','区块链安全','移动安全','安全博弈']},
  {names:['逆向','逆向工程','reverse engineering'],aliases:['逆向','逆向工程','reverse engineering']},
  {names:['自然语言处理','NLP','natural language processing'],aliases:['自然语言处理','NLP','natural language processing']},
  {names:['计算机视觉','CV','computer vision'],aliases:['计算机视觉','CV','computer vision']},
  {names:['横向','横向项目','企业合作','工程实践'],aliases:['横向','企业合作','校企合作','产学研','工程实践','工程项目','偏工程','工程开发','项目练手','项目资源丰富','项目丰富','资源充足','经费充足','项目很多','项目多','项目数量多','资源较足','工程和理论研究都有','工程与理论研究并行']},
  {names:['纵向','纵向项目','纵向课题'],aliases:['纵向','国家自然科学基金','国自然','国家级项目','国家重点研发','国家重大专项','基础研究','偏学术','学术路线','理论研究']},
  CAREER_TOPIC,
  RESEARCH_TOPIC,
]
const RESEARCH_NAMES=new Set(RESEARCH_TOPIC.names.map(normalize))
const CAREER_NAMES=new Set(CAREER_TOPIC.names.map(normalize))
const aliases=term=>{
  const normalized=normalize(term),topic=topics.find(topic=>topic.names.some(name=>normalize(name)===normalized))
  return [...new Set((topic?.aliases||[term]).map(normalize))]
}
function excerpt(document,groups) {
  const text=document.text.normalize('NFKC')
  if(text.length<=320)return text
  const patterns=groups.flat().map(term=>[...term].map(char=>char.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*'))
  const match=text.search(new RegExp(patterns.join('|'),'iu')),start=Math.max(0,match-80),end=start+320
  return `${start?'…':''}${text.slice(start,end)}${end<text.length?'…':''}`
}

function leadership(mentor,members) {
  const surname=mentor.name.slice(0,1),names=[mentor.name]
  if(members.filter(member=>member.name.startsWith(surname)).length===1)names.push(`${surname}老师`,`${surname}教授`)
  const rawClauses=(mentor.group_context||'').split(/[；;。！？\n]/).map(clause=>clause.trim()).filter(Boolean)
  const clauses=rawClauses.flatMap(clause=>clause.split(/[，,]/)).map(clause=>clause.trim()).filter(Boolean)
  const escaped=names.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')
  const posRe=new RegExp(`(?:${escaped})[^，,；;。]{0,6}?(?:负责(?:具体|日常)?(?:(?:小?组|团队|课题组|实验室)(?:内)?)?(?:管理|工作)|(?:小?组|团队|实验室)(?:负责人|带头人))|由\\s*(?:${escaped})\\s*统一(?:指导|带|管理|培养)`)
  const negPhrase=/不(?:负责|参与|介入)(?:具体(?:的)?)?(?:(?:小?组|团队|课题组|实验室)(?:内)?(?:管理|事务)|组务)|已不直接带学生|不直接带学生|(?:自行|亲自)指导(?:的情况)?较少/
  const negRe=new RegExp(`(?:${escaped})[^，,；;。]{0,12}(?:${negPhrase.source})`)
  const otherNames=members.map(member=>member.name).filter(name=>name!==mentor.name)
  const positive=clauses.find(clause=>!/不负责|不参与|不带学生|不直接带学生|自行指导较少/.test(clause)&&posRe.test(clause))
  const negative=clauses.some(clause=>negRe.test(clause))||rawClauses.some(clause=>names.some(name=>clause.includes(name))&&!otherNames.some(name=>clause.includes(name))&&negPhrase.test(clause))
  return {value:positive?true:negative?false:null,text:positive?.replace(/^-\s*/,'').trim()||null}
}
function doctoralEvidence(profiles) {
  for(const profile of profiles) {
    if(/博士生导师|博导/.test(profile.supervisor_type||''))return {text:profile.supervisor_type,source_ids:profile.source_ids||[]}
    const guidance=(profile.admissions||'').split('\n').find(line=>/指导(?:学博|专博)学科\s*[:：]\s*\S/.test(line))
    if(guidance)return {text:guidance,source_ids:profile.source_ids||[]}
    const intro=(profile.biography||'').split(/[。\n]/)[0],role=intro.search(/博士生导师|博导/)
    if(role>=0&&intro.includes(profile.name)&&!/师从|导师为|导师是|团队|课题组/.test(intro.slice(0,role)))return {text:intro,source_ids:profile.source_ids||[]}
  }
  return null
}

function buildAcademicSummary({mentor,profiles,lead}) {
  const title=profiles.map(p=>p.professional_title).find(Boolean)||null
  const roleParts=[]
  if(title)roleParts.push(title)
  if(lead.value===true)roleParts.push(`${mentor.group?mentor.group:'团队'}负责人`)
  const seen=new Set(),profileSentences=[]
  for(const profile of profiles) {
    for(const field of ['biography','achievements','projects']) {
      const clauses=String(profile[field]||'').split(/[。\n；;]/).flatMap(part=>part.length>110?part.split(/[，,](?=(?:在[A-Z]|发表|主持|牵头|作为|获|入选|长期从事|主要研究|申请))/):[part])
      for(const raw of clauses) {
        const line=raw.replace(/\s+/g,' ').trim()
        if(line.length<8||/^\s*(?:(?:代表性)?(?:科研|研究)?成果[：:]\s*)?(?:\[\d+\]|\(\d+\)|\d+[.、）)])|^\s*(?:https?:\/\/|【[^】]+】$)/.test(line))continue
        const norm=normalize(line)
        if(seen.has(norm))continue
        seen.add(norm)
        const signal=(FLAGSHIP_ACADEMIC_RE.test(line)?5:0)+(TOP_PUBLICATION_RE.test(line)?4:0)+(NATIONAL_PROJECT_RE.test(line)?3:0)+(/发表.*(?:SCI|论文|专利)|主持.*(?:项目|课题|基金)|主要研究|长期从事|研究方向/.test(line)?2:0)+(/博士生导师|博导|研究员|教授|副教授|获奖|科技进步|一等奖|二等奖/.test(line)?1:0)
        if(signal>0)profileSentences.push({line,signal})
      }
    }
  }
  profileSentences.sort((a,b)=>b.signal-a.signal)
  const picked=profileSentences.slice(0,2).map(item=>item.line.length>125?item.line.slice(0,124)+'…':item.line)
  const membersClause=/培养定位|培养方式|资源与指导|个人情况|共同培养|项目资源|整体实力|已不直接带学生|不直接带学生|挂名|导师本人没有研究项目|学术研究较少|刚到北邮任教|新入职教师/
  const cultSources=[mentor.mentor_note,mentor.review_text,mentor.group_context].filter(Boolean).join('\n').split(/[。\n；;]/)
  const cult=cultSources.map(s=>s.trim()).find(s=>membersClause.test(s)&&!/^研究方向[：:]/.test(s))
  const parts=[roleParts.join('、'),...picked,cult?(cult.length>75?cult.slice(0,74)+'…':cult):null].filter(Boolean)
  if(!parts.length)return null
  const joined=parts.join('；')
  return joined.length>290?joined.slice(0,289)+'…':joined
}

function stripNegatedRouteClauses(text) {
  return String(text||'')
    .replace(/不允许[^，。；;\n]{0,12}实习|禁止实习|限制实习/g,' ')
    .replace(/(?:没有|缺少|无)(?:科研|研究)项目|科研项目压力不大|学术研究较少|与个人科研关联不大/g,' ')
}

function buildEnrollmentSignal({mentor,exams,isCollegeTopCount}) {
  if(mentor.student_count==null||mentor.student_count<=0)return null
  const parts=[`2026全专业名册${mentor.student_count}人（保研${mentor.recommended_count??0}、考研${mentor.exam_count??0}）`]
  if(isCollegeTopCount&&mentor.student_count>=8)parts.push('名册规模居全院第1')
  else if(mentor.student_count>=8)parts.push('招生规模居全院前列')
  const bestExam=[...exams].filter(exam=>exam.rank_first!=null).sort((a,b)=>a.rank_first-b.rank_first||(b.score_first||0)-(a.score_first||0))[0]
  if(bestExam?.rank_first===1)parts.push(`含全院初试第1名（${bestExam.score_first}分${mentor.exam_count>1&&mentor.score_first_mean!=null?`，考研均分${mentor.score_first_mean}`:''}）`)
  else if(bestExam?.rank_first<=10)parts.push(`含全院初试第${bestExam.rank_first}名（最高${bestExam.score_first}分${mentor.exam_count>1&&mentor.score_first_mean!=null?`，均分${mentor.score_first_mean}`:''}）`)
  else if(mentor.score_first_max!=null)parts.push(`考研初试最高${mentor.score_first_max}分${mentor.exam_count>1&&mentor.score_first_mean!=null?`（均分${mentor.score_first_mean}）`:''}`)
  return parts.join('，')
}

export function createMentorIndex(data) {
  const identity=row=>row.mentor_id||`${row.college||''}:${row.name}`
  const people=new Map((data.mentors||[]).map(mentor=>[identity(mentor),{mentor,profiles:[]}]))
  for(const profile of data.profiles||[]) {
    const college=data.metadata?.colleges?.find(name=>profile.college?.startsWith(name+'（')||profile.college?.startsWith(name+'('))||profile.college
    const key=identity({...profile,college})
    if(!people.has(key))people.set(key,{mentor:{mentor_id:profile.mentor_id||null,name:profile.name,college,group:null,personal_directions:null,rating:null,source_ids:[]},profiles:[]})
    people.get(key).profiles.push(profile)
  }
  const collegeTopStudentCount=new Map()
  for(const mentor of data.mentors||[]) {
    if(mentor.student_count>0&&mentor.college){
      const prev=collegeTopStudentCount.get(mentor.college)||0
      if(mentor.student_count>prev)collegeTopStudentCount.set(mentor.college,mentor.student_count)
    }
  }
  const examsByMentor=new Map()
  for(const exam of data.exams||[]) {
    if(!exam.mentor_id)continue
    if(!examsByMentor.has(exam.mentor_id))examsByMentor.set(exam.mentor_id,[])
    examsByMentor.get(exam.mentor_id).push(exam)
  }
  const allNames=[...new Set((data.mentors||[]).map(mentor=>mentor.name))]
  const index=[...people.values()].map(({mentor,profiles})=>{
    const documents=[]
    const doctoral=doctoralEvidence(profiles)
    const mentorExams=mentor.mentor_id?(examsByMentor.get(mentor.mentor_id)||[]):[]
    const bestExam=[...mentorExams].filter(exam=>exam.rank_first!=null).sort((a,b)=>a.rank_first-b.rank_first)[0]||null
    const topExamRank=bestExam?.rank_first??null
    const enrollmentSignal=buildEnrollmentSignal({mentor,exams:mentorExams,isCollegeTopCount:Boolean(mentor.college&&mentor.student_count!=null&&mentor.student_count===collegeTopStudentCount.get(mentor.college))})
    const add=(label,text,weight,scope,ids)=>{if(text)documents.push({label,text,normalized:normalize(text),routeNormalized:normalize(stripNegatedRouteClauses(text)),weight,scope,source_ids:ids||[]})}
    const namesForSearch=[mentor.name,...nameVariants(mentor.name)].join(' ')
    add('导师姓名',namesForSearch,8,'个人',mentor.source_ids)
    add('个人研究方向',mentor.personal_directions,6,'个人',mentor.source_ids)
    add('导师评价',mentor.mentor_note,6,'个人',mentor.source_ids)
    add('个人培养与科研资料',mentor.review_text,4,'个人资料',mentor.source_ids)
    add('生源与学生选择',enrollmentSignal,3,'个人资料',mentor.source_ids)
    add('团队招生方向',mentor.directions,3,'团队',mentor.source_ids)
    add('组内资料',mentor.group_context,2,'团队资料',mentor.source_ids)
    add('博士指导学科',doctoral?.text,3,'个人资料',doctoral?.source_ids)
    for(const profile of profiles) {
      add('网页研究领域',profile.research_areas,6,'个人',profile.source_ids)
      for(const [field,label]of[['biography','个人简介'],['projects','科研项目'],['achievements','科研成果'],['team_description','公开团队介绍']])add(label,profile[field],4,'个人资料',profile.source_ids)
    }
    const members=(data.mentors||[]).filter(member=>member.group===mentor.group&&member.college===mentor.college)
    const lead=leadership(mentor,members)
    const training=documents.filter(document=>['导师评价','个人培养与科研资料','组内资料','科研项目'].includes(document.label))
    const seenProfileEntries=new Set()
    const profileEvidence=profiles.flatMap(profile=>[['导师类型',profile.supervisor_type],['职称',profile.professional_title],['研究领域',profile.research_areas],['个人简介',profile.biography],['科研项目',profile.projects],['科研成果',profile.achievements],['团队介绍',profile.team_description],['招生与指导学科',profile.admissions]].filter(([,text])=>text).map(([label,text])=>`${profile.source_type||'公开介绍'}·${label}：${text}`)).filter(entry=>{const norm=normalize(entry);if(seenProfileEntries.has(norm))return false;seenProfileEntries.add(norm);return true}).join('\n')||null
    const trainingText=training.map(document=>{
      const text=document.label==='组内资料'?document.text.split('\n').filter(line=>!/^\s*(?:-\s*)?(?:主流方向|研究方向|方向)[：:]/.test(line)).join('\n'):document.text
      return `${document.label}：${text}`
    }).join('\n')||null
    const seenResearchLines=new Set()
    const researchText=documents.filter(document=>document.label!=='导师姓名').flatMap(document=>{
      const text=['网页研究领域','团队招生方向','个人简介','科研项目','科研成果','博士指导学科','生源与学生选择'].includes(document.label)?document.text:document.text.split('\n').filter(line=>/科研|学术|研究|项目|资源|经费|论文|基金|成果|博导|博士|读博|深造/.test(line)).join('\n')
      if(!text)return []
      const entry=`${document.label}：${text}`,norm=normalize(entry)
      if(seenResearchLines.has(norm))return []
      seenResearchLines.add(norm)
      return [entry]
    }).join('\n')||null
    const academicSummary=buildAcademicSummary({mentor,profiles,lead})
    const professionalTitle=profiles.map(profile=>profile.professional_title).find(Boolean)||null
    const researchAreas=profiles.map(profile=>profile.research_areas).find(Boolean)||null
    const base={...mentor,professional_title:professionalTitle,research_areas:researchAreas,can_supervise_doctoral:doctoral?true:null,doctoral_evidence:doctoral?.text||null,group_lead:lead.value,profile_evidence:profileEvidence,academic_summary:academicSummary,enrollment_signal:enrollmentSignal}
    const insight=mentorInsight(base,allNames),labels=tone=>insight.flags.filter(flag=>flag.tone===tone).map(flag=>flag.label).join('、')||null
    const row={...base,green_flags:labels('good'),red_flags:labels('bad'),watch_flags:labels('note'),actual_supervisor:insight.supervisor?.name||null,research_evidence:researchText,training_evidence:trainingText,source_ids:[...new Set([...(mentor.source_ids||[]),...profiles.flatMap(profile=>profile.source_ids||[])])]}
    return {mentor:row,documents,lead,doctoral,insight,topExamRank}
  })
  function search(terms,mode='any'){
    const normalizedTerms=terms.map(normalize)
    const isResearchRoute=normalizedTerms.some(term=>RESEARCH_NAMES.has(term)),isCareerRoute=normalizedTerms.some(term=>CAREER_NAMES.has(term))
    const useRouteFilter=isResearchRoute||isCareerRoute
    const groups=terms.map(aliases)
    const labels=new Map([...topics.flatMap(topic=>topic.aliases),...terms].map(term=>[normalize(term),term]))
    const rows=[]
    for(const person of index) {
      const docNorm=doc=>useRouteFilter?doc.routeNormalized:doc.normalized
      const hits=person.documents.filter(document=>groups.some(group=>group.some(term=>docNorm(document).includes(term))))
      if(!hits.length||mode==='all'&&!groups.every(group=>person.documents.some(document=>group.some(term=>docNorm(document).includes(term)))))continue
      const teamHit=hits.some(hit=>hit.scope.startsWith('团队')),leader=person.lead.value===true
      const matchedTopics=[...new Set(groups.flat().filter(term=>hits.some(hit=>docNorm(hit).includes(term))))].map(term=>labels.get(term)||term)
      const sortedHits=hits.toSorted((a,b)=>b.weight-a.weight)
      let score=sortedHits[0].weight+sortedHits.slice(1,4).reduce((sum,hit)=>sum+hit.weight*0.3,0)+(teamHit&&leader?6:0)
      const r=person.mentor.rating,fp=person.insight.fingerprint
      const inactive=/已不直接带学生|不直接带学生|作为挂名导师/.test([person.mentor.review_text,person.mentor.group_context].filter(Boolean).join('\n'))
      const studentChoiceBoost=(!person.mentor.actual_supervisor&&!inactive&&(r==null||r>=4))?Math.min(2.4,(person.mentor.recommended_count||0)*0.2+(person.mentor.student_count>=9?0.5:0))+(person.topExamRank===1?2.0:person.topExamRank!=null&&person.topExamRank<=5?1.1:person.topExamRank!=null&&person.topExamRank<=10?0.5:0):0
      if(isResearchRoute&&!isCareerRoute){
        const isNominal=Boolean(person.mentor.actual_supervisor||inactive||/非本人带教/.test(person.mentor.red_flags||''))
        score+=(person.doctoral?3:0)+((fp.research?.value||3)-3)*3.5+(leader?2.5:0)+(r>=4?1.6+r*0.65:r===3?0.4:r!=null?-8:0)+studentChoiceBoost-(person.mentor.actual_supervisor||inactive?8:isNominal?5.5:0)-(/压榨记录|整体不推荐|毕业风险/.test(person.mentor.red_flags||'')?6:0)
      }else if(isCareerRoute&&!isResearchRoute){
        score+=((fp.internship?.value||2.5)-2.5)*2.5+((fp.freedom?.value||2.5)-2.5)*2.0+((fp.funding?.value||2.5)-2.5)*1.6+((fp.guidance?.value||3)-3)*1.8+(/不卡论文/.test(person.mentor.green_flags||'')?2.5:0)+(/资源充足|经费充足|去向不错/.test(person.mentor.green_flags||'')?1.8:0)+studentChoiceBoost*0.35+(r>=4?r*1.2:r===3?0.5:r!=null?-8:0)-(/限制实习|压榨记录|整体不推荐|毕业风险/.test(person.mentor.red_flags||'')?8:0)-(/打卡坐班/.test(person.mentor.red_flags||'')?2.5:0)
      }else{
        score+=(r>=4?1.5+(r-4)*0.4:r===3?0.5:r!=null&&r<=2?-2.5:0)+studentChoiceBoost*0.25+((fp.research?.value||3)>=4.5?0.8:0)+((fp.internship?.value||0)>=4&&!person.mentor.red_flags?0.6:0)
      }
      const contentHits=sortedHits.filter(hit=>hit.label!=='导师姓名')
      const fallbackHits=contentHits.length?contentHits:person.documents.filter(doc=>doc.label!=='导师姓名').toSorted((a,b)=>b.weight-a.weight)
      const evidence=fallbackHits.slice(0,4).map(hit=>`${hit.label}：${excerpt(hit,groups)}`)
      if(teamHit&&leader)evidence.push(`团队分工：${person.lead.text}`)
      if(person.doctoral)evidence.push(`博士指导学科：${person.doctoral.text}`)
      rows.push({score,row:{...person.mentor,candidate_id:`candidate-${createHash('sha256').update(identity(person.mentor)).digest('hex').slice(0,12)}`,matched_topics:matchedTopics.join('、'),topic_basis:[...new Set(hits.map(hit=>hit.scope)),...(teamHit&&leader?['团队负责人']:[])].join('、'),topic_evidence:evidence.join('\n')}})
    }
    return rows.toSorted((a,b)=>b.score-a.score||(b.row.rating??0)-(a.row.rating??0)||a.row.name.localeCompare(b.row.name,'zh-CN')).map(item=>item.row)
  }
  return {rows:index.map(person=>person.mentor),search}
}

export const createMentorSearch=data=>createMentorIndex(data).search

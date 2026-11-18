import {nameVariants} from './insights.js'

const hasFlag=(item,id,allowConditional=true)=>(item.flags||[]).some(f=>f.id===id&&(allowConditional||!f.conditional))
const hasReviewRecord=item=>Boolean(item.rating!=null||item.evidence?.personal||item.evidence?.team)
const directionHaystack=item=>[item.directions,item.academicSummary,item.academic_summary,item.group,item.research_areas,item.personal_directions].filter(Boolean).join(' ')

export const MENTOR_FILTER_GROUPS=[
  {
    id:'conditions',
    label:'培养条件',
    filters:[
      {id:'internship_ok',label:'可以实习',test:item=>hasFlag(item,'internship_ok',false)},
      {id:'no_clock',label:'不打卡',test:item=>hasFlag(item,'no_clock')},
      {id:'free_time',label:'时间自由',test:item=>hasFlag(item,'free_time')},
      {id:'no_paper',label:'不卡论文',test:item=>hasFlag(item,'no_paper')},
      {id:'kind',label:'尊重学生',test:item=>hasFlag(item,'kind')},
      {id:'personal',label:'亲自指导',test:item=>hasFlag(item,'personal')},
      {id:'career',label:'去向不错',test:item=>hasFlag(item,'career')},
      {id:'resources',label:'经费充足',test:item=>hasFlag(item,'resources')},
      {id:'high_pay',label:'补助优厚',test:item=>hasFlag(item,'high_pay')||(item.stipend??item.stipend_monthly_max??item.stipend_monthly_min??0)>=800},
      {id:'holiday',label:'正常放假',test:item=>hasFlag(item,'holiday')},
      {id:'student_choice',label:'高分生源青睐',test:item=>hasFlag(item,'student_choice')},
    ],
  },
  {
    id:'qualifications',
    label:'口碑资质',
    filters:[
      {id:'doctoral',label:'博导',test:item=>Boolean(item.doctoral||item.can_supervise_doctoral)},
      {id:'full_prof',label:'教授/研究员',test:item=>/(?:^|[^副助理])(?:教授|研究员)/.test(item.title||item.professional_title||'')},
      {id:'assoc_prof',label:'副教授',test:item=>/副教授|副研究员/.test(item.title||item.professional_title||'')},
      {id:'zero_risk',label:'零负面评价',test:item=>hasReviewRecord(item)&&!(item.flags||[]).some(f=>f.tone==='bad')},
      {id:'non_nominal',label:'非挂名带教',test:item=>hasReviewRecord(item)&&!hasFlag(item,'nominal')},
      {id:'rating_4',label:'评分 ≥ 4',test:item=>(item.rating??0)>=4},
      {id:'rating_5',label:'满分 5 分',test:item=>item.rating===5},
      {id:'has_review',label:'有学生实评',test:item=>hasReviewRecord(item)},
      {id:'engineering',label:'偏工程',test:item=>hasFlag(item,'engineering')},
      {id:'academic',label:'偏学术',test:item=>hasFlag(item,'academic')},
      {id:'has_email',label:'有公开邮箱',test:item=>Boolean(item.email||item.contact_email)},
    ],
  },
  {
    id:'directions',
    label:'研究方向',
    filters:[
      {id:'dir_llm',label:'大模型',test:item=>/大模型|LLM|大语言模型|多模态|AIGC|生成式/i.test(directionHaystack(item))},
      {id:'dir_6g',label:'6G',test:item=>/6G|无线通信|移动通信|毫米波|太赫兹|MIMO|空天地|卫星通信/i.test(directionHaystack(item))},
      {id:'dir_sec',label:'网络安全',test:item=>/网络安全|攻防|漏洞|渗透|恶意代码|威胁情报|流量分析|内生安全|系统安全/i.test(directionHaystack(item))},
      {id:'dir_crypto',label:'密码学',test:item=>/密码|加密|零知识|量子密码|后量子|认证协议/i.test(directionHaystack(item))},
      {id:'dir_cv',label:'计算机视觉',test:item=>/计算机视觉|图像|视频|目标检测|三维重建|视觉|多模态/i.test(directionHaystack(item))},
      {id:'dir_nlp',label:'自然语言处理',test:item=>/自然语言处理|NLP|文本挖掘|知识图谱|情感分析|机器翻译|语音/i.test(directionHaystack(item))},
      {id:'dir_ai',label:'深度学习与AI',test:item=>/深度学习|机器学习|人工智能|强化学习|联邦学习|神经网络|数据挖掘/i.test(directionHaystack(item))},
      {id:'dir_iot',label:'物联网与边缘',test:item=>/物联网|边缘计算|传感|车联网|工业互联网|嵌入式|智能感知/i.test(directionHaystack(item))},
      {id:'dir_privacy',label:'区块链与隐私',test:item=>/区块链|隐私计算|隐私保护|数据安全|可信计算|联邦/i.test(directionHaystack(item))},
      {id:'dir_sys',label:'云计算与系统',test:item=>/软件工程|云计算|分布式|操作系统|数据库|编译|网络体系|算力网络/i.test(directionHaystack(item))},
    ],
  },
]

export const MENTOR_FILTERS=MENTOR_FILTER_GROUPS.flatMap(g=>g.filters.map(f=>({...f,group:g.id})))
export const MENTOR_FILTER_MAP=new Map(MENTOR_FILTERS.map(f=>[f.id,f]))

export function splitMentorColleges(collegeStr){
  return String(collegeStr||'').split(/[、,，]+/).map(part=>part.replace(/[（(].*$/,'').trim()).filter(Boolean)
}

export function shortCollegeName(college){
  const text=String(college||'').trim()
  return text.length<=3?text:text.replace(/学院$/,'')
}

export function matchesMentorQuery(item,query){
  const raw=String(query||'').trim()
  if(!raw)return true
  const q=raw.toLowerCase()
  if(q==='博导')return Boolean(item.doctoral||item.can_supervise_doctoral)
  const variants=nameVariants(raw).map(v=>v.toLowerCase())
  const lowerName=String(item.name||'').toLowerCase()
  if(lowerName.includes(q)||variants.some(v=>lowerName.includes(v)))return true
  const flagText=(item.flags||[]).map(f=>f.label).join(' ').toLowerCase()
  const hay=[item.college,item.title,item.professional_title,item.group,item.directions,item.academicSummary,item.academic_summary,item.enrollmentSignal,item.enrollment_signal,flagText].filter(Boolean).join(' ').toLowerCase()
  return q.split(/\s+/).every(term=>hay.includes(term))
}

function itemMatchesColleges(item,colleges){
  if(!colleges?.length)return true
  const parts=splitMentorColleges(item.college)
  return colleges.some(target=>item.college===target||parts.includes(target))
}

function splitActiveFilters(filterIds){
  const nonDir=[],dir=[]
  for(const id of filterIds||[]){
    const def=MENTOR_FILTER_MAP.get(id)
    if(!def)continue
    if(def.group==='directions')dir.push(def)
    else nonDir.push(def)
  }
  return {nonDir,dir}
}

export function filterMentors(allMentors,{query='',colleges=[],filters=[],directionMode='and'}={}){
  const {nonDir,dir}=splitActiveFilters(filters)
  return allMentors.filter(item=>{
    if(!itemMatchesColleges(item,colleges))return false
    if(!matchesMentorQuery(item,query))return false
    for(const def of nonDir)if(!def.test(item))return false
    if(dir.length){
      if(directionMode==='or'){if(!dir.some(def=>def.test(item)))return false}
      else{for(const def of dir)if(!def.test(item))return false}
    }
    return true
  })
}

export function computeFacetCounts(allMentors,{query='',colleges=[],filters=[],directionMode='and',collegeList=[]}={}){
  const queryPool=query.trim()?allMentors.filter(item=>matchesMentorQuery(item,query)):allMentors
  const {nonDir,dir}=splitActiveFilters(filters)
  const activeSet=new Set(filters)

  const matchesActiveFilters=item=>{
    for(const def of nonDir)if(!def.test(item))return false
    if(dir.length){
      if(directionMode==='or'){if(!dir.some(def=>def.test(item)))return false}
      else{for(const def of dir)if(!def.test(item))return false}
    }
    return true
  }

  const filterSatisfiers=queryPool.filter(matchesActiveFilters)
  const collegeCounts={}
  for(const c of collegeList)collegeCounts[c]=0
  for(const item of filterSatisfiers){
    const parts=splitMentorColleges(item.college)
    for(const c of collegeList)if(item.college===c||parts.includes(c))collegeCounts[c]++
  }

  const collegePool=colleges.length?queryPool.filter(item=>itemMatchesColleges(item,colleges)):queryPool
  const currentMatched=colleges.length?filterSatisfiers.filter(item=>itemMatchesColleges(item,colleges)):filterSatisfiers
  const nonDirPool=nonDir.length?collegePool.filter(item=>nonDir.every(def=>def.test(item))):collegePool

  const filterCounts={}
  for(const def of MENTOR_FILTERS){
    if(def.group==='directions'&&directionMode==='or'){
      let n=0
      for(const item of nonDirPool)if(def.test(item))n++
      filterCounts[def.id]=n
    }else if(activeSet.has(def.id)){
      filterCounts[def.id]=currentMatched.length
    }else{
      let n=0
      for(const item of currentMatched)if(def.test(item))n++
      filterCounts[def.id]=n
    }
  }
  return {filterCounts,collegeCounts}
}

// 北极星的「评价洞察」：把整理后的学生评价归纳为可读标签与画像维度。
// 原则：忠实归纳评价要点，每个标签都附带触发它的依据语句，负面信息与正面信息同等呈现。

export const FLAGSHIP_ACADEMIC_RE=/首席科学家|国家杰出青年|杰青|优秀青年科学基金|国家优青|优青|长江学者|万人计划|青年人才托举|小米青年学者|百千万人才|新世纪优秀人才/
export const TOP_PUBLICATION_RE=/CCF[\s-]*A|CVPR|ICCV|ECCV|NeurIPS|NIPS|ICML|ICLR|ACL|EMNLP|SIGKDD|KDD|AAAI|IJCAI|WWW|SIGIR|INFOCOM|MOBICOM|SIGCOMM|NDSS|CCS|USENIX|S&P|Oakland|OSDI|SOSP|PLDI|POPL|ICSE|FSE|ASE|ISSTA|ISSAC|PKC|ISIT|CRYPTO|EUROCRYPT|ASIACRYPT|SIAM|IEEE\s*(?:JSAC|TIFS|TPAMI|PAMI|TKDE|TMC|TDSC|ToN|TSC|TC|TPDS)|ACM\s*(?:TOIS|TOCS|CCS)|中科院\s*[1一]\s*区|JCR\s*[1一]\s*区|最佳论文|Best\s*Paper|ESI\s*高被引/i
export const NATIONAL_PROJECT_RE=/(?:主持|牵头|负责人|承担)[^。；\n]{0,28}(?:国家重点研发|国家自然科学基金|国家重大专项|国家级(?:科研)?项目|重点研发计划)/

const SURNAME_GROUPS=[['傅','付'],['肖','萧'],['戴','代'],['邱','丘'],['吕','呂'],['钟','锺']]
const SURNAME_MAP=new Map(SURNAME_GROUPS.flatMap(group=>group.map(char=>[char,group.filter(other=>other!==char)])))
export function nameVariants(name){
  const text=String(name||'').trim()
  if(text.length<2)return []
  const alts=SURNAME_MAP.get(text[0])
  return alts?alts.map(char=>char+text.slice(1)):[]
}
export function homophoneMatches(value,rows){
  const variants=nameVariants(value)
  if(!variants.length)return []
  return rows.filter(row=>variants.includes(row.name||row.mentor_name))
}

const RULES=[
  // ---- 值得注意的正面信号 ----
  {id:'internship_ok',tone:'good',label:'可以实习',test:s=>{const explicitWindow=/研[一二三][上下]?(?:学期|暑假|寒假|结束)?.{0,8}(?:可|能|允许)(?:以)?(?:外出|出去|自主|自行)?实习|完成.{0,12}后.{0,6}(?:可|能|允许)(?:以)?(?:外出|出去)?(?:实习)?|既包含允许实习/.test(s);return (explicitWindow||/(?:可|允许|能|放|支持|鼓励)(?:以)?(?:学生)?(?:外出|出去|自主|自行)?(?:短期)?实习|实习(?:自由|宽松|支持|放行)|主动放实习/.test(s))&&(explicitWindow||!/不(?:允许|让|能|可|支持)(?:学生)?(?:自主|外出|出去|自行){0,2}实习|禁止(?:外出)?实习/.test(s))}},
  {id:'no_clock',tone:'good',label:'不打卡',test:s=>/(?:不|无|免)(?:固定|用|需要?|要求|强制|设|必)?[^。；，\n]{0,12}(?:打卡|坐班)|无(?:需|须)(?:打卡|坐班)|不强制(?:每日|每天)?到(?:实验室|岗|场)|弹性(?:工作|考勤|到岗)/.test(s)&&!/每天.{0,6}打卡|打卡严格/.test(s)},
  {id:'free_time',tone:'good',label:'时间自由',test:s=>/时间(?:比较|较为?|很|相对|十分|相当)?(?:自由|充裕|灵活)|管理(?:比较|较为?|很|相对|十分|算)?(?:宽松|不严|松)|(?:自主|自由)(?:安排|支配)|放养|不(?:怎么)?管|约束(?:较|很)?少/.test(s)&&!/不自由|过于放养/.test(s)},
  {id:'no_paper',tone:'good',label:'不卡论文',test:s=>/(?:不|无)(?:额外|强制|硬性)?要求(?:发表?)?(?:小)?(?:论文|SCI|ccf|CCF)|无(?:SCI|小论文)[^。；，\n]{0,8}(?:硬性|额外)?(?:指标|要求)|没有(?:额外|硬性|明确的?)?(?:发|发表)?(?:小)?论文(?:要求|条件|指标)|论文要求(?:放宽|不高|宽松|较低)|以专利代替论文|专利代替/.test(s)},
  {id:'personal',tone:'good',label:'亲自指导',test:s=>/(?<!不|少)亲自(?:指导|带|改)|本人(?:直接|亲自)(?:指导|带)|(?:耐心|悉心|认真|细致|手把手)(?:地)?(?:指导|解答|修改)|指导(?:认真|耐心|细致|到位)|手把手/.test(s)},
  {id:'kind',tone:'good',label:'尊重学生',test:s=>/尊重学生|和蔼|和气|情绪稳定|(?:待人|导师|老师|为人|性格)?(?:很|非常|比较|十分|颇为)?(?:友善|和善|亲切|随和|平易近人|好沟通|容易沟通)|(?:导师|老师|性格|脾气)(?:很|比较)?(?:温和|好)|师生关系(?:很|比较|十分|相当)?(?:融洽|和谐|好|不错)|体谅|为学生(?:着想|考虑)|替学生(?:着想|考虑)|从学生(?:角度|立场)|人(?:很|非常)?好|(?:没有|不摆|毫无)架子|nice/i.test(s)&&!/尊重不足|(?:不|不太|不怎么|不够|缺乏)尊重|关系(?:一般|较差|很差|紧张)|关系不和|不融洽|偏向自己的项目/.test(s)},
  {id:'resources',tone:'good',label:'资源充足',test:s=>/经费(?:很|较|比较|十分)?(?:充足|充裕|多|足|宽裕)|项目资源(?:丰富|充足)|资源(?:丰富|充足|较足|充沛)/.test(s)||/项目(?:很|较|比较|数量)?(?:多|丰富)/.test(s)&&/锻炼|实践|经验|资源|经费|机会/.test(s)&&!/杂|申请书|很少见/.test(s)},
  {id:'career',tone:'good',label:'去向不错',test:s=>/(?:去向|就业|进入|入职|去了|毕业生?|往届|offer).{0,16}(?:百度|腾讯|阿里|字节|华为|微软|Google|Microsoft|BAT|美团|京东|大厂|互联网)|(?:百度|腾讯|阿里|字节|华为|微软|Google|Microsoft|BAT|美团|京东|大厂).{0,10}(?:offer|SP|入职|就业)|SP待遇|(?:毕业)?去向(?:很|较|比较|整体)?(?:好|不错|理想)|就业(?:前景|情况|整体)?(?:很|较|比较)?(?:好|不错|理想)/.test(s)&&!/去向.{0,4}一般|靠(?:学生)?(?:个人|自己)/.test(s)},
  {id:'holiday',tone:'good',label:'正常放假',test:s=>/(?:寒暑假|假期).{0,8}(?:正常|按校历|完整|充足)|按校历(?:正常)?放假/.test(s)},
  // ---- 需要看清的风险信号（如实保留，绝不弱化） ----
  {id:'no_internship',tone:'bad',label:'限制实习',test:s=>/不(?:允许|让|能|支持)(?:学生)?(?:自主|外出|出去|自行){0,2}实习|禁止(?:外出)?实习|阻止.{0,6}(?:外出|实习)|实习.{0,6}(?:影响|难以).{0,4}毕业/.test(s)},
  {id:'clock',tone:'bad',label:'打卡坐班',test:s=>/打卡|坐班|指纹|到岗时长|签到/.test(s)&&!/(?:不|无|免)(?:固定|用|需要?|要求|强制|设|必)?[^。；，\n]{0,12}(?:打卡|坐班)|无(?:需|须)(?:打卡|坐班)|没有打卡|不强制/.test(s)},
  {id:'nominal',tone:'bad',label:'非本人带教',test:s=>/挂名|已不直接带学生|不直接带学生|不亲自(?:指导|带|承担)|(?:学生|硕士)?交(?:由|给).{1,10}(?:指导|培养|带|负责)|主要由(?:博士生?|博士后|博后|师兄|师姐|其他(?:老师|教师)|年轻教师)(?:日常|具体|实际)?(?:指导|培养|带|管理|负责)|由(?:博士生?|博士后|师兄|师姐)(?:日常|具体|实际)?(?:指导|带)|平时.{0,4}很少(?:见到|到实验室|指导)|很少(?:见到导师|去实验室)/.test(s)},
  {id:'exploit',tone:'bad',label:'压榨记录',test:s=>/压榨|PUA|(?:低成本|廉价)劳动力|过度加班|半夜开会|被迫退学|打压/.test(s)&&!/(?:不|不会|从不|从无|没有|并无)压榨|不PUA/.test(s)},
  {id:'abuse',tone:'bad',label:'会骂人',test:s=>/辱骂|骂人|会骂|骂学生|咆哮|责骂|训斥/.test(s)&&!/(?:不|不会|从不|不直接)(?:辱骂|骂|责骂|训斥)/.test(s)},
  {id:'not_recommended',tone:'bad',label:'整体不推荐',test:s=>/不推荐|评价(?:很|较|比较|极|偏|明显)?(?:差|负面)|体验(?:很|较|比较|极|偏)?差|慎选|避雷|劝退|谨慎避开/.test(s)},
  {id:'overtime',tone:'bad',label:'加班较多',test:s=>{const t=s.replace(/(?:晋升|考核|非升即走|科研|论文|学术|发论文|毕业|竞争(?:和|与)科研)(?:方面的?|上的?)?压力(?:很|较|比较|不)?(?:大|小)/g,'').replace(/不(?:强制|要求)[^。；，\n]{0,6}(?:周末)?加班/g,'');return /经常加班|加班(?:较|很|比较)?多|加班(?:是|成|为)?常态|(?<!自愿)周末(?:要|需|必须|默认)(?:加班|到岗|到实验室|在场)|(?<!不强制|不要求|自愿)周末加班(?!自愿|全凭自愿)|假期(?:很|较)?短|没有假期|(?:任务|杂务|杂事)(?:繁重|繁多|很重|较重)|工作负担重|(?<!不)(?:很|较|非常|比较|整体较)累|工作(?:辛苦|较累)|工作(?:至|到)2[2-4]点?|熬夜|压力(?:很|较|比较)?大/.test(t)&&!/自愿(?:周末)?加班|加班(?:全凭)?自愿|压力(?:不大|较小|小|不算大)/.test(t)}},
  {id:'low_pay',tone:'bad',label:'补助偏低',test:s=>/补助.{0,10}(?:少|低|没有|停发|拖欠|晚发|不发)|不发(?:放)?补助|劳务.{0,14}(?:少|低|晚|拖欠)|没有(?:补助|劳务)|(?:整体|总体|待遇)(?:水平)?(?:较|偏|很)低/.test(s)},
  {id:'delay',tone:'bad',label:'毕业风险',test:s=>/延毕|延期(?:毕业|六个月|半年)?|没有按时毕业|毕业(?:困难|难)/.test(s)&&!/无延毕|不延毕|没有延毕|按时毕业的很多/.test(s)},
  {id:'mood',tone:'bad',label:'情绪化',test:s=>/情绪(?:化|影响|不稳定|起伏大)|发脾气|酒后/.test(s)&&!/情绪稳定|(?:不|很少|几乎不|从不)发脾气/.test(s)},
  // ---- 中性但关键的条件 ----
  {id:'paper_high',tone:'note',label:'论文要求高',test:s=>/要求.{0,14}(?:SCI|CCF|[AB]类|一区|二区|两篇|三篇|一作)|(?:论文|科研|实验)(?:能力)?(?:要求|压力)(?:较|很|比较|偏)?(?:高|大)/.test(s)&&!/(?:不|无)(?:额外|强制|硬性)?要求|放宽/.test(s)},
  {id:'academic',tone:'note',label:'偏学术',test:s=>/偏(?:向)?学术|学术(?:导向|为主|氛围|路线|型)|(?:重视|看重|注重)(?:论文|科研|学术)|科研(?:任务)?(?:较|很)?(?:多|重)/.test(s)},
  {id:'engineering',tone:'note',label:'偏工程',test:s=>/偏(?:向)?工程|侧重工程|工程(?:导向|型|为主|开发)|以(?:项目|开发|工程)为主|项目(?:开发)?为主/.test(s)},
  {id:'travel',tone:'note',label:'可能出差',test:s=>/出差|外派/.test(s)},
]

const strip=s=>s.replace(/^[-•\s]+/,'').replace(/^[\u4e00-\u9fa5A-Za-z/、与和]{1,10}[：:]\s*/u,'').trim()
export function sentencesOf(text){return String(text||'').split(/[。；;！!\n]/).map(strip).filter(s=>s.length>=3)}

function stipendAmount(mentor){
  if(Number.isFinite(mentor.stipend_monthly_max))return mentor.stipend_monthly_max
  if(Number.isFinite(mentor.stipend_monthly_min))return mentor.stipend_monthly_min
  // Free-text amounts can describe company payments or project bonuses; only curated monthly fields are numeric.
  return null
}

const clamp=n=>Math.max(1,Math.min(5,Math.round(n*2)/2))

/**
 * @param mentor 一条导师记录（mentors 数据集）
 * @param names  全部导师姓名，用于识别"实际带教人"
 */
export function mentorInsight(mentor,names=[]){
  const own=['mentor_note','review_text','management','internship','graduation','stipend_text'].flatMap(key=>sentencesOf(mentor[key]).map(text=>({text,scope:'个人'})))
  const others=names.filter(name=>name!==mentor.name)
  const team=sentencesOf(mentor.group_context).filter(text=>!others.some(name=>text.includes(name))||text.includes(mentor.name)).map(text=>({text,scope:'团队'}))
  const seen=new Set(),pool=[...own,...team].filter(item=>!seen.has(item.text)&&seen.add(item.text))
  const flags=[]
  const isOtherSubjectNominal=text=>!text.includes(mentor.name)&&others.some(other=>text.startsWith(other)||new RegExp(`${other.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}[^，。；]{0,6}(?:挂名|已不直接|不直接|不亲自)`).test(text))
  for(const rule of RULES){
    const hits=pool.filter(item=>(rule.id!=='nominal'||!isOtherSubjectNominal(item.text))&&rule.test(item.text))
    if(!hits.length)continue
    const personal=hits.filter(hit=>hit.scope==='个人')
    // A personal record overrides the opposite team default.
    const chosen=personal.length?personal:hits
    const label=rule.id==='resources'&&chosen.some(hit=>/经费(?:充足|充裕|多|足)/.test(hit.text))?'经费充足':rule.label
    flags.push({id:rule.id,tone:rule.tone,label,scope:personal.length?'个人':'团队',evidence:[...new Set(chosen.map(hit=>hit.text))].slice(0,3)})
  }
  const has=id=>flags.some(flag=>flag.id===id),flag=id=>flags.find(flag=>flag.id===id)
  const personalHas=id=>flag(id)?.scope==='个人'
  // Personal evidence resolves conflicts with team defaults.
  if(has('internship_ok')&&has('no_internship')&&(flag('internship_ok').evidence.some(text=>flag('no_internship').evidence.includes(text))||flag('no_internship').evidence.some(text=>/研[一二三][上下]?(?:结束)?(?:之)?前|平时|原则上|一般|除|只有|完成.{0,6}后/.test(text)))){
    const merged=[...new Set([...flag('no_internship').evidence,...flag('internship_ok').evidence])].slice(0,3)
    flags.splice(flags.indexOf(flag('no_internship')),1)
    Object.assign(flag('internship_ok'),{id:'internship_ok',tone:'note',label:'有条件实习',evidence:merged,conditional:true})
  }
  for(const [a,b] of [['internship_ok','no_internship'],['no_clock','clock'],['personal','nominal']]){
    if(has(a)&&has(b)){
      if(personalHas(a)&&!personalHas(b))flags.splice(flags.indexOf(flag(b)),1)
      else if(personalHas(b)&&!personalHas(a))flags.splice(flags.indexOf(flag(a)),1)
    }
  }
  if(has('clock')&&has('free_time')&&(personalHas('clock')||!personalHas('free_time')))flags.splice(flags.indexOf(flag('free_time')),1)
  if(has('no_paper')&&pool.some(item=>/学硕(?:需要?|要求)(?:发表|完成|有)?(?:小)?论文/.test(item.text)))Object.assign(flag('no_paper'),{tone:'note',label:'专硕不卡论文',conditional:true})
  const amount=stipendAmount(mentor)
  if(amount!=null&&amount>=1500&&!has('low_pay'))flags.push({id:'high_pay',tone:'good',label:`补助 ¥${amount}/月`,scope:'个人',evidence:sentencesOf(mentor.stipend_text).slice(0,2)})
  if(mentor.rating!=null&&mentor.rating<=2&&!has('not_recommended'))flags.push({id:'low_rating',tone:'bad',label:`口碑 ${mentor.rating}/5`,scope:'个人',evidence:[`培养体验评分 ${mentor.rating} / 5`]})
  if(mentor.can_supervise_doctoral)flags.push({id:'doctoral',tone:'note',label:'可带博士',scope:'个人',evidence:[mentor.doctoral_evidence||'具有博士指导资格'].filter(Boolean)})

  // Actual day-to-day supervisor, only when another known mentor is named after a hand-over phrase.
  let supervisor=null
  for(const item of pool){
    const handover=item.text.search(/交由|交给|转给|(?:主要|日常|实际)?由.{0,10}(?:指导|带|培养|负责|管理|接手)/u)
    if(handover<0||/不(?:交|由|是由)|并非由/.test(item.text.slice(Math.max(0,handover-3),handover+2)))continue
    const after=item.text.slice(handover,handover+18).split(/[，,。；;]/)[0]
    if(after.includes(mentor.name))continue
    const named=others.map(name=>({name,index:after.indexOf(name)})).filter(found=>found.index>=0).sort((a,b)=>a.index-b.index||b.name.length-a.name.length)[0]
    if(named&&!/^由(?:博士|博后|师兄|师姐)/.test(after)){supervisor={name:named.name,evidence:item.text};break}
  }
  if(supervisor&&!has('nominal'))flags.push({id:'nominal',tone:'bad',label:'非本人带教',scope:'个人',evidence:[supervisor.evidence]})
  if(!supervisor&&!has('nominal')&&(mentor.rating==null||mentor.rating>=4)&&((mentor.recommended_count??0)>=6||/初试第[1-5]名/.test(mentor.enrollment_signal||''))){
    const choiceEvidence=mentor.enrollment_signal||`名册${mentor.student_count}人（保研${mentor.recommended_count??0}、考研${mentor.exam_count??0}）`
    flags.push({id:'student_choice',tone:'good',label:'高分生源青睐',scope:'个人',evidence:[choiceEvidence]})
  }

  // Six-axis fingerprint; null means "no record", never a low score.
  const axis=(value,evidence)=>value==null?null:{value:clamp(value),evidence:evidence.filter(Boolean).slice(0,3)}
  const ev=id=>flag(id)?.evidence||[]
  const freedomSignals=['no_clock','free_time','holiday','clock','overtime'].filter(has)
  const freedom=freedomSignals.length?3+(has('no_clock')?1:0)+(has('free_time')?.8:0)+(has('holiday')?.4:0)-(has('clock')?1.2:0)-(has('overtime')?1:0):null
  const internshipText=[...ev('internship_ok'),mentor.internship||''].join(' ')
  const internship=has('no_internship')&&!has('internship_ok')?1:has('internship_ok')?(/研一|随时|平时|自由|任何时候|鼓励/.test(internshipText)?5:/研二上|研二初/.test(internshipText)?4.5:/研二下(?!结束|六月底|暑假)|研二春/.test(internshipText)?4:/研二(?:下)?结束|研二(?:下)?六月底|研二暑|暑假/.test(internshipText)?3.5:/研三/.test(internshipText)?3:3.5)-(has('no_internship')||flag('internship_ok')?.conditional?1:0):null
  const funding=amount!=null?(amount>=2000?5:amount>=1500?4.5:amount>=1000?4:amount>=700?3:amount>=400?2:1.5)+(has('resources')?.5:0)-(has('low_pay')?.5:0):has('low_pay')?1.5:has('resources')?4:null
  const guidance=has('personal')||has('nominal')?3+(has('personal')?1.5:0)-(has('nominal')?1.8:0):null
  const academicSource=[mentor.academic_summary,mentor.profile_evidence].filter(Boolean).join('\n')
  const ownAndTeamText=pool.map(item=>item.text).join('\n')
  const hasFlagship=FLAGSHIP_ACADEMIC_RE.test(academicSource),hasTopPaper=TOP_PUBLICATION_RE.test(academicSource),hasNatProj=NATIONAL_PROJECT_RE.test(academicSource)||(mentor.group_lead===true&&has('resources'))
  const hasAcademicRecord=['paper_high','academic','engineering','no_paper'].some(has)||Boolean(mentor.can_supervise_doctoral)||hasFlagship||hasTopPaper||hasNatProj
  const research=hasAcademicRecord?3+(hasFlagship?1.1:0)+(hasTopPaper?0.9:0)+(hasNatProj?0.6:0)+(mentor.can_supervise_doctoral?0.4:0)+(has('academic')?0.6:0)+(has('paper_high')?0.6:0)-(has('engineering')&&!has('academic')&&!hasTopPaper?0.8:0)-(has('no_paper')&&!flag('no_paper')?.conditional&&!hasTopPaper?0.5:0)-(/导师本人没有研究项目|学术研究较少|缺少明确的研究方向/.test(ownAndTeamText)?1.0:0)-(/刚到北邮任教|新入职教师/.test(ownAndTeamText)&&!hasTopPaper?0.3:0):null
  const academicEvidence=sentencesOf(academicSource).filter(s=>FLAGSHIP_ACADEMIC_RE.test(s)||TOP_PUBLICATION_RE.test(s)||NATIONAL_PROJECT_RE.test(s)).slice(0,2)
  const fingerprint={
    reputation:axis(mentor.rating,[mentor.rating!=null?`培养体验评分 ${mentor.rating} / 5`:null,...ev('student_choice')]),
    freedom:axis(freedom,freedomSignals.flatMap(ev)),
    internship:axis(internship,[...ev('internship_ok'),...ev('no_internship')]),
    funding:axis(funding,[...sentencesOf(mentor.stipend_text).slice(0,2),...ev('resources'),...ev('low_pay')]),
    guidance:axis(guidance,[...ev('personal'),...ev('nominal')]),
    research:axis(research,[...academicEvidence,...ev('paper_high'),...ev('academic'),...ev('engineering'),...ev('no_paper'),mentor.can_supervise_doctoral?'具有博士指导资格':null]),
  }

  // A representative student voice: prefer the person's own relationship/overall sentence.
  const voices=own.map(item=>item.text).filter(text=>text.length>=10&&text.length<=70)
  const quote=voices.find(text=>/相处|评价|总体|整体|为人|待人|人很|性格|氛围|推荐|口碑/.test(text))||voices.find(text=>/指导|尊重|压榨|骂|自由|轻松|累/.test(text))||voices[0]||null

  const sources=mentor.source_ids||[]
  const evidence={
    sources:sources.length,
    personal:Boolean(mentor.review_text||mentor.mentor_note),
    team:Boolean(mentor.group_context),
    level:mentor.review_text||mentor.mentor_note?(own.length>=6?'详实':'一般'):mentor.group_context?'仅团队资料':'暂无评价',
  }
  const order={bad:0,good:1,note:2}
  flags.sort((a,b)=>order[a.tone]-order[b.tone])
  return {flags,fingerprint,supervisor,quote,evidence,stipend:amount}
}

export const fingerprintAxes=[
  {key:'reputation',label:'学生口碑'},
  {key:'freedom',label:'时间自由'},
  {key:'internship',label:'实习友好'},
  {key:'funding',label:'经费补助'},
  {key:'guidance',label:'亲自指导'},
  {key:'research',label:'科研强度'},
]

export function flagText(insight,tone){return insight.flags.filter(flag=>flag.tone===tone).map(flag=>flag.label).join('、')||null}

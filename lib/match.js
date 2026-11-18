// 画像契合度：只依据评价归纳出的标签与维度估算，用于排序参考，不代替原文。
const mustFlags={
  internship:{good:['internship_ok'],bad:['no_internship']},
  no_clock:{good:['no_clock','free_time'],bad:['clock']},
  stipend:{good:['high_pay'],bad:['low_pay']},
  personal:{good:['personal'],bad:['nominal']},
  no_paper:{good:['no_paper'],bad:['paper_high']},
  kind:{good:['kind'],bad:['exploit','abuse','mood']},
  doctoral:{good:['doctoral'],bad:[]},
  resources:{good:['resources'],bad:[]},
}
const mustNames={internship:'能实习',no_clock:'不打卡',stipend:'补助高',personal:'亲自指导',no_paper:'不卡论文',kind:'尊重学生',doctoral:'博导',resources:'项目资源多'}
const weights={
  career:{reputation:3,internship:3,freedom:2.5,funding:2,guidance:1.5,research:.2},
  research:{research:3.5,reputation:2.5,guidance:2,funding:1.5,freedom:.3,internship:.2},
  undecided:{reputation:3,freedom:1,internship:1,funding:1,guidance:1,research:1},
}

export function matchScore(insight,profile){
  if(!insight||!profile)return null
  const goal=profile.goal||'undecided',musts=profile.musts||[],colleges=profile.colleges||[]
  const interests=String(profile.interests||'').trim()
  const doctoralStage=profile.stage==='doctoral'
  if(!profile.goal&&!musts.length&&!doctoralStage&&!interests)return null
  const has=id=>insight.flags.some(flag=>flag.id===id&&!flag.conditional),conditional=id=>insight.flags.some(flag=>flag.id===id&&flag.conditional)
  const isDoctoral=Boolean(insight.doctoral||has('doctoral'))
  let total=0,weight=0
  for(const [key,w] of Object.entries(weights[goal])){const axis=insight.fingerprint[key];if(axis){total+=axis.value/5*w;weight+=w}}
  const base=weight?total/weight:.55,coverage=Math.min(1,weight/6)
  const hits=[],misses=[],unknown=[]
  let partialPenalty=0
  for(const must of musts){
    const rule=mustFlags[must]
    if(must==='doctoral'){
      if(isDoctoral)hits.push(mustNames.doctoral)
      else if(insight.evidence?.sources>0)misses.push(mustNames.doctoral)
      else unknown.push(mustNames.doctoral)
      continue
    }
    if(rule.bad.some(has))misses.push(mustNames[must])
    else if(rule.good.some(has))hits.push(mustNames[must])
    else if(must==='internship'&&conditional('internship_ok')){hits.push('有条件实习');partialPenalty+=2}
    else if(must==='no_paper'&&conditional('no_paper')){hits.push('专硕不卡论文');partialPenalty+=3}
    else unknown.push(mustNames[must])
  }
  let score=base*(55+15*coverage)+(musts.length?(hits.length/musts.length)*30:20)-partialPenalty
  score-=misses.length*12
  if(doctoralStage){
    if(isDoctoral){score+=5;if(!hits.includes('博导'))hits.push('可带博士')}
    else{score-=18;if(!misses.includes('博导'))misses.push('非博导')}
  }
  if(colleges.length>0&&insight.college){
    const parts=insight.college.split(/[、,，]+/).map(s=>s.replace(/[（(].*$/,'').trim())
    if(colleges.some(c=>c===insight.college||parts.includes(c)))score+=4
    else score-=6
  }
  if(interests){
    const terms=interests.toLowerCase().split(/[、,，\s/;；]+/).filter(t=>t.length>=2)
    const haystack=[insight.directions,insight.academicSummary,insight.quote].filter(Boolean).join(' ').toLowerCase()
    if(terms.length&&terms.some(term=>haystack.includes(term))){score+=6;hits.push('方向契合')}
  }
  if(goal==='research'){
    if(has('nominal'))score-=12
    if(has('student_choice'))score+=4
  }
  if(goal==='career'){
    if(has('no_internship'))score-=15
    if(has('clock'))score-=6
    if(has('no_paper'))score+=4
  }
  if(has('exploit')||has('not_recommended'))score-=18
  if(has('abuse'))score-=8
  if(insight.rating!=null&&insight.rating<=2)score-=10
  return {score:Math.max(3,Math.min(99,Math.round(score))),hits,misses,unknown}
}


// 用户择导画像：一次说清，北极星在之后每一轮对话中默认沿用。
export const profileOptions={
  stage:[{value:'exam',label:'统考'},{value:'recommended',label:'保研'},{value:'doctoral',label:'直博/申博'}],
  goal:[{value:'career',label:'毕业就业'},{value:'research',label:'读博深造'},{value:'undecided',label:'还没想好'}],
  musts:[
    {value:'internship',label:'能实习'},
    {value:'no_clock',label:'不打卡'},
    {value:'stipend',label:'补助高'},
    {value:'personal',label:'亲自指导'},
    {value:'no_paper',label:'不卡论文'},
    {value:'kind',label:'尊重学生'},
    {value:'doctoral',label:'博导'},
    {value:'resources',label:'项目资源多'},
  ],
}
export const emptyProfile={stage:null,goal:null,score:null,program:null,colleges:[],musts:[],interests:'',notes:'',updatedAt:null}
const label=(group,value)=>profileOptions[group].find(item=>item.value===value)?.label

export function normalizeProfile(input={},previous=emptyProfile){
  const next={...emptyProfile,...previous}
  const pick=(key,values)=>{if(input[key]!==undefined){if(input[key]!==null&&!values.includes(input[key]))throw new Error('画像字段无效：'+key);next[key]=input[key]}}
  pick('stage',profileOptions.stage.map(item=>item.value))
  pick('goal',profileOptions.goal.map(item=>item.value))
  if(input.score!==undefined){
    if(input.score!==null&&(!Number.isFinite(Number(input.score))||Number(input.score)<0||Number(input.score)>500))throw new Error('初试分数需在0–500之间')
    next.score=input.score===null||input.score===''?null:Math.round(Number(input.score))
  }
  for(const key of ['program','interests','notes']){
    if(input[key]!==undefined){
      if(input[key]!==null&&typeof input[key]!=='string')throw new Error('画像字段无效：'+key)
      const value=(input[key]||'').trim()
      if(value.length>(key==='notes'?600:120))throw new Error('画像文字过长：'+key)
      next[key]=key==='program'?value||null:value
    }
  }
  if(input.colleges!==undefined){if(!Array.isArray(input.colleges)||input.colleges.some(item=>typeof item!=='string'))throw new Error('学院需为数组');next.colleges=[...new Set(input.colleges.map(item=>item.trim()).filter(Boolean))].slice(0,16)}
  if(input.musts!==undefined){
    const allowed=profileOptions.musts.map(item=>item.value)
    if(!Array.isArray(input.musts)||input.musts.some(item=>!allowed.includes(item)))throw new Error('偏好条件无效')
    next.musts=[...new Set(input.musts)]
  }
  next.updatedAt=new Date().toISOString()
  return next
}

export function profileChips(profile){
  if(!profile)return []
  return [
    profile.stage&&{key:'stage',text:label('stage',profile.stage)},
    profile.score!=null&&{key:'score',text:profile.score+'分'},
    profile.program&&{key:'program',text:profile.program},
    profile.goal&&{key:'goal',text:label('goal',profile.goal)},
    ...profile.colleges.map(college=>({key:'college:'+college,text:college.replace('学院','')})),
    ...profile.musts.map(value=>({key:'must:'+value,text:label('musts',value)})),
    profile.interests&&{key:'interests',text:profile.interests},
  ].filter(Boolean)
}

export function hasProfile(profile){return profileChips(profile).length>0||Boolean(profile?.notes)}

// Plain-language summary for the Agent's system prompt.
export function profilePrompt(profile){
  if(!hasProfile(profile))return ''
  const parts=[
    profile.stage&&'报考方式：'+label('stage',profile.stage),
    profile.score!=null&&'初试分数：'+profile.score,
    profile.program&&'目标专业或代码：'+profile.program,
    profile.goal&&'读研目标：'+label('goal',profile.goal),
    profile.colleges.length&&'关注学院：'+profile.colleges.join('、'),
    profile.musts.length&&'看重：'+profile.musts.map(value=>label('musts',value)).join('、'),
    profile.interests&&'感兴趣的方向：'+profile.interests,
    profile.notes&&'其他说明：'+profile.notes,
  ].filter(Boolean)
  return '用户择导画像（用户主动填写并可随时修改；作为默认偏好使用，本轮明确改口时以本轮为准；“看重”是偏好而不是硬筛选，除非用户说“必须/只要”）：'+parts.join('；')+'。'
}

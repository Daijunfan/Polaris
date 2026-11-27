import React,{useEffect,useRef,useState} from 'react'
import {AlertTriangle,ArrowLeft,BadgeCheck,BookOpen,Bookmark,Check,ChevronLeft,ChevronRight,Copy,ExternalLink,FileCheck2,GraduationCap,Info,Mail,MessageCircleQuestion,PenLine,Quote,ShieldAlert,Sparkles,Star,UserRoundSearch,Users} from 'lucide-react'
import {fingerprintAxes} from '../../lib/insights.js'
import {usePolaris} from '../insights.jsx'
import {useWorkspace} from '../workspace.jsx'
import {useToast} from '../toast.jsx'
import {api} from '../api.js'
import {display,formatAcademicSummary,formatDisciplineText} from '../presentation.js'
import Dialog from './Dialog.jsx'
import ExportMenu from './ExportMenu.jsx'
import {DossierDetailSkeleton} from './Skeleton.jsx'

const toneIcon={good:BadgeCheck,bad:AlertTriangle,note:Info}
const SHORT_AXIS={reputation:'口碑',freedom:'自由',internship:'实习',funding:'经费',guidance:'指导',research:'科研'}

export function FlagChips({insight,limit=Infinity,tones=['bad','good','note'],skip=[],className=''}){
  const [expanded,setExpanded]=useState(false)
  if(!insight)return null
  const flags=insight.flags.filter(flag=>tones.includes(flag.tone)&&!skip.includes(flag.id)).toSorted((a,b)=>tones.indexOf(a.tone)-tones.indexOf(b.tone)||(a.scope==='团队')-(b.scope==='团队'))
  if(!flags.length)return null
  const shown=expanded||!Number.isFinite(limit)?flags:flags.slice(0,limit),rest=flags.length-shown.length
  const hiddenNames=rest>0?flags.slice(shown.length).map(f=>f.label).join('、'):''
  return <span className={'flag-chips '+className}>{shown.map(flag=>{const Icon=toneIcon[flag.tone];return <span key={flag.id} className={'flag-chip tone-'+flag.tone+(flag.scope==='团队'?' scope-team':'')} title={(flag.scope==='团队'?'来自所在团队的共同评价：':'')+flag.evidence.join('；')}><Icon size={11} aria-hidden="true"/>{flag.label}{flag.scope==='团队'&&<sup>组</sup>}</span>})}{rest>0&&<button type="button" className="flag-chip tone-more" aria-expanded={expanded} aria-label={`展开其余 ${rest} 项标签：${hiddenNames}`} title={`点击展开其余 ${rest} 项：${hiddenNames}`} onClick={event=>{event.preventDefault();event.stopPropagation();setExpanded(true)}}>展开 +{rest} 项</button>}</span>
}

export function MatchRing({match,size=44}){
  if(!match)return null
  const r=size/2-4,c=2*Math.PI*r,level=match.score>=75?'high':match.score>=55?'mid':'low'
  return <span className={'match-ring level-'+level} title={`画像契合度 ${match.score}%（据评价标签估算）${match.hits.length?'\n满足：'+match.hits.join('、'):''}${match.misses.length?'\n冲突：'+match.misses.join('、'):''}${match.unknown.length?'\n无记录：'+match.unknown.join('、'):''}`} style={{width:size,height:size}}>
    <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true"><circle cx={size/2} cy={size/2} r={r} className="ring-track"/><circle cx={size/2} cy={size/2} r={r} className="ring-value" strokeDasharray={`${c*match.score/100} ${c}`} transform={`rotate(-90 ${size/2} ${size/2})`}/></svg>
    <b>{match.score}{size>=36&&<small>%</small>}</b><span className="sr-only">画像契合度{match.score}%</span>
  </span>
}

export const radarColors=['#1d4b8f','#d97706','#0d9488','#7c3aed']
export function Radar({series,size=216,showLabels=true,active,onAxis}){
  const center=size/2,radius=size/2-(showLabels?46:10),count=fingerprintAxes.length
  const point=(index,value)=>{const angle=-Math.PI/2+index*2*Math.PI/count,d=radius*value/5;return [center+d*Math.cos(angle),center+d*Math.sin(angle)]}
  return <svg className="radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={'培养画像：'+series.map(item=>(item.name?item.name+' ':'')+fingerprintAxes.map(axis=>axis.label+(item.fingerprint[axis.key]?item.fingerprint[axis.key].value:'无记录')).join('，')).join('；')}>
    {[1,2,3,4,5].map(level=><polygon key={level} className={'radar-grid'+(level===5?' outer':'')} points={fingerprintAxes.map((_,index)=>point(index,level).join(',')).join(' ')}/>)}
    {fingerprintAxes.map((axis,index)=>{const [x,y]=point(index,5),[lx,ly]=point(index,6.08);return <g key={axis.key}><line className="radar-axis" x1={center} y1={center} x2={x} y2={y}/>{showLabels&&<text className={'radar-label'+(active===axis.key?' active':'')+(series.every(item=>!item.fingerprint[axis.key])?' empty':'')+(onAxis?' is-interactive':'')} x={lx} y={ly} textAnchor={Math.abs(lx-center)<4?'middle':lx>center?'start':'end'} dominantBaseline="middle" onClick={onAxis?()=>onAxis(axis.key):undefined}>{axis.label}</text>}</g>})}
    {series.map((item,seriesIndex)=>{
      const color=item.color||radarColors[seriesIndex%radarColors.length]
      const values=fingerprintAxes.map(axis=>item.fingerprint[axis.key]?.value??0)
      const points=values.map((value,index)=>point(index,Math.max(value,.15)).join(',')).join(' ')
      return <g key={seriesIndex} className="radar-series"><polygon points={points} fill={color} fillOpacity={series.length>1?.12:.18} stroke={color} strokeWidth="2" strokeLinejoin="round"/>{values.map((value,index)=>value?<circle key={index} cx={point(index,value)[0]} cy={point(index,value)[1]} r="3.2" style={{ fill: 'var(--surface, #fff)' }} stroke={color} strokeWidth="2"/>:null)}</g>
    })}
  </svg>
}

export function Stars({value}){
  if(value==null)return <span className="stars empty">暂无评分</span>
  return <span className={'stars rating-'+value} aria-label={`培养体验评分 ${value} / 5`}>{[1,2,3,4,5].map(n=><Star key={n} size={13} fill={n<=value?'currentColor':'none'} aria-hidden="true"/>)}<b>{value}</b></span>
}

export function Avatar({name,size=52,tone}){
  const palette=[['#2563eb','#1d4b8f'],['#0284c7','#0369a1'],['#4f46e5','#3730a3'],['#0d9488','#0f766e'],['#2563eb','#1e40af'],['#0ea5e9','#0369a1']]
  const [top,bottom]=palette[[...name].reduce((sum,char)=>sum+char.charCodeAt(0),0)%palette.length]
  return <span className={'mentor-avatar'+(tone?' tone-'+tone:'')} style={{width:size,height:size,fontSize:size*.4,background:`linear-gradient(140deg,${top},${bottom})`}} aria-hidden="true">{name.slice(0,1)}</span>
}

function splitDirectionTags(str){
  return formatDisciplineText(str).split(/[、,，；;|\n]+/).map(s=>s.trim()).filter(Boolean)
}

export function MentorDossier({onAsk,busy}){
  const polaris=usePolaris(),w=useWorkspace(),toast=useToast(),target=polaris.dossier
  const insight=target?polaris.lookup(target):null
  const [detail,setDetail]=useState(null),[detailError,setDetailError]=useState(''),[axis,setAxis]=useState(null),[emailCopied,setEmailCopied]=useState(false)
  const emailTimer=useRef(null)
  useEffect(()=>()=>clearTimeout(emailTimer.current),[])
  useEffect(()=>{setDetail(null);setDetailError('');setAxis(null);setEmailCopied(false);if(!insight?.key)return;let current=true;api('/workbench/mentors/'+insight.key).then(row=>{if(current)setDetail(row)}).catch(err=>{if(current)setDetailError(err?.message||'档案详情加载失败')});return()=>{current=false}},[insight?.key])
  async function copyEmail(){
    if(!insight?.email)return
    try{
      await navigator.clipboard.writeText(insight.email)
      setEmailCopied(true)
      clearTimeout(emailTimer.current)
      emailTimer.current=setTimeout(()=>setEmailCopied(false),1800)
      toast.success('邮箱已复制')
    }catch{
      toast.error('复制邮箱失败，请手动复制')
    }
  }
  if(!target)return null
  const close=polaris.closeMentor
  const backLabel=polaris.previousDossier?`返回${polaris.previousDossier.name}`:polaris.dossierOrigin?.label||(w?.view?'返回候选库':'返回对话')
  const backBtn=<button type="button" className="dossier-back-btn" onClick={close}><ArrowLeft size={14} aria-hidden="true"/><span>{backLabel}</span></button>
  const originList=!polaris.previousDossier&&polaris.dossierOrigin?.list?.length>1?polaris.dossierOrigin:null
  const stepControls=originList?<div className="dossier-step-nav" role="group" aria-label="切换前后导师">
    <span className="dossier-step-pos" aria-hidden="true">{originList.index+1} / {originList.list.length}</span>
    <button type="button" className="icon-button dossier-step-btn" disabled={originList.index<=0} aria-label="上一位导师" title="上一位导师" onClick={()=>polaris.stepMentor(-1)}><ChevronLeft size={16}/></button>
    <button type="button" className="icon-button dossier-step-btn" disabled={originList.index>=originList.list.length-1} aria-label="下一位导师" title="下一位导师" onClick={()=>polaris.stepMentor(1)}><ChevronRight size={16}/></button>
  </div>:null
  if(!insight)return <Dialog title="导师档案" leading={backBtn} headerActions={stepControls} onClose={close}><p className="dossier-missing">暂未收录 {target.name} 的资料。</p></Dialog>

  const match=polaris.match(insight),saved=w?.state?.items.some(item=>item.key===insight.key)
  const bad=insight.flags.filter(flag=>flag.tone==='bad'),good=insight.flags.filter(flag=>flag.tone==='good'),notes=insight.flags.filter(flag=>flag.tone==='note')
  const ask=text=>{polaris.dismissMentorAll();w?.close?.();onAsk?.(text)}
  const who=`${insight.name}（${insight.college}）`
  const axisInfo=axis&&insight.fingerprint[axis]
  const meaningfulAcademic=formatAcademicSummary(insight.academicSummary,insight.title)
  const facts=detail&&w?.state?w.state.fieldOptions.filter(field=>!['rating','green_flags','red_flags','actual_supervisor'].includes(field.key)&&detail[field.key]!=null&&detail[field.key]!==''):[]
  const officialOnly=!insight.evidence.personal&&!insight.evidence.team&&!insight.flags.length&&insight.rating==null
  const admissionsText=[insight.doctoralPrograms,insight.admissions].filter(Boolean).map(formatDisciplineText).join('\n')
  const formatFactValue=field=>{
    if(['doctoral_evidence','profile_evidence','admissions','programs','research_evidence','research_areas'].includes(field.key))return formatDisciplineText(display(detail[field.key],field))
    if(field.key==='academic_summary')return formatAcademicSummary(detail[field.key],insight.title)||display(detail[field.key],field)
    return display(detail[field.key],field)
  }
  const bioText=formatDisciplineText(insight.biography)
  const projectsText=formatDisciplineText(insight.projects)
  const achievementsText=formatDisciplineText(insight.achievements)
  const officialCards=[
    bioText&&['个人简介',bioText],
    admissionsText&&['指导学科与招生',admissionsText],
    projectsText&&['主持科研项目',projectsText],
    achievementsText&&['代表性成果与奖项',achievementsText],
  ].filter(Boolean)

  const directionTags=splitDirectionTags(insight.directions)
  const keyTrainFacts=[
    detail?.internship&&['实习安排',detail.internship],
    detail?.stipend_text&&['补助标准',detail.stipend_text],
    detail?.management&&['日常管理',detail.management],
    detail?.graduation&&['毕业与去向',detail.graduation],
  ].filter(Boolean)

  const supplementCards=[
    admissionsText&&['指导学科与招生专业',admissionsText],
    meaningfulAcademic&&['学术与科研平台',meaningfulAcademic],
    insight.enrollmentSignal&&['生源与学生选择',insight.enrollmentSignal],
    bioText&&['教师简介',bioText],
    projectsText&&['科研项目',projectsText],
    achievementsText&&['代表性成果',achievementsText],
  ].filter(Boolean)

  const hasRichReviewFlags=bad.length+good.length>=4

  return <Dialog title="导师档案" leading={backBtn} headerActions={stepControls} className="dossier-modal" onClose={close}>
    <div className="dossier">
      <header className="dossier-hero">
        <div className="dossier-hero-top">
          <Avatar name={insight.name} size={56} tone={bad.length?'risk':undefined}/>
          <div className="dossier-identity">
            <div className="dossier-name-line">
              <h3>{insight.name}</h3>
              {insight.doctoral&&<span className="badge-doctoral"><GraduationCap size={12}/>博导</span>}
              {insight.title&&<span className="dossier-role-pill">{insight.title}</span>}
              <Stars value={insight.rating}/>
            </div>
            <p className="dossier-affil">
              <span>{[insight.college,insight.group].filter(Boolean).join(' · ')}</span>
              <span className={'evidence-level level-'+(insight.evidence.level==='详实'?'rich':insight.evidence.level==='暂无评价'?'none':'some')}>
                <Sparkles size={11} aria-hidden="true"/>评价{insight.evidence.level} · {insight.evidence.sources}个来源{insight.evidence.personal?' · 含个人评价':''}
              </span>
              {insight.students!=null&&<span className="dossier-roster-pill">2026名册 {insight.students}人（研{insight.exam??0} / 保{insight.recommended??0}）</span>}
            </p>
          </div>
          <div className="dossier-hero-side">
            {match&&<div className="dossier-match"><MatchRing match={match} size={46}/><small>契合度</small></div>}
            <ExportMenu variant="compact" label="导出档案" ariaLabel={`导出 ${insight.name} 导师档案`} formats={['pdf','docx','xlsx','md']} getPayload={format => ({ kind: 'dossier', format, key: insight.key, name: insight.name, college: insight.college })} onSuccess={({ filename }) => w?.setMessage?.(`已导出 ${filename}`)} onError={err => w?.fail?.(err)} />
            {w?.state&&<button type="button" className={'dossier-save-btn'+(saved?' is-on':'')} disabled={w.pending} onClick={()=>w.saveMentor({key:insight.key,name:insight.name,college:insight.college}).catch(()=>{})}>
              <Bookmark size={14} fill={saved?'currentColor':'none'} aria-hidden="true"/>
              {saved?'已在候选库':'加入候选库'}
            </button>}
          </div>
        </div>
        {(directionTags.length>0||insight.email||insight.homepage)&&<div className="dossier-hero-bar">
          {directionTags.length>0&&<div className="dossier-dir-row">
            <b>研究方向</b>
            <div className="dossier-dir-tags">{directionTags.map(tag=><span key={tag} className="dossier-dir-tag">{tag}</span>)}</div>
          </div>}
          {(insight.email||insight.homepage)&&<div className="dossier-contact-links">
            {insight.email&&<span className="dossier-email-group"><a href={'mailto:'+insight.email} className="dossier-link-pill"><Mail size={12} aria-hidden="true"/>{insight.email}</a><button type="button" className={'dossier-copy-email'+(emailCopied?' is-copied':'')} aria-label="复制邮箱" title={`复制邮箱 ${insight.email}`} onClick={copyEmail}>{emailCopied?<Check size={12} aria-hidden="true"/>:<Copy size={12} aria-hidden="true"/>}</button></span>}
            {insight.homepage&&<a href={insight.homepage} target="_blank" rel="noopener noreferrer" className="dossier-link-pill"><ExternalLink size={12} aria-hidden="true"/>官网主页</a>}
          </div>}
        </div>}
      </header>

      {insight.supervisor&&<div className="dossier-supervisor" role="note"><Users size={16}/><div><b>实际带教：{insight.supervisor.name}</b><span>{insight.supervisor.evidence}</span></div><button className="text-button" onClick={()=>polaris.openMentor({name:insight.supervisor.name,college:insight.college})}>看{insight.supervisor.name}的档案</button></div>}
      {insight.quote&&<blockquote className="dossier-quote"><Quote size={15} aria-hidden="true"/><p>{insight.quote}</p><cite>学生评价归纳</cite></blockquote>}

      {officialOnly&&officialCards.length>0?<section className="dossier-official" aria-label="学校官网学术档案">
        <div className="dossier-official-head"><h4><GraduationCap size={15}/>学校官网学术档案</h4><span>暂无学生匿名评价 · 提取自北邮教师主页</span></div>
        <div className="dossier-official-grid">{officialCards.map(([title,body])=><div key={title} className="dossier-official-card"><b>{title}</b><p>{body}</p></div>)}</div>
      </section>:<div className="dossier-grid">
        <section className="dossier-radar">
          <div className="dossier-card-head"><h4>培养画像</h4><small>{Object.values(insight.fingerprint).filter(Boolean).length} / 6 维有记录</small></div>
          <Radar series={[{fingerprint:insight.fingerprint}]} size={208} active={axis} onAxis={key=>setAxis(axis===key?null:key)}/>
          <div className="radar-mini-pills" role="group" aria-label="六维分值速览">
            {fingerprintAxes.map(a=>{
              const val=insight.fingerprint[a.key]?.value
              return <button type="button" key={a.key} className={'radar-mini-pill'+(axis===a.key?' is-on':'')+(val==null?' is-empty':'')} onClick={()=>setAxis(axis===a.key?null:a.key)}>
                <span>{SHORT_AXIS[a.key]||a.label.slice(0,2)}</span>
                <strong>{val!=null?val:'—'}</strong>
              </button>
            })}
          </div>
          <p className="radar-hint">{axisInfo?<><b>{axisInfo.value} / 5 · </b>{axisInfo.evidence.join('；')||'依据评分'}</>:axis?'这一项暂无评价记录':'点击维度查看归纳依据；缺失项代表暂无评价记录。'}</p>
        </section>

        <div className="dossier-right-col">
          <section className="dossier-flags">
            {bad.length>0&&<div className="flag-group tone-bad"><h4><ShieldAlert size={15}/>需要看清的风险 · {bad.length}</h4><ul>{bad.map(flag=><li key={flag.id}><b>{flag.label}</b>{flag.scope==='团队'&&<small>团队资料</small>}<span>{flag.evidence.map(text=>'“'+text+'”').join(' ')}</span></li>)}</ul></div>}
            {good.length>0&&<div className="flag-group tone-good"><h4><BadgeCheck size={15}/>学生认可的地方 · {good.length}</h4><ul>{good.map(flag=><li key={flag.id}><b>{flag.label}</b>{flag.scope==='团队'&&<small>团队资料</small>}<span>{flag.evidence.map(text=>'“'+text+'”').join(' ')}</span></li>)}</ul></div>}
            {notes.length>0&&<div className="flag-group tone-note"><h4><Info size={15}/>值得留意</h4><div className="flag-chips">{notes.map(flag=><span key={flag.id} className="flag-chip tone-note" title={flag.evidence.join('；')}>{flag.label}</span>)}</div></div>}
            {!insight.flags.length&&<p className="dossier-empty">暂无具体标签归纳，详见下方指导学科与公开资料。</p>}
          </section>

          {!hasRichReviewFlags&&keyTrainFacts.length>0&&<section className="dossier-bento-card">
            <h4><FileCheck2 size={14} aria-hidden="true"/>培养细节记录</h4>
            <dl className="dossier-kv-grid">{keyTrainFacts.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </section>}

          {!hasRichReviewFlags&&supplementCards.length>0&&<section className="dossier-bento-card dossier-bento-fill">
            <h4><BookOpen size={14} aria-hidden="true"/>学术背景与招生学科</h4>
            <div className="dossier-supp-list">
              {supplementCards.slice(0,4).map(([title,body])=><div key={title} className="dossier-supp-item"><b>{title}</b><p>{body}</p></div>)}
            </div>
          </section>}

          {!supplementCards.length&&!hasRichReviewFlags&&<section className="dossier-bento-card dossier-bento-fill">
            <h4><FileCheck2 size={14} aria-hidden="true"/>档案核验概览</h4>
            <div className="dossier-supp-list">
              <div className="dossier-supp-item">
                <b>数据交叉核验</b>
                <p>已汇总 {insight.evidence.sources} 份公开资料与评价记录{insight.group?`（所属团队：${insight.group}）`:''}。{insight.evidence.personal?'包含针对导师本人的培养体验反馈。':insight.evidence.team?'当前评价主要来自所在教研室/课题组整体反馈，建议面谈时进一步确认个人带教细节。':'可通过下方按钮让北极星深度检索对比同方向导师。'}</p>
              </div>
            </div>
          </section>}
        </div>
      </div>}

      {!officialOnly&&hasRichReviewFlags&&supplementCards.length>0&&<section className="dossier-bento-card">
        <h4><BookOpen size={14} aria-hidden="true"/>学术背景与招生学科</h4>
        <div className="dossier-supp-grid">
          {supplementCards.slice(0,4).map(([title,body])=><div key={title} className="dossier-supp-item"><b>{title}</b><p>{body}</p></div>)}
        </div>
      </section>}

      {onAsk&&<div className="dossier-ask" aria-label="让北极星继续">
        <button disabled={busy} onClick={()=>ask(`详细分析${who}适不适合我，结合我的画像，把优点和风险都讲清楚并列出评价依据。`)}><UserRoundSearch size={15}/>适合我吗？</button>
        <button disabled={busy} onClick={()=>ask(`${who}有哪些坑？把评价里的负面记录和限制条件都列出来，给出评价依据。`)}><ShieldAlert size={15}/>有什么坑？</button>
        <button disabled={busy} onClick={()=>ask(`找3–5位和${who}风格相似、但风险更少的导师，和他放在一起对比。`)}><MessageCircleQuestion size={15}/>找相似导师</button>
        <button disabled={busy} onClick={()=>ask(`帮我给${who}写一封套磁邮件，结合他的研究方向和我的画像，未提供的个人信息留空。`)}><PenLine size={15}/>写套磁信</button>
      </div>}

      {insight.key&&!detail&&!detailError&&<DossierDetailSkeleton/>}
      {detailError&&<p className="dossier-detail-error" role="status">{detailError}</p>}
      {facts.length>0&&<details className="dossier-facts" open={officialOnly&&!officialCards.length?true:undefined}><summary>查看原始档案字段与核验来源（{detail?.sources?.length||insight.evidence.sources} 项来源）</summary><dl>{facts.map(field=><div key={field.key}><dt>{field.label}</dt><dd>{formatFactValue(field)}</dd></div>)}</dl>{detail.sources?.length>0&&<p className="dossier-sources">来源：{detail.sources.map(source=>source.url?<a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>:<span key={source.id}>{source.title}</span>)}</p>}</details>}
    </div>
  </Dialog>
}

/** Side-by-side duel: overlaid fingerprints, per-axis winners and every risk in plain sight. */
export function DuelPanel({rows}){
  const polaris=usePolaris()
  const people=rows.map(row=>({row,insight:polaris.lookup(row)})).filter(item=>item.insight)
  if(people.length<2)return null
  const isDup=insight=>people.filter(p=>p.insight.name===insight.name).length>1
  const series=people.map((item,index)=>({name:isDup(item.insight)?`${item.insight.name}（${item.insight.college.replace(/学院$/,'')}）`:item.insight.name,fingerprint:item.insight.fingerprint,color:radarColors[index%radarColors.length]}))
  const radarSeries=series.slice(0,4)
  const winners=fingerprintAxes.map(axis=>{
    const scored=people.map((item,index)=>({index,value:item.insight.fingerprint[axis.key]?.value})).filter(item=>item.value!=null)
    if(scored.length<2)return null
    const best=Math.max(...scored.map(item=>item.value)),top=scored.filter(item=>item.value===best)
    return top.length===1?{axis:axis.label,winner:people[top[0].index].insight.name,value:best}:null
  }).filter(Boolean)
  return <section className="duel-panel" aria-label="导师对决">
    <div className="duel-radar"><Radar series={radarSeries} size={260}/>
      <div className="duel-legend">{radarSeries.map((item,index)=><span key={index}><i style={{background:item.color}}/>{item.name}</span>)}</div>
      {series.length>radarSeries.length&&<p className="duel-cap-note">雷达图展示前 {radarSeries.length} 位，右侧列出全部 {series.length} 位对比</p>}
    </div>
    <div className="duel-people" style={{'--duel-columns':Math.min(people.length,4)}}>{people.map(({insight},index)=>{
      const color=radarColors[index%radarColors.length]
      const won=winners.filter(item=>item.winner===insight.name)
      const dup=isDup(insight)
      return <article className="duel-person" key={insight.key} style={{'--duel-color':color}}>
        <header><div><button className="duel-name" onClick={()=>polaris.openMentor(insight)}>{insight.name}</button>{dup&&<small className="duel-college">{insight.college}</small>}</div><Stars value={insight.rating}/></header>
        {won.length>0&&<p className="duel-wins">胜出：{won.map(item=>item.axis).join('、')}</p>}
        <FlagChips insight={insight} tones={['bad']}/>
        <FlagChips insight={insight} tones={['good']}/>
        {insight.supervisor&&<p className="duel-supervisor">实际带教：{insight.supervisor.name}</p>}
      </article>
    })}</div>
  </section>
}

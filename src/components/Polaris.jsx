import React,{useState} from 'react'
import {ArrowRight,Filter,ImageDown,LoaderCircle} from 'lucide-react'
import {APP_NAME,APP_EN,STAR_PATH} from '../../lib/brand.js'
import {usePolaris} from '../insights.jsx'
import {useWorkspace} from '../workspace.jsx'
import {useToast} from '../toast.jsx'
import {profileChips} from '../../lib/profile.js'

/** Brand mark: a four-point north star on a night-sky tile. */
export function PolarisMark({size=34,className=''}){
  return <span className={'polaris-mark '+className} style={{width:size,height:size}} aria-hidden="true">
    <svg viewBox="0 0 32 32"><path d={STAR_PATH} transform="translate(0 1.5)"/><circle cx="26" cy="5" r="1.2" className="spark"/></svg>
  </span>
}

export function AgentMark({small=false}){
  return <PolarisMark size={small?26:34} className={small?'small':''}/>
}

const datasetBase={search:'相关方向',query:'筛选',join:'关联',aggregate:'统计',visualize:'最终名单'}
/** Funnel theatre: shows how the candidate pool narrows, built from real tool counts. */
export function Funnel({activity,total,running}){
  const steps=(activity||[]).filter(step=>Number.isFinite(step.count)&&step.count>0&&step.tool!=='aggregate'&&step.tool!=='join'&&!['exams','students','reviews','sources'].includes(step.dataset))
  if(!steps.length||!total)return null
  const points=[{label:'全部导师',count:total,base:true},...steps.map(step=>({label:step.tool==='visualize'?'最终名单':step.label.replace(/^(查阅|检索|筛选|整理)/,'$1'),count:step.count,tool:step.tool}))]
  // Collapse identical consecutive counts so the story stays readable.
  const story=points.filter((point,index)=>index===0||point.count!==points[index-1].count||point.tool==='visualize').filter((point,index,list)=>!(list[index+1]?.tool==='visualize'&&list[index+1].count===point.count&&index>0)).slice(-6)
  const max=Math.max(...story.map(point=>point.count),1)
  return <div className={'funnel'+(running?' is-running':'')} aria-label={'筛选漏斗：'+story.map(point=>`${point.label}${point.count}`).join('，')}>
    <span className="funnel-icon"><Filter size={13}/></span>
    {story.map((point,index)=><React.Fragment key={index}>
      {index>0&&<ArrowRight size={12} className="funnel-arrow" aria-hidden="true"/>}
      <span className={'funnel-step'+(index===story.length-1?' last':'')} style={{'--w':Math.max(.18,Math.log10(point.count+1)/Math.log10(max+1))}} title={point.label}>
        <b>{point.count}</b><small>{datasetBase[point.tool]||point.label}</small>
      </span>
    </React.Fragment>)}
    {running&&<LoaderCircle size={13} className="spin funnel-live" aria-hidden="true"/>}
  </div>
}

/** Context-aware next steps. Clicking one is the same as saying it, or runs a direct workspace action. */
export function FollowUps({message,rankings,onFollowUp}){
  const {lookup}=usePolaris(),workspace=useWorkspace()
  const rows=rankings.flatMap(table=>table.rows)
  const name=row=>`${row.name||row.mentor_name}${row.college?`（${row.college}）`:''}`
  const items=[]
  const saveToLibrary=list=>{
    const mentors=list.map(r=>({name:r.name||r.mentor_name,college:r.college})).filter(m=>m.name)
    if(!workspace?.state||!mentors.length)return onFollowUp('把这份名单里的导师都收藏到我的候选库。')
    workspace.mutate('/workbench/items','POST',{mentors}).then(()=>{workspace.setMessage(`已将 ${mentors.length} 位导师收入候选库`);workspace.open('library')}).catch(()=>onFollowUp('把这份名单里的导师都收藏到我的候选库。'))
  }
  if(rows.length>=2)items.push({text:'对决前两位',action:()=>onFollowUp(`把${name(rows[0])}和${name(rows[1])}放在一起对决：按我的画像逐项比较，谁在哪一项胜出，各自最大的风险是什么。`)})
  if(rows.length)items.push({text:'这些人有什么坑？',action:()=>onFollowUp('把这份名单里每位导师评价中的风险和限制条件逐一列出来，给出评价依据，没有风险记录的也说明。')})
  if(rows.length)items.push({text:`给${rows[0].name||rows[0].mentor_name}写套磁信`,action:()=>onFollowUp(`帮我给${name(rows[0])}写一封套磁邮件，结合他的研究方向和我的画像，未提供的个人信息留空。`)})
  if(rows.length)items.push({text:'全部收入候选库',action:()=>saveToLibrary(rows)})
  if(rankings.length&&rows.length>3)items.push({text:'查看全部相关导师',action:()=>onFollowUp('把你这次查到的全部相关导师列出来，我想自己比较，不限这几位推荐。')})
  if(rankings.length===1&&rows.length>3)items.push({text:'对比前3位',action:()=>onFollowUp(`把这3位导师放在一起比较，帮我看清与我的要求有关的主要差别：${rows.slice(0,3).map(name).join('、')}。`)})
  if(!rows.length){
    const artifactMentors=(message.artifacts||[]).flatMap(a=>(a.rows||[]).map(r=>lookup(r)).filter(Boolean))
    const textMatches=[...(message.content||'').matchAll(/\*\*([\u4e00-\u9fa5·]{2,8})\*\*/gu)].map(m=>lookup({name:m[1]})).filter(Boolean)
    const uniqueMentors=[...new Map([...artifactMentors,...textMatches].map(m=>[m.key,m])).values()]
    const content=message.content||''
    const isColdEmail=/主题[：:]|尊敬的.{1,6}(?:老师|教授)|祝好|此致|敬礼/.test(content)&&/邮件|联系|套磁|自荐/.test(content)
    const isScoreTopic=/初试|复试|录取|均分|中位分|分段/.test(content)
    if(isColdEmail&&uniqueMentors.length>=1){
      const target=uniqueMentors[0]
      items.push({text:'精简为200字微信/短邮件版',action:()=>onFollowUp(`把上面给${target.name}（${target.college}）的套磁信精简成200字以内、手机一眼能读完的版本，保留最打动老师的核心匹配点。`)})
      items.push({text:`${target.name}面谈前要问清什么？`,action:()=>onFollowUp(`如果${target.name}（${target.college}）回复了邮件约面谈，结合他的评价和团队情况，我最应该向他和师兄师姐核实哪几个关键问题？`)})
    }else if(uniqueMentors.length>=2){
      const pair=uniqueMentors.slice(0,2)
      items.push({text:`对决 ${pair[0].name} vs ${pair[1].name}`,action:()=>onFollowUp(`把${pair[0].name}（${pair[0].college}）和${pair[1].name}（${pair[1].college}）放在一起逐项对决：看清科研平台、实习自由度、补助和各自最大的风险。`)})
      items.push({text:`给${pair[0].name}写套磁信`,action:()=>onFollowUp(`帮我给${pair[0].name}（${pair[0].college}）写一封套磁邮件，结合他的研究方向和我的画像，未提供的个人信息留空。`)})
      items.push({text:'收入候选库',action:()=>saveToLibrary(uniqueMentors.slice(0,6))})
    }else if(uniqueMentors.length===1){
      const m=uniqueMentors[0]
      items.push({text:`${m.name}有哪些风险与限制？`,action:()=>onFollowUp(`${m.name}（${m.college}）有哪些坑或限制条件？把评价里的负面记录和注意事项逐条列出来并给出评价依据。`)})
      items.push({text:'找风格相近但更稳妥的导师',action:()=>onFollowUp(`找3–5位和${m.name}（${m.college}）研究方向相近、但培养体验更好或风险更少的导师，放在一起对比。`)})
      items.push({text:`给${m.name}写套磁信`,action:()=>onFollowUp(`帮我给${m.name}（${m.college}）写一封套磁邮件，结合他的研究方向和我的画像，未提供的个人信息留空。`)})
    }
    if(isScoreTopic)items.push({text:'按我的分数推荐冲稳保名单',action:()=>onFollowUp('结合刚才的历史初试与复试数据，帮我按“冲刺、稳妥、保底”三档推荐具体导师，并注明各自风险。')})
    if(content)items.push({text:'有类似的导师吗？',action:()=>onFollowUp('按刚才讨论的条件，再推荐几位类似的导师，并点出各自的风险。')})
  }
  const deduped=[...new Map(items.map(item=>[item.text,item])).values()]
  if(!deduped.length)return null
  return <div className="answer-followups" aria-label="下一步">{deduped.slice(0,5).map(item=><button key={item.text} onClick={item.action}>{item.text}</button>)}</div>
}

function wrap(context,text,width){
  const lines=[];let line=''
  for(const char of text){if(context.measureText(line+char).width>width&&line){lines.push(line);line=''};line+=char}
  if(line)lines.push(line)
  return lines
}
function roundRect(context,x,y,w,h,r){context.beginPath();context.moveTo(x+r,y);context.arcTo(x+w,y,x+w,y+h,r);context.arcTo(x+w,y+h,x,y+h,r);context.arcTo(x,y+h,x,y,r);context.arcTo(x,y,x+w,y,r);context.closePath()}

function fitText(context,text,maxWidth){
  const str=String(text||'')
  if(!str||context.measureText(str).width<=maxWidth)return str
  let out=str
  while(out.length>1&&context.measureText(out+'…').width>maxWidth)out=out.slice(0,-1)
  return out+'…'
}

/** Render a shareable PNG card (4:5) for a recommendation list. */
export async function renderShareCard({title,rows,lookup,profile,match}){
  if(document.fonts?.ready){try{await document.fonts.ready}catch{}}
  const W=1080,H=1350,canvas=document.createElement('canvas'),context=canvas.getContext('2d')
  canvas.width=W;canvas.height=H
  const font=(size,weight=400)=>`${weight} ${size}px "PingFang SC","Microsoft YaHei UI","Microsoft YaHei","Hiragino Sans GB","Segoe UI",system-ui,-apple-system,sans-serif`
  const sky=context.createLinearGradient(0,0,W,H);sky.addColorStop(0,'#f8fafc');sky.addColorStop(0.55,'#f1f6fe');sky.addColorStop(1,'#e8f1ff')
  context.fillStyle=sky;context.fillRect(0,0,W,H)
  const topBar=context.createLinearGradient(0,0,W,0);topBar.addColorStop(0,'#1d4b8f');topBar.addColorStop(0.6,'#2563eb');topBar.addColorStop(1,'#0d9488')
  context.fillStyle=topBar;context.fillRect(0,0,W,10)
  const tile=context.createLinearGradient(72,64,140,132);tile.addColorStop(0,'#2457a4');tile.addColorStop(1,'#163768')
  context.fillStyle=tile;roundRect(context,72,64,68,68,18);context.fill()
  context.save();context.translate(82,74);context.scale(1.5,1.5);context.fillStyle='#fbbf24';context.fill(new Path2D(STAR_PATH));context.restore()
  context.fillStyle='#0f172a';context.font=font(38,700);context.fillText(APP_NAME,160,104)
  context.fillStyle='#4b5869';context.font=font(22,400);context.fillText(`${APP_EN} · 评价归纳择导卡`,160,136)
  const dateStr=new Date().toLocaleDateString('sv-SE'),safeRows=Array.isArray(rows)?rows:[],list=safeRows.slice(0,6)
  const countNote=safeRows.length>list.length?`展示前 ${list.length} / 共 ${safeRows.length} 位`:`共 ${safeRows.length} 位候选`
  context.fillStyle='#556274';context.font=font(20,400);context.textAlign='right';context.fillText(`${dateStr} · ${countNote}`,W-72,108);context.textAlign='left'
  context.fillStyle='#0f172a';context.font=font(46,700)
  let y=220
  const titleLines=wrap(context,String(title||'导师推荐名单'),W-144)
  titleLines.slice(0,2).forEach((line,idx)=>{
    const shownLine=idx===1&&titleLines.length>2?fitText(context,line+'…',W-144):line
    context.fillText(shownLine,72,y);y+=60
  })
  const allChips=profileChips(profile)
  if(allChips.length){
    context.font=font(20,600);let x=72;y+=6
    for(const chip of allChips){
      const w=context.measureText(chip.text).width+32
      if(x+w>W-72&&x>72){x=72;y+=44}
      context.fillStyle='#edf4ff';roundRect(context,x,y-28,w,38,19);context.fill();context.strokeStyle='#c7daf7';context.lineWidth=1.5;context.stroke();context.fillStyle='#1d4b8f';context.fillText(chip.text,x+16,y-2);x+=w+9
    }
    y+=38
  }
  y+=14
  const cardH=Math.min(162,Math.floor((H-y-136)/Math.max(list.length,1))-14)
  list.forEach((row,index)=>{
    const insight=lookup?.(row),top=y+index*(cardH+14)
    context.save()
    context.shadowColor='rgba(15,23,42,0.06)';context.shadowBlur=18;context.shadowOffsetY=5
    context.fillStyle='#ffffff';roundRect(context,56,top,W-112,cardH,22);context.fill()
    context.restore()
    context.strokeStyle='#dbe4f0';context.lineWidth=1.8;roundRect(context,56,top,W-112,cardH,22);context.stroke()
    const medalFill=index===0?'#fef9ec':index<3?'#edf4ff':'#f1f5f9'
    const medalText=index===0?'#854d0e':index<3?'#1d4b8f':'#334155'
    context.fillStyle=medalFill;roundRect(context,88,top+cardH/2-26,52,52,16);context.fill()
    context.fillStyle=medalText;context.font=font(27,700);context.textAlign='center';context.fillText(String(index+1),114,top+cardH/2+10);context.textAlign='left'
    const ratingRaw=row.rating??insight?.rating
    const mScore=match&&insight?match(insight):null
    let rightEdge=W-84
    if(ratingRaw!=null&&Number.isFinite(Number(ratingRaw))){
      const rInt=Math.max(0,Math.min(5,Math.round(Number(ratingRaw))))
      context.fillStyle='#d99b26';context.font=font(24,600)
      const stars='★'.repeat(rInt)+'☆'.repeat(5-rInt)
      context.textAlign='right';context.fillText(stars,rightEdge,top+44);context.textAlign='left'
      rightEdge-=context.measureText(stars).width+16
    }
    if(mScore){context.font=font(19,700);const mLabel=`契合 ${mScore.score}%`,mw=context.measureText(mLabel).width+24;context.fillStyle=mScore.score>=75?'#eaf7f0':'#fef9ec';roundRect(context,rightEdge-mw,top+19,mw,32,16);context.fill();context.fillStyle=mScore.score>=75?'#146c43':'#854d0e';context.fillText(mLabel,rightEdge-mw+12,top+41);rightEdge-=mw+14}
    context.fillStyle='#0f172a';context.font=font(33,700)
    const safeName=fitText(context,row.name||row.mentor_name||'导师',Math.max(120,rightEdge-240))
    context.fillText(safeName,164,top+46)
    let metaX=178+context.measureText(safeName).width
    if(insight?.doctoral&&metaX+72<rightEdge){
      context.font=font(18,700);const dw=context.measureText('博导').width+22
      context.fillStyle='#edf4ff';roundRect(context,metaX,top+20,dw,30,15);context.fill()
      context.fillStyle='#1d4b8f';context.fillText('博导',metaX+11,top+41)
      metaX+=dw+12
    }
    const rawCollege=row.college||insight?.college||''
    context.fillStyle='#4b5869';context.font=font(21,400)
    if(rawCollege&&metaX<rightEdge-40)context.fillText(fitText(context,rawCollege,rightEdge-metaX-12),metaX,top+44)
    let x=164,flagY=top+64
    const flags=insight?[...insight.flags.filter(flag=>flag.tone==='bad'),...insight.flags.filter(flag=>flag.tone==='good')]:[]
    if(flags.length){
      context.font=font(18,600)
      for(const flag of flags){
        const w=context.measureText(flag.label).width+24
        if(x+w>W-80&&x>164){
          if(flagY+66<=top+cardH){x=164;flagY+=35}else break
        }
        context.fillStyle=flag.tone==='bad'?'#fef2f2':'#eaf7f0';roundRect(context,x,flagY,w,30,15);context.fill();context.strokeStyle=flag.tone==='bad'?'#f8c9c5':'#bce3cd';context.lineWidth=1.3;context.stroke();context.fillStyle=flag.tone==='bad'?'#b42318':'#146c43';context.fillText(flag.label,x+12,flagY+21.5);x+=w+7
      }
    }else{
      const fallbackLine=insight?.directions||row.personal_directions||row.directions||insight?.academicSummary||(ratingRaw!=null?`学生培养体验评分 ${ratingRaw} / 5 · 详见北极星导师档案`:'')
      if(fallbackLine){
        context.fillStyle='#4b5869';context.font=font(20,400)
        context.fillText(fitText(context,String(fallbackLine).replace(/\n/g,' '),W-252),164,top+cardH-28)
      }
    }
  })
  context.fillStyle='#dbe4f0';context.fillRect(72,H-116,W-144,1.5)
  context.fillStyle='#4b5869';context.font=font(21);context.fillText('基于学生评价与学校公开档案归纳 · 正负面标签如实呈现',72,H-70)
  context.fillStyle='#1d4b8f';context.font=font(21,700);context.textAlign='right';context.fillText(`${APP_NAME} ${APP_EN}`,W-72,H-70);context.textAlign='left'
  return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('择导卡生成失败，请重试')),'image/png'))
}

export function ShareCardButton({artifact}){
  const {lookup,profile,match}=usePolaris(),w=useWorkspace(),toast=useToast(),[busy,setBusy]=useState(false)
  async function share(){
    setBusy(true)
    try{
      const blob=await renderShareCard({title:artifact.title,rows:artifact.rows,lookup,profile,match})
      const safeTitle=String(artifact.title||'导师推荐').replace(/[\\/:*?"<>|\r\n]+/g,'_').trim().slice(0,48)||'导师推荐'
      const href=URL.createObjectURL(blob),link=document.createElement('a')
      link.href=href;link.download=`${APP_NAME}择导卡-${safeTitle}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(href),1500)
      toast.success(`已生成 ${APP_NAME}择导卡`)
    }catch(error){
      const msg=error.message||'择导卡生成失败'
      toast.error(msg)
      w?.setError?.(msg)
    }finally{setBusy(false)}
  }
  return <button className="share-card-button" onClick={share} disabled={busy} title="生成可分享的择导卡图片"><ImageDown size={14}/>{busy?'生成中…':'择导卡'}</button>
}

export function useCollegesFromData(data){return data?.metadata?.colleges||[]}
export {usePolaris}

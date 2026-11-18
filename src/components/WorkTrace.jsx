import React,{useEffect,useLayoutEffect,useRef,useState} from 'react'
import {AlertCircle,Check,ChevronDown,LoaderCircle} from 'lucide-react'

function elapsed(start,end){return Math.max(0,(end||Date.now())-Date.parse(start))}
function duration(ms){if(ms<1000)return '不到 1 秒';const sec=Math.floor(ms/1000);return sec<60?`${sec} 秒`:`${Math.floor(sec/60)} 分 ${String(sec%60).padStart(2,'0')} 秒`}

export default function WorkTrace({activity,running,status,isFollowing}) {
  const [open,setOpen]=useState(running),[,tick]=useState(0)
  const list=useRef(),followSteps=useRef(true),touchY=useRef(0)
  useLayoutEffect(()=>{if(running)setOpen(true);else if(isFollowing?.()!==false)setOpen(false)},[running,isFollowing])
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>tick(value=>value+1),1000);return()=>clearInterval(timer)},[running])
  useLayoutEffect(()=>{if(running&&followSteps.current&&list.current)list.current.scrollTop=list.current.scrollHeight},[activity.length,running])
  const failed=status==='error'||status==='canceled'
  const current=activity.findLast(step=>step.status==='running'),first=activity[0],last=activity.at(-1)
  const total=elapsed(first.startedAt,running?null:Date.parse(last.finishedAt||last.startedAt))
  return <details className={`tool-trace work-trace${running?'':' is-finished'}`} open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>{running?<LoaderCircle size={15} className="spin"/>:failed?<AlertCircle size={15}/>:<Check size={15}/>}<span>{running?current?.label||'正在处理':status==='error'?'未完成':status==='canceled'?'已停止':`已完成 · ${activity.length} 步`}</span><time>{duration(total)}</time><ChevronDown size={14} className="details-chevron"/></summary>
    <ol ref={list} className="work-steps tool-list" aria-label="处理进度" tabIndex={activity.length>4?0:undefined} onWheel={event=>{if(event.deltaY<0)followSteps.current=false}} onTouchStart={event=>{touchY.current=event.touches[0].clientY}} onTouchMove={event=>{const y=event.touches[0].clientY;if(y>touchY.current)followSteps.current=false;touchY.current=y}} onKeyDown={event=>{if(['ArrowUp','PageUp','Home'].includes(event.key))followSteps.current=false;if(event.key==='End')followSteps.current=true}} onScroll={event=>{const el=event.currentTarget;if(el.scrollHeight-el.clientHeight-el.scrollTop<4)followSteps.current=true}}>{activity.map(step=><li key={step.id} className={`work-step ${step.status}`}>
      <span className="work-step-icon">{step.status==='running'?<LoaderCircle size={13} className="spin"/>:step.status==='complete'?<Check size={12}/>:<AlertCircle size={12}/>}</span>
      <span className="work-step-label" role={step.status==='running'?'status':undefined}>{step.label}</span>
      <time>{duration(elapsed(step.startedAt,step.finishedAt?Date.parse(step.finishedAt):null))}</time>
    </li>)}</ol>
  </details>
}

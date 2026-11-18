import React,{useId,useRef,useState} from 'react'
import Artifact from './Charts.jsx'
import {resultTitle} from '../presentation.js'
import {useWorkspace} from '../workspace.jsx'
import {Bookmark} from 'lucide-react'
import {ShareCardButton} from './Polaris.jsx'

export default function Rankings({artifacts,onSources}){
  const workspace=useWorkspace(),[college,setCollege]=useState('')
  const [selected,setSelected]=useState(0),id=useId(),tabs=useRef([])
  const active=Math.min(selected,artifacts.length-1)
  const count=new Set(artifacts.flatMap(table=>table.rows.map(row=>`${row.college||''}:${row.name||row.mentor_name}`))).size
  const splitColleges=value=>(value||'').split(/[、,，]+/).map(s=>s.replace(/[（(].*$/,'').trim()).filter(Boolean)
  const colleges=[...new Set(artifacts.flatMap(table=>table.rows.flatMap(row=>splitColleges(row.college))))]
  const views=artifacts.map(table=>({...table,rows:college?table.rows.filter(row=>row.college===college||splitColleges(row.college).includes(college)):table.rows}))
  function navigate(event,index){
    const next=event.key==='ArrowRight'?(index+1)%artifacts.length:event.key==='ArrowLeft'?(index+artifacts.length-1)%artifacts.length:event.key==='Home'?0:event.key==='End'?artifacts.length-1:null
    if(next!=null){event.preventDefault();setSelected(next);tabs.current[next]?.focus()}
  }
  return <section className="recommendations" aria-label="导师推荐结果">
    {artifacts.length>1&&<div className="recommendations-heading"><h3>推荐名单</h3><span>{count} 位导师 · {artifacts.length} 组结果</span></div>}
    <div className="recommendations-bar">
      {artifacts.length>1&&<div className="recommendation-tabs" role="tablist" aria-label="推荐类别">{artifacts.map((artifact,index)=><button key={artifact.id} id={`${id}-tab-${index}`} ref={node=>tabs.current[index]=node} role="tab" aria-label={`${resultTitle(artifact)}，${artifact.rows.length}位`} aria-selected={active===index} aria-controls={`${id}-panel-${index}`} tabIndex={active===index?0:-1} title={artifact.title} onClick={()=>setSelected(index)} onKeyDown={event=>navigate(event,index)}><span>{resultTitle(artifact)}</span><small>{artifact.rows.length}</small></button>)}</div>}
      <div className="recommendation-controls">{colleges.length>1&&<select aria-label="筛选推荐学院" value={college} onChange={event=>setCollege(event.target.value)}><option value="">全部学院</option>{colleges.map(value=><option key={value}>{value}</option>)}</select>}{workspace?.state&&<button disabled={workspace.pending||!views[active]?.rows.length} onClick={()=>workspace.mutate('/workbench/items','POST',{mentors:views[active].rows.map(row=>({name:row.name||row.mentor_name,college:row.college}))}).then(()=>workspace.setMessage('已收藏本组导师')).catch(()=>{})}><Bookmark size={13}/>收藏本组</button>}{views[active]?.rows.length>0&&<ShareCardButton artifact={views[active]}/>}</div>
    </div>
    {artifacts.map((artifact,index)=><div key={artifact.id} id={`${id}-panel-${index}`} role={artifacts.length>1?'tabpanel':undefined} aria-labelledby={artifacts.length>1?`${id}-tab-${index}`:undefined} hidden={active!==index}>{views[index].rows.length?<Artifact artifact={views[index]} onSources={onSources}/>:<div className="table-empty">本分类没有该学院的候选。<button onClick={()=>setCollege('')}>查看全部学院</button></div>}</div>)}
  </section>
}

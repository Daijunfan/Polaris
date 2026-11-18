import React,{useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {ArrowLeft,Bookmark,Check,ChevronRight,Columns3,Download,ExternalLink,FolderPlus,History,LayoutGrid,ListFilter,Lock,Plus,Search,SlidersHorizontal,Star,Table2,Trash2,X} from 'lucide-react'
import Dialog from './Dialog.jsx'
import DataTable from './DataTable.jsx'
import {FlagChips} from './MentorInsight.jsx'
import {usePolaris} from '../insights.jsx'
import {AnalysisViews,ScenarioDifference} from './AnalysisViews.jsx'
import {comparisonGoals,differingComparisonFields,contactStatuses} from '../../lib/fields.js'
import {useWorkspace} from '../workspace.jsx'
import {api} from '../api.js'
import {display} from '../presentation.js'
import {Chart,pointColors} from './Charts.jsx'
import './workbench.css'

const statusNames=contactStatuses
const short=value=>{const str=String(value||'').replace(/\n/g,' ').trim();return str.length>240?str.slice(0,240)+'…':str}
const same=(a,b)=>a.key===b.key
const presets=comparisonGoals
const swallow=()=>{}
function FeatureButton({feature,children,onClick,className='secondary-button',disabled}){
  const w=useWorkspace()
  return <button className={className} disabled={disabled||w.pending} onClick={()=>{if(w.requireFeature(feature))onClick()}}>{children}</button>
}
function CollegeChart({items,onCollege,active}){
  const splitColleges=value=>(value||'').split(/[、,，]+/).map(s=>s.replace(/[（(].*$/,'').trim()).filter(Boolean)
  const allColleges=[...new Set(items.flatMap(item=>splitColleges(item.college)))]
  const counts=allColleges.map(college=>({college,count:items.filter(item=>splitColleges(item.college).includes(college)).length})).sort((a,b)=>b.count-a.count)
  const max=Math.max(1,...counts.map(row=>row.count))
  return <section className="workspace-chart"><header><h4>候选的学院分布</h4><small>{items.length}位已收藏导师</small></header>{counts.map(row=><button key={row.college} title={row.college} className={'college-bar'+(active===row.college?' selected':'')} onClick={()=>onCollege(active===row.college?'':row.college)}><span>{row.college.replace(/学院$/,'')}</span><i><b style={{width:row.count/max*100+'%'}}/></i><strong>{row.count}</strong></button>)}</section>
}
function MentorCard({person,onDetail,list,activeList}){
  const w=useWorkspace(),polaris=usePolaris(),saved=w.state.items.some(item=>same(item,person))
  const fallbackSummary=person.academic_summary&&person.academic_summary!==person.professional_title?person.academic_summary:null
  const directionText=person.personal_directions||person.research_areas||person.directions||fallbackSummary
  return <article className="mentor-tile">
    <header><div><button className="mentor-tile-name" onClick={()=>onDetail(person)}>{person.name}</button><small>{person.college}{person.group?' · '+person.group:''}</small></div><button className={'tile-save'+(saved?' saved':'')} aria-label={(saved?'取消收藏 ':'收藏 ')+person.name} disabled={w.pending} onClick={()=>w.saveMentor(person).catch(swallow)}><Bookmark size={17} fill={saved?'currentColor':'none'}/></button></header>
    <div className="mentor-tile-tags">{person.rating!=null&&<span className="experience-score"><Star size={12}/>{person.rating} / 5<span>培养体验</span></span>}{person.professional_title&&<span className="mentor-degree">{person.professional_title}</span>}{person.can_supervise_doctoral&&<span className="mentor-degree is-doctoral">可指导博士</span>}{person.rating==null&&!person.professional_title&&!person.can_supervise_doctoral&&<span className="mentor-degree">官网档案</span>}{saved&&person.status&&<span className={'contact-state '+person.status}>{statusNames[person.status]}</span>}</div>
    <FlagChips insight={polaris.lookup(person)} tones={['bad','good']}/>
    {directionText&&<p className="mentor-directions" title={String(directionText)}>{short(directionText)}</p>}
    <dl className="mentor-tile-facts">{[['internship','实习'],['stipend_text','补助'],['management','管理']].filter(([key])=>person[key]).map(([key,label])=><div key={key}><dt>{label}</dt><dd title={String(person[key])}>{short(person[key])}</dd></div>)}</dl>
    {saved&&person.note&&<p className="mentor-note-preview">{person.note}</p>}
    <footer><button className="text-button" onClick={()=>onDetail(person)}>查看资料与备注<ChevronRight size={13}/></button><button className="text-button" onClick={()=>polaris.openMentor(person)}>导师档案<ChevronRight size={13}/></button></footer>
    {saved&&list&&<select aria-label={'将'+person.name+'加入清单'} value="" disabled={w.pending} onChange={event=>{const id=event.target.value;if(id)w.mutate(now=>{const target=now.lists.find(item=>item.id===id);return {path:'/workbench/lists/'+id,method:'PATCH',body:{keys:[...new Set([...target.keys,person.key])]}}}).then(next=>w.setMessage('已加入'+next.lists.find(item=>item.id===id).name)).catch(swallow)}}><option value="">加入分类清单…</option>{w.state.lists.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}
    {saved&&activeList&&<button className="remove-from-list" disabled={w.pending} onClick={()=>w.mutate(now=>({path:'/workbench/lists/'+activeList.id,method:'PATCH',body:{keys:now.lists.find(item=>item.id===activeList.id).keys.filter(key=>key!==person.key)}})).then(()=>w.setMessage('已移出'+activeList.name)).catch(swallow)}>移出这份清单</button>}
  </article>
}
function MentorDetail({person,onBack}){
  const w=useWorkspace(),polaris=usePolaris(),[detail,setDetail]=useState(null),[note,setNote]=useState(''),[loading,setLoading]=useState(true),[noteStatus,setNoteStatus]=useState('saved')
  const draft=useRef({note:'',dirty:false}),saving=useRef(null),mounted=useRef(true),draftKey='mentor-note-draft-'+person.key
  const saved=w.state.items.find(item=>same(item,person))
  const savedKey=saved?.key
  const saveNote=useCallback(async()=>{
    const text=draft.current.note
    if(!savedKey||!draft.current.dirty||saving.current===text)return
    saving.current=text;if(mounted.current)setNoteStatus('saving')
    try{
      await w.mutate('/workbench/items/'+savedKey,'PATCH',{note:text})
      if(draft.current.note===text){draft.current.dirty=false;sessionStorage.removeItem('mentor-note-draft-'+savedKey);if(mounted.current)setNoteStatus('saved')}
    }catch{if(mounted.current)setNoteStatus('error')}
    finally{if(saving.current===text)saving.current=null}
  },[savedKey,w.mutate])
  useEffect(()=>{let current=true;setLoading(true);api('/workbench/mentors/'+person.key).then(row=>{if(current){
    setDetail(row);const cached=sessionStorage.getItem(draftKey),text=cached??row.note,dirty=cached!==null&&cached!==row.note
    draft.current={note:text,dirty};setNote(text);setNoteStatus(dirty?'editing':'saved')
    if(cached!==null&&!dirty)sessionStorage.removeItem(draftKey)
  }}).catch(w.fail).finally(()=>{if(current)setLoading(false)});return()=>{current=false}},[person.key])
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;void saveNote()}},[saveNote])
  useEffect(()=>{if(!draft.current.dirty)return;const timer=setTimeout(saveNote,650);return()=>clearTimeout(timer)},[note,saveNote])
  return <div className="workspace-detail"><button className="workspace-back" onClick={onBack}><ArrowLeft size={15}/>返回候选</button><div className="detail-heading"><div><span className="section-eyebrow">{person.college}</span><h3>{person.name}</h3></div><div><button className="secondary-button" disabled={w.pending} onClick={()=>w.saveMentor(person).catch(swallow)}><Bookmark size={15}/>{saved?'已收藏':'收藏导师'}</button><button className="primary-button" onClick={()=>polaris.openMentor(person)}>导师档案</button></div></div>
    {loading?<p className="workspace-loading">正在读取导师资料…</p>:detail&&<div className="detail-layout"><aside className="detail-notes"><h4>我的选择记录</h4>{saved?<><label htmlFor="mentor-contact-status">联系进度</label><select id="mentor-contact-status" value={saved.status} disabled={w.pending||!w.plan.features.includes('notes')} onChange={event=>w.mutate('/workbench/items/'+person.key,'PATCH',{status:event.target.value}).catch(swallow)}>{Object.entries(statusNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><label htmlFor="mentor-private-note">导师备注</label><textarea id="mentor-private-note" value={note} maxLength={2000} placeholder="记录你的方向、联系进展和需要比较的问题" onChange={event=>{const text=event.target.value;draft.current={note:text,dirty:true};sessionStorage.setItem(draftKey,text);setNote(text);setNoteStatus('editing')}} onBlur={saveNote} readOnly={!w.plan.features.includes('notes')}/><div className="detail-note-actions"><button className="primary-button" disabled={w.pending||!draft.current.dirty} onClick={saveNote}>{noteStatus==='error'?'重试保存':'保存备注'}</button><small role="status">{({saved:'已保存 · 自动保存',editing:'等待保存',saving:'保存中…',error:'尚未保存'})[noteStatus]}</small></div></>:<p>收藏这位导师后，可记录联系进度与个人备注。</p>}</aside><div className="detail-facts">{w.state.fieldOptions.filter(field=>detail[field.key]!=null&&detail[field.key]!=='').map(field=><section key={field.key}><h4>{field.label}</h4><p>{display(detail[field.key],field)}</p></section>)}{person.student_count!=null&&<small>{w.state.rosterYear}年名册 · 全专业</small>}<section><h4>资料来源</h4><div className="detail-sources">{detail.sources.map(source=>source.url?<a href={source.url} target="_blank" rel="noopener noreferrer" key={source.id}>{source.title}<ExternalLink size={12}/></a>:<span key={source.id}>{source.title}{source.year?' · '+source.year:''}</span>)}</div></section></div></div>}
  </div>
}
function WorkspaceNotice({floating=false}){
  const w=useWorkspace(),text=w.message||(!w.view?w.error:'')
  if(!text)return null
  return <div className={'workspace-toast'+(floating?' floating':'')} role="status"><Check size={14}/>{text}{w.message==='已移出候选'&&w.state?.removedKey&&<button onClick={()=>w.mutate('/workbench/items/'+w.state.removedKey+'/restore','POST',{}).then(()=>w.setMessage('已恢复候选及备注')).catch(swallow)}>撤销</button>}<button aria-label="关闭操作提示" onClick={()=>{w.setMessage('');w.setError('')}}><X size={13}/></button></div>
}
export default function WorkspaceLayer({onAsk,onOpenMentors,busy=false}){
  const w=useWorkspace(),[list,setList]=useState('all'),[query,setQuery]=useState(''),[college,setCollege]=useState(''),[status,setStatus]=useState(''),[sort,setSort]=useState('recent'),[discover,setDiscover]=useState(false),[directory,setDirectory]=useState({rows:[],total:0}),[finding,setFinding]=useState(false),[displayMode,setDisplayMode]=useState('cards'),[detail,setDetail]=useState(null),[name,setName]=useState(''),[naming,setNaming]=useState(null),[differences,setDifferences]=useState(false),[inspected,setInspected]=useState(null),[snapshotRows,setSnapshotRows]=useState([]),[removeConfirm,setRemoveConfirm]=useState(null),[dirPage,setDirPage]=useState(0),[visibleCount,setVisibleCount]=useState(24),[analysis,setAnalysis]=useState('ratings'),[rules,setRules]=useState([]),[matching,setMatching]=useState(null),[linking,setLinking]=useState(false),[chartCollege,setChartCollege]=useState(''),[scenarioIds,setScenarioIds]=useState([]),[scenarioResult,setScenarioResult]=useState(null),[conclusion,setConclusion]=useState(''),[fieldDraft,setFieldDraft]=useState(null)
  const body=useRef(null),positions=useRef(new Map()),scrollKey=w.view+':'+(detail?.key||'')
  useLayoutEffect(()=>{if(body.current)body.current.scrollTop=positions.current.get(scrollKey)||0},[scrollKey,Boolean(w.state)])
  useEffect(()=>{if(!discover||!w.view)return;let current=true;setFinding(true);const timer=setTimeout(()=>api('/workbench/directory?q='+encodeURIComponent(query)+'&college='+encodeURIComponent(college)+'&offset='+dirPage+'&sort='+encodeURIComponent(sort)).then(result=>{if(current)setDirectory(result)}).catch(w.fail).finally(()=>{if(current)setFinding(false)}),180);return()=>{current=false;clearTimeout(timer)}},[discover,query,college,dirPage,sort,Boolean(w.view)])
  useEffect(()=>{if(w.view!=='library')setDetail(null)},[w.view])
  useEffect(()=>{setDirPage(0);setVisibleCount(24)},[query,college,status,list,sort])
  const state=w.state,selected=state?.comparison||[]
  const all=state?.items||[],activeList=state?.lists.find(item=>item.id===list)
  const shown=useMemo(()=>{
    if(discover)return directory.rows
    const rows=all.filter(item=>(!matching||matching.has(item.key))&&(list==='all'||activeList?.keys.includes(item.key))&&(!college||item.college===college||item.college?.split(/[、,，]+/).map(s=>s.trim()).some(part=>part===college||part.startsWith(college+'（')||part.startsWith(college+'(')))&&(!status||item.status===status)&&(!query||[item.name,item.college,item.personal_directions,item.research_areas,item.academic_summary,item.directions,item.professional_title,item.note].some(text=>text?.toLowerCase().includes(query.toLowerCase()))))
    return rows.toSorted((a,b)=>sort==='rating'?(b.rating??-1)-(a.rating??-1):sort==='stipend'?(b.stipend_monthly_min??-1)-(a.stipend_monthly_min??-1):sort==='name'?a.name.localeCompare(b.name,'zh-CN'):(b.addedAt||'').localeCompare(a.addedAt||''))
  },[all,directory,discover,list,activeList,college,status,query,sort,matching])
  if(!w.view)return <WorkspaceNotice floating/>
  const close=()=>{setDetail(null);setNaming(null);setInspected(null);w.close()}
  if(!state)return <Dialog title="选导师工作台" onClose={close}><p>{w.error||'正在载入工作台…'}</p>{w.error&&<button className="secondary-button" onClick={w.refresh}>重试</button>}</Dialog>
  function startName(kind){setName('');setConclusion('');setNaming(kind)}
  function applyRules(filters,result){if(result){setMatching(new Set(result.keys));setRules(filters);return}api('/workbench/analyze',{method:'POST',body:{filters}}).then(result=>{setMatching(new Set(result.keys));setRules(filters)}).catch(w.fail)}
  function linkCollege(value){setChartCollege(value);if(linking&&w.plan.features.includes('linked')){const next=rules.filter(rule=>rule.field!=='college');if(value)next.push({field:'college',op:'contains',value});applyRules(next)}else{setCollege(value)}}
  function saveName(){
    const kind=naming;w.mutate('/workbench/'+kind,'POST',{name,...(kind==='views'?{filters:rules}:{}),...(kind==='snapshots'?{conclusion}:{})}).then(()=>{setNaming(null);setName('');w.setMessage('已保存');if(kind==='snapshots')w.setView('snapshots')}).catch(swallow)
  }
  const chosenFields=fieldDraft||state.fields
  function changeField(key){
    const next=chosenFields.includes(key)?chosenFields.filter(value=>value!==key):[...chosenFields,key]
    setFieldDraft(next)
    w.mutate('/workbench/fields','PUT',{fields:next}).finally(()=>setFieldDraft(null)).catch(swallow)
  }
  const changedFields=differingComparisonFields(selected,state.fields)
  const safeFields=differences&&w.plan.features.includes('differences')?changedFields:state.fields
  const compareColumns=[{key:'name',label:'导师'},{key:'college',label:'学院'},...safeFields.map(key=>({key,label:state.fieldOptions.find(field=>field.key===key).label+(/^(student_count|exam_count|recommended_count)$/.test(key)?'（'+state.rosterYear+'年名册）':'')}))]
  const compareRows=selected.map(row=>({...row,rawName:row.name,name:selected.filter(item=>item.name===row.name).length>1?row.name+' · '+row.college:row.name}))
  const moneyRows=shown.filter(row=>row.rating!=null&&Number.isFinite(row.stipend_monthly_min)).map(row=>({...row,stipend_record:row.stipend_monthly_min}))
  const ratedRows=shown.filter(row=>row.rating!=null)
  const gradeTicks=ratedRows.length?[5,4,3,2,1].filter(g=>g<=Math.max(...ratedRows.map(r=>r.rating))&&g>=Math.min(...ratedRows.map(r=>r.rating))):[]
  const histogram={type:'bar',title:'培养体验评分分布',x:'grade',y:['count'],rows:gradeTicks.map(rating=>({grade:rating+'分',count:ratedRows.filter(row=>row.rating===rating).length})),columns:[{key:'grade',label:'培养体验评分'},{key:'count',label:'导师人数'}]}
  const scatter={type:'scatter',title:'培养体验与月补助记录',x:'rating',y:['stipend_record'],color_by:'college',rows:moneyRows,columns:[{key:'name',label:'导师'},{key:'rating',label:'培养体验评分 / 5'},{key:'stipend_record',label:'月补助记录低值（元）'},{key:'college',label:'学院'},{key:'stipend_text',label:'补助与支付条件'}]}
  const scatterColors=pointColors(scatter)
  const tableRows=shown.map(row=>({...row,direction_summary:row.personal_directions||row.research_areas||row.directions||(row.academic_summary&&row.academic_summary!==row.professional_title?row.academic_summary:null)||null}))
  const distinctSavedColleges=new Set(all.flatMap(row=>(row.college||'').split(/[、,，]+/).map(s=>s.replace(/[（(].*$/,'').trim()).filter(Boolean))).size
  return <Dialog title="候选库" className="workbench-dialog" onClose={close}><div className="workbench-body" ref={body} onScroll={event=>positions.current.set(scrollKey,event.currentTarget.scrollTop)}>
    {<>
      <div className="workspace-heading"><div><span className="section-eyebrow">北极星 · 我的选择</span><h3>我的导师候选</h3></div></div>
      {w.error&&<div className="workspace-error" role="alert">{w.error}<button aria-label="关闭工作台提示" onClick={()=>w.setError('')}><X size={14}/></button></div>}
      {naming&&<form className="workspace-name-form" onSubmit={event=>{event.preventDefault();saveName()}}><label htmlFor="workspace-object-name">{naming==='lists'?'清单名称':'视图名称'}</label><input id="workspace-object-name" autoFocus value={name} onChange={event=>setName(event.target.value)} placeholder="输入名称" maxLength={80}/><button className="primary-button" disabled={!name.trim()||w.pending}>保存</button><button type="button" className="secondary-button" onClick={()=>setNaming(null)}>取消</button></form>}
      {(detail?<MentorDetail person={detail} onBack={()=>setDetail(null)}/>:<>
        <div className="workspace-summary"><div><span>已收藏候选</span><strong>{all.length}</strong></div><div><span>涉及学院</span><strong>{distinctSavedColleges}</strong></div><div><span>重点联系</span><strong>{all.filter(row=>row.status==='priority').length}</strong></div><div className="workspace-summary-actions">{onOpenMentors&&<button type="button" className="secondary-button" onClick={()=>{close();onOpenMentors()}}><Search size={14}/>多维查看导师</button>}<button className="primary-button" onClick={()=>{setDiscover(value=>!value);setQuery('');setStatus('')}}><Plus size={15}/>{discover?'返回已收藏':'添加导师'}</button></div></div>
        <div className="workspace-library-layout"><aside className="workspace-lists"><button className={list==='all'?'selected':''} onClick={()=>{setList('all');setDiscover(false)}}><Bookmark size={14}/>全部候选<span>{all.length}</span></button>{state.lists.map(item=><div className="workspace-list-line" key={item.id}><button className={list===item.id?'selected':''} onClick={()=>{setList(item.id);setDiscover(false)}}>{item.name}<span>{item.keys.length}</span></button><button className="list-delete" aria-label={'删除清单 '+item.name} onClick={()=>w.mutate('/workbench/lists/'+item.id,'DELETE').then(()=>setList('all')).catch(swallow)}><X size={12}/></button></div>)}<button className="new-list-button" onClick={()=>w.plan.features.includes('lists')?startName('lists'):w.mutate('/workbench/lists','POST',{name:'新清单'}).catch(swallow)}><FolderPlus size={14}/>新建清单</button></aside>
        <div className="workspace-library-main"><div className="workspace-toolbar"><label className="workspace-search"><Search size={15}/><input aria-label={discover?'查找要添加的导师':'搜索收藏导师'} placeholder={discover?'姓名、方向或学院':'搜索姓名、方向或备注'} value={query} onChange={event=>setQuery(event.target.value)}/></label><select aria-label="按学院筛选候选" value={college} onChange={event=>setCollege(event.target.value)}><option value="">全部学院</option>{state.colleges.map(value=><option key={value}>{value}</option>)}</select>{!discover&&<select aria-label="按联系状态筛选" value={status} onChange={event=>setStatus(event.target.value)}><option value="">全部进度</option>{Object.entries(statusNames).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select>}<select aria-label="候选排序" value={sort} onChange={event=>setSort(event.target.value)}><option value="recent">{discover?'综合排序':'最近收藏'}</option><option value="rating">培养体验评分</option><option value="stipend">补助记录低值</option><option value="name">姓名拼音</option></select>{!discover&&<button className="workspace-export-data" disabled={!shown.length} onClick={()=>w.exportReport('csv',undefined,'library',shown.map(row=>row.key))}><Download size={13}/>导出当前结果</button>}<div className="view-switch"><button aria-label="候选卡片视图" className={displayMode==='cards'?'selected':''} onClick={()=>setDisplayMode('cards')}><LayoutGrid size={14}/></button><button aria-label="候选表格视图" className={displayMode==='table'?'selected':''} onClick={()=>setDisplayMode('table')}><Table2 size={14}/></button></div></div>
        {!discover&&<AnalysisViews rules={rules} setRules={setRules} onApply={applyRules} onClear={()=>{setRules([]);setMatching(null);setChartCollege('')}} onSave={()=>startName('views')}/>}
        <div className="workspace-results-heading"><h4>{discover?'查找导师':activeList?.name||'全部候选'}</h4><span>{finding?'查找中…':discover?directory.total+'位匹配 · 本页'+shown.length+'位':shown.length+'位导师'}</span></div>
        {!shown.length?<div className="workspace-empty"><Bookmark size={28}/><h4>{discover?'没有匹配的导师':query||college||status||matching?'没有匹配的候选':activeList?'清单为空':'候选库为空'}</h4><p>{discover?'试试导师姓名或更具体的研究方向。':activeList?'从全部候选中选择导师加入这份清单。':'从对话或查看导师中收藏，建立你的专属候选库。'}</p>{!discover&&!query&&!college&&!status&&!matching&&<button className="primary-button" onClick={()=>activeList?setList('all'):setDiscover(true)}>{activeList?'查看全部候选':'查找导师'}<ChevronRight size={14}/></button>}</div>:displayMode==='table'?<DataTable rows={tableRows} columns={[{key:'name',label:'导师'},{key:'college',label:'学院'},{key:'professional_title',label:'职称'},{key:'rating',label:'培养体验评分 / 5'},{key:'direction_summary',label:'研究方向'},{key:'internship',label:'实习情况'},{key:'stipend_text',label:'补助与支付条件'}]} purpose="comparison" layout="table" pageSize={discover?30:12} caption="我的候选导师"/>:<div className="mentor-tile-grid">{shown.slice(0,discover?30:visibleCount).map(person=><MentorCard key={person.key} person={person} onDetail={setDetail} list={state.lists.length>0} activeList={activeList}/>)}</div>}
        {discover?<div className="workspace-pagination"><span>{directory.total?dirPage+1:0}–{Math.min(dirPage+30,directory.total)} / {directory.total}</span><button className="secondary-button" disabled={!dirPage||finding} onClick={()=>setDirPage(Math.max(0,dirPage-30))}>上一页导师</button><button className="secondary-button" disabled={directory.next_offset==null||finding} onClick={()=>setDirPage(directory.next_offset)}>下一页导师</button></div>:displayMode==='cards'&&shown.length>visibleCount&&<div className="workspace-pagination"><span>已显示{visibleCount} / {shown.length}位</span><button className="secondary-button" onClick={()=>setVisibleCount(value=>value+24)}>显示更多候选</button></div>}
        {!discover&&all.length>0&&w.plan.features.includes('visuals')&&<div className="workspace-analytics"><div className="linked-college-chart"><label className="linking-toggle"><input type="checkbox" checked={linking&&w.plan.features.includes('linked')} onChange={event=>{if(w.requireFeature('linked'))setLinking(event.target.checked)}}/>联动名单</label><CollegeChart items={all} active={linking?chartCollege:college} onCollege={linkCollege}/></div>{ratedRows.length>0&&<section className="workspace-chart"><header><h4>{analysis==='ratings'?'培养体验评分分布':'评分与月补助记录'}</h4><select aria-label="候选分析图表" value={analysis} onChange={event=>setAnalysis(event.target.value)}><option value="ratings">评分分布</option>{(moneyRows.length>=2||analysis==='money')&&<option value="money">评分与补助</option>}</select><small>{analysis==='ratings'?ratedRows.length:moneyRows.length}位导师</small></header>{analysis==='ratings'?<Chart artifact={histogram}/>:moneyRows.length?<>{scatterColors?.entries?.length>1&&<div className="chart-legend"><b>{scatterColors.label}</b>{scatterColors.entries.map((e,i)=><span key={i}><i style={{background:e.color}}/>{e.label}</span>)}</div>}<Chart artifact={scatter} colors={scatterColors}/></>:<p className="workspace-chart-empty">当前筛选没有可绘制的数据。</p>}</section>}</div>}
        </div></div>
      </>)}
    </>}
    <WorkspaceNotice/>
  </div></Dialog>
}

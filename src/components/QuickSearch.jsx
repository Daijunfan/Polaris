import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {Bookmark,Check,ChevronDown,CornerDownLeft,GraduationCap,MessageCircleQuestion,RotateCcw,Search,Sparkles,X} from 'lucide-react'
import Dialog from './Dialog.jsx'
import {Avatar,FlagChips,MatchRing,Stars} from './MentorInsight.jsx'
import {usePolaris} from '../insights.jsx'
import {useWorkspace} from '../workspace.jsx'
import {nameVariants} from '../../lib/insights.js'
import {MENTOR_FILTER_GROUPS,MENTOR_FILTER_MAP,computeFacetCounts,filterMentors,shortCollegeName,splitMentorColleges} from '../../lib/mentor-filters.js'

const PRIORITY_COLLEGES=['网络空间安全学院','计算机学院','人工智能学院','软件学院']
const HOT_FILTER_IDS=['internship_ok','no_clock','no_paper','doctoral','dir_llm','dir_6g']

export default function QuickSearch({onClose,onSuspend,onReopen,savedStateRef,onAsk,onOpenLibrary,busy=false}){
  const polaris=usePolaris(),w=useWorkspace()
  const init=savedStateRef?.current||{}
  const [query,setQuery]=useState(init.query||'')
  const [selectedColleges,setSelectedColleges]=useState(init.selectedColleges||[])
  const [selectedFilters,setSelectedFilters]=useState(init.selectedFilters||[])
  const [directionMode,setDirectionMode]=useState(init.directionMode||'and')
  const [openCategory,setOpenCategory]=useState(init.openCategory||null)
  const [activeIndex,setActiveIndex]=useState(init.activeIndex||0)
  const [limitCount,setLimitCount]=useState(init.limitCount||20)
  const inputRef=useRef(null),listRef=useRef(null),mountedRef=useRef(false)
  useEffect(()=>{inputRef.current?.focus()},[])
  useLayoutEffect(()=>{
    if(!listRef.current||(!init.scrollTop&&!init.activeIndex))return
    if(init.scrollTop)listRef.current.scrollTop=init.scrollTop
    if(init.activeIndex>0)listRef.current.querySelectorAll('[data-qs-item]')[init.activeIndex]?.scrollIntoView({block:'nearest'})
  },[])

  const allMentors=useMemo(()=>Object.values(polaris.insights||{}),[polaris.insights])
  const colleges=useMemo(()=>{
    const totals=new Map()
    for(const item of allMentors){
      for(const clean of splitMentorColleges(item.college)){
        totals.set(clean,(totals.get(clean)||0)+1)
      }
    }
    return [...totals.keys()].sort((a,b)=>{
      const pa=PRIORITY_COLLEGES.indexOf(a),pb=PRIORITY_COLLEGES.indexOf(b)
      if(pa>=0&&pb>=0)return pa-pb
      if(pa>=0)return -1
      if(pb>=0)return 1
      return (totals.get(b)||0)-(totals.get(a)||0)||a.localeCompare(b,'zh-CN')
    })
  },[allMentors])

  const toggleFilter=id=>setSelectedFilters(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])
  const toggleCollege=c=>setSelectedColleges(prev=>prev.includes(c)?prev.filter(x=>x!==c):[...prev,c])
  const clearAllFilters=()=>{setSelectedFilters([]);setSelectedColleges([]);setDirectionMode('and')}

  const {filterCounts,collegeCounts}=useMemo(
    ()=>computeFacetCounts(allMentors,{query,colleges:selectedColleges,filters:selectedFilters,directionMode,collegeList:colleges}),
    [allMentors,query,selectedColleges,selectedFilters,directionMode,colleges]
  )

  const groupSelectedCounts=useMemo(()=>{
    const counts={conditions:0,qualifications:0,directions:0}
    for(const id of selectedFilters){
      const g=MENTOR_FILTER_MAP.get(id)?.group
      if(g&&counts[g]!=null)counts[g]++
    }
    return counts
  },[selectedFilters])

  const selectedDirectionCount=groupSelectedCounts.directions

  const orFallbackCount=useMemo(()=>{
    if(selectedDirectionCount<2||directionMode!=='and')return 0
    return filterMentors(allMentors,{query,colleges:selectedColleges,filters:selectedFilters,directionMode:'or'}).length
  },[allMentors,query,selectedColleges,selectedFilters,directionMode,selectedDirectionCount])

  const {results,sortedResults,totalMatches}=useMemo(()=>{
    const q=query.trim().toLowerCase()
    const variants=q?nameVariants(query.trim()).map(v=>v.toLowerCase()):[]
    const savedKeys=new Set((w?.state?.items||[]).map(item=>item.key))
    const filtered=filterMentors(allMentors,{query,colleges:selectedColleges,filters:selectedFilters,directionMode})
    const sorted=filtered.toSorted((a,b)=>{
      if(q){
        const aExact=a.name.toLowerCase()===q||variants.includes(a.name.toLowerCase())?2:a.name.toLowerCase().startsWith(q)?1:0
        const bExact=b.name.toLowerCase()===q||variants.includes(b.name.toLowerCase())?2:b.name.toLowerCase().startsWith(q)?1:0
        if(aExact!==bExact)return bExact-aExact
      }else{
        const aSaved=savedKeys.has(a.key)?1:0,bSaved=savedKeys.has(b.key)?1:0
        if(aSaved!==bSaved)return bSaved-aSaved
      }
      const ma=polaris.match(a)?.score??-1,mb=polaris.match(b)?.score??-1
      if(ma!==mb&&!q)return mb-ma
      return (b.rating??-1)-(a.rating??-1)||(b.doctoral?1:0)-(a.doctoral?1:0)||a.name.localeCompare(b.name,'zh-CN')
    })
    return {results:sorted.slice(0,limitCount),sortedResults:sorted,totalMatches:filtered.length}
  },[allMentors,selectedColleges,selectedFilters,directionMode,query,polaris,w?.state?.items,limitCount])

  useEffect(()=>{
    if(!mountedRef.current){mountedRef.current=true;return}
    setActiveIndex(0);setLimitCount(20)
  },[query,selectedColleges,selectedFilters,directionMode])
  const safeIndex=Math.min(activeIndex,Math.max(0,results.length-1))

  const activeFilterItems=useMemo(()=>[
    ...selectedFilters.map(id=>{
      const def=MENTOR_FILTER_MAP.get(id)
      return def?{key:'f:'+id,label:def.label,remove:()=>toggleFilter(id)}:null
    }).filter(Boolean),
    ...selectedColleges.map(c=>({key:'c:'+c,label:shortCollegeName(c),remove:()=>toggleCollege(c)})),
  ],[selectedFilters,selectedColleges])

  const hasAnyCriteria=Boolean(query.trim()||activeFilterItems.length)
  const activeGroup=MENTOR_FILTER_GROUPS.find(g=>g.id===openCategory)
  const activeHotIds=useMemo(()=>activeGroup?HOT_FILTER_IDS.filter(id=>!activeGroup.filters.some(f=>f.id===id)):HOT_FILTER_IDS,[activeGroup])

  function openDossier(item,idx=safeIndex){
    if(!item)return
    if(savedStateRef){
      savedStateRef.current={query,selectedColleges,selectedFilters,directionMode,openCategory,activeIndex:idx,limitCount:Math.max(limitCount,idx+1),scrollTop:listRef.current?.scrollTop||0}
    }
    ;(onSuspend||onClose)()
    polaris.openMentor(item,{
      origin:{
        label:'返回查看导师',
        list:sortedResults,
        index:idx,
        onStep:(nextIdx)=>{
          if(savedStateRef?.current){
            savedStateRef.current.activeIndex=nextIdx
            savedStateRef.current.limitCount=Math.max(savedStateRef.current.limitCount||20,nextIdx+1)
          }
        },
        onReturn:()=>onReopen?.(),
      },
    })
  }
  function askMentor(item){
    if(!item||!onAsk)return
    onClose()
    onAsk(`详细分析${item.name}（${item.college}）的研究方向、培养风格与优缺点风险，结合评价归纳与公开档案说明。`)
  }
  function onKeyDown(event){
    if(!results.length)return
    if(event.key==='ArrowDown'){
      event.preventDefault()
      const next=(safeIndex+1)%results.length
      setActiveIndex(next)
      listRef.current?.querySelectorAll('[data-qs-item]')[next]?.scrollIntoView({block:'nearest'})
    }else if(event.key==='ArrowUp'){
      event.preventDefault()
      const next=(safeIndex-1+results.length)%results.length
      setActiveIndex(next)
      listRef.current?.querySelectorAll('[data-qs-item]')[next]?.scrollIntoView({block:'nearest'})
    }else if(event.key==='Enter'){
      event.preventDefault()
      if(event.shiftKey&&!busy)askMentor(results[safeIndex])
      else openDossier(results[safeIndex],safeIndex)
    }
  }

  const savedCount=w?.state?.items?.length||0
  const headerActions=<div className="qs-header-tools">
    <span className="quick-search-meta">{hasAnyCriteria?`显示 ${results.length} / 共 ${totalMatches} 位匹配`:`全校 ${allMentors.length} 位导师`}</span>
    {onOpenLibrary&&<button type="button" className="qs-lib-btn" onClick={()=>{onClose();onOpenLibrary()}}>
      <Bookmark size={12} aria-hidden="true"/>候选库{savedCount?` (${savedCount})`:''}
    </button>}
  </div>

  return <Dialog title="查看导师" headerActions={headerActions} className="quick-search-modal" onClose={onClose}>
    <div className="qs-top-shell">
      <div className="quick-search-box">
        <Search size={16} aria-hidden="true"/>
        <input ref={inputRef} aria-label="搜索导师姓名、方向或关键词" placeholder="搜索导师姓名（支持同音姓）、研究方向或课题组…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={onKeyDown}/>
        {query&&<button type="button" className="icon-button qs-clear" aria-label="清空搜索词" onClick={()=>{setQuery('');inputRef.current?.focus()}}><X size={15}/></button>}
      </div>

      <div className="qs-toolbar" aria-label="筛选条件栏">
        <div className="qs-cat-tabs">
          {MENTOR_FILTER_GROUPS.map(g=>{
            const isOpen=openCategory===g.id
            const cnt=groupSelectedCounts[g.id]||0
            return <button type="button" key={g.id} aria-expanded={isOpen} className={'qs-cat-btn'+(isOpen?' is-open':'')+(cnt>0?' has-val':'')} onClick={()=>setOpenCategory(cur=>cur===g.id?null:g.id)}>
              {g.label}
              {cnt>0&&<b aria-hidden="true">{cnt}</b>}
              <ChevronDown size={12} aria-hidden="true" className="qs-cat-caret"/>
            </button>
          })}
          <button type="button" aria-expanded={openCategory==='colleges'} className={'qs-cat-btn'+(openCategory==='colleges'?' is-open':'')+(selectedColleges.length>0?' has-val':'')} onClick={()=>setOpenCategory(cur=>cur==='colleges'?null:'colleges')}>
            所属学院
            {selectedColleges.length>0&&<b aria-hidden="true">{selectedColleges.length}</b>}
            <ChevronDown size={12} aria-hidden="true" className="qs-cat-caret"/>
          </button>
        </div>
        {activeHotIds.length>0&&<span className="qs-bar-sep" aria-hidden="true"/>}
        <div className="qs-hot-pills" role="group" aria-label="高频筛选">
          {activeHotIds.map(id=>{
            const def=MENTOR_FILTER_MAP.get(id)
            if(!def)return null
            const selected=selectedFilters.includes(id)
            const count=filterCounts[id]??0
            return <button type="button" key={id} aria-pressed={selected} className={'qs-chip'+(selected?' selected':'')+(count===0&&!selected?' is-zero':'')} onClick={()=>toggleFilter(id)}>
              {selected&&<Check size={11} aria-hidden="true" className="qs-chip-check"/>}
              {def.label}
              <span className="qs-chip-count" aria-hidden="true">{count}</span>
            </button>
          })}
        </div>
      </div>

      {activeGroup&&<div className="qs-drawer" role="group" aria-label={activeGroup.label+'筛选'}>
        {activeGroup.filters.map(f=>{
          const selected=selectedFilters.includes(f.id)
          const count=filterCounts[f.id]??0
          return <button type="button" key={f.id} aria-pressed={selected} className={'qs-chip'+(selected?' selected':'')+(count===0&&!selected?' is-zero':'')} onClick={()=>toggleFilter(f.id)}>
            {selected&&<Check size={11} aria-hidden="true" className="qs-chip-check"/>}
            {f.label}
            <span className="qs-chip-count" aria-hidden="true">{count}</span>
          </button>
        })}
      </div>}

      {openCategory==='colleges'&&colleges.length>0&&<div className="qs-drawer" role="group" aria-label="所属学院筛选">
        {colleges.map(c=>{
          const selected=selectedColleges.includes(c)
          const count=collegeCounts[c]??0
          const shortLabel=shortCollegeName(c)
          return <button type="button" key={c} title={c} aria-pressed={selected} className={'qs-chip'+(selected?' selected':'')+(count===0&&!selected?' is-zero':'')} onClick={()=>toggleCollege(c)}>
            {selected&&<Check size={11} aria-hidden="true" className="qs-chip-check"/>}
            {shortLabel}
            <span className="qs-chip-count" aria-hidden="true">{count}</span>
          </button>
        })}
      </div>}

      {activeFilterItems.length>0&&<div className="qs-active-bar" role="region" aria-label="已选筛选条件">
        <span className="qs-active-count">已选 {activeFilterItems.length} 项筛选</span>
        <div className="qs-active-pills">
          {activeFilterItems.map(item=><button type="button" key={item.key} className="qs-active-pill" aria-label={`移除筛选：${item.label}`} onClick={item.remove}>
            {item.label}
            <X size={11} aria-hidden="true"/>
          </button>)}
        </div>
        <div className="qs-active-actions">
          {selectedDirectionCount>=2&&<button type="button" className="qs-dir-mode" onClick={()=>setDirectionMode(m=>m==='and'?'or':'and')} title="切换多个研究方向之间的匹配关系">
            方向匹配：{directionMode==='and'?'同时满足':'任一方向'}
          </button>}
          <button type="button" className="qs-reset-btn" onClick={clearAllFilters}><RotateCcw size={11} aria-hidden="true"/>清空筛选</button>
        </div>
      </div>}
    </div>

    {results[safeIndex]&&<span className="sr-only" aria-live="polite">当前选中：{results[safeIndex].name}，{results[safeIndex].college}，第 {safeIndex+1} 位，共 {totalMatches} 位</span>}
    {polaris.loading&&!allMentors.length?<div className="quick-search-empty"><p role="status">正在加载全校导师档案…</p></div>:polaris.error&&!allMentors.length?<div className="quick-search-empty"><p role="alert">{polaris.error}</p><button type="button" className="secondary-button" onClick={polaris.reload}>重试加载</button></div>:!results.length?<div className="quick-search-empty">
      <Sparkles size={24}/>
      <p>没有同时满足当前{activeFilterItems.length?` ${activeFilterItems.length} 项筛选条件`:''}{query.trim()?`${activeFilterItems.length?'与':''}关键词“${query.trim()}”`:''}的导师。</p>
      <div className="qs-empty-actions">
        {orFallbackCount>0&&<button type="button" className="secondary-button" onClick={()=>setDirectionMode('or')}>切换为满足任一研究方向（共 {orFallbackCount} 位）</button>}
        {hasAnyCriteria&&<button type="button" className="secondary-button" onClick={()=>{setQuery('');clearAllFilters()}}>清空全部筛选与搜索词</button>}
      </div>
    </div>:<ul className="quick-search-list" ref={listRef} aria-label="导师速查结果">
      {results.map((item,idx)=>{
        const match=polaris.match(item)
        const saved=w?.state?.items?.some(s=>s.key===item.key)
        const bad=item.flags?.some(f=>f.tone==='bad')
        return <li key={item.key} data-qs-item className={'qs-item'+(idx===safeIndex?' active':'')} onPointerEnter={()=>setActiveIndex(idx)}>
          <button type="button" className="qs-item-main" aria-current={idx===safeIndex?'true':undefined} onClick={()=>openDossier(item,idx)}>
            <Avatar name={item.name} size={40} tone={bad?'risk':undefined}/>
            <div className="qs-item-body">
              <div className="qs-item-title">
                <strong>{item.name}</strong>
                {item.doctoral&&<span className="badge-doctoral"><GraduationCap size={11}/>博导</span>}
                {item.title&&<span className="qs-role">{item.title}</span>}
                <small>{item.college}{item.group?' · '+item.group:''}</small>
                <Stars value={item.rating}/>
              </div>
              <FlagChips insight={item} tones={['bad','good']}/>
              {item.directions&&<p className="qs-directions" title={String(item.directions)}>{String(item.directions).replace(/\n/g,' ')}</p>}
            </div>
            {match&&<MatchRing match={match} size={36}/>}
          </button>
          <div className="qs-item-actions">
            {w?.state&&<button type="button" className={'qs-save-btn'+(saved?' is-on':'')} title={saved?'移出候选库':'收藏到候选库'} aria-label={(saved?'取消收藏 ':'收藏 ')+item.name} onClick={()=>w.saveMentor({key:item.key,name:item.name,college:item.college}).catch(w.fail)}><Bookmark size={13} fill={saved?'currentColor':'none'} aria-hidden="true"/><span aria-hidden="true">{saved?'已藏':'收藏'}</span></button>}
            {onAsk&&<button type="button" className="icon-button" disabled={busy} title={`向北极星提问 ${item.name}`} aria-label={`向北极星提问 ${item.name}`} onClick={()=>askMentor(item)}><MessageCircleQuestion size={14}/></button>}
            <button type="button" className="qs-open-btn" onClick={()=>openDossier(item,idx)}>档案<CornerDownLeft size={12}/></button>
          </div>
        </li>
      })}
      {totalMatches>results.length&&<li className="qs-more-row"><button type="button" className="secondary-button qs-more-btn" onClick={()=>setLimitCount(c=>c+32)}>显示更多匹配导师（余 {totalMatches-results.length} 位）</button></li>}
    </ul>}
  </Dialog>
}

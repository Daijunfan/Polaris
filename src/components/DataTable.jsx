import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, ChevronDown, ChevronLeft, ChevronRight, Columns3, Download, List, Search, Star, Table2, X } from 'lucide-react'
import { columnLabel, display, formatAcademicSummary, formatDisciplineText, formatTableField, internalColumn, isMissing, isStatusColumn, numericColumn, statusInfo,csvText } from '../presentation.js'
import {api,downloadFile} from '../api.js'
import {useWorkspace} from '../workspace.jsx'
import { publicWebUrl,ordinalColumn } from '../../lib/presentation.js'
import Dialog from './Dialog.jsx'
import {usePolaris} from '../insights.jsx'
import {FlagChips,MatchRing,DuelPanel} from './MentorInsight.jsx'
import ExportMenu from './ExportMenu.jsx'
import { useToast } from '../toast.jsx'
import {IdCard} from 'lucide-react'

const factLabels={management:'管理',internship:'实习',graduation:'论文与毕业',stipend_text:'劳务补助',personal_directions:'个人方向',directions:'团队方向',mentor_note:'个人情况',matched_topics:'匹配方向',topic_evidence:'相关依据',academic_summary:'学术概览',enrollment_signal:'生源选择'}
const factPrefixes={management:/^(?:管理(?:与考勤)?|考勤)[：:]\s*/,internship:/^实习(?:情况)?[：:]\s*/,graduation:/^(?:论文要求|毕业要求)[：:]\s*/,personal_directions:/^(?:个人)?研究方向[：:]\s*/}
function formatRowField(row,column,mentorInfo){
  const rawText=display(row[column.key],column)
  if(isMissing(row[column.key]))return rawText
  return formatTableField(column.key,rawText,mentorInfo?.title||row.professional_title)||rawText
}
function previewFact(row,column,mentorInfo){
  const text=formatRowField(row,column,mentorInfo)
  const sections=column.key==='internship'?[/^(?:-\s*)?论文\/实习[：:]\s*(.+)$/m,/^(?:-\s*)?实习(?:情况)?[：:]\s*(.+)$/m,/^(?:-\s*)?学生前途[：:]\s*(.+)$/m]:column.key==='graduation'?[/^(?:-\s*)?(?:毕业要求|论文要求)[：:]\s*(.+)$/m]:[]
  const section=sections.map(pattern=>text.match(pattern)?.[1]).find(Boolean)
  const topics={management:/打卡|坐班|考勤|工作时间|工位|任务制|自由|管理/,internship:/实习/,graduation:/毕业|论文|SCI|EI|CCF/,stipend_text:/劳务|补助|补贴|奖金|津贴|每月/}
  const excerpts=!section&&topics[column.key]?text.match(/[^。！？\n]+[。！？]?/g)?.filter(sentence=>topics[column.key].test(sentence)).slice(0,2).join(''):null
  return (section||excerpts||text).replace(/^\s*[-•]\s*/,'').replace(factPrefixes[column.key]||/^$/,'').replace(/\s+/g,' ').trim()
}

function EvidenceText({text}){
  const labels={'导师评价':'个人记录','个人培养与科研资料':'培养条件','组内资料':'团队与项目','科研项目':'科研项目'},sections=[]
  for(const raw of text.split('\n').filter(line=>line.trim())){
    const heading=raw.match(/^(导师评价|个人培养与科研资料|组内资料|科研项目)[：:]\s*(.*)$/u)
    if(heading)sections.push({title:labels[heading[1]],lines:heading[2]?[heading[2]]:[]})
    else {if(!sections.length)sections.push({title:null,lines:[]});sections.at(-1).lines.push(raw)}
  }
  const lineText=line=>formatDisciplineText(line.trim().replace(/^[-•]\s*/u,''))
  return <div className={`profile-evidence${sections.some(section=>section.title)?' has-sections':''}`}>{sections.map((section,index)=><section key={index}>{section.title&&<h5>{section.title}</h5>}<ul>{section.lines.map((line,i)=><li key={i}>{lineText(line)}</li>)}</ul></section>)}</div>
}

function TextCell({ value, content, preview=value }) {
  const [open, setOpen] = useState(false)
  if (value.length < 110) return <div className="cell-text">{content ?? value}</div>
  return <details className="table-cell-detail" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><span className="cell-preview">{preview}</span><span className="cell-toggle">{open ? '收起' : '展开全文'}</span></summary>
    <div className="cell-full">{content ?? value}</div>
  </details>
}

export default function DataTable({ rows, columns, pageSize = 8, renderCell, caption, layout = 'auto',purpose }) {
  const workspace=useWorkspace(),polaris=usePolaris(),toast=useToast()
  const [page, setPage] = useState(0), [sort, setSort] = useState(null), [width, setWidth] = useState(0), [chosen, setChosen] = useState(null)
  const [query,setQuery] = useState(''), [size,setSize] = useState(pageSize)
  const [selected,setSelected] = useState([]),[compareOpen,setCompareOpen] = useState(false)
  const root = useRef()
  const visible = useMemo(() => columns.filter(c => !internalColumn(c)).map(c => ({ ...c, numeric: numericColumn(c, rows), fractionDigits: rows.some(row => typeof row[c.key] === 'number' && !Number.isInteger(row[c.key])) || /^(score_reexam|score_total|score_first_mean|score_first_median)$/.test(c.key) ? 2 : 0 })), [columns, rows])
  const studentColumn=visible.find(c=>c.key==='student_name'||columnLabel(c)==='学生姓名')
  const nameColumn = studentColumn || visible.find(c => /^(?:mentor_name|name)$/.test(c.key) || columnLabel(c) === '导师') || visible[0]
  const attributes = visible.filter(c => c !== nameColumn)
  const comparison = !studentColumn && rows.length > 1 && rows.length <= 4 && visible.length >= 5 && nameColumn && !nameColumn.numeric && new Set(rows.map(row=>row[nameColumn.key])).size===rows.length
  const filtered = useMemo(() => {
    const term=query.trim().toLocaleLowerCase()
    if(!term)return rows
    const exact=!nameColumn?.numeric?rows.filter(row=>display(row[nameColumn.key],nameColumn).toLocaleLowerCase()===term):[]
    return exact.length?exact:rows.filter(row=>visible.some(column=>formatRowField(row,column,polaris.lookup(row)).toLocaleLowerCase().includes(term)))
  }, [rows,visible,query,nameColumn,polaris.lookup])
  const sorted = useMemo(() => !sort ? filtered : filtered.toSorted((a, b) => {
    const x = a[sort.key], y = b[sort.key]
    if (isMissing(x)) return isMissing(y) ? 0 : 1
    if (isMissing(y)) return -1
    const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh-CN', { numeric: true })
    return sort.order === 'asc' ? cmp : -cmp
  }), [filtered, sort])
  const pages = Math.max(1, Math.ceil(sorted.length / size)), current = Math.min(page, pages - 1), shown = sorted.slice(current * size, (current + 1) * size)
  const preferredWidth = c => c === nameColumn ? 116 : c.numeric ? 108 : ['招生组', '专业代码'].includes(columnLabel(c)) ? 80 : isStatusColumn(c) ? 160 : rows.some(row => String(row[c.key] ?? '').length > 45) ? 240 : 160
  const minimum = visible.reduce((n, c) => n + preferredWidth(c), 0)
  useLayoutEffect(() => {
    const thresholds=[640,148+rows.length*210,minimum]
    const measure=value=>setWidth(previous=>previous>0&&thresholds.every(point=>(previous<point)===(value<point))?previous:value)
    measure(root.current.clientWidth)
    const observer=new ResizeObserver(entries=>measure(entries[0].contentRect.width))
    observer.observe(root.current)
    return()=>observer.disconnect()
  },[minimum,rows.length])
  const wideText = width > 0 && minimum > width && visible.some(c=>rows.some(r=>String(r[c.key]??'').length>80))
  const ordinal=visible.find(column=>column.numeric&&ordinalColumn(column))
  const ranked=Boolean((!purpose||purpose==='recommendation')&&ordinal&&!studentColumn&&/^(name|mentor_name)$/.test(nameColumn?.key))
  const singlePerson=rows.length===1&&!studentColumn&&/^(name|mentor_name)$/.test(nameColumn?.key)&&visible.length>=4&&purpose!=='statistics'
  const canCompare=layout==='auto'&&ranked
  const mentorIdentity=row=>JSON.stringify([row.name||row.mentor_name,row.college||''])
  const selectedRows=selected.map(row=>rows.find(current=>mentorIdentity(current)===mentorIdentity(row))||row)
  const mentorSelector=row=>({name:row.name||row.mentor_name,college:row.college})
  async function openComparison(){
    try{if(workspace)await api('/workbench/comparison/check',{method:'POST',body:{mentors:selectedRows.map(mentorSelector)}});setCompareOpen(true)}
    catch(error){workspace?.fail(error)}
  }
  const preferred = ranked?'ranking':singlePerson?'cards':!width || width < 640 ? 'cards' : comparison && width >= 148 + rows.length * 210 ? 'comparison' : ['comparison','statistics'].includes(purpose)?'table':wideText ? 'cards' : 'table'
  const mode = layout === 'auto' ? chosen==='comparison'&&width<640?preferred:chosen||preferred : layout
  const flexible = visible.filter(c => !c.numeric && c !== nameColumn).toSorted((a, b) => Math.max(0, ...rows.map(r => String(r[b.key] ?? '').length)) - Math.max(0, ...rows.map(r => String(r[a.key] ?? '').length)))[0]
  function cell(row, column) {
    const value = row[column.key], rawText = display(value, column), status = isStatusColumn(column) ? statusInfo(value) : null
    if((column.key==='url'||columnLabel(column)==='原始网页')&&publicWebUrl(value))return <a href={publicWebUrl(value)} target="_blank" rel="noopener noreferrer" className="table-source-link">查看原始网页 ↗</a>
    if(singlePerson&&['training_evidence','topic_evidence'].includes(column.key))return <EvidenceText text={rawText}/>
    const mentorInfo = polaris.lookup(row)
    const text = formatRowField(row, column, mentorInfo)
    return status ? <span className={`data-status ${value === 'unique' ? 'verified' : 'uncertain'}`} title={status[1]}>{status[0]}</span> : isMissing(value) ? <span className="missing" aria-label="暂无资料">—</span> : column.numeric ? text : <TextCell value={text} preview={column.key==='academic_summary'?text:factLabels[column.key]?previewFact(row,column,mentorInfo):text} content={renderCell?.(row, column)}/>
  }
  function rankRecord(row,index){
    const mentorInfo=polaris.lookup(row)
    const college=visible.find(column=>column.key==='college'),rating=visible.find(column=>column.key==='rating'),seen=new Set()
    const insight=visible.find(column=>column.role==='annotation')
    const facts=attributes.filter(column=>{
      if(column===ordinal||column===college||column===rating||isMissing(row[column.key]))return false
      const text=formatRowField(row,column,mentorInfo)
      if(seen.has(text))return false
      seen.add(text);return true
    })
    const Tag=facts.length?'details':'div',Summary=facts.length?'summary':'header'
    const meaningful=facts.filter(column=>column.key!=='group')
    const priorities=['internship','management','graduation','personal_directions','directions','mentor_note']
    const metrics=attributes.filter(column=>!isMissing(row[column.key])&&(column.type==='money'||/(?:^|_)(?:student_count|exam_count|recommended_count)$/.test(column.key)))
    const snippets=(meaningful.length?meaningful:facts).filter(column=>!facts.some(other=>other!==column&&previewFact(row,column,mentorInfo).length>32&&previewFact(row,other,mentorInfo).length>previewFact(row,column,mentorInfo).length&&previewFact(row,other,mentorInfo).includes(previewFact(row,column,mentorInfo)))).toSorted((a,b)=>(priorities.includes(a.key)?priorities.indexOf(a.key):99)-(priorities.includes(b.key)?priorities.indexOf(b.key):99)).slice(0,2)
    const rankNum=Number(row[ordinal.key])
    const rankTier=rankNum===1?' tier-1':rankNum===2?' tier-2':rankNum===3?' tier-3':''
    const academicBrief=formatAcademicSummary((!isMissing(row.academic_summary)&&row.academic_summary)||mentorInfo?.academicSummary,mentorInfo?.title||row.professional_title)
    const enrollmentBrief=(!isMissing(row.enrollment_signal)&&row.enrollment_signal)||mentorInfo?.enrollmentSignal||null
    const insightText=insight&&!isMissing(row[insight.key])?display(row[insight.key],insight):null
    const showAcademic=academicBrief&&!snippets.some(c=>c.key==='academic_summary')&&!(insightText&&insightText.includes(academicBrief.slice(0,12)))
    const showEnrollment=enrollmentBrief&&!snippets.some(c=>c.key==='enrollment_signal')
    const hasFlags=Boolean(mentorInfo?.flags?.some(f=>f.tone==='bad'||f.tone==='good'))
    const hasSnippetContent=Boolean(insightText||snippets.length||showAcademic||showEnrollment||hasFlags||metrics.length)
    const fallbackDirections=!hasSnippetContent&&((!isMissing(row.personal_directions)&&row.personal_directions)||(!isMissing(row.research_areas)&&row.research_areas)||(!isMissing(row.directions)&&row.directions)||mentorInfo?.directions||null)
    const fallbackNote=!hasSnippetContent&&!fallbackDirections&&((!isMissing(row.review_note)&&row.review_note)||(!isMissing(row.mentor_note)&&row.mentor_note)||null)
    const identity=mentorIdentity(row),checked=selected.some(value=>mentorIdentity(value)===identity),saved=workspace?.state?.items.some(item=>item.name===(row.name||row.mentor_name)&&(!row.college||item.college===row.college))
    return <article className={'rank-record'+(rankTier?' is-top3':'')} key={identity}><div className="rank-controls">
      {canCompare&&<label className="rank-select" title="选择加入对比"><input type="checkbox" aria-label={`选择对比 ${display(row[nameColumn.key],nameColumn)}`} checked={checked} disabled={workspace?.pending} onChange={()=>setSelected(previous=>checked?previous.filter(value=>mentorIdentity(value)!==identity):[...previous,row])}/></label>}
      {mentorInfo&&<button className="rank-dossier" aria-label={'查看导师档案 '+display(row[nameColumn.key],nameColumn)} title="查看导师档案" onClick={()=>polaris.openMentor(row)}><IdCard size={15}/></button>}
      {workspace?.state&&<button className={'rank-bookmark'+(saved?' saved':'')} aria-label={(saved?'取消收藏 ':'收藏 ')+display(row[nameColumn.key],nameColumn)} title={saved?'取消收藏':'收藏到候选库'} disabled={workspace.pending} onClick={()=>workspace.saveMentor(mentorSelector(row)).catch(()=>{})}><Bookmark size={15} fill={saved?'currentColor':'none'}/></button>}
    </div><Tag className="rank-disclosure">
      <Summary className="rank-record-summary">
        <span className="rank-order"><span className={'rank-number'+rankTier}>{display(row[ordinal.key],ordinal)}</span></span>
        <span className="rank-identity"><span className="rank-name-row"><strong>{display(row[nameColumn.key],nameColumn)}</strong>{mentorInfo?.doctoral&&<span className="rank-badge-doc">博导</span>}</span>{college&&!isMissing(row[college.key])&&<small>{display(row[college.key],college)}</small>}<span className="rank-meta-pills">{rating&&!isMissing(row[rating.key])&&<small className="rank-rating" title="学生评价"><Star size={11}/>{display(row[rating.key],rating)}<span>/ 5</span></small>}{mentorInfo?.title&&<span className="rank-title-badge">{mentorInfo.title}</span>}</span>{mentorInfo&&polaris.match(mentorInfo)&&<span className="rank-match"><MatchRing match={polaris.match(mentorInfo)} size={30}/>契合</span>}</span>
        <span className="rank-snippet">{insightText?<span className="rank-insight">{insightText}</span>:snippets.map(column=><span className="rank-snippet-fact" key={column.key}><span className="rank-snippet-label">{factLabels[column.key]||columnLabel(column)}</span><span className="rank-snippet-value">{previewFact(row,column,mentorInfo)}</span></span>)}{(showAcademic||showEnrollment)&&<span className="rank-highlights">{showAcademic&&<span className="rank-highlight"><b>学术</b><span>{academicBrief}</span></span>}{showEnrollment&&<span className="rank-highlight tone-choice"><b>生源</b><span>{enrollmentBrief}</span></span>}</span>}<FlagChips insight={mentorInfo} tones={['bad','good']} className="rank-flags"/>{metrics.length>0&&<span className="rank-metrics">{metrics.map(column=><span key={column.key}>{columnLabel(column)}<b>{display(row[column.key],column)}</b></span>)}</span>}{!hasSnippetContent&&(fallbackDirections?<span className="rank-snippet-fact"><span className="rank-snippet-label">研究方向</span><span className="rank-snippet-value">{formatDisciplineText(fallbackDirections)}</span></span>:fallbackNote?<span className="rank-snippet-fact"><span className="rank-snippet-label">档案摘要</span><span className="rank-snippet-value">{formatDisciplineText(fallbackNote)}</span></span>:<span className="rank-snippet-fallback">{mentorInfo?.evidence?.sources?`已收录 ${mentorInfo.evidence.sources} 份公开资料 · 点击查看完整档案`:'点击展开详情或查看导师档案'}</span>)}</span>
        {facts.length>0&&<ChevronDown size={15} className="rank-expand"/>}
      </Summary>
      {facts.length>0&&<dl className="rank-facts">{facts.map(column=>{const formatted=formatRowField(row,column,mentorInfo);return <div key={column.key}><dt>{columnLabel(column)}</dt><dd>{renderCell?.(row,column)??formatted}</dd></div>})}</dl>}
    </Tag></article>
  }
  function recordCard(row){
    const summary=singlePerson&&attributes.find(column=>column.role==='annotation')
    const info=!studentColumn&&/^(name|mentor_name)$/.test(nameColumn?.key)?polaris.lookup(row):null
    return <section className={`record-card${studentColumn?' student-record':''}`} key={rows.indexOf(row)}><h4>{display(row[nameColumn.key],nameColumn)}{info&&<button className="record-dossier" onClick={()=>polaris.openMentor(row)} aria-label={'查看导师档案 '+display(row[nameColumn.key],nameColumn)}><IdCard size={13}/>档案</button>}</h4>
      {info&&singlePerson&&<FlagChips insight={info} className="record-flags"/>}
      {summary&&!isMissing(row[summary.key])&&<p className="profile-summary">{display(row[summary.key],summary)}</p>}
      <dl>{attributes.filter(column=>column!==summary).map(column=><div className={`${column.numeric?'record-metric':''}${singlePerson&&formatRowField(row,column,info).length<36?' record-compact':''}`} key={column.key}><dt>{columnLabel(column)}</dt><dd>{cell(row,column)}</dd></div>)}</dl>
    </section>
  }
  const modes = ranked?[['ranking',List,'推荐'],...(comparison&&width>=640?[['comparison',Columns3,'对比']]:[]),['table',Table2,'表格']]:width && width < 640 || wideText && !comparison ? [['cards', List, '列表'], ['table', Table2, '表格']] : comparison ? [['comparison', Columns3, '对比'], ['table', Table2, '表格']] : []
  return <div className={`data-table-container layout-${mode}${width>0&&width<640?' is-compact':''}${singlePerson?' single-mentor':''}`} ref={root}>
    {(rows.length>pageSize || layout==='auto'&&modes.length>0) && <div className="data-table-toolbar">
      {rows.length>pageSize && <label className="table-search"><Search size={15}/><input aria-label="在表中查找" placeholder="查找表中内容" value={query} onChange={event=>{setQuery(event.target.value);setPage(0)}}/>{query.trim()&&<small className="table-search-count" aria-live="polite">{filtered.length} 条</small>}{query&&<button aria-label="清除表内查找" onClick={()=>{setQuery('');setPage(0)}}><X size={14}/></button>}</label>}
      {layout === 'auto' && modes.length > 0 && <div className="data-layout-controls" role="group" aria-label="数据显示方式">{modes.map(([value, Icon, label]) => <button key={value} className={mode === value ? 'selected' : ''} onClick={() => setChosen(value)} aria-pressed={mode === value}><Icon size={14}/>{label}</button>)}</div>}
    </div>}
    {canCompare&&selectedRows.length>0&&<div className="comparison-selection" role="region" aria-label="待对比导师"><span>已选 <b>{selectedRows.length}</b> 位<span className="selection-names">{selectedRows.map(row=>display(row[nameColumn.key],nameColumn)).join('、')}</span></span><div>{workspace&&<button className="selection-to-workspace" onClick={()=>workspace.mutate('/workbench/comparison','PATCH',{add:selectedRows.map(mentorSelector)}).then(()=>workspace.open('compare')).catch(()=>{})}>放入工作台</button>}<button className="selection-clear" onClick={()=>setSelected([])}>清空</button><button className="selection-compare" disabled={selectedRows.length<2} onClick={openComparison}><Columns3 size={14}/>对比{selectedRows.length>1?`这 ${selectedRows.length} 位`:''}</button></div></div>}
    {!sorted.length ? <div className="table-empty">{query?'表中没有匹配的记录':'没有符合条件的记录'}</div> : mode==='ranking'?<div className="ranking-list">{shown.map(rankRecord)}</div>:mode === 'comparison' ? <>{!studentColumn&&<DuelPanel rows={shown}/>}<div className="comparison-scroll" tabIndex={0} aria-label="导师对比，可滚动查看全部内容"><table className="comparison-table" style={{minWidth:136+shown.length*210}}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <colgroup><col style={{width:136}}/>{shown.map((_, i) => <col key={i} style={{minWidth:210}}/>)}</colgroup>
      <thead><tr><th scope="col">对比项</th>{shown.map((row,i) => <th scope="col" key={i}>{display(row[nameColumn.key],nameColumn)}</th>)}</tr></thead>
      <tbody>{attributes.map(column => <tr key={column.key}><th scope="row">{columnLabel(column)}</th>{shown.map((row,i) => <td key={i} className={column.numeric ? 'numeric' : ''}>{cell(row,column)}</td>)}</tr>)}</tbody>
    </table></div></> : mode === 'cards' ? <div className="record-list">{shown.map(recordCard)}</div> : <div className="data-table-scroll" tabIndex={minimum > width ? 0 : undefined} aria-label={minimum > width ? '数据表格，可横向滚动查看全部列' : undefined}>
      <table className="result-table" style={{ minWidth: minimum }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <colgroup>{visible.map(c => <col key={c.key} style={{ width: c === flexible ? undefined : preferredWidth(c) }}/>)}</colgroup>
        <thead><tr>{visible.map(c => <th key={c.key} className={`${c.numeric?'numeric':''}${c===nameColumn?' identity-cell':''}`} scope="col" aria-sort={sort?.key === c.key ? sort.order === 'asc' ? 'ascending' : 'descending' : 'none'}><button onClick={() => { setSort({ key:c.key,order:sort?.key===c.key&&sort.order==='asc'?'desc':'asc' });setPage(0) }} aria-label={`按${columnLabel(c)}排序`}><span>{columnLabel(c)}</span>{sort?.key===c.key ? sort.order==='asc'?<ArrowUp size={13}/>:<ArrowDown size={13}/>:<ArrowUpDown size={13} className="sort-idle"/>}</button></th>)}</tr></thead>
        <tbody>{shown.map(row => <tr key={rows.indexOf(row)}>{visible.map(c => <td key={c.key} className={`${c.numeric?'numeric':''}${isMissing(row[c.key])?' missing':''}${c===nameColumn?' identity-cell':''}`} title={c.numeric&&row[c.key]!=null?String(row[c.key]):undefined}>{cell(row,c)}</td>)}</tr>)}</tbody>
      </table>
    </div>}
    <div className="table-footer"><span>{query?`${filtered.length} / ${rows.length}`:rows.length} 条记录{mode==='table'&&minimum>width ? ' · 可展开查看完整表格' : ''}</span><div className="table-pagination">{rows.length>pageSize&&<label className="table-page-size"><span className="sr-only">每页记录数</span><select aria-label="每页记录数" value={size} onChange={event=>{setSize(Number(event.target.value));setPage(0)}}>{[...new Set([pageSize,25,50,rows.length])].filter(value=>value<=rows.length||value===pageSize).sort((a,b)=>a-b).map(value=><option key={value} value={value}>{value===rows.length?'全部':`${value} 条 / 页`}</option>)}</select></label>}{pages>1&&<><span>{current*size+1}–{Math.min((current+1)*size,filtered.length)} / {filtered.length}</span><button aria-label="上一页" disabled={current===0} onClick={()=>setPage(current-1)}><ChevronLeft size={16}/></button><button aria-label="下一页" disabled={current===pages-1} onClick={()=>setPage(current+1)}><ChevronRight size={16}/></button></>}</div></div>
    {compareOpen&&<Dialog title="导师对比" className="expanded-table-modal comparison-modal" onClose={()=>setCompareOpen(false)}><div className="expanded-chart-toolbar"><span>{selectedRows.length} 位导师</span><div className="artifact-actions"><ExportMenu variant="compact" label="导出对比报告" ariaLabel="多格式导出导师对比" getPayload={format=>({kind:'comparison',format,mentors:selectedRows.map(mentorSelector),title:'所选导师对比分析报告'})} onSuccess={({filename})=>toast.success(`已导出 ${filename}`)} onError={err=>toast.error(err.message)} /><button className="text-button" onClick={()=>{downloadFile('所选导师对比.csv',csvText({rows:selectedRows,columns:columns.filter(column=>column.key!==ordinal?.key)}),'text/csv;charset=utf-8');toast.success('已导出所选导师对比.csv')}}><Download size={14}/>导出对比 CSV</button></div></div><DataTable rows={selectedRows} columns={columns.filter(column=>column.key!==ordinal?.key)} caption="所选导师对比" layout="comparison" pageSize={8}/></Dialog>}
  </div>
}

import {randomUUID,createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {createMentorIndex} from '../lib/search.js'
import {nameVariants} from '../lib/insights.js'
import {plans,planById,planError,featureNames} from '../lib/plans.js'
import {mentorComparisonFields,defaultComparisonFields,fieldLabels,comparisonGoals,mentorFilterFields,contactStatuses} from '../lib/fields.js'
import {createToolRuntime} from '../lib/tools.js'
import {publicSource,publicWebUrl} from '../lib/presentation.js'
import {csvText} from '../src/presentation.js'
import {validateWorkbenchAction} from './workbench-tool.js'
import {reportAnalysis} from './report-analysis.js'
import {APP_NAME,APP_EN,STAR_PATH} from '../lib/brand.js'

const statuses=Object.keys(contactStatuses)
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const valueText=value=>value==null?'—':typeof value==='boolean'?value?'是':'否':String(value)

export function createWorkbench({store,data}){
  const index=createMentorIndex(data),personKey=person=>person.mentor_id||'candidate-'+createHash('sha256').update((person.college||'')+':'+person.name).digest('hex').slice(0,12)
  const people=index.rows.map(person=>({...person,key:personKey(person)}))
  const find=key=>people.find(person=>person.key===key)
  const empty=()=>({items:[],lists:[],comparison:[],fields:defaultComparisonFields,snapshots:[],templates:[],views:[],goal:''})
  let board={...empty(),...store.read('workbench',{})}
  fs.mkdirSync(path.join(store.dir,'reports'),{recursive:true,mode:0o700})
  // Open-source edition: every capability is available to everyone.
  const membership=()=>({tier:'full',owner:true,experienceTier:null})
  const effective=()=>planById('full')
  const save=()=>store.write('workbench',board)
  function requireFeature(feature){
    if(!featureNames[feature])throw planError(feature)
  }
  const normalizeCollege=part=>(data.metadata.colleges||[]).find(name=>part===name||part.startsWith(name+'（')||part.startsWith(name+'('))||part
  const matchesCollege=(value,target)=>!target||value===target||(value||'').split(/[、,，]+/).map(s=>normalizeCollege(s.trim())).includes(target)
  function entity(input){
    if(input.key&&find(input.key))return find(input.key)
    const targetName=input.name||input.mentor_name
    const byCollege=person=>matchesCollege(person.college,input.college)
    let rows=people.filter(person=>person.name===targetName&&byCollege(person))
    if(!rows.length&&targetName){
      const variants=nameVariants(targetName)
      rows=people.filter(person=>variants.includes(person.name)&&byCollege(person))
    }
    if(rows.length!==1)throw new Error(rows.length?'同名导师请同时选择学院':'没有找到这位导师')
    return rows[0]
  }
  function keys(inputs){
    if(!Array.isArray(inputs))throw new Error('请选择导师')
    return [...new Set(inputs.map(input=>entity(typeof input==='string'?{key:input}:input).key))]
  }
  function fields(input){
    if(!Array.isArray(input)||!input.length||input.some(key=>!mentorComparisonFields.some(field=>field.key===key)))throw new Error('请选择有效的对比维度')
    return [...new Set(input)]
  }
  function summary(person){
    return {key:person.key,name:person.name,college:person.college,group:person.group,professional_title:person.professional_title??null,rating:person.rating,personal_directions:person.personal_directions,research_areas:person.research_areas??null,academic_summary:person.academic_summary??null,directions:person.directions,internship:person.internship,graduation:person.graduation,management:person.management,stipend_text:person.stipend_text,stipend_monthly_min:person.stipend_monthly_min,stipend_monthly_max:person.stipend_monthly_max,can_supervise_doctoral:person.can_supervise_doctoral,student_count:person.student_count,exam_count:person.exam_count,recommended_count:person.recommended_count}
  }
  function record(person,selected=board.fields){
    const item=board.items.find(item=>item.key===person.key)
    return {...summary(person),...Object.fromEntries(selected.map(key=>[key,person[key]??null])),note:item?.note||'',status:item?.status||'considering',contact_status:contactStatuses[item?.status||'considering'],sources:data.sources.filter(source=>person.source_ids.includes(source.id)).map(publicSource)}
  }
  function snapshot(){
    const m=membership()
    return {membership:{...m,effectiveTier:m.experienceTier||m.tier,plans},items:board.items.flatMap(item=>{const person=find(item.key);return person?[{...summary(person),...item}]:[]}),lists:board.lists,comparison:board.comparison.flatMap(key=>find(key)?[record(find(key))]:[]),fields:board.fields,fieldOptions:mentorComparisonFields,snapshots:board.snapshots.map(({rows,...item})=>({...item,count:rows.length})),templates:board.templates,views:board.views,goal:board.goal,filterOptions:mentorFilterFields,colleges:[...new Set([...data.metadata.colleges,...people.flatMap(person=>(person.college||'').split(/[、,，]+/).map(s=>normalizeCollege(s.trim()))).filter(Boolean)])],rosterYear:data.metadata.year,removedKey:board.lastRemoved?.item.key||null}
  }
  function setExperience(){return snapshot()}
  function addItems(inputs){
    const selected=keys(inputs),added=selected.filter(key=>!board.items.some(item=>item.key===key))
    board.items.push(...added.map(key=>({key,note:'',status:'considering',addedAt:new Date().toISOString()})))
    save();return snapshot()
  }
  function updateItem(key,input){
    requireFeature('notes')
    const item=board.items.find(item=>item.key===key);if(!item)throw new Error('请先收藏这位导师')
    if(input.note!==undefined){if(typeof input.note!=='string'||input.note.length>2000)throw new Error('备注最多2000字');item.note=input.note}
    if(input.status!==undefined){if(!statuses.includes(input.status))throw new Error('请选择有效联系状态');item.status=input.status}
    save();return snapshot()
  }
  function removeItem(key){
    const item=board.items.find(item=>item.key===key)
    if(item)board.lastRemoved={item,lists:board.lists.filter(list=>list.keys.includes(key)).map(list=>list.id)}
    board.items=board.items.filter(item=>item.key!==key);board.lists=board.lists.map(list=>({...list,keys:list.keys.filter(id=>id!==key)}))
    save();return snapshot()
  }
  function restoreItem(key){
    if(board.lastRemoved?.item.key!==key)throw new Error('没有可撤销的移除操作')
    if(!board.items.some(item=>item.key===key)){board.items.push(board.lastRemoved.item)}
    for(const list of board.lists)if(board.lastRemoved.lists.includes(list.id)&&!list.keys.includes(key))list.keys.push(key)
    delete board.lastRemoved;save();return snapshot()
  }
  function setComparison(inputs){
    const selected=keys(inputs)
    board.comparison=selected;save();return snapshot()
  }
  function patchComparison(input){
    const added=keys(input.add||[]),removed=new Set(keys(input.remove||[]))
    board.comparison=[...new Set([...board.comparison.filter(key=>!removed.has(key)),...added])]
    save();return snapshot()
  }
  function checkComparison(inputs){const selected=keys(inputs);return {allowed:true,count:selected.length}}
  function setFields(input){board.fields=fields(input);save();return snapshot()}
  function setGoal(goal){
    requireFeature('goals');if(!comparisonGoals[goal])throw new Error('请选择有效比较目标')
    board.goal=goal;board.fields=[...comparisonGoals[goal]];save();return snapshot()
  }
  function evaluate(filters=[]){
    if(!Array.isArray(filters)||filters.some(filter=>!mentorFilterFields.some(field=>field.key===filter.field)))throw new Error('请选择有效筛选字段')
    const runtime=createToolRuntime(data),rows=board.items.map(item=>({...find(item.key),...item})),ref=runtime.acceptInput({rows,columns:[...mentorFilterFields,{key:'key',type:'string'}],sources:[]})
    return runtime.execute('query',{from:ref,filters,select:['key'],limit:5000}).rows.map(row=>row.key)
  }
  function analyze(filters){requireFeature('linked');return {keys:evaluate(filters),filters}}
  function addView(name,filters){requireFeature('views');evaluate(filters);board.views.push({id:randomUUID(),name:title(name),filters});save();return snapshot()}
  function getView(id){const item=board.views.find(item=>item.id===id);if(!item)throw new Error('视图不存在');return {keys:evaluate(item.filters),filters:item.filters,name:item.name}}
  function deleteView(id){board.views=board.views.filter(item=>item.id!==id);save();return snapshot()}
  function compareScenarios(ids){
    requireFeature('scenarios')
    if(!Array.isArray(ids)||ids.length!==2)throw new Error('请选择两个方案')
    const left=getSnapshot(ids[0]),right=getSnapshot(ids[1]),allFields=[...left.fields.filter(field=>right.fields.includes(field)),'note','contact_status']
    const shared=left.rows.filter(row=>right.rows.some(other=>other.key===row.key)).map(row=>{
      const other=right.rows.find(other=>other.key===row.key)
      return {name:row.name,college:row.college,changes:allFields.filter(key=>JSON.stringify(row[key]??null)!==JSON.stringify(other[key]??null)).map(key=>({field:key,label:key==='note'?'我的备注':key==='contact_status'?'我的联系进度':fieldLabels[key],before:row[key]??null,after:other[key]??null}))}
    })
    return {left:{name:left.name,createdAt:left.createdAt,conclusion:left.conclusion,extraFields:left.fields.filter(field=>!right.fields.includes(field)).map(field=>fieldLabels[field])},right:{name:right.name,createdAt:right.createdAt,conclusion:right.conclusion,extraFields:right.fields.filter(field=>!left.fields.includes(field)).map(field=>fieldLabels[field])},shared,onlyLeft:left.rows.filter(row=>!right.rows.some(other=>other.key===row.key)).map(summary),onlyRight:right.rows.filter(row=>!left.rows.some(other=>other.key===row.key)).map(summary)}
  }
  function title(input){
    if(typeof input!=='string'||!input.trim()||input.trim().length>80)throw new Error('名称需为1–80字')
    return input.trim()
  }
  function addList(name){requireFeature('lists');board.lists.push({id:randomUUID(),name:title(name),keys:[]});save();return snapshot()}
  function updateList(id,input){
    requireFeature('lists');const list=board.lists.find(list=>list.id===id);if(!list)throw new Error('清单不存在')
    if(input.name!==undefined)list.name=title(input.name)
    if(input.keys!==undefined){const selected=keys(input.keys);if(selected.some(key=>!board.items.some(item=>item.key===key)))throw new Error('请先收藏要加入清单的导师');list.keys=selected}
    save();return snapshot()
  }
  function deleteList(id){board.lists=board.lists.filter(list=>list.id!==id);save();return snapshot()}
  function addSnapshot(name,conclusion=''){
    requireFeature('snapshots');
    if(typeof conclusion!=='string'||conclusion.length>4000)throw new Error('方案结论最多4000字')
    if(!board.comparison.length)throw new Error('请先选择导师')
    board.snapshots.unshift({id:randomUUID(),name:title(name),createdAt:new Date().toISOString(),fields:[...board.fields],goal:board.goal,conclusion,rows:board.comparison.map(key=>record(find(key)))})
    save();return snapshot()
  }
  function restoreSnapshot(id){
    requireFeature('snapshots');const item=board.snapshots.find(item=>item.id===id);if(!item)throw new Error('方案不存在')
    board.comparison=item.rows.filter(row=>find(row.key)).map(row=>row.key);board.fields=fields(item.fields);board.goal=item.goal||'';save();return snapshot()
  }
  function deleteSnapshot(id){board.snapshots=board.snapshots.filter(item=>item.id!==id);save();return snapshot()}
  function addTemplate(name){requireFeature('templates');board.templates.push({id:randomUUID(),name:title(name),fields:[...board.fields],goal:board.goal});save();return snapshot()}
  function restoreTemplate(id){
    requireFeature('templates');const item=board.templates.find(item=>item.id===id);if(!item)throw new Error('模板不存在')
    board.fields=fields(item.fields);board.goal=item.goal||'';save();return snapshot()
  }
  function deleteTemplate(id){board.templates=board.templates.filter(item=>item.id!==id);save();return snapshot()}
  function directory(query='',college='',offset=0,sort=''){
    if(!Number.isInteger(offset)||offset<0)throw new Error('页码无效')
    const term=query.trim().toLowerCase()
    const named=term?people.filter(person=>person.name.toLowerCase().includes(term)):[]
    const orderedSearch=term&&!named.length?[...index.search([query]).map(personKey),...people.filter(person=>person.college?.toLowerCase().includes(term)).map(person=>person.key)]:named.map(person=>person.key)
    const rankMap=term?new Map(orderedSearch.map((k,i)=>[k,i])):null
    let matches=people.filter(person=>matchesCollege(person.college,college)&&(!rankMap||rankMap.has(person.key)))
    if(sort==='rating')matches=matches.toSorted((a,b)=>(b.rating??-1)-(a.rating??-1)||(b.can_supervise_doctoral?1:0)-(a.can_supervise_doctoral?1:0)||a.name.localeCompare(b.name,'zh-CN'))
    else if(sort==='stipend')matches=matches.toSorted((a,b)=>(b.stipend_monthly_min??-1)-(a.stipend_monthly_min??-1)||(b.rating??-1)-(a.rating??-1)||a.name.localeCompare(b.name,'zh-CN'))
    else if(sort==='name')matches=matches.toSorted((a,b)=>a.name.localeCompare(b.name,'zh-CN'))
    else if(rankMap)matches=matches.toSorted((a,b)=>(rankMap.get(a.key)??99999)-(rankMap.get(b.key)??99999))
    return {total:matches.length,offset,next_offset:offset+30<matches.length?offset+30:null,rows:matches.slice(offset,offset+30).map(summary)}
  }
  function detail(key){const person=find(key);if(!person)throw new Error('导师不存在');return record(person,mentorComparisonFields.map(field=>field.key))}
  function getSnapshot(id){const item=board.snapshots.find(item=>item.id===id);if(!item)throw new Error('方案不存在');return item}
  function report(format='html',snapshotId,options={}){
    requireFeature(format==='csv'?'csv':'reports')
    const saved=snapshotId?getSnapshot(snapshotId):null,selected=options.scope==='library'?mentorComparisonFields.map(field=>field.key):options.fields?fields(options.fields):saved?saved.fields:board.fields,rows=saved?saved.rows:(options.mentors?keys(options.mentors):options.scope==='library'?board.items.map(item=>item.key):board.comparison).map(key=>record(find(key),selected))
    if(!rows.length)throw new Error('请先选择导师')
    const columns=[{key:'name',label:'导师'},{key:'college',label:'学院'},...selected.map(key=>({key,label:fieldLabels[key]})),{key:'contact_status',label:'我的联系进度'},{key:'note',label:'我的备注'}]
    if(format==='csv')return {type:'text/csv;charset=utf-8',extension:'csv',body:csvText({rows,columns})}
    const name=options.name?title(options.name):saved?saved.name:'导师对比报告',date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})
    const sourceRows=[...new Map(rows.flatMap(row=>row.sources).map(source=>[source.id,source])).values()]
    const analysis=reportAnalysis({rows,fields:selected,labels:fieldLabels,level:effective().level,goal:saved?saved.goal||'':board.goal,snapshots:board.snapshots.filter(item=>item.rows.some(row=>rows.some(person=>person.key===row.key))),conclusion:saved?.conclusion||''})
    if(format==='md'){
      const text='# '+name+'\n\n'+date+' · 北极星\n\n'+rows.map(row=>'## '+row.name+' · '+row.college+'\n\n'+selected.filter(key=>row[key]!=null&&row[key]!=='').map(key=>'- '+fieldLabels[key]+'：'+valueText(row[key])).join('\n')+'\n\n我的联系进度：'+row.contact_status+(row.note?'\n\n我的备注：'+row.note:'')).join('\n\n')+'\n\n## 资料来源\n\n'+sourceRows.map(source=>'- '+source.title+(source.url?'：'+source.url:'')).join('\n')
      return {type:'text/markdown;charset=utf-8',extension:'md',body:text+analysis.markdown}
    }
    if(format!=='html')throw new Error('请选择支持的导出格式')
    const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(name)+'</title><style>body{font:15px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#0f172a;background:#f8fafc;margin:0;-webkit-font-smoothing:antialiased}main{max-width:1120px;margin:36px auto;padding:48px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 8px 30px rgba(15,23,42,.05)}h1{font-size:30px;letter-spacing:-.5px;margin:0;color:#0f172a}header .brand{display:flex;align-items:center;gap:10px;margin-bottom:12px}.flag-bad{color:#b42318}.flag-good{color:#146c43}header{border-bottom:2px solid #1d4b8f;padding-bottom:24px}header>div:last-child{margin-top:8px;color:#4b5869;font-size:14px}small,dt{color:#4b5869}dt{font-size:12.5px;font-weight:600}section{break-inside:avoid;padding:26px 0;border-bottom:1px solid #e2e8f0}section:last-child{border-bottom:0}h2{margin:0 0 16px;color:#0f172a;font-size:21px}h2 small{font-weight:500;font-size:14px;margin-left:6px}h3{font-size:15px;color:#334155;margin:18px 0 10px}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 28px}dl>div{min-width:0;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px}dd{margin:5px 0 0;white-space:pre-line;overflow-wrap:anywhere;color:#334155}a{color:#1d4b8f;text-decoration:none}a:hover{text-decoration:underline}.note{background:#edf4ff;border:1px solid #c7daf7;border-radius:10px;padding:14px 16px;white-space:pre-line;color:#0f172a}@media(max-width:680px){main{margin:0;padding:24px;border-radius:0;border:0}dl{grid-template-columns:1fr}}@media print{body{background:white}main{margin:0;padding:0;border:0;box-shadow:none}a{color:inherit}header{break-after:avoid}h2{break-after:avoid}}@page{size:A4;margin:18mm}</style><main><header><div class="brand"><svg viewBox="0 0 32 32" width="30" height="30"><rect width="32" height="32" rx="9" fill="#1d4b8f"/><path d="'+STAR_PATH+'" transform="translate(0 1.5)" fill="#fbbf24"/></svg><small>'+APP_NAME+' '+APP_EN+' · 对比报告</small></div><h1>'+escape(name)+'</h1><div>'+date+' · '+rows.length+'位导师</div></header>'+rows.map(row=>'<section><h2>'+escape(row.name)+' <small>'+escape(row.college)+'</small></h2><dl>'+selected.filter(key=>row[key]!=null&&row[key]!=='').map(key=>'<div><dt>'+escape(fieldLabels[key])+'</dt><dd>'+escape(valueText(row[key]))+'</dd></div>').join('')+'</dl><p>我的联系进度：'+escape(row.contact_status)+'</p>'+(row.note?'<div class="note"><b>我的备注</b><br>'+escape(row.note)+'</div>':'')+'</section>').join('')+'<section><h2>资料来源</h2><ul>'+sourceRows.map(source=>'<li>'+(publicWebUrl(source.url)?'<a href="'+escape(source.url)+'">'+escape(source.title)+'</a>':escape(source.title))+'</li>').join('')+'</ul></section></main></html>'
    return {type:'text/html;charset=utf-8',extension:'html',body:html.replace('</header>','</header>'+analysis.html)}
  }
  function getReport(id){
    if(!/^[\w-]+$/.test(id))throw new Error('报告不存在')
    const file=store.read('reports/'+id,null);if(!file)throw new Error('报告不存在');return file
  }
  function execute(input,runtime){
    validateWorkbenchAction(input)
    const listName=input.list_name?.trim()
    if(!listName||['我的候选库','候选库','全部候选'].includes(listName)&&!board.lists.some(list=>list.name===listName))input={...input,list_name:undefined}
    if(input.action==='analyze'){
      const matched=analyze(input.filters||[]),people=matched.keys.map(key=>find(key))
      if(!people.length){const columns=[{key:'name',label:'导师',type:'string'},{key:'college',label:'学院',type:'string'}],ref=runtime.acceptInput({rows:[],columns,sources:[]});return {ref,rows:[],columns,total:0,returned:0,sources:[],message:'当前条件匹配0位已收藏导师。'}}
      return execute({action:'read',mentors:people.map(person=>({name:person.name,college:person.college})),limit:input.limit,offset:input.offset,include_notes:input.include_notes},runtime)
    }
    if(input.action==='view'){addView(input.name,input.filters||[]);return {message:'已保存动态视图'+input.name+'。',sources:[]}}
    if(input.action==='scenario'){
      const result=compareScenarios(input.scenario_ids),rows=[...result.shared.map(row=>({name:row.name,college:row.college,category:'共同人选',changes:row.changes.map(change=>change.label+'：'+valueText(change.before)+' → '+valueText(change.after)).join('\n')})),...result.onlyLeft.map(row=>({name:row.name,college:row.college,category:'只在'+result.left.name,changes:''})),...result.onlyRight.map(row=>({name:row.name,college:row.college,category:'只在'+result.right.name,changes:''}))]
      const columns=[{key:'name',label:'导师',type:'string'},{key:'college',label:'学院',type:'string'},{key:'category',label:'方案归属',type:'string'},{key:'changes',label:'保存资料的变化',type:'string'}],ref=runtime.acceptInput({rows,columns,sources:[]})
      return {ref,rows,columns,total:rows.length,returned:rows.length,sources:[],schemes:[result.left,result.right]}
    }
    const incoming=input.from?runtime.tables[input.from]?.rows:input.mentors
    if(input.from&&!incoming)throw new Error('查询引用不存在，请先查询导师')
    const selectors=incoming?.map(row=>({name:row.name||row.mentor_name,college:row.college}))
    const selected=selectors?keys(selectors):[],list=input.list_name?board.lists.find(list=>list.name===input.list_name):null
    let message='',file
    if(input.action==='read'){
      if(input.list_name&&!list)throw new Error('没有这个清单')
      const scope=input.scope||'library',original=scope==='comparison'?board.comparison.map(key=>board.items.find(item=>item.key===key)||{key,note:'',status:'considering'}):board.items.toSorted((a,b)=>b.addedAt.localeCompare(a.addedAt))
      let items=original.filter(item=>(!list||list.keys.includes(item.key))&&(!selectors||selected.includes(item.key)))
      const total=items.length,offset=input.offset||0;items=items.slice(offset,offset+(input.limit||30))
      const rows=items.map(item=>{const {key,...person}=find(item.key);return {...person,contact_status:contactStatuses[item.status],...(input.include_notes?{personal_note:item.note}:{})}})
      const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))].map(key=>({key,label:key==='personal_note'?'我的备注':key==='contact_status'?'我的联系进度':/^(student_count|exam_count|recommended_count)$/.test(key)?fieldLabels[key]+'（'+data.metadata.year+'年名册，全专业）':fieldLabels[key]||key,type:rows.map(row=>row[key]).find(value=>value!=null)==null?'unknown':typeof rows.find(row=>row[key]!=null)[key],...(/^(student_count|exam_count|recommended_count)$/.test(key)?{statistic_scope:'all_programs'}:{})}))
      const sources=data.sources.filter(source=>rows.some(row=>row.source_ids.includes(source.id)))
      const ref=runtime.acceptInput({rows,columns,sources,row_source_ids:rows.map(row=>row.source_ids),total:rows.length})
      return {ref,rows,columns,total,returned:rows.length,offset,next_offset:offset+rows.length<total?offset+rows.length:null,sources,scope,comparison:{count:board.comparison.length,mentors:board.comparison.map(key=>({name:find(key).name,college:find(key).college})),goal:board.goal,fields:board.fields},notes:['ref只包含本页实际返回的导师；total是所选范围总人数，完整统计应先提高limit获取完整列表。'],lists:board.lists.map(list=>({name:list.name,count:list.keys.length})),snapshots:board.snapshots.map(({rows,...item})=>({...item,count:rows.length})),templates:board.templates,views:board.views,membership:{name:effective().name,analysisLevel:effective().level}}
    }
    if(['save','remove','compare','note'].includes(input.action)&&!selected.length)throw new Error('请选择实际导师，或提供导师查询ref')
    if(input.action==='save'){
      if(input.list_name)requireFeature('lists')
        addItems(selected)
      if(input.list_name){if(!list)addList(input.list_name);const target=board.lists.find(item=>item.name===input.list_name);updateList(target.id,{keys:[...new Set([...target.keys,...selected])]})}
      message='已将'+selected.length+'位导师保存到'+(input.list_name||'候选库')+'。'
    }else if(input.action==='remove'){
      if(input.list_name){if(!list)throw new Error('没有这个清单');updateList(list.id,{keys:list.keys.filter(key=>!selected.includes(key))})}
      else selected.forEach(removeItem)
      message='已从'+(input.list_name||'候选库')+'移出'+selected.length+'位导师。'
    }else if(input.action==='compare'){
      setComparison(selected);if(input.fields)setFields(input.fields)
      message='已将'+selected.length+'位导师放入工作台对比。'
    }else if(input.action==='list'){
      title(input.name)
      if(input.list_name){if(!list)throw new Error('没有这个清单');updateList(list.id,{name:input.name})}else addList(input.name)
      message='已保存清单'+input.name+'。'
    }else if(input.action==='note'){
      requireFeature('notes')
      if(input.note===undefined&&input.status===undefined)throw new Error('请提供备注或联系进度')
      addItems(selected);selected.forEach(key=>updateItem(key,{note:input.note,status:input.status}))
      message='已更新'+selected.length+'位导师的个人记录。'
    }else if(input.action==='snapshot'){
      addSnapshot(input.name,input.note||'');message='已保存方案'+input.name+'。'
    }else if(input.action==='template'){
      requireFeature('templates');title(input.name);if(input.fields)setFields(input.fields);addTemplate(input.name);message='已保存对比模板'+input.name+'。'
    }else if(input.action==='restore'){
      if(!['snapshot','template'].includes(input.saved_type))throw new Error('请选择要载入的方案或模板')
      const item=(input.saved_type==='snapshot'?board.snapshots:board.templates).find(item=>item.id===input.saved_id)
      if(!item)throw new Error('没有找到这份方案或模板')
      if(input.saved_type==='snapshot')restoreSnapshot(item.id);else restoreTemplate(item.id)
      message='已载入'+item.name+'，当前对比'+board.comparison.length+'位导师。'
    }else if(input.action==='report'){
      const format=input.format||'html',result=report(format,undefined,{name:input.name,fields:input.fields,mentors:selectors,scope:input.scope})
      const id=randomUUID(),name=(input.name||'导师对比报告').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_')+'.'+result.extension
      file={id,name,format:result.extension,depth:effective().focus,count:selectors?selected.length:input.scope==='library'?board.items.length:board.comparison.length,createdAt:new Date().toISOString()}
      store.write('reports/'+id,{...file,...result});message='已生成'+file.count+'位导师的对比报告。'
    }else if(input.action==='undo'){
      if(!board.lastRemoved)throw new Error('没有可撤销的移除操作');restoreItem(board.lastRemoved.item.key);message='已恢复最近移出的导师及备注。'
    }
    return {message,...(file?{file}:{}),saved_count:board.items.length,comparison_count:board.comparison.length,selected:(input.action==='restore'?board.comparison:selected).map(key=>({name:find(key).name,college:find(key).college})),lists:board.lists.map(list=>({name:list.name,count:list.keys.length})),sources:[]}
  }
  return {snapshot,setExperience,addItems,updateItem,removeItem,restoreItem,setComparison,patchComparison,checkComparison,setFields,setGoal,analyze,addView,getView,deleteView,compareScenarios,addList,updateList,deleteList,addSnapshot,restoreSnapshot,deleteSnapshot,addTemplate,restoreTemplate,deleteTemplate,directory,detail,getSnapshot,report,getReport,execute}
}

import {differingComparisonFields} from '../lib/fields.js'
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const text=value=>value==null?'—':typeof value==='boolean'?value?'是':'否':String(value)
export function reportAnalysis({rows,fields,labels,level,goal,snapshots=[],conclusion=''}){
  const changed=differingComparisonFields(rows,fields)
  const splitCol=v=>String(v).split(/[、,，]+/).map(s=>s.replace(/[（(].*$/,'').trim()).filter(Boolean)
  const counts=key=>key==='college'?(()=>{const all=[...new Set(rows.flatMap(r=>r.college?splitCol(r.college):[]))];return all.map(label=>({label,count:rows.filter(r=>r.college&&splitCol(r.college).includes(label)).length})).sort((a,b)=>b.count-a.count)})():[...new Set(rows.map(row=>row[key]).filter(value=>value!=null&&value!==''))].map(value=>({label:text(value),count:rows.filter(row=>row[key]===value).length}))
  const graph=(title,entries)=>{
    if(!entries.length)return ''
    const max=Math.max(...entries.map(row=>row.count)),height=entries.length*36+32
    return '<div style="break-inside:avoid;margin-top:12px"><h3>'+escape(title)+'</h3><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 '+height+'" role="img" aria-label="'+escape(title)+'" style="width:100%;max-width:740px">'+entries.map((row,index)=>{const barW=Math.max(4,Math.round(row.count/max*380));const shortLabel=row.label.length>15?row.label.slice(0,14)+'…':row.label;return '<text x="0" y="'+(index*36+22)+'" font-size="12.5" fill="#334155">'+escape(shortLabel)+'</text><rect x="216" y="'+(index*36+8)+'" width="380" height="18" rx="5" fill="#f1f5f9"/><rect x="216" y="'+(index*36+8)+'" width="'+barW+'" height="18" rx="5" fill="#1d4b8f"/><text x="'+(224+barW)+'" y="'+(index*36+22)+'" font-size="12.5" font-weight="600" fill="#0f172a">'+row.count+'</text>'}).join('')+'</svg></div>'
  }
  const matrix=rows.length>=2?'<div style="overflow-x:auto;margin-top:16px"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f5f9;text-align:left"><th style="padding:10px 12px;border:1px solid #e2e8f0">导师</th><th style="padding:10px 12px;border:1px solid #e2e8f0">学院</th><th style="padding:10px 12px;border:1px solid #e2e8f0">评分</th><th style="padding:10px 12px;border:1px solid #e2e8f0">博导</th><th style="padding:10px 12px;border:1px solid #e2e8f0">优点亮点</th><th style="padding:10px 12px;border:1px solid #e2e8f0">风险提示</th></tr></thead><tbody>'+rows.map(r=>'<tr><td style="padding:10px 12px;border:1px solid #e2e8f0;font-weight:600">'+escape(r.name)+'</td><td style="padding:10px 12px;border:1px solid #e2e8f0;color:#4b5869">'+escape(r.college)+'</td><td style="padding:10px 12px;border:1px solid #e2e8f0">'+(r.rating!=null?escape(r.rating)+' / 5':'—')+'</td><td style="padding:10px 12px;border:1px solid #e2e8f0">'+(r.can_supervise_doctoral?'是':'—')+'</td><td style="padding:10px 12px;border:1px solid #e2e8f0;color:#146c43">'+escape(r.green_flags||'—')+'</td><td style="padding:10px 12px;border:1px solid #e2e8f0;color:'+(r.red_flags?'#b42318':'#4b5869')+'">'+escape(r.red_flags||'—')+'</td></tr>').join('')+'</tbody></table></div>':''
  let html='',markdown=''
  if(level>=1){
    const differences=changed.map(key=>labels[key])
    html='<section><h2>比较概览'+(goal?' · '+escape(goal):'')+'</h2><p>'+rows.length+'位导师 · '+counts('college').length+'个学院 · '+fields.length+'项对比维度</p>'+(differences.length?'<p>存在差异的对比项：'+differences.map(escape).join('、')+'。</p>':'')+matrix+'</section>'
    markdown='\n\n## 比较概览\n\n'+rows.length+'位导师 · '+counts('college').length+'个学院 · '+fields.length+'项对比维度'+(differences.length?'\n\n存在差异的对比项：'+differences.join('、')+'。':'')
  }
  if(level>=2){
    html+='<section><h2>数据分布</h2>'+graph('学院分布',counts('college'))+graph('培养体验评分分布',counts('rating').map(row=>({...row,label:row.label+'分'})))+'</section>'
    markdown+='\n\n## 数据分布\n\n'+counts('college').map(row=>'- '+row.label+'：'+row.count+'位').join('\n')
  }
  if(level>=3&&(conclusion||snapshots.length)){
    html+='<section><h2>方案与选择记录</h2>'+(conclusion?'<h3>我的选择结论</h3><p style="white-space:pre-line">'+escape(conclusion)+'</p>':'')+(snapshots.length?'<h3>相关方案版本</h3><ul>'+snapshots.map(item=>'<li>'+escape(item.name)+' · '+escape(new Date(item.createdAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}))+' · '+item.rows.length+'位导师</li>').join('')+'</ul>':'')+'</section>'
    markdown+='\n\n## 方案与选择记录'+(conclusion?'\n\n### 我的选择结论\n\n'+conclusion:'')+(snapshots.length?'\n\n'+snapshots.map(item=>'- '+item.name+' · '+new Date(item.createdAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})+' · '+item.rows.length+'位导师').join('\n'):'')
  }
  return {html,markdown}
}

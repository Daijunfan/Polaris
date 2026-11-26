import {APP_NAME} from '../../lib/brand.js'
import React, { memo, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Download, Maximize2, Table2, ChartNoAxesCombined } from 'lucide-react'
import { downloadFile } from '../api.js'
import DataTable from './DataTable.jsx'
import { columnLabel, display, internalColumn, resultTitle,csvText } from '../presentation.js'
import Dialog from './Dialog.jsx'
import { mentorRanking, publicArtifact, sourceName } from '../../lib/presentation.js'
import SourceLinks from './SourceLinks.jsx'
import ExportMenu from './ExportMenu.jsx'
export { default as DataTable } from './DataTable.jsx'

const palette = ['#1d4b8f', '#0d9488', '#d97706', '#7c3aed', '#e11d48', '#0284c7', '#4f46e5', '#059669']
const paletteLight = ['#3b76c4', '#14b8a6', '#f59e0b', '#9333ea', '#f43f5e', '#38bdf8', '#6366f1', '#10b981']
export function pointColors(artifact) {
  if (!artifact.color_by) return null
  const key = artifact.color_by, column = artifact.columns.find(c => c.key === key), colLabel = column?.label || key, values = [...new Set(artifact.rows.map(r => r[key]))]
  const numbers = values.filter(v => v != null)
  if (numbers.length && numbers.every(v => typeof v === 'number')) {
    const min = Math.min(...numbers), max = Math.max(...numbers)
    return { label: colLabel, numeric: true, min, max, entries: [], color: value => value == null ? '#94a3b8' : `hsl(215 72% ${78 - (value-min)/(max-min||1)*42}%)` }
  }
  const categoryPalette = ['#1d4b8f','#0d9488','#d97706','#7c3aed','#e11d48','#0284c7','#4f46e5','#059669','#c2410c','#0891b2','#9333ea','#b45309','#2563eb','#be123c']
  const entries = values.map((value,i) => ({value,label:display(value,column),color:categoryPalette[i]||`hsl(${i*137.5%360} 58% 46%)`}))
  return {label:colLabel,numeric:false,entries,color:value=>entries.find(e=>e.value===value)?.color||'#94a3b8'}
}
function axisRange(min, max) {
  if (min === 0 && max === 0) return { min: 0, max: 5, ticks: [0, 1, 2, 3, 4, 5] }
  const span = max > min ? max - min : Math.max(1, Math.abs(min) * 0.2 || 1)
  const raw = span / 5, unit = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].find(n => n * unit >= raw) * unit
  const start = Number((Math.floor(min / step) * step).toPrecision(12))
  const end = Number((Math.ceil((max > min ? max : min + step) / step) * step).toPrecision(12))
  const count = Math.max(1, Math.round((end - start) / step))
  return { min: start, max: end, ticks: Array.from({ length: count + 1 }, (_, i) => Number((start + i * step).toPrecision(12))) }
}
function exportCSV(artifact) {
  downloadFile(`${artifact.title}.csv`,csvText(artifact),'text/csv;charset=utf-8')
}
export function Chart({ artifact, svgRef, colors, expanded=false }) {
  const [active, setActive] = useState(null)
  const [width,setWidth]=useState(720),plot=useRef()
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  useLayoutEffect(()=>{
    const el=plot.current
    if(!el)return
    const measure=()=>setWidth(Math.round(el.clientWidth))
    measure()
    const observer=new ResizeObserver(measure)
    observer.observe(el)
    return()=>observer.disconnect()
  },[artifact.type])
  const rows = artifact.type === 'bar' ? artifact.rows.slice(0, 20) : artifact.rows, yKeys = artifact.y,range=artifact.range
  const column = key => artifact.columns.find(c => c.key === key)
  const studentKey=artifact.columns.find(c=>c.key==='student_name'||c.label==='学生姓名')?.key
  const label = key => column(key)?.label || key
  const format = (row, key) => display(row[key], column(key))
  const amount=row=>{const low=row[range.low],high=row[range.high];return low==null?display(high):high==null||low===high?display(low):`${display(low)}–${display(high)}`}
  if (!rows.length) return <div className="chart-empty">暂无数据</div>
  if (artifact.type === 'metric') {
    const count=Math.min(rows.length,6)*yKeys.length
    return <><div className="metric-grid" ref={plot} style={{'--metric-columns':width<600?Math.min(2,count):Math.min(count===6?3:4,count),'--metric-mobile-columns':Math.min(2,count)}}>{rows.slice(0, 6).map((row, i) => yKeys.map(key => <div className="metric-item" key={`${i}-${key}`}><small>{artifact.x?`${format(row,artifact.x)} · `:''}{label(key)}</small><strong>{format(row, key)}</strong></div>))}</div>{rows.length>6&&<p className="chart-truncation">前6条 · 共{rows.length}条，完整结果见数据视图</p>}</>
  }
  const values = rows.flatMap(row => yKeys.map(key => row[key])).filter(v => typeof v === 'number')
  if (!values.length) return <div className="chart-empty">暂无数值</div>
  const yAxis = axisRange(['scatter','line'].includes(artifact.type) ? Math.min(...values) : Math.min(0, ...values), Math.max(...values))
  const low = yAxis.min, high = yAxis.max
  const tooltip = (row, anchor) => {
    const identity=row[studentKey]?studentKey:row.name?'name':row.mentor_name?'mentor_name':null
    const details=artifact.columns.filter(c=>![artifact.x,...yKeys,identity].includes(c.key)).slice(0,6)
    const placeLeft = anchor && anchor.xPct > 0.56
    const topPx = anchor ? Math.max(8, Math.min(Math.max(8, anchor.h - 118), Math.round(anchor.y - 26))) : 8
    const posStyle = anchor ? { top: topPx, ...(placeLeft ? { left: 14, right: 'auto' } : { right: 14, left: 'auto' }) } : undefined
    return <div className="chart-tooltip" role="status" style={posStyle}><b>{row[identity]||(artifact.type==='scatter'?'成绩样本':typeof row[artifact.x]==='number'?`${label(artifact.x)}：${format(row,artifact.x)}`:format(row,artifact.x))}</b>{artifact.type === 'scatter' && <span>{label(artifact.x)}<strong>{format(row, artifact.x)}</strong></span>}{range?<span><i style={{background:colors?colors.color(row[artifact.color_by]):palette[0]}}/>{range.label}<strong>{amount(row)}</strong></span>:yKeys.map((key, i) => <span key={key}><i style={{ background: colors?colors.color(row[artifact.color_by]):palette[i % palette.length] }}/>{label(key)}<strong>{format(row, key)}</strong></span>)}{details.map(c=><span key={c.key}>{c.label}<strong>{display(row[c.key],c).length>70?display(row[c.key],c).slice(0,70)+'…':display(row[c.key],c)}</strong></span>)}</div>
  }
  function pointInteraction(row,index) {
    return {'data-point-index':index,tabIndex:active===index||active==null&&index===0?0:-1,onFocus:()=>setActive(index),onBlur:()=>setActive(null),onPointerEnter:event=>{if(event.pointerType!=='touch')setActive(index)},onPointerUp:event=>{if(event.pointerType==='touch')setActive(index)},onPointerCancel:()=>setActive(null),'aria-label':`${row[studentKey]?row[studentKey]+'，':''}${format(row,artifact.x)}，${range?`${range.label} ${amount(row)}`:yKeys.map(k=>`${label(k)} ${format(row,k)}`).join('，')}`,onKeyDown:event=>{
      let next
      if(['ArrowRight','ArrowDown'].includes(event.key))next=(index+1)%rows.length
      if(['ArrowLeft','ArrowUp'].includes(event.key))next=(index-1+rows.length)%rows.length
      if(event.key==='Home')next=0
      if(event.key==='End')next=rows.length-1
      if(next!=null){event.preventDefault();event.stopPropagation();setActive(next);event.currentTarget.closest('svg').querySelector(`[data-point-index="${next}"]`)?.focus()}
    }}
  }
  const common = { onPointerLeave:event=>{if(event.pointerType!=='touch')setActive(null)},onPointerDown:event=>{if(!event.target.closest('[data-point-index]'))setActive(null)} }
  const numericBars = artifact.type === 'bar' && rows.every(row => typeof row[artifact.x] === 'number')
  if (artifact.type === 'bar' && !numericBars) {
    const w = Math.max(280,width), left = Math.min(156,Math.max(88,Math.round(w*.21))), right = range?114:78, top = 12, band = range?46:Math.max(46, yKeys.length * 20 + 16), h = rows.length * band + top + 38
    const scale = n => left + (n - low) / (high - low || 1) * (w - left - right)
    const showTrack = !range && yKeys.length === 1 && low === 0
    return <div className="chart-plot" ref={plot} {...common}>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={artifact.title}>
        <title>{artifact.title}</title>
        <defs>
          {yKeys.map((_, j) => <linearGradient key={j} id={`hbar-${gid}-${j}`} x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor={palette[j % palette.length]}/><stop offset="100%" stopColor={paletteLight[j % paletteLight.length]}/></linearGradient>)}
        </defs>
        {yAxis.ticks.map(n => <g key={n}><line className="chart-grid-line" x1={scale(n)} y1={top - 3} x2={scale(n)} y2={h - 27}/><text className="chart-axis" textAnchor="middle" x={scale(n)} y={h - 8}>{display(n)}</text></g>)}
        {rows.map((row, i) => <g key={i} {...pointInteraction(row,i)}>
          <rect data-hover-bg="1" x="2" y={top + i * band + 3} width={w - 4} height={band - 6} rx="8" fill={active === i ? '#edf4ff' : 'transparent'}/>
          <text className="chart-category" x={left - 13} y={top + i * band + band / 2} dominantBaseline="middle" textAnchor="end">{format(row, artifact.x).length>Math.floor((left-18)/12)?`${format(row,artifact.x).slice(0,Math.floor((left-18)/12)-1)}…`:format(row,artifact.x)}</text>
          {range?(()=>{const lowVal=row[range.low]??row[range.high],highVal=row[range.high]??row[range.low],y=top+i*band+band/2,color=colors?colors.color(row[artifact.color_by]):palette[0];return lowVal==null?null:<g opacity={active==null||active===i?1:.35}><line x1={left} x2={w-right} y1={y} y2={y} stroke="#eef2f7" strokeWidth="4" strokeLinecap="round"/><line x1={scale(lowVal)} x2={scale(highVal)} y1={y} y2={y} stroke={color} strokeWidth="5" strokeLinecap="round"/><circle cx={scale(lowVal)} cy={y} r="4.5" fill={color} stroke="#ffffff" strokeWidth="1.5"/>{lowVal!==highVal&&<circle cx={scale(highVal)} cy={y} r="4.5" fill={color} stroke="#ffffff" strokeWidth="1.5"/>}<text className="chart-value" x={scale(highVal)+11} y={y+4}>{amount(row)}</text></g>})():yKeys.map((key, j) => { const value = row[key], y = top + i * band + (band-yKeys.length*20)/2 + j * 20 + 2; return <g key={key}>
            {showTrack && <rect x={scale(0)} y={y} width={Math.max(1, w - left - right)} height={15} rx="5" fill="#f1f5f9"/>}
            {value != null && <rect x={Math.min(scale(0), scale(value))} y={y} width={Math.max(2, Math.abs(scale(value) - scale(0)))} height={15} rx="5" fill={`url(#hbar-${gid}-${j})`} opacity={active == null || active === i ? 0.96 : 0.35}/>}
            <text className="chart-value" textAnchor={value<0?'end':'start'} x={(value == null ? scale(0) : scale(value)) + (value<0?-8:8)} y={y + 11.5}>{display(value)}</text>
          </g> })}
        </g>)}
      </svg>
      {active != null && rows[active] && tooltip(rows[active], { xPct: 0.3, y: top + active * band + band / 2, h })}
      {artifact.rows.length > rows.length && <p className="chart-truncation">前 {rows.length} 行 · 共 {artifact.rows.length} 行</p>}
    </div>
  }
  const w = Math.max(280,width), h = expanded?(width<500?360:500):width<500?320:350, m = { l: 57, r: 24, t: 25, b: 58 }, innerW = w - m.l - m.r, innerH = h - m.t - m.b
  const numericX = rows.every(row => row[artifact.x] == null || typeof row[artifact.x] === 'number')
  const xs = rows.map(row => row[artifact.x]).filter(v => typeof v === 'number')
  const distinctX = [...new Set(xs)].sort((a, b) => a - b)
  const slot = distinctX.length > 1 ? Math.min(...distinctX.slice(1).map((v, i) => v - distinctX[i])) : 1
  const padX = numericBars ? slot / 2 : distinctX.length === 1 ? 1 : 0
  const xAxis = numericX && xs.length ? axisRange(Math.min(...xs) - padX, Math.max(...xs) + padX) : null
  const minX = xAxis ? xAxis.min : 0, maxX = xAxis ? xAxis.max : Math.max(1, rows.length - 1)
  const px = (row, i) => !numericX && rows.length === 1 ? m.l + innerW / 2 : m.l + ((numericX ? row[artifact.x] : i) - minX) / (maxX - minX || 1) * innerW
  const py = value => m.t + innerH - (value - low) / (high - low || 1) * innerH
  const barWidth = numericBars ? slot / (maxX - minX || 1) * innerW * 0.72 / yKeys.length : 0
  const ticks = [...new Set([0, Math.floor((rows.length - 1) / 3), Math.floor((rows.length - 1) * 2 / 3), rows.length - 1])]
  const scatterPositions = useMemo(() => {
    if (artifact.type !== 'scatter' || yKeys.length !== 1) return null
    const yKey = yKeys[0], buckets = new Map(), coords = new Array(rows.length)
    rows.forEach((row, i) => {
      if (row[yKey] == null || row[artifact.x] == null) return
      const bx = px(row, i), by = py(row[yKey]), key = `${Math.round(bx / 4)}:${Math.round(by / 4)}`
      const list = buckets.get(key) || []; list.push({ i, bx, by }); buckets.set(key, list)
    })
    for (const list of buckets.values()) {
      list.forEach(({ i, bx, by }, k) => {
        if (k === 0) { coords[i] = [Number(bx.toFixed(1)), Number(by.toFixed(1))]; return }
        const radius = Math.min(10, 5 + Math.floor((k - 1) / 6) * 4), angle = k * 2.39996
        const jx = Math.max(m.l + 4, Math.min(w - m.r - 4, bx + Math.cos(angle) * radius))
        const jy = Math.max(m.t + 4, Math.min(m.t + innerH - 4, by + Math.sin(angle) * radius))
        coords[i] = [Number(jx.toFixed(1)), Number(jy.toFixed(1))]
      })
    }
    return coords
  }, [artifact.type, artifact.x, yKeys, rows, w, h, minX, maxX, low, high])
  const valueLabels=[]
  function showValueLabel(row,index,series,key){
    const x=px(row,index)-barWidth*yKeys.length/2+(series+.5)*barWidth,y=py(row[key])-7,half=format(row,key).length*3.5
    if(valueLabels.some(label=>Math.abs(label.y-y)<14&&Math.abs(label.x-x)<label.half+half+5))return false
    valueLabels.push({x,y,half});return true
  }
  const activeRow = active != null ? rows[active] : null
  const activeCoord = active != null && activeRow && activeRow[artifact.x] != null && activeRow[yKeys[0]] != null
    ? (scatterPositions?.[active] || [px(activeRow, active), py(activeRow[yKeys[0]])])
    : null
  return <div className="chart-plot" ref={plot} {...common}><svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={artifact.title}><title>{artifact.title}</title>
    <defs>
      {yKeys.map((_, s) => <linearGradient key={s} id={`vbar-${gid}-${s}`} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor={paletteLight[s % paletteLight.length]}/><stop offset="100%" stopColor={palette[s % palette.length]}/></linearGradient>)}
      <linearGradient id={`area-${gid}-0`} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor={palette[0]} stopOpacity="0.16"/><stop offset="100%" stopColor={palette[0]} stopOpacity="0.01"/></linearGradient>
    </defs>
    {yAxis.ticks.map(n => <g key={n}><line className="chart-grid-line" x1={m.l} x2={w - m.r} y1={py(n)} y2={py(n)}/><text className="chart-axis" textAnchor="end" x={m.l - 10} y={py(n) + 4}>{display(n)}</text></g>)}
    {xAxis ? xAxis.ticks.map(n => <text className="chart-axis" textAnchor="middle" key={n} x={m.l + (n - minX) / (maxX - minX || 1) * innerW} y={h - 31}>{display(n)}</text>) : ticks.map(i => { const tx = px(rows[i], i), anchor = rows.length > 1 && tx < m.l + 24 ? 'start' : rows.length > 1 && tx > w - m.r - 24 ? 'end' : 'middle'; return <text className="chart-axis" textAnchor={anchor} key={i} x={tx} y={h - 31}>{format(rows[i], artifact.x).slice(0, 12)}</text> })}
    <text className="chart-axis" textAnchor="middle" x={m.l + innerW / 2} y={h - 8}>{label(artifact.x)}</text>
    <text className="chart-axis" textAnchor="middle" transform={`translate(14 ${m.t + innerH / 2}) rotate(-90)`}>{yKeys.map(label).join(' / ')}</text>
    {activeCoord && artifact.type !== 'scatter' && <line data-hover-guide="1" x1={activeCoord[0]} x2={activeCoord[0]} y1={m.t} y2={m.t + innerH} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3"/>}
    {yKeys.map((key, series) => {
      let connected = false
      const segments = []
      const d = rows.map((row, i) => {
        if (row[key] == null || row[artifact.x] == null) { connected = false; return '' }
        const x = Number(px(row, i).toFixed(2)), y = Number(py(row[key]).toFixed(2))
        if (!connected) segments.push([{ x, y }]); else segments.at(-1).push({ x, y })
        const cmd = connected ? 'L' : 'M'; connected = true
        return `${cmd}${x},${y}`
      }).join(' ')
      const areaD = artifact.type === 'line' && yKeys.length === 1
        ? segments.filter(seg => seg.length > 1).map(seg => `M${seg[0].x},${Number(py(low).toFixed(2))} ` + seg.map(pt => `L${pt.x},${pt.y}`).join(' ') + ` L${seg.at(-1).x},${Number(py(low).toFixed(2))} Z`).join(' ')
        : ''
      return <g key={key}>
        {areaD && <path d={areaD} fill={`url(#area-${gid}-0)`}/>}
        {artifact.type === 'line' && <path d={d} fill="none" stroke={palette[series % palette.length]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>}
        {rows.map((row, i) => {
          if (row[key] == null || row[artifact.x] == null) return null
          const interaction = pointInteraction(row,i)
          const [cx, cy] = scatterPositions?.[i] || [px(row, i), py(row[key])]
          return numericBars ? <g key={i}><rect {...interaction} x={px(row, i) - barWidth * yKeys.length / 2 + series * barWidth} y={Math.min(py(0), py(row[key]))} width={Math.max(2, barWidth - 2)} height={Math.max(2, Math.abs(py(row[key]) - py(0)))} rx="5" fill={`url(#vbar-${gid}-${series})`} opacity={active == null || active === i ? 0.94 : 0.35}/>{showValueLabel(row,i,series,key)&&<text className="chart-value" textAnchor="middle" x={px(row, i) - barWidth * yKeys.length / 2 + (series + 0.5) * barWidth} y={py(row[key]) - 7}>{format(row, key)}</text>}</g> : <circle {...interaction} key={i} cx={cx} cy={cy} r={active === i ? 6.5 : artifact.type === 'scatter' ? 5 : 3.8} fill={colors?colors.color(row[artifact.color_by]):palette[series % palette.length]} stroke="#ffffff" strokeWidth={active===i?2.2:1.5} opacity={active == null || active === i ? 0.92 : 0.28}/>
        })}
      </g>
    })}
  </svg>{active != null && activeRow && tooltip(activeRow, activeCoord ? { xPct: (activeCoord[0] - m.l) / (innerW || 1), y: activeCoord[1], h } : null)}</div>
}

export default memo(function Artifact({ artifact: original, onSources }) {
  const artifact = useMemo(() => publicArtifact(original), [original])
  const colors = useMemo(()=>artifact?pointColors(artifact):null,[artifact])
  const [dataView, setDataView] = useState(artifact?.type === 'table'), [expanded, setExpanded] = useState(null), svgRef = useRef(),expandedSvg=useRef()
  const table=useMemo(()=>artifact?publicArtifact({...artifact,type:'table'}):null,[artifact])
  if (!artifact) return null
  const label = key => artifact.columns.find(c => c.key === key)?.label || key
  const legend=<>
    {!colors && artifact.type!=='metric' && artifact.y.length > 1 && <div className="chart-legend">{artifact.range?<span><i style={{background:palette[0]}}/>{artifact.range.label}</span>:artifact.y.map((key, i) => <span key={key}><i style={{ background: palette[i % palette.length] }}/>{label(key)}</span>)}</div>}
    {colors && <div className="chart-legend"><b>{colors.label}</b>{colors.numeric?<span>{display(colors.min)}<i className="color-scale" style={{background:`linear-gradient(90deg,${colors.color(colors.min)},${colors.color(colors.max)})`}}/>{display(colors.max)}</span>:colors.entries.map((e,i)=><span key={i}><i style={{background:e.color}}/>{e.label}</span>)}</div>}
  </>
  function exportSVG(element=svgRef.current) {
    if (!element) return
    const clone = element.cloneNode(true)
    const ns = 'http://www.w3.org/2000/svg', width = element.viewBox.baseVal.width, height = element.viewBox.baseVal.height
    const root = document.createElementNS(ns, 'svg'), canvas = document.createElement('canvas'), measure = canvas.getContext('2d')
    root.setAttribute('xmlns', ns)
    const svgFont='"PingFang SC","Microsoft YaHei UI","Microsoft YaHei","Hiragino Sans GB","Segoe UI",system-ui,-apple-system,sans-serif'
    function text(value, x, y, size = 11, color = '#4b5869', bold = false) {
      const node = document.createElementNS(ns, 'text'); node.setAttribute('x', x); node.setAttribute('y', y); node.setAttribute('font-size', size); node.setAttribute('fill', color)
      if (bold) node.setAttribute('font-weight', '600')
      node.textContent = value; root.append(node)
    }
    function lines(value, size) {
      measure.font = `${size}px ${svgFont}`
      const result = []; let line = ''
      for (const character of value) { if (line && measure.measureText(line + character).width > width - 36) { result.push(line); line = '' }; line += character }
      if (line) result.push(line)
      return result
    }
    let y = 25
    for (const line of lines(artifact.title, 14)) { text(line, 18, y, 14, '#0f172a', true); y += 21 }
    for (const line of lines(artifact.description || '', 11)) { text(line, 18, y, 11); y += 16 }
    let x = 18
    const legends=colors?(colors.numeric?[]:colors.entries.map(e=>({label:`${colors.label}：${e.label}`,color:e.color}))):artifact.range?[{label:artifact.range.label,color:palette[0]}]:artifact.y.map((key,i)=>({label:label(key),color:palette[i % palette.length]}))
    if(colors?.numeric) {
      const name=`${colors.label} · ${display(colors.min)}`;measure.font=`11px ${svgFont}`;text(name,x,y);x+=measure.measureText(name).width+12
      const defs=document.createElementNS(ns,'defs'),gradient=document.createElementNS(ns,'linearGradient');gradient.setAttribute('id','value-scale');gradient.setAttribute('x1','0%');gradient.setAttribute('x2','100%')
      for(const [offset,value] of [['0%',colors.min],['100%',colors.max]]){const stop=document.createElementNS(ns,'stop');stop.setAttribute('offset',offset);stop.setAttribute('stop-color',colors.color(value));gradient.append(stop)}
      defs.append(gradient);root.append(defs)
      const ramp=document.createElementNS(ns,'rect');ramp.setAttribute('x',x);ramp.setAttribute('y',y-8);ramp.setAttribute('width','90');ramp.setAttribute('height','8');ramp.setAttribute('rx','2');ramp.setAttribute('fill','url(#value-scale)');root.append(ramp);text(display(colors.max),x+98,y)
    }
    for (let i = 0; i < legends.length; i++) {
      const name = legends[i].label; measure.font = `11px ${svgFont}`; const span = measure.measureText(name).width + 30
      if (x + span > width - 18) { x = 18; y += 20 }
      const swatch = document.createElementNS(ns, 'rect'); swatch.setAttribute('x', x); swatch.setAttribute('y', y - 8); swatch.setAttribute('width', '7'); swatch.setAttribute('height', '7'); swatch.setAttribute('rx', '2'); swatch.setAttribute('fill', legends[i].color); root.append(swatch)
      text(name, x + 13, y, 11); x += span
    }
    y += 16
    clone.querySelectorAll('[data-hover-guide]').forEach(node => node.remove())
    clone.querySelectorAll('[data-hover-bg]').forEach(node => node.setAttribute('fill', 'transparent'))
    clone.querySelectorAll('[opacity]').forEach(node => { const v = Number(node.getAttribute('opacity')); if (v > 0 && v < 0.5) node.setAttribute('opacity', '0.94') })
    const totalHeight = y + height + 28
    root.setAttribute('width', width); root.setAttribute('height', totalHeight)
    root.setAttribute('viewBox', `0 0 ${width} ${totalHeight}`)
    const background = document.createElementNS(ns, 'rect'); background.setAttribute('width', '100%'); background.setAttribute('height', '100%'); background.setAttribute('fill', '#ffffff'); root.prepend(background)
    clone.setAttribute('x', '0'); clone.setAttribute('y', y); clone.setAttribute('width', width); clone.setAttribute('height', height); root.append(clone)
    const shown = artifact.type === 'bar' ? Math.min(artifact.rows.length, 20) : artifact.rows.length
    const sourceText = artifact.sources.map(s => s.year ? `${sourceName(s)} · ${s.year}` : sourceName(s)).join(' / ')
    text(`${shown < artifact.rows.length ? `显示 ${shown}/${artifact.rows.length} 条记录 · ` : ''}${sourceText ? `来源：${sourceText}　|　` : ''}${APP_NAME}`, 18, y + height + 17, 10)
    const style = document.createElementNS(ns, 'style')
    style.textContent = `text{font-family:${svgFont}}.chart-axis{font-size:11px;fill:#4b5869}.chart-grid-line{stroke:#e2e8f0;stroke-dasharray:3 4}.chart-value{font-size:12px;font-weight:600;fill:#0f172a}.chart-category{font-size:13px;fill:#334155}`
    root.prepend(style)
    downloadFile(`${artifact.title}.svg`, root.outerHTML, 'image/svg+xml;charset=utf-8')
  }
  return <section className="artifact" data-testid="artifact">
    <div className="artifact-header"><div className="artifact-title"><span className="artifact-icon">{artifact.type === 'table' ? <Table2 size={16}/> : <ChartNoAxesCombined size={16}/>}</span><h3>{mentorRanking(artifact)?resultTitle(artifact):artifact.title}{mentorRanking(artifact)&&<small className="artifact-count">{artifact.rows.length} 位</small>}</h3></div><div className="artifact-actions">
      {artifact.type !== 'table' && <div className="view-switch" role="group" aria-label="结果视图"><button className={!dataView ? 'selected' : ''} aria-pressed={!dataView} onClick={() => setDataView(false)}>{artifact.type==='metric'?'指标':'图表'}</button><button className={dataView ? 'selected' : ''} aria-pressed={dataView} onClick={() => setDataView(true)}>数据</button></div>}
      <button className="icon-button" aria-label={`${artifact.type==='table'?'展开表格':'放大图表'} ${artifact.title}`} title={artifact.type==='table'?'展开表格':'放大图表'} onClick={() => setExpanded(dataView?'data':'chart')}><Maximize2 size={14}/></button>
      <ExportMenu variant="icon" ariaLabel={`多格式导出 ${artifact.title}`} title="导出 Excel / PDF / Word / MD" getPayload={format => ({ kind: 'artifact', format, artifacts: [table], title: artifact.title })} />
      <button className="icon-button" aria-label={`下载 ${artifact.title} CSV`} title="下载 CSV 数据" onClick={() => exportCSV(table)}><Download size={15}/></button>
    </div></div>
    {artifact.description && <p className="artifact-description">{artifact.description}</p>}
    {!dataView&&legend}
    {dataView ? <DataTable rows={table.rows} columns={table.columns} purpose={artifact.purpose} caption={artifact.title}/> : <Chart artifact={artifact} svgRef={svgRef} colors={colors}/>}
    <div className="artifact-footer">{!dataView && <span>{artifact.type==='metric'?`${artifact.rows.length*artifact.y.length} 项指标`:`${artifact.rows.length} 条数据`}</span>}<div><span>{[...new Set(artifact.sources.map(s=>s.year).filter(Boolean))].join(' / ')}</span><SourceLinks sources={artifact.sources} onSources={onSources}/>{!dataView && ['bar', 'line', 'scatter'].includes(artifact.type) && <button onClick={()=>exportSVG()}>导出 SVG</button>}</div></div>
    {expanded && <Dialog title={artifact.title} className={`expanded-table-modal${artifact.type==='table'?'':' expanded-chart-modal'}`} onClose={() => setExpanded(null)}>
      {artifact.description && <p className="modal-intro">{artifact.description}</p>}
      {artifact.type!=='table'&&<div className="expanded-chart-toolbar"><div className="view-switch" role="group" aria-label="放大结果视图"><button className={expanded==='chart'?'selected':''} aria-pressed={expanded==='chart'} onClick={()=>setExpanded('chart')}>{artifact.type==='metric'?'指标':'图表'}</button><button className={expanded==='data'?'selected':''} aria-pressed={expanded==='data'} onClick={()=>setExpanded('data')}>数据</button></div><div className="artifact-actions"><button className="text-button" onClick={()=>exportCSV(table)}><Download size={14}/>CSV</button>{expanded==='chart'&&['bar','line','scatter'].includes(artifact.type)&&<button className="text-button" onClick={()=>exportSVG(expandedSvg.current)}><Download size={14}/>SVG</button>}</div></div>}
      <div className={artifact.type==='table'?undefined:'expanded-chart-body'}>{artifact.type==='table'||expanded==='data'?<DataTable rows={table.rows} columns={table.columns} purpose={artifact.purpose} layout="table" pageSize={25} caption={artifact.title}/>:<>{legend}<Chart artifact={artifact} svgRef={expandedSvg} colors={colors} expanded/></>}</div>
      {artifact.type!=='table'&&<div className="expanded-chart-footer"><span>{artifact.rows.length} 条数据</span><SourceLinks sources={artifact.sources} onSources={onSources}/></div>}
    </Dialog>}
  </section>
})

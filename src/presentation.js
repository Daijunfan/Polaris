import { exportText, internalColumn, publicArtifact, publicMessage, publicSource, sourceNumber } from '../lib/presentation.js'

const statuses = {
  unique: ['可确认归属', '姓名与专业可唯一对应到这条记录。'],
  ambiguous: ['归属待确认', '有多条可能对应的记录，不能确定导师归属，未用于导师历史分数统计。'],
  unmatched: ['暂无对应资料', '现有名册中未找到可确认的对应记录。'],
  unlinked: ['暂无成绩记录', '未关联到初试成绩；招生类型为保研。'],
  not_admitted: ['未拟录取', '原始复试结果未标记为拟录取，不关联在读名册。'],
}

export const isMissing = value => value == null || value === '' || ['未知', '—', '-', '暂无数据', '暂无资料', '未提供', '未记录', '未记载', 'N/A'].includes(value)
export { internalColumn } from '../lib/presentation.js'
export const isStatusColumn = column => /(?:^|_)match_status$/.test(column.key) || /关联状态|匹配状态|成绩归属说明/.test(column.label || '')
export const statusInfo = value => statuses[value] || null
export const columnLabel = column => isStatusColumn(column) ? '成绩归属说明' : column.label || column.key
export function resultTitle(artifact) {
  const match=artifact.title.match(/(?:[（(\s·：:]|^)(?:共|前)?(\d+)\s*[位名](?:导师|老师)?[）)]?\s*$/)
  return match&&Number(match[1])===artifact.rows.length?artifact.title.slice(0,match.index).trim()||artifact.title:artifact.title
}

export function numericColumn(column, rows) {
  if(column.type==='money')return true
  if (column.type === 'number') return true
  if (column.type && column.type !== 'unknown') return false
  const values = rows.map(row => row[column.key]).filter(v => !isMissing(v))
  return values.length > 0 && values.every(v => typeof v === 'number')
}

export function display(value, column) {
  if (isMissing(value)) return '—'
  if(column?.type==='money'&&typeof value==='string')return value.split('–').map(part=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(Number(part))).join('–')
  if (/(?:^|_)admission_type$/.test(column?.key || '')) return ({ exam: '考研', recommended: '保研' })[value] || String(value)
  if (column && isStatusColumn(column) && statusInfo(value)) return statusInfo(value)[0]
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') {
    if (column?.key === 'year') return String(value)
    const fixed = /^(score_reexam|score_total|score_first_mean|score_first_median)$/.test(column?.key || '')
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: column?.fractionDigits ?? (fixed ? 2 : 0) }).format(value)
  }
  if (Array.isArray(value)) return value.join('、') || '—'
  return String(value)
}

export function csvText({rows,columns}){
  const visible=columns.filter(column=>!internalColumn(column))
  const cell=value=>{
    let text=value==null?'':Array.isArray(value)?value.join('、'):String(value)
    if(typeof value==='string'&&/^\s*[=+@-]/.test(text))text="'"+text
    return '"'+text.replaceAll('"','""')+'"'
  }
  return '\uFEFF'+[visible.map(column=>cell(columnLabel(column))).join(','),...rows.map(row=>visible.map(column=>cell(row[column.key]==null?null:typeof row[column.key]==='number'?row[column.key]:display(row[column.key],column))).join(','))].join('\r\n')
}

export const effortLabel = value => ({ off: '关闭', none: '关闭', auto: '跟随模型', low: '低', medium: '中', high: '高', max: '最高 · Max' })[value] || value
export function compactNumber(value) {
  if (value >= 1048576) return `${(value / 1048576).toFixed(value % 1048576 ? 1 : 0)}M`
  if (value >= 1024) return `${(value / 1024).toFixed(value >= 102400 ? 0 : 1).replace(/\.0$/, '')}K`
  return String(value || 0)
}

export function sourcesMarkdown(sources) {
  return [...new Map(sources.map(source=>[source.id,publicSource(source)])).values()].map(source=>{
    const title=source.url?`[${source.title}](${source.url})`:source.title
    return `- **[${sourceNumber(source.id)}] ${title}**${[source.publisher,source.published_at||source.year,source.fetched_at?`抓取 ${new Date(source.fetched_at).toLocaleDateString('zh-CN')}`:null].filter(Boolean).map(value=>` · ${value}`).join('')}`
  }).join('\n')
}

export function messageMarkdown(message,{withSources=true}={}) {
  const safe=publicMessage(message), escape=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ')
  const tables=(safe.artifacts||[]).map(original=>{
    const artifact=publicArtifact({...original,type:'table'})
    const columns=artifact.columns.filter(column=>!internalColumn(column))
    return `### ${artifact.title}\n\n${artifact.description}\n\n| ${columns.map(column=>escape(columnLabel(column))).join(' | ')} |\n| ${columns.map(()=>'---').join(' | ')} |\n${artifact.rows.map(row=>'| '+columns.map(column=>escape(display(row[column.key],column))).join(' | ')+' |').join('\n')}`
  })
  const sources=[...(safe.sources||[]),...(safe.artifacts||[]).flatMap(artifact=>artifact.sources||[])]
  return [exportText(safe.content),...tables,withSources&&sources.length?`### 资料来源\n\n${sourcesMarkdown(sources)}`:null].filter(Boolean).join('\n\n')
}

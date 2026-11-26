import React, { memo, Children, isValidElement, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, ExternalLink } from 'lucide-react'
import DataTable from './DataTable.jsx'
import { isMissing } from '../presentation.js'
import { publicText, sourceNumber } from '../../lib/presentation.js'
import { usePolaris } from '../insights.jsx'

function textOf(value) {
  return Children.toArray(value).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement(child) ? textOf(child.props.children) : '').join('')
}
function MarkdownTable({ children }) {
  const sections = Children.toArray(children).filter(isValidElement)
  const head = sections.find(s => s.type === 'thead'), body = sections.find(s => s.type === 'tbody')
  const header = Children.toArray(Children.toArray(head?.props.children).find(isValidElement)?.props.children).filter(isValidElement)
  const trs = Children.toArray(body?.props.children).filter(isValidElement)
  const cells = trs.map(tr => Children.toArray(tr.props.children).filter(isValidElement))
  const columns = header.map((cell, i) => {
    const label = textOf(cell.props.children), values = cells.map(row => textOf(row[i]?.props.children)).filter(v => !isMissing(v))
    return { key: /关联状态|匹配状态|成绩归属/.test(label) ? 'match_status' : `col${i}`, label, type: values.length && values.every(v => /^-?[\d,]+(?:\.\d+)?$/.test(v)) ? 'number' : 'string', index: i }
  })
  const rows = cells.map((row, index) => Object.fromEntries([['__index', index], ...columns.map(c => { const raw = textOf(row[c.index]?.props.children); return [c.key, isMissing(raw) ? null : c.type === 'number' ? Number(raw.replaceAll(',', '')) : raw] })]))
  return <div className="markdown-table"><DataTable columns={columns} rows={rows} renderCell={(row, column) => cells[row.__index][column.index]?.props.children}/></div>
}
function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef(null)
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  const code = Children.toArray(children).find(isValidElement), language = code?.props.className?.replace('language-', '') || 'text'
  async function copy() { clearTimeout(copyTimer.current); try { await navigator.clipboard.writeText(textOf(children)); setCopied(true); copyTimer.current = setTimeout(() => setCopied(false), 1600) } catch { setCopied(false) } }
  return <div className="code-block"><div className="code-toolbar"><span>{language}</span><button onClick={copy} aria-label="复制代码">{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? '已复制' : '复制'}</button></div><pre>{children}</pre></div>
}
// Bold names and per-mentor headings become links to the mentor dossier.
function mentorTarget(children,lookup){
  const text=textOf(children).trim().replace(/[：:]$/,'')
  const match=text.match(/^(?:\d+[.、]\s*)?([\u4e00-\u9fa5·]{2,5})(?:\s*[（(]([^）)]+)[）)])?(?:老师|教授)?$/u)
  return match?lookup({name:match[1],college:match[2]?.includes('学院')?match[2]:undefined}):null
}
export default memo(function Markdown({ content, onSources }) {
  const {lookup,openMentor}=usePolaris()
  const markdown = publicText(content).replace(/\[S(\d+)\](?!\()/g, '[S$1](#source-S$1)')
  const components = useMemo(() => ({
    a: ({ href, children }) => href?.startsWith('#source-') ? <button className="inline-citation" title="查看资料来源" aria-label={`查看资料来源 ${sourceNumber(href.slice(8))}`} onClick={() => onSources(href.slice(8))}>{sourceNumber(href.slice(8))}</button> : <a href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={11}/></a>,
    table: MarkdownTable, pre: CodeBlock,
    img: ({ alt }) => <span className="image-placeholder">{alt || '图片内容'}</span>,
    strong: ({ children }) => { const mentor=mentorTarget(children,lookup); return mentor ? <button className="mentor-link" title={`查看${mentor.name}的导师档案`} onClick={()=>openMentor(mentor)}><strong>{children}</strong></button> : <strong>{children}</strong> },
    h2: ({ children }) => { const mentor=mentorTarget(children,lookup); return <h2>{children}{mentor&&<button className="mentor-link-chip" onClick={()=>openMentor(mentor)} aria-label={`查看${mentor.name}的导师档案`}>档案</button>}</h2> },
    h3: ({ children }) => { const mentor=mentorTarget(children,lookup); return <h3>{children}{mentor&&<button className="mentor-link-chip" onClick={()=>openMentor(mentor)} aria-label={`查看${mentor.name}的导师档案`}>档案</button>}</h3> },
    h4: ({ children }) => { const mentor=mentorTarget(children,lookup); return <h4>{children}{mentor&&<button className="mentor-link-chip" onClick={()=>openMentor(mentor)} aria-label={`查看${mentor.name}的导师档案`}>档案</button>}</h4> },
  }), [onSources,lookup,openMentor])
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown></div>
})

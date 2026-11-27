import {APP_NAME} from '../../lib/brand.js'
import React, { memo, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Database, ExternalLink, LoaderCircle, AlertCircle, CircleStop, Download, RefreshCw } from 'lucide-react'
import Artifact from './Charts.jsx'
import Markdown from './Markdown.jsx'
import { tokenNumber,downloadFile } from '../api.js'
import { mentorRanking } from '../../lib/presentation.js'
import { compactNumber, messageMarkdown } from '../presentation.js'
import WorkTrace from './WorkTrace.jsx'
import SourceLinks from './SourceLinks.jsx'
import Rankings from './Rankings.jsx'
import {PolarisMark,Funnel,FollowUps} from './Polaris.jsx'
import ExportMenu from './ExportMenu.jsx'
import {useToast} from '../toast.jsx'

export function AgentMark({ small = false }) { return <PolarisMark size={small?26:34} className={small?'small':''}/> }

function ToolTrace({ tools, running }) {
  if (!tools?.length) return null
  const complete = tools.filter(t => t.status === 'complete').length
  return <details className="tool-trace"><summary><Database size={14}/><span>{running ? '查询中' : `查询记录 · ${complete}`}</span>{running && <LoaderCircle size={13} className="spin"/>}<ChevronDown size={14} className="details-chevron"/></summary><div className="tool-list">
    {tools.map((tool, i) => <div className="tool-step" key={tool.id || i}><span className={`tool-status ${tool.status}`}>{tool.status === 'running' ? <LoaderCircle className="spin" size={12}/> : tool.status === 'complete' ? <Check size={12}/> : <AlertCircle size={12}/>}</span><b>{tool.label || '查询资料'}</b><span>{tool.summary || '执行中'}</span></div>)}
  </div></details>
}

export default memo(function Message({ message, onSources,isFollowing,onRetry,onFollowUp,mentorTotal }) {
  const toast = useToast()
  const [copyState, setCopyState] = useState('idle'),[fileError,setFileError]=useState('')
  const copyTimer = useRef(null)
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  if (message.role === 'user') return <div className="message user-message"><div className="user-bubble">{message.content}</div></div>
  const running = message.status === 'running'
  const rankings=(message.artifacts||[]).filter(mentorRanking)
  const artifactSources=new Set((message.artifacts||[]).flatMap(artifact=>(artifact.sources||[]).map(source=>source.id)))
  const additionalSources=(message.sources||[]).filter(source=>!artifactSources.has(source.id)&&(!message.files?.length||message.content?.includes('['+source.id+']')))
  const phase=message.progress?.includes('修正')?'修正中':message.progress?.includes('核对')?'核对中':message.progress?.includes('压缩')?'整理上下文':message.tools?.some(tool=>tool.status==='running')?'查阅资料':'生成中'
  async function copy() {
    clearTimeout(copyTimer.current)
    try { await navigator.clipboard.writeText(messageMarkdown(message)); setCopyState('copied'); toast.success('已复制回答内容'); copyTimer.current = setTimeout(() => setCopyState('idle'), 1800) }
    catch { setCopyState('error') }
  }
  return <article className="message assistant-message" data-testid="assistant-message">
    <div className="message-main"><div className="message-byline"><AgentMark small/><b>{APP_NAME}</b>{running && <i>{phase}</i>}</div>
      {message.activity?.length?<WorkTrace activity={message.activity} running={running} status={message.status} isFollowing={isFollowing}/>:<ToolTrace tools={message.tools} running={running}/>}
      <Funnel activity={message.activity} total={mentorTotal} running={running}/>
      {rankings.length>0&&<Rankings artifacts={rankings} onSources={onSources}/>}
      {message.artifacts?.filter(artifact=>!mentorRanking(artifact)).map(artifact => <Artifact key={artifact.id} artifact={artifact} onSources={onSources}/>)}
      {message.content && <div className={`markdown-wrap${running ? ' is-streaming' : ''}`}><Markdown content={message.content} onSources={onSources}/></div>}
      {message.files?.length>0&&<div className="answer-files">{message.files.map((file,i)=><button key={file.id||i} onClick={async()=>{try{const targetUrl=file.url||('/api/workbench/reports/'+encodeURIComponent(file.id));const response=await fetch(targetUrl);if(!response.ok)throw new Error('报告暂时无法下载，请重试');const blob=await response.blob();downloadFile(file.name||'导师对比报告',blob,response.headers.get('content-type')||blob.type);setFileError('')}catch(error){setFileError(error.message)}}}><span className="answer-file-icon"><Download size={19}/></span><span><strong>{file.name||'导师对比报告'}</strong><small>{[file.depth,String(file.format||'文件').toUpperCase(),Number.isFinite(file.count)?`${file.count}位导师`:null].filter(Boolean).join(' · ')}</small></span><Download size={15}/></button>)}</div>}
      {fileError&&<p className="copy-feedback" role="status">{fileError}</p>}
      {running && !message.content && (!message.activity?.length ? <div className="thinking-dots" aria-label="生成中"><span/><span/><span/></div> : <div className="streaming-shimmer" role="status" aria-label="正在生成回答"><span className="streaming-shimmer-label">{(message.progress?.includes('输出') || message.progress === '生成回答') ? '正在组织文字结论…' : '正在检索并整理依据…'}</span><div className="streaming-shimmer-lines" aria-hidden="true"><span/><span/><span/></div></div>)}
      {message.error && <div className={`message-error ${message.status === 'canceled' ? 'canceled' : ''}`}>{message.status === 'canceled' ? <CircleStop size={15}/> : <AlertCircle size={15}/>}<span>{message.error}</span>{onRetry&&<button className="retry-answer" onClick={onRetry}>重试</button>}</div>}
      {!running&&message.status==='complete'&&onFollowUp&&<FollowUps message={message} rankings={rankings} onFollowUp={onFollowUp}/>}
      {!running && <div className="message-bottom"><div className="message-sources"><SourceLinks sources={additionalSources} onSources={onSources}/></div><div className="message-meta">{message.usage?.requests > 0 && <span title={`合计 ${tokenNumber(message.usage.totalTokens)} Token · 输入 ${tokenNumber(message.usage.inputTokens)} · 输出 ${tokenNumber(message.usage.outputTokens)} · ${message.usage.requests} 次模型请求`}>{compactNumber(message.usage.totalTokens)} tokens{message.usage.unreportedRequests > 0 ? ' + 未计量请求' : ''}</span>}{(message.content||message.artifacts?.length>0) && <ExportMenu variant="icon" ariaLabel="导出本条回答" title="导出本条回答（Excel / PDF / Word / MD）" getPayload={format => ({ kind: 'chat', format, chat: { title: '北极星问答结果', messages: [message] }, messageId: message.id })} onSuccess={({ filename }) => { if (!window.polarisDesktop?.isElectron) toast.success(`已导出 ${filename}`) }} onError={err => toast.error(err.message)} />}{(message.content||message.artifacts?.length>0) && <button className={`icon-button${copyState==='copied'?' is-copied':''}`} aria-label="复制回答" title="复制回答" onClick={copy}>{copyState==='copied' ? <><Check size={14}/><span className="copy-pill" aria-hidden="true">已复制</span></> : <Copy size={14}/>}</button>}{copyState==='copied'&&<span className="sr-only" role="status">回答已复制</span>}{message.status==='complete'&&onRetry&&<button className="icon-button" aria-label="重新生成" title="重新生成" onClick={onRetry}><RefreshCw size={14}/></button>}</div></div>}
      {copyState==='error'&&<p className="copy-feedback" role="status">复制未成功，可在右上角导出对话。</p>}
    </div>
  </article>
})

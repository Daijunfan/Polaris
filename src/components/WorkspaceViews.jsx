import {APP_NAME,APP_SLOGAN,APP_TAGLINE} from '../../lib/brand.js'
import React, { forwardRef, memo, useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, Bookmark, ChevronRight, Coins, Keyboard, LoaderCircle, MessageSquare, Moon, Pencil, Plus, Search, Settings2, SlidersHorizontal, Square, Sun, Trash2, X } from 'lucide-react'
import { compactNumber, effortLabel } from '../presentation.js'
import { tokenNumber } from '../api.js'
import { useTheme } from '../theme-hook.jsx'
import { AgentMark } from './Polaris.jsx'
import SidebarPane from './SidebarPane.jsx'
import {ProfileBar} from './ProfileBar.jsx'

export const Sidebar = memo(function Sidebar({ chats, chatId, usage, configured, open, collapsed, isMac = false, onCollapse, onClose, onNew, onSelect, onSearch, onRemove, onRename, onTrash, onSettings, onUsage, onShortcuts, onOpenMentors, onWorkspace }) {
  const { resolved, toggleQuickTheme } = useTheme()
  const [search,setSearch] = useState('')
  const [found,setFound] = useState({query:'',items:[]}),[searchError,setSearchError] = useState('')
  useEffect(()=>{
    if(!search.trim())return
    let current=true
    setSearchError('')
    const timer=setTimeout(()=>onSearch(search).then(items=>{if(current)setFound({query:search,items})}).catch(e=>{if(current)setSearchError(e.message)}),180)
    return()=>{current=false;clearTimeout(timer)}
  },[search,chats,onSearch])
  const start=()=>{setSearch('');onNew()}
  const searching=Boolean(search.trim()),waiting=searching&&found.query!==search
  const shown = searching ? found.query===search?found.items:[] : chats
  return <SidebarPane collapsed={collapsed} open={open} onCollapse={onCollapse}><aside className="sidebar">
    <div className="sidebar-heading"><button className="brand" onClick={start} aria-label={`${APP_NAME}首页`}><AgentMark/><strong>{APP_NAME}</strong></button><button className="icon-button sidebar-mobile-close" aria-label="关闭对话列表" onClick={onClose}><X size={18}/></button></div>
    <button className="new-chat" onClick={start}><Plus size={16}/><span>开启新对话</span></button>
    <div className="history-search"><Search size={15} aria-hidden="true"/><input type="search" aria-label="搜索对话" placeholder="搜索对话" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button type="button" className="icon-button history-search-clear" aria-label="清空搜索" title="清空搜索" onClick={()=>setSearch('')}><X size={13}/></button>}</div>
    <div className="history-heading">历史对话</div>
    <nav className="chat-history" aria-label="历史对话">
      {!shown.length && <p className="history-empty">{searchError?'搜索暂不可用':waiting?'搜索中…':searching?'没有匹配对话':'暂无对话'}</p>}
      {shown.map(c => <div className={`history-item ${chatId === c.id ? 'active' : ''}`} key={c.id}><button onClick={() => onSelect(c.id)} title={c.title}><MessageSquare size={14}/><span>{c.title}</span>{c.running && <i className="history-running"/>}</button><div className="history-actions"><button aria-label={`重命名对话 ${c.title}`} title="重命名" onClick={()=>onRename(c)}><Pencil size={13}/></button><button disabled={c.running} aria-label={`移到回收站 ${c.title}`} title="移到回收站" onClick={() => onRemove(c.id)}><Trash2 size={13}/></button></div></div>)}
    </nav>
    <div className="sidebar-bottom">
      {onOpenMentors&&<button className="sidebar-workspace" onClick={onOpenMentors}><Search size={15}/><span>查看导师</span><ChevronRight size={14}/></button>}
      <button className="sidebar-workspace" onClick={onWorkspace}><Bookmark size={15}/><span>候选库</span><ChevronRight size={14}/></button>
      <button className="usage-summary" onClick={onUsage} aria-label="Token 用量"><Coins size={16}/><span>Token 用量</span><strong>{compactNumber(usage?.totalTokens || 0)}</strong></button>
      <div className="sidebar-settings-row"><button className="sidebar-setting" onClick={onSettings} disabled={!configured}><Settings2 size={16}/><span>设置</span><ChevronRight size={14}/></button><button className="icon-button" aria-label="切换深色模式" aria-pressed={resolved === 'dark'} title={resolved === 'dark' ? '切换为浅色模式' : '切换为深色模式'} onClick={toggleQuickTheme}>{resolved === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}</button>{onShortcuts&&<button className="icon-button" aria-label="快捷键" title={`快捷键（${isMac?'⌘/':'Ctrl+/'} 或 ?）`} onClick={onShortcuts}><Keyboard size={16}/></button>}<button className="icon-button" aria-label="回收站" title="回收站" onClick={onTrash}><Trash2 size={16}/></button></div>
    </div>
  </aside></SidebarPane>
})

export function Welcome({ data, failed = false, mentorCount = 0, savedCount = 0, compareCount = 0, isMac = false, vaultLocked = false, configured, onOpenSettings, onOpenMentors, onOpenLibrary, children }) {
  const counts=data?.metadata?.counts
  const effectiveLocked=vaultLocked||(data!=null&&(counts?.mentors??0)===0&&!(data.sources?.length))
  return <>
    <div className="start-heading">
      <div className="start-dataset"><span>{APP_TAGLINE}</span>{data&&<span>北京邮电大学 {data.metadata.colleges.length} 个精评学院<span className="dataset-dot">·</span>{counts.mentors} 位评价导师<span className="dataset-dot">·</span>{counts.reviews} 条评价归纳{counts.web_profiles>0&&<><span className="dataset-dot">·</span>全校 {data.metadata.profile_colleges?.length||14} 院 {counts.web_profiles} 份官网档案</>}</span>}</div>
      <h2>{APP_SLOGAN}</h2>
      <p className="start-sub">优点、风险、实际谁带、能不能实习——一句话问清，每个结论都有评价依据与出处。</p>
    </div>
    {children}
    {configured===false&&<div className="start-onboarding-chip" role="note" aria-label="模型未配置提示"><span>尚未配置大模型 API</span><button type="button" className="text-button" onClick={onOpenSettings}>立即填写 API Key →</button></div>}
    {!data?<p className="start-status" role="status">{failed ? '资料未加载' : '加载中…'}</p>:<section className="core-hub" aria-label="导师与候选入口">
      <button type="button" className="core-card" onClick={onOpenMentors}>
        <div className="core-card-top">
          <span className="core-card-icon"><Search size={16} aria-hidden="true"/></span>
          <span className="core-card-tag">{effectiveLocked ? '数据库已加密锁定' : mentorCount > 0 ? `全校 ${mentorCount} 位导师档案` : '全校导师档案'}</span>
          <kbd aria-hidden="true">{isMac?'⌘K':'Ctrl K'}</kbd>
        </div>
        <div className="core-card-body">
          <strong>查看导师</strong>
          <p>按培养条件、口碑资质、研究方向与 14 院多选 Filter 叠加筛选</p>
        </div>
        <span className="core-card-foot">打开多维导师检索 <ArrowRight size={13} aria-hidden="true"/></span>
      </button>
      <button type="button" className="core-card" onClick={onOpenLibrary}>
        <div className="core-card-top">
          <span className="core-card-icon"><Bookmark size={16} aria-hidden="true"/></span>
          <span className="core-card-tag">{savedCount>0?`已收藏 ${savedCount} 位`:'收藏 · 备注 · 导出'}</span>
        </div>
        <div className="core-card-body">
          <strong>候选库</strong>
          <p>沉淀意向导师清单、记录联系进度与私人备注，一键导出候选资料</p>
        </div>
        <span className="core-card-foot">进入我的候选库 <ArrowRight size={13} aria-hidden="true"/></span>
      </button>
    </section>}
  </>
}

export const Composer = forwardRef(function Composer({ chat, config, colleges=[], loading, busy, stopping, text, onText, onSend, onStop, onLatest, showLatest, onExecution }, ref) {
  const continuing=Boolean(chat?.messages.length)
  const tokens = chat?.context?.inputTokens || chat?.context?.estimatedTokens || 0
  const threshold = config?.compressionTriggerTokens || Math.floor((config?.contextWindow || 32768) * .8)
  return <div className="composer-area">
    <ProfileBar colleges={colleges}/>
    <form className={`composer ${busy ? 'generating' : ''}`} onSubmit={e => { e.preventDefault(); onSend() }}>
      <textarea ref={ref} aria-label={`向${APP_NAME}提问`} aria-busy={loading} placeholder={loading?'载入对话…':continuing?'继续问，比如“第二位有什么坑？”':'问任何关于导师的问题，比如“不打卡还能实习的老师有哪些？”'} rows={continuing?1:2} value={text} maxLength={20000} disabled={!config||loading} onChange={e => onText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend() } }}/>
      <div className="composer-bottom">
        {showLatest?<button type="button" className="composer-latest" onClick={onLatest} aria-label="回到最新消息"><ArrowDown size={14}/><span>最新消息</span></button>:busy&&text.trim()?<span className="composer-hint" role="status">草稿已保留，回答结束后可发送</span>:<span className="composer-shortcut"><kbd>Enter</kbd> 发送<span>·</span><kbd>Shift + Enter</kbd> 换行</span>}
        <div className="composer-actions">{config?.configured && <button type="button" className="context-button" aria-label="上下文与压缩设置" onClick={onExecution} title={`推理 · ${effortLabel(config.reasoningEffort || 'off')} · 输入 ${tokenNumber(tokens)} Token · 压缩阈值 ${tokenNumber(threshold)} Token`}><SlidersHorizontal size={12}/><span><span className="context-reasoning-label">推理·{effortLabel(config.reasoningEffort || 'off')} · </span>上下文 {compactNumber(tokens)} / {compactNumber(config.contextWindow)}</span></button>}{busy ? <button type="button" className="send-button stop-button" aria-label="停止生成" title="停止生成" disabled={stopping} onClick={onStop}>{stopping ? <LoaderCircle className="spin" size={17}/> : <Square size={12} fill="currentColor"/>}</button> : <button className="send-button" type="submit" disabled={!text.trim() || !config||loading} aria-label="发送问题" title="发送（Enter）"><ArrowUp size={18}/></button>}</div>
      </div>
    </form>
  </div>
})

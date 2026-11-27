import {APP_NAME} from '../lib/brand.js'
import React, { lazy,Suspense,useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bookmark, ChevronDown, Database, FileText, LoaderCircle, Lock, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, Search, SlidersHorizontal } from 'lucide-react'
import QuickSearch from './components/QuickSearch.jsx'
import { api, downloadFile, modelLabel, observeChat, streamChat } from './api.js'
import Message from './components/Message.jsx'
import { RenameConversation, Settings, ShortcutHelp, Sources, Trash, Usage, VaultUnlockDialog } from './components/Dialogs.jsx'
import { Sidebar, Welcome, Composer } from './components/WorkspaceViews.jsx'
import ExportMenu from './components/ExportMenu.jsx'
import { effortLabel, messageMarkdown, sourcesMarkdown } from './presentation.js'
import './styles.css'
import './components/content.css'
import './components/settings.css'
import './components/sidebar.css'
import './components/workbench.css'
import './components/export.css'
import {usePolaris} from './insights.jsx'
import {MentorDossier} from './components/MentorInsight.jsx'
import './components/polaris.css'
import './components/mobile.css'
import './components/theme-dark.css'
import {useWorkspace} from './workspace.jsx'
import {useToast} from './toast.jsx'
const WorkspaceLayer=lazy(()=>import('./components/Workbench.jsx'))

export default function App() {
  const workspace=useWorkspace(),polaris=usePolaris(),toast=useToast()
  const [data, setData] = useState(null), [config, setConfig] = useState(null), [chats, setChats] = useState([]), [chat, setChat] = useState(null), [usage, setUsage] = useState(null), [vaultStatus, setVaultStatus] = useState(null)
  const draftId = useRef(sessionStorage.getItem('mentor-active-chat') || 'new')
  const [text, setText] = useState(()=>sessionStorage.getItem(`mentor-draft-${draftId.current}`)||''), [busy, setBusy] = useState(false), [stopping, setStopping] = useState(false), [modal, setModal] = useState(null), [sourceId, setSourceId] = useState(null), [sidebar, setSidebar] = useState(false), [error, setError] = useState('')
  const [modelLoading, setModelLoading] = useState(false)
  const [sidebarCollapsed,setSidebarCollapsed] = useState(()=>{try{return localStorage.getItem('mentor-sidebar-collapsed')==='true'}catch{return false}})
  const sidebarToggle=useRef(),mobileToggle=useRef(),deltaFrame=useRef(null),pendingDelta=useRef(null),scrollWidth=useRef(0)
  const [loadingChat,setLoadingChat] = useState(false)
  const [showLatest,setShowLatest] = useState(false),[renameTarget,setRenameTarget] = useState(null)
  const modalRef = useRef(modal)
  modalRef.current = modal
  const scroll = useRef(), textarea = useRef(), follow = useRef(true), sending = useRef(false), assistantId = useRef(null), observer = useRef(), view = useRef(0), cancelPending = useRef(false)
  const streamAbortRef = useRef(null), runStartedRef = useRef(false), activeChatIdRef = useRef(null)
  const scrollTop = useRef(0), scrollHeight = useRef(0), touchY = useRef(0), scrollBottom = useRef(null), quickSearchState = useRef(null)
  const closeModal = useCallback(() => setModal(null), [])
  const closeQuickSearch = useCallback(() => { quickSearchState.current = null; setModal(null) }, [])
  const closeSidebar=useCallback(()=>{setSidebar(false);mobileToggle.current?.focus({preventScroll:true})},[])
  const showSettings=useCallback(()=>{closeSidebar();setModal('settings')},[closeSidebar]),showTrash=useCallback(()=>{closeSidebar();setModal('trash')},[closeSidebar]),showUsage=useCallback(()=>{closeSidebar();setModal('usage')},[closeSidebar]),showShortcuts=useCallback(()=>{closeSidebar();setModal('shortcuts')},[closeSidebar])
  const showRename=useCallback(item=>{setRenameTarget(item);setModal('rename')},[])
  const collapseSidebar=useCallback(()=>{setSidebarCollapsed(true);sidebarToggle.current?.focus({preventScroll:true})},[])
  useEffect(()=>{try{localStorage.setItem('mentor-sidebar-collapsed',String(sidebarCollapsed))}catch{}},[sidebarCollapsed])
  function editText(value) {
    setText(value)
    const key=`mentor-draft-${draftId.current}`
    if(value)sessionStorage.setItem(key,value);else sessionStorage.removeItem(key)
  }
  function openDraft(id) {draftId.current=id;setText(sessionStorage.getItem(`mentor-draft-${id}`)||'')}
  const searchChats = useCallback(async query=>(await api(`/chats?q=${encodeURIComponent(query)}`)).chats,[])
  useEffect(() => { initialize(); return () => {observer.current?.abort();streamAbortRef.current?.abort();cancelAnimationFrame(deltaFrame.current)} }, [])
  useEffect(() => {
    const desktop = typeof window !== 'undefined' ? window.polarisDesktop : null
    if (!desktop) return
    const offSettings = desktop.onOpenSettings?.(() => { closeSidebar(); setModal('settings') })
    const offDownload = desktop.onDownloadDone?.(payload => {
      if (!payload?.filename) return
      toast.success(`已保存 ${payload.filename}`, { desktopSavedPath: payload.savedPath || '' })
    })
    return () => { offSettings?.(); offDownload?.() }
  }, [closeSidebar, toast])
  async function initialize({ restoreChat = true } = {}) {
    try {
      const [d, c, history, u, vs] = await Promise.all([
        api('/data'),
        api('/config'),
        api('/chats'),
        api('/usage'),
        api('/vault/status').catch(() => api('/health').then(h => h ? { locked: Boolean(h.vault_locked), vaults: 5 } : null).catch(() => null)),
      ])
      setData(d); setConfig(c); setChats(history.chats); setUsage(u); setVaultStatus(vs); setError('')
      if (c.configured && (!c.models?.length || !c.models.every(m => m.reasoning))) api('/models?refresh=1').then(r => api('/config')).then(setConfig).catch(() => {})
      if (restoreChat) {
        const saved = sessionStorage.getItem('mentor-active-chat')
        const ongoing = saved === 'new' ? null : history.chats.find(item => item.id === saved) || history.chats.find(item=>item.running)
        if (ongoing) await selectChat(ongoing.id)
      }
    } catch (e) { setError(`无法连接本机后端：${e.message}`) }
  }
  async function handleVaultUnlocked(result) {
    await Promise.all([initialize({ restoreChat: false }), polaris.reload(), workspace.refresh()])
    setModal(null)
    const count = result?.mentor_count
    toast.success(count != null ? `导师库已解锁，已加载 ${count} 位评价导师` : '导师库已解锁')
    if (!workspace.view && !polaris.dossier) {
      requestAnimationFrame(() => textarea.current?.focus({ preventScroll: true }))
    }
  }
  async function refreshHistory() {
    const [history, u] = await Promise.all([api('/chats'), api('/usage')])
    setChats(history.chats); setUsage(u)
  }
  useEffect(() => {
    if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px` }
  }, [text,Boolean(chat?.messages.length)])
  useLayoutEffect(() => {
    if (chat?.messages?.length && follow.current && scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight
      scrollTop.current = scroll.current.scrollTop
      scrollHeight.current = scroll.current.scrollHeight
      scrollBottom.current = null
      setShowLatest(false)
    } else if (scroll.current) {
      scrollHeight.current = scroll.current.scrollHeight
      setShowLatest(!follow.current && scroll.current.scrollHeight-scroll.current.scrollTop-scroll.current.clientHeight>80)
    }
  }, [chat?.messages, busy])
  useLayoutEffect(()=>{
    const el=scroll.current,content=el?.querySelector('.messages')
    if(!content)return
    let frame
    const observer=new ResizeObserver(()=>{
      cancelAnimationFrame(frame)
      if(el.scrollHeight<=el.clientHeight+2){
        follow.current=true;scrollBottom.current=null;scrollHeight.current=el.scrollHeight;setShowLatest(false)
        return
      }
      if(follow.current){
        frame=requestAnimationFrame(()=>{if(follow.current){el.scrollTop=el.scrollHeight;scrollTop.current=el.scrollTop;scrollHeight.current=el.scrollHeight;setShowLatest(false)}})
      }else{
        scrollHeight.current=el.scrollHeight
        setShowLatest(el.scrollHeight-el.scrollTop-el.clientHeight>80)
      }
    })
    observer.observe(content);observer.observe(el)
    return()=>{observer.disconnect();cancelAnimationFrame(frame)}
  },[chat?.id,Boolean(chat?.messages.length)])
  function trackScroll() {
    const el = scroll.current
    const resized=scrollWidth.current!==el.clientWidth
    scrollWidth.current=el.clientWidth
    const shrunk = el.scrollHeight < scrollHeight.current - 1
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 2
    const fitsViewport = el.scrollHeight <= el.clientHeight + 2
    const returning = scrollBottom.current != null && el.scrollHeight - el.clientHeight - el.scrollTop < 80
    if (fitsViewport) { follow.current = true; scrollBottom.current = null }
    else if (el.scrollTop < scrollTop.current && !resized && !shrunk && !atBottom) { follow.current = false; scrollBottom.current = null }
    else if (el.scrollTop > scrollTop.current && (returning || el.scrollTop >= (scrollBottom.current ?? el.scrollHeight - el.clientHeight) - 1)) {
      follow.current = true; scrollBottom.current = null
    }
    scrollTop.current = el.scrollTop
    scrollHeight.current = el.scrollHeight
    setShowLatest(!follow.current && el.scrollHeight-el.scrollTop-el.clientHeight>80)
  }
  function latest() {
    follow.current=true;scrollBottom.current=null;setShowLatest(false)
    if(scroll.current){scroll.current.scrollTop=scroll.current.scrollHeight;scrollTop.current=scroll.current.scrollTop;scrollHeight.current=scroll.current.scrollHeight}
  }
  function scrollIntent(direction) {
    if (direction < 0) { follow.current = false; scrollBottom.current = null }
    if (direction > 0) {
      const el = scroll.current
      // New text can move the bottom before the browser delivers the scroll event.
      scrollBottom.current = el.scrollHeight - el.clientHeight
      if (el.scrollTop >= scrollBottom.current - 1) follow.current = true
    }
  }
  function touchScroll(event) {
    const y = event.touches[0].clientY
    scrollIntent(touchY.current - y)
    touchY.current = y
  }
  function keyScroll(event) {
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || event.key === ' ' && event.shiftKey) scrollIntent(-1)
    if (['ArrowDown', 'PageDown'].includes(event.key) || event.key === ' ' && !event.shiftKey) scrollIntent(1)
    if (event.key === 'End') follow.current = true
  }
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  useEffect(() => {
    function key(e) {
      const active = document.activeElement
      const isEditing = Boolean(active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable))
      const openDialog = document.querySelector('[aria-modal="true"]')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (e.repeat) return
        e.preventDefault()
        setSidebar(false)
        polaris.dismissMentorAll()
        setModal(current => current && current !== 'quick-search' ? current : current === 'quick-search' ? (quickSearchState.current = null, null) : 'quick-search')
      } else if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        if (e.repeat) return
        if (openDialog && modalRef.current !== 'shortcuts') return
        e.preventDefault()
        setSidebar(false)
        setModal(current => current === 'shortcuts' ? null : 'shortcuts')
      } else if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditing) {
        if (e.repeat) return
        if (openDialog && modalRef.current !== 'shortcuts') return
        e.preventDefault()
        setSidebar(false)
        setModal(current => current === 'shortcuts' ? null : 'shortcuts')
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && document.activeElement === document.body) {
        e.preventDefault(); textarea.current?.focus()
      }
      if (e.key === 'Escape') setSidebar(open => { if (open) queueMicrotask(() => mobileToggle.current?.focus({ preventScroll: true })); return false })
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  const sources = useCallback(id => { setSourceId(id || null); setModal('sources') }, [])
  const isFollowing=useCallback(()=>follow.current,[])
  const selectChat=useCallback(async(id)=>{
    const token = ++view.current
    observer.current?.abort(); streamAbortRef.current?.abort(); streamAbortRef.current = null; runStartedRef.current = false; cancelPending.current = false; activeChatIdRef.current = id; sending.current = true; setBusy(false);setStopping(false);setLoadingChat(true)
    try {
      const c = await api(`/chats/${id}`)
      if (token !== view.current) return
      setLoadingChat(false);setChat(c);openDraft(id); setSidebar(false); setError(''); follow.current = true; scrollBottom.current = null; scrollTop.current = 0; scrollHeight.current = 0
      sessionStorage.setItem('mentor-active-chat', id)
      if (c.running) { runStartedRef.current = true; setBusy(true); try { await watchRun(id, token) } finally { await finishRun(token) } }
      else sending.current = false
    }
    catch (e) { if (token === view.current) { setLoadingChat(false);setError(e.message); sending.current = false; setBusy(false); setStopping(false) } }
  },[])
  const newChat=useCallback(()=>{ view.current++; observer.current?.abort(); streamAbortRef.current?.abort(); streamAbortRef.current = null; runStartedRef.current = false; activeChatIdRef.current = null; sending.current = false; cancelPending.current = false; assistantId.current = null; follow.current = true; scrollBottom.current = null; setLoadingChat(false);setBusy(false); setStopping(false); setShowLatest(false); sessionStorage.removeItem('mentor-goal-chat'); sessionStorage.setItem('mentor-active-chat', 'new'); setChat(null);openDraft('new'); setSidebar(false); setError(''); scrollTop.current = 0; scrollHeight.current = 0; if (scroll.current) scroll.current.scrollTop = 0; textarea.current?.focus() },[])
  const removeChat=useCallback(async(id)=>{
    try {
      await api(`/chats/${id}`, { method: 'DELETE' })
      if (chat?.id === id) newChat()
      toast.info('已移到回收站', {
        actionLabel: '撤销',
        durationMs: 6500,
        onAction: () => restoreChat(id).catch(e => setError(e.message)),
      })
      await refreshHistory()
    }
    catch (e) { setError(e.message) }
  },[chat?.id, newChat, toast])
  async function restoreChat(id) {
    await api(`/chats/${id}/restore`,{method:'POST'});await refreshHistory();toast.success('对话已恢复')
  }
  async function renameChat(id,title) {
    const renamed=await api(`/chats/${id}`,{method:'PATCH',body:{title}})
    setChat(current=>current?.id===id?{...current,title:renamed.title}:current)
    await refreshHistory();setModal(null);toast.success('已重命名')
  }
  function updateAssistant(id, update) {
    setChat(c => c ? { ...c, messages: c.messages.map(m => m.id === id ? { ...m, ...update(m) } : m) } : c)
  }
  function flushDelta() {
    cancelAnimationFrame(deltaFrame.current);deltaFrame.current=null
    const next=pendingDelta.current;pendingDelta.current=null
    if(next&&next.token===view.current)updateAssistant(next.id,m=>({content:next.content??m.content+next.text}))
  }
  function runEvent(event, payload, token) {
    if (token !== view.current) return
    if(event==='delta') {
      const previous=pendingDelta.current,same=previous?.token===token&&previous.id===assistantId.current
      pendingDelta.current={id:assistantId.current,token,content:payload.content??(same&&previous.content!=null?previous.content+(payload.text||''):undefined),text:(same?previous.text:'')+(payload.text||'')}
      if(deltaFrame.current==null)deltaFrame.current=requestAnimationFrame(flushDelta)
      return
    }
    flushDelta()
    if (event === 'sync') {
      setChat(payload); assistantId.current = payload.messages.at(-1)?.id
      sessionStorage.setItem('mentor-active-chat', payload.id)
      if (payload.running || payload.messages?.at(-1)?.status === 'running') {
        runStartedRef.current = true
        if (cancelPending.current) {
          cancelPending.current = false
          api(`/chats/${payload.id}/cancel`, { method: 'POST' }).catch(() => {})
        }
      }
    }
    if (event === 'start') {
      runStartedRef.current = true
      assistantId.current = payload.message.id
      if (payload.chat) { setChat(payload.chat); sessionStorage.setItem('mentor-active-chat', payload.chat.id) }
      else setChat(c => ({ ...c, title: payload.title, messages: [...c.messages, payload.message] }))
      refreshHistory().catch(() => {})
      if (cancelPending.current) {
        cancelPending.current = false
        const activeId = payload.chat?.id || activeChatIdRef.current
        if (activeId) api(`/chats/${activeId}/cancel`, { method: 'POST' }).catch(() => {})
      }
    }
    if(event==='workspace')workspace.refresh()
    if(event==='profile'&&payload)polaris.setProfile(payload)
    if(event==='file')updateAssistant(assistantId.current,m=>({files:[...(m.files||[]),payload]}))
    if (event === 'progress') updateAssistant(assistantId.current, m => ({ content: payload.content, progress: payload.text,activity:payload.activity||m.activity }))
    if (event === 'tool_start') updateAssistant(assistantId.current, m => ({ tools: [...m.tools, payload] }))
    if (event === 'tool_end') updateAssistant(assistantId.current, m => ({ tools: m.tools.map(t => t.id === payload.tool.id ? payload.tool : t), sources: payload.sources }))
    if (event === 'artifact') updateAssistant(assistantId.current, m => ({ artifacts: [...m.artifacts, payload] }))
    if (event === 'context') setChat(c => ({ ...c, context: payload }))
    if (event === 'usage') { if (payload.context) setChat(c => ({ ...c, context: payload.context })); updateAssistant(assistantId.current, () => ({ usage: payload.turn })); setUsage(payload.total) }
    if (event === 'done') {
      const completed=payload.message||payload.chat?.messages.at(-1),readResult=follow.current&&!completed?.content&&completed?.artifacts?.length
      if(readResult)scrollIntent(-1)
      if (payload.chat) setChat(payload.chat)
      else { updateAssistant(assistantId.current, () => payload.message); setChat(c => ({ ...c, usage: payload.usage })) }
      if(readResult)requestAnimationFrame(()=>{
        if(token!==view.current||!scroll.current)return
        const el=scroll.current,reply=[...el.querySelectorAll('.assistant-message')].at(-1),result=reply?.querySelector('.recommendations,.artifact')
        if(result){el.scrollTop+=result.getBoundingClientRect().top-el.getBoundingClientRect().top-16;scrollTop.current=el.scrollTop;setShowLatest(el.scrollHeight-el.scrollTop-el.clientHeight>80)}
      })
    }
    if (event === 'error' && !payload.reconnect) {
      if (payload.chat) setChat(payload.chat)
      else updateAssistant(assistantId.current, m => ({ status: payload.canceled ? 'canceled' : 'error', error: payload.error, tools: m.tools.map(t => t.status === 'running' ? { ...t, status: 'canceled' } : t) }))
    }
  }
  async function watchRun(id, token) {
    if (token !== view.current) return
    observer.current?.abort(); observer.current = new AbortController()
    await observeChat(id, (event, payload) => runEvent(event, payload, token), observer.current.signal)
  }
  async function finishRun(token) {
    if (token === view.current) { sending.current = false; setBusy(false); setStopping(false); streamAbortRef.current = null; runStartedRef.current = false; cancelPending.current = false; activeChatIdRef.current = null }
    try { await refreshHistory() } catch { }
    if (token === view.current && follow.current && [document.body,textarea.current].includes(document.activeElement)) textarea.current?.focus({ preventScroll: true })
  }
  async function send(value) {
    const question = (value ?? text).trim()
    if (!question || sending.current || !config) return
    if (!config.configured) { editText(question); setModal('settings'); return }
    sending.current = true; setBusy(true); setError(''); editText(''); follow.current = true; cancelPending.current = false
    runStartedRef.current = false
    streamAbortRef.current?.abort()
    const streamAbort = new AbortController()
    streamAbortRef.current = streamAbort
    const token = view.current
    const priorChat = chat
    let current = chat
    activeChatIdRef.current = priorChat?.id || null
    const previousUserId = chat?.messages.findLast(message => message.role === 'user')?.id
    const pendingUser = { id: `pending-${Date.now()}`, role: 'user', content: question }
    assistantId.current = null
    setChat(priorChat ? { ...priorChat, messages: [...priorChat.messages, pendingUser] } : { id: 'pending-chat', title: question.slice(0, 24), messages: [pendingUser] })
    try {
      if (!current) {
        current = await api('/chats', { method: 'POST' })
        if (token !== view.current) return
        if (cancelPending.current) {
          cancelPending.current = false
          api(`/chats/${current.id}`, { method: 'DELETE' }).catch(() => {})
          setChat(priorChat)
          editText(question)
          return
        }
      }
      activeChatIdRef.current = current.id
      if (token === view.current) { draftId.current = current.id; sessionStorage.setItem('mentor-active-chat', current.id); setChat({ ...current, messages: [...current.messages, pendingUser] }) }
      const result = await streamChat(current.id, question, (event, payload) => runEvent(event, payload, token), { signal: streamAbort.signal })
      if (result.reconnect) await watchRun(current.id, token)
    } catch (e) {
      if (token !== view.current) return
      if (e.name === 'AbortError' || cancelPending.current) {
        cancelPending.current = false
        if (current) {
          const latestChat = await api(`/chats/${current.id}`).catch(() => null)
          if (token !== view.current) return
          if (latestChat?.running) {
            api(`/chats/${current.id}/cancel`, { method: 'POST' }).catch(() => {})
            try { await watchRun(current.id, token) } catch {}
            return
          }
          if (latestChat && latestChat.messages.length > (priorChat?.messages.length || 0)) {
            setChat(latestChat)
            return
          }
          if (!priorChat && latestChat && latestChat.messages.length === 0) {
            api(`/chats/${current.id}`, { method: 'DELETE' }).catch(() => {})
            draftId.current = 'new'
            sessionStorage.setItem('mentor-active-chat', 'new')
            setChat(null)
            editText(question)
            return
          }
        }
        if (!priorChat) { draftId.current = 'new'; sessionStorage.setItem('mentor-active-chat', 'new') }
        setChat(priorChat || null)
        editText(question)
        return
      }
      if (current && !e.status) {
        try {
          await watchRun(current.id, token)
          const recovered = await api(`/chats/${current.id}`)
          if (token === view.current && !recovered.messages.some(message => message.role === 'user' && message.id !== previousUserId && message.content === question)) {
            editText(question); setError('连接已恢复，问题尚未发送，请重试。')
          }
        } catch (error) { setError(error.message) }
      } else if (assistantId.current) updateAssistant(assistantId.current, () => ({ status: 'error', error: e.message }))
      else { setError(e.message); editText(question); setChat(current || priorChat || null) }
    } finally {
      await finishRun(token)
    }
  }
  async function retry() {
    if (!chat || sending.current) return
    const token = view.current
    const retryChatId = chat.id
    const priorChat = chat
    sending.current = true; setBusy(true); setError('')
    cancelPending.current = false
    runStartedRef.current = false
    activeChatIdRef.current = retryChatId
    streamAbortRef.current?.abort()
    const streamAbort = new AbortController()
    streamAbortRef.current = streamAbort
    try {
      await api(`/chats/${retryChatId}/retry`, { method: 'POST', signal: streamAbort.signal })
      if (token !== view.current) return
      if (cancelPending.current) {
        cancelPending.current = false
        await api(`/chats/${retryChatId}/cancel`, { method: 'POST' }).catch(() => {})
      }
      await watchRun(retryChatId, token)
    }
    catch (e) {
      if (token !== view.current) return
      if (e.name === 'AbortError' || cancelPending.current) {
        cancelPending.current = false
        const latestChat = await api(`/chats/${retryChatId}`).catch(() => null)
        if (token !== view.current) return
        if (latestChat?.running) {
          api(`/chats/${retryChatId}/cancel`, { method: 'POST' }).catch(() => {})
          try { await watchRun(retryChatId, token) } catch {}
          return
        }
        setChat(latestChat || priorChat)
        return
      }
      setError(e.message)
    }
    finally { await finishRun(token) }
  }
  async function loadModels() {
    if (config.models?.length && config.models.every(m => m.reasoning) || modelLoading) return
    setModelLoading(true)
    try { await api('/models'); setConfig(await api('/config')) }
    catch (e) { setError(e.message) }
    finally { setModelLoading(false) }
  }
  async function changeModel(model) {
    setModelLoading(true)
    try { const result = await api('/config/model', { method: 'PUT', body: { model } }); setConfig(result) }
    catch (e) { setError(e.message) }
    finally { setModelLoading(false) }
  }
  async function stop() {
    if (!chat || stopping) return
    if (chat.id === 'pending-chat') { cancelPending.current = true; setStopping(true); return }
    setStopping(true)
    if (!runStartedRef.current) {
      cancelPending.current = true
      streamAbortRef.current?.abort()
      api(`/chats/${chat.id}/cancel`, { method: 'POST' }).catch(() => {})
      return
    }
    try { await api(`/chats/${chat.id}/cancel`, { method: 'POST' }) }
    catch (e) { setError(e.message); setStopping(false) }
  }
  function exportChat() {
    if (!chat) return
    const cited=chat.messages.flatMap(message=>[...(message.sources||[]),...(message.artifacts||[]).flatMap(artifact=>artifact.sources||[])])
    const body = `# ${chat.title}\n\n` + chat.messages.map(m => `## ${m.role === 'user' ? '我' : APP_NAME}\n\n${m.status && m.status !== 'complete' ? `本条状态：${m.status === 'running' ? '生成中' : '未完成'}\n\n` : ''}${m.role==='assistant'?messageMarkdown(m,{withSources:false}):m.content}`).join('\n\n') + (cited.length?`\n\n## 资料来源\n\n${sourcesMarkdown(cited)}`:'')
    downloadFile(`${chat.title.replace(/[\\/:*?"<>|]/g, '_')}.md`, body)
    toast.success('已导出对话 Markdown')
  }
  const isWelcome = !chat?.messages.length
  const runningReply = busy ? chat?.messages.findLast(m => m.role === 'assistant') : null
  const shownModel = runningReply?.model || config?.model
  const savedCount = workspace.state?.items?.length || 0
  const compareCount = workspace.state?.comparison?.length || 0
  const mentorTotalCount = Object.keys(polaris.insights || {}).length
  const openMentors = useCallback(() => { closeSidebar(); polaris.dismissMentorAll(); workspace.close(); setModal('quick-search') }, [closeSidebar, polaris, workspace])
  const openLibrary = useCallback(() => { closeSidebar(); polaris.dismissMentorAll(); setModal(null); workspace.open('library') }, [closeSidebar, polaris, workspace])
  const focusAgent = useCallback(() => { closeSidebar(); polaris.dismissMentorAll(); setModal(null); workspace.close(); requestAnimationFrame(() => textarea.current?.focus()) }, [closeSidebar, polaris, workspace])
  const activeCore = modal === 'quick-search' ? 'mentors' : workspace.view ? 'library' : 'agent'
  useEffect(() => { document.title = chat?.title ? `${chat.title} · ${APP_NAME}` : APP_NAME }, [chat?.title])
  const composer = <Composer ref={textarea} chat={chat} config={config} colleges={data?.metadata?.profile_colleges||data?.metadata?.colleges||[]} loading={loadingChat} busy={busy} stopping={stopping} text={text} onText={editText} onSend={() => send()} onStop={stop} onLatest={latest} showLatest={showLatest&&!isWelcome} onExecution={() => setModal('execution')}/>
  return <div className="app-shell">
    {sidebar && <div className="sidebar-backdrop" onClick={closeSidebar}/>}
    <Sidebar chats={chats} chatId={chat?.id} usage={usage} configured={Boolean(config)} open={sidebar} collapsed={sidebarCollapsed} isMac={isMac} onCollapse={collapseSidebar} onClose={closeSidebar} onNew={newChat} onSelect={selectChat} onSearch={searchChats} onRemove={removeChat} onRename={showRename} onTrash={showTrash} onSettings={showSettings} onUsage={showUsage} onShortcuts={showShortcuts} onOpenMentors={openMentors} onWorkspace={openLibrary} />
    <main className="chat-main"><header className="topbar"><div className="topbar-left"><button ref={sidebarToggle} className="icon-button desktop-sidebar-toggle" aria-label={sidebarCollapsed?"展开侧栏":"收起侧栏"} title={sidebarCollapsed?"展开侧栏":"收起侧栏"} aria-expanded={!sidebarCollapsed} aria-controls="sidebar-content" onClick={()=>setSidebarCollapsed(value=>!value)}>{sidebarCollapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button><button ref={mobileToggle} className="icon-button mobile-menu" aria-label="打开对话列表" aria-expanded={sidebar} onClick={() => setSidebar(true)}><Menu size={19}/></button><h1 className="topbar-topic" title={isWelcome ? undefined : chat.title}>{isWelcome ? '新对话' : chat.title}</h1></div><nav className="core-nav" aria-label="核心功能"><button type="button" className={'core-nav-btn'+(activeCore==='agent'?' active':'')} aria-label="Agent 交互" title="Agent 交互" aria-current={activeCore==='agent'?'page':undefined} onClick={focusAgent}><MessageSquare size={13} aria-hidden="true"/><span>Agent 交互</span></button><button type="button" className={'core-nav-btn quick-search-trigger'+(activeCore==='mentors'?' active':'')} aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K" onClick={openMentors} aria-label="查看导师 · 速查导师档案" title={`查看全校导师档案（${isMac?'⌘K':'Ctrl+K'}）`}><Search size={13} aria-hidden="true"/><span>查看导师</span><kbd aria-hidden="true">{isMac?'⌘K':'Ctrl K'}</kbd></button><button type="button" className={'core-nav-btn workspace-open-button'+(activeCore==='library'?' active':'')} onClick={openLibrary} aria-label="候选库 · 打开选导师工作台" title="打开候选库"><Bookmark size={13} aria-hidden="true"/><span>候选库</span>{savedCount>0&&<small aria-hidden="true">{savedCount}</small>}</button></nav><div className="topbar-right">{config?.configured ? <div className="model-pill model-picker"><select aria-label="选择模型" value={shownModel} onFocus={loadModels} onChange={e => changeModel(e.target.value)} disabled={busy || modelLoading}>{!config.models?.some(m => m.id === shownModel) && <option value={shownModel}>{shownModel}</option>}{config.models?.map(m => <option key={m.id} value={m.id}>{modelLabel(m,{compact:true})}</option>)}</select>{modelLoading ? <LoaderCircle className="spin" size={12}/> : <ChevronDown size={13}/>}</div> : <button className="model-pill" onClick={() => config && setModal('settings')}>连接模型<ChevronDown size={13}/></button>}{config?.configured && <button className="reasoning-button" aria-label="推理强度与上下文设置" onClick={() => setModal('execution')} title="推理强度与上下文设置"><SlidersHorizontal size={14}/><span>推理 · {effortLabel(runningReply?.reasoningEffort || config.reasoningEffort || 'off')}</span></button>}<button className="data-button" aria-label="资料与来源" onClick={() => sources()} disabled={!data}><Database size={15}/><span>资料</span></button>{data && !vaultStatus?.locked && <ExportMenu variant="topbar" className="export-topbar-trigger" label={isWelcome ? '导出数据' : '多格式导出'} ariaLabel={isWelcome ? '快捷导出导师数据' : '导出为 Excel / PDF / Word'} showPresets={true} presetsOnly={isWelcome} getPayload={isWelcome ? undefined : (format => ({ kind: 'chat', format, chatId: chat.id, title: chat.title }))} onSuccess={({ filename }) => { if (!window.polarisDesktop?.isElectron) toast.success(`已导出 ${filename}`) }} onError={err => setError(err.message)} />}{!isWelcome && <button className="icon-button export-chat" aria-label="导出对话" title="导出对话 Markdown" onClick={exportChat}><FileText size={16}/></button>}</div></header>
      {vaultStatus?.locked && <div className="vault-lock-banner" role="region" aria-label="导师加密库锁定提示"><div className="vault-lock-banner-copy"><Lock size={15} aria-hidden="true"/><span>导师加密库当前处于锁定状态（{vaultStatus.vaults || 5} 个加密数据集未解密），暂仅展示空目录。</span></div><button type="button" className="primary-button vault-lock-banner-btn" onClick={() => setModal('vault-unlock')}>解锁导师库</button></div>}
      {error && <div className="app-error" role="alert"><span>{error}</span><button onClick={() => config ? setError('') : initialize()}>{config ? '关闭' : '重试'}</button></div>}
      <div className="conversation-panel">
      <div className={`conversation-scroll${isWelcome ? ' is-empty' : ''}`} ref={scroll} role="region" aria-label="对话内容" tabIndex={0} onScroll={trackScroll} onWheel={event => scrollIntent(event.deltaY)} onTouchStart={event => { touchY.current = event.touches[0].clientY }} onTouchMove={touchScroll} onKeyDown={keyScroll}>
        {isWelcome ? <div className="start-view"><Welcome data={data} failed={Boolean(error && !data)} mentorCount={mentorTotalCount} savedCount={savedCount} compareCount={compareCount} isMac={isMac} vaultLocked={Boolean(vaultStatus?.locked)} configured={config?.configured} onOpenSettings={() => setModal('settings')} onOpenMentors={openMentors} onOpenLibrary={openLibrary}>{composer}</Welcome></div> : <div className="messages">{chat.messages.map(m => <Message key={m.id} message={m} mentorTotal={data?.metadata?.counts?.mentors} onRetry={m===chat.messages.at(-1)&&!busy?retry:undefined} onFollowUp={m===chat.messages.at(-1)&&!busy?send:undefined} onSources={sources} isFollowing={isFollowing}/>)}{busy && chat.messages.at(-1)?.role === 'user' && <div className="connecting"><LoaderCircle className="spin" size={15}/><span>连接中…</span></div>}</div>}
      </div>
      </div>
      {!isWelcome && composer}
    </main>
    {['settings', 'execution'].includes(modal) && config && <Settings initialTab={modal === 'execution' ? 'execution' : 'connection'} config={config} onClose={closeModal} onSaved={c => { setConfig(c); setModal(null); toast.success(c.warning || '已保存');  textarea.current?.focus() }}/>}
    {modal === 'vault-unlock' && <VaultUnlockDialog status={vaultStatus} onUnlocked={handleVaultUnlocked} onClose={closeModal}/>}
    {modal === 'usage' && <Usage usage={usage} onClose={closeModal}/>}
    {modal === 'shortcuts' && <ShortcutHelp isMac={isMac} onClose={closeModal}/>}
    {modal === 'sources' && data && <Sources data={data} selected={sourceId} onClose={closeModal}/>}
    {modal === 'rename' && renameTarget && <RenameConversation chat={renameTarget} onSave={renameChat} onClose={closeModal}/>}
    {modal === 'trash' && <Trash onRestore={restoreChat} onClose={closeModal}/>}
    {modal === 'quick-search' && <QuickSearch onClose={closeQuickSearch} onSuspend={closeModal} onReopen={() => setModal('quick-search')} savedStateRef={quickSearchState} onAsk={send} onOpenLibrary={openLibrary} busy={busy}/>}
    <MentorDossier onAsk={send} busy={busy}/>
    {(workspace.view||workspace.message||workspace.error)&&<Suspense fallback={<div className="toast-stack" role="region" aria-label="通知提示"><div className="notice toast-item tone-info" role="status">正在打开工作台…</div></div>}><WorkspaceLayer onAsk={send} onOpenMentors={openMentors} busy={busy}/></Suspense>}
  </div>
}

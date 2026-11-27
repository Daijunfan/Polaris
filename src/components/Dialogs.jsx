import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Eye, EyeOff, KeyRound, Keyboard, Link2, LoaderCircle, Lock, Search, ShieldAlert, SlidersHorizontal } from 'lucide-react'
import { api, modelLabel, tokenNumber } from '../api.js'
import { compactNumber, effortLabel } from '../presentation.js'
import Dialog from './Dialog.jsx'
import DataTable from './DataTable.jsx'
import { sourceNumber } from '../../lib/presentation.js'

function hostOf(url) {
  try { return new URL(String(url || '').trim()).host.toLowerCase() } catch { return '' }
}

export function RenameConversation({ chat, onSave, onClose }) {
  const [title,setTitle] = useState(chat.title),[saving,setSaving] = useState(false),[error,setError] = useState('')
  const input=useRef()
  useEffect(()=>{input.current.focus();input.current.select()},[])
  return <Dialog title="重命名对话" className="rename-modal" onClose={onClose}><form onSubmit={async e=>{e.preventDefault();setSaving(true);try{await onSave(chat.id,title.trim())}catch(error){setError(error.message)}finally{setSaving(false)}}}><label htmlFor="conversation-title">对话名称</label><input ref={input} id="conversation-title" value={title} maxLength={100} onChange={e=>setTitle(e.target.value)}/>{error&&<p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={!title.trim()||saving}>{saving?'保存中…':'保存'}</button></div></form></Dialog>
}

export function Trash({ onRestore, onClose }) {
  const [items,setItems] = useState(null),[error,setError] = useState('')
  useEffect(()=>{api('/chats?deleted=1').then(r=>setItems(r.chats)).catch(e=>setError(e.message))},[])
  return <Dialog title="回收站" className="trash-modal" onClose={onClose}>{error&&<p className="form-error" role="alert">{error}</p>}{items==null?<p className="empty-state">加载中…</p>:!items.length?<p className="empty-state">回收站为空</p>:<ul className="trash-list">{items.map(item=><li key={item.id}><div><strong>{item.title}</strong><small>{new Date(item.deletedAt).toLocaleString('zh-CN')}</small></div><button className="secondary-button" onClick={async()=>{try{await onRestore(item.id);setItems(rows=>rows.filter(row=>row.id!==item.id))}catch(e){setError(e.message)}}}>恢复</button></li>)}</ul>}</Dialog>
}

const PROVIDER_PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', hint: '推荐 · 性价比高，开箱适配工具调用' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: 'OpenAI 官方接口' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat', hint: '聚合多款主流大模型' },
  { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', hint: '国内直连加速服务商' },
  { id: 'ollama', label: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', hint: '本机离线模型（11434 端口，无需填写密钥）', isLocal: true },
  { id: 'custom', label: '自定义', baseUrl: '', model: '', hint: '任意 OpenAI 兼容接口地址' },
]

function detectPresetId(url) {
  const norm = String(url || '').trim().replace(/\/+$/, '').toLowerCase()
  const hit = PROVIDER_PRESETS.find(p => p.baseUrl && p.baseUrl.toLowerCase() === norm)
  return hit ? hit.id : 'custom'
}

function ConnectionForm({ config, onSaved }) {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl), [apiKey, setApiKey] = useState(''), [model, setModel] = useState(config.model || '')
  const [showKey, setShowKey] = useState(false), [loading, setLoading] = useState(false), [testing, setTesting] = useState(false)
  const [error, setError] = useState(''), [testResult, setTestResult] = useState(null)
  const [models, setModels] = useState(config.models || []), [loadingModels, setLoadingModels] = useState(false)
  const lastModelsHost = useRef(hostOf(config.baseUrl)), modelTouched = useRef(Boolean(config.model))
  const activePreset = detectPresetId(baseUrl)
  const activePresetMeta = PROVIDER_PRESETS.find(p => p.id === activePreset)

  function applyPreset(preset) {
    setError(''); setTestResult(null)
    if (preset.id === 'custom') return
    setBaseUrl(preset.baseUrl)
    const nextHost = hostOf(preset.baseUrl)
    if (nextHost && nextHost !== lastModelsHost.current) {
      setModels([])
      lastModelsHost.current = nextHost
    }
    if (preset.model) {
      setModel(preset.model)
      modelTouched.current = false
    }
  }

  async function loadModels() {
    setLoadingModels(true); setError(''); setTestResult(null)
    try {
      const result = await api('/models', { method: 'POST', body: { baseUrl, apiKey } })
      setModels(result.models)
      lastModelsHost.current = hostOf(baseUrl)
    }
    catch (e) { setError(e.message) }
    finally { setLoadingModels(false) }
  }

  async function handleTest() {
    setTesting(true); setError(''); setTestResult(null)
    try {
      const result = await api('/config/test', { method: 'POST', body: { baseUrl, apiKey, model } })
      if (result.models?.length) {
        setModels(result.models)
        lastModelsHost.current = hostOf(baseUrl)
      }
      if (!model && result.recommendedModel) {
        setModel(result.recommendedModel)
        modelTouched.current = false
      }
      if (result.ok) {
        setTestResult(result)
      } else {
        setError(result.message || '连接失败，请检查地址与密钥')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setTesting(false)
    }
  }

  async function save(e) {
    e.preventDefault(); setLoading(true); setError(''); setTestResult(null)
    try { onSaved(await api('/config', { method: 'PUT', body: { baseUrl, apiKey, model } })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const keyPlaceholder = activePreset === 'ollama'
    ? '本地 Ollama 可留空（默认无需密钥）'
    : config.hasKey
      ? `已保存（${config.maskedKey || '****'}），留空保留现有密钥`
      : '输入 API Key（例如 sk-...）'

  return <form className="settings-form" onSubmit={save}><div className="settings-section-heading"><div><h3>模型连接</h3></div><span className={`connection-state ${config.configured ? 'configured' : ''}`}>{config.configured ? <><Check size={12}/>已配置</> : '未配置'}</span></div>
    <div className="preset-section">
      <span className="preset-section-label">快速选择服务商</span>
      <div className="provider-presets" role="group" aria-label="常用服务商预设">
        {PROVIDER_PRESETS.map(preset => (
          <button
            key={preset.id}
            type="button"
            className={`provider-preset-pill${activePreset === preset.id ? ' active' : ''}`}
            aria-pressed={activePreset === preset.id}
            onClick={() => applyPreset(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {activePresetMeta?.hint && <small className="preset-hint">{activePresetMeta.hint}</small>}
    </div>
    <label htmlFor="api-url">API URL</label><div className="field-with-icon"><Link2 size={15}/><input id="api-url" type="url" required value={baseUrl} onChange={e => { const next = e.target.value; setBaseUrl(next); setTestResult(null); const nextHost = hostOf(next); if (nextHost && nextHost !== lastModelsHost.current) { setModels([]); if (!modelTouched.current) setModel(''); lastModelsHost.current = nextHost } }} placeholder="https://api.deepseek.com" spellCheck={false}/></div>
    <label htmlFor="api-key">API Key{config.hasKey && <span className="saved-label"><Check size={12}/>已保存{config.maskedKey ? `：${config.maskedKey}` : ''}</span>}</label><div className="field-with-icon"><KeyRound size={15}/><input id="api-key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => { setApiKey(e.target.value); setTestResult(null) }} placeholder={keyPlaceholder} autoComplete="off" spellCheck={false}/><button type="button" className="icon-button" aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>
    <div className="model-field-heading"><label htmlFor="default-model">模型</label><button type="button" className="text-button" onClick={loadModels} disabled={loadingModels || testing}>{loadingModels ? <><LoaderCircle className="spin" size={13}/>读取中</> : '获取模型列表'}</button></div><div className="select-field"><select id="default-model" value={model} onChange={e => { modelTouched.current = true; setModel(e.target.value) }}><option value="">自动选择</option>{model && !models.some(m => m.id === model) && <option value={model}>{model}</option>}{models.map(m => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}</select><ChevronDown size={14}/></div>
    <details className="advanced-settings"><summary>自定义模型 ID<ChevronDown size={13}/></summary><label htmlFor="model-id">服务商模型 ID</label><input id="model-id" value={model} onChange={e => { modelTouched.current = true; setModel(e.target.value) }} placeholder="例如 deepseek-chat"/><small>所选模型需要支持工具调用。</small></details>
    {testResult && <div className="form-success" role="status"><Check size={15}/><span>{testResult.message}{testResult.warning ? `（${testResult.warning}）` : ''}</span></div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <p className="field-note settings-privacy-note">密钥与接口配置仅保存在本机应用数据目录，保存后立即生效，不会写入项目代码。</p>
    <div className="settings-form-footer"><button type="button" className="secondary-button" onClick={handleTest} disabled={testing || loading}>{testing ? <><LoaderCircle className="spin" size={14}/>测试中…</> : '测试连接'}</button><button className="primary-button" type="submit" disabled={loading || testing}>{loading ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>} {loading ? '正在验证…' : '连接并保存'}</button></div>
  </form>
}

function ExecutionForm({ config, onSaved }) {
  const [effort, setEffort] = useState(config.reasoningEffort || 'off'), [automatic, setAutomatic] = useState(config.compressionThresholdTokens == null)
  const [tokens, setTokens] = useState(String(config.compressionTriggerTokens || Math.floor(config.contextWindow * .8))), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const window = config.contextWindow || 32768, min = config.compressionMinTokens || 8192, max = config.compressionMaxTokens || Math.floor(window * .95)
  const effective = automatic ? Math.min(Math.floor(window * .8), max) : Number(tokens)
  const percentage = Math.round(effective / window * 1000) / 10
  async function save(e) {
    e.preventDefault(); setLoading(true); setError('')
    try { onSaved(await api('/config/execution', { method: 'PUT', body: { reasoningEffort: effort, compressionThresholdTokens: automatic ? null : Number(tokens) } })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  return <form className="settings-form execution-form" onSubmit={save} noValidate>
    <div className="setting-row"><div><label htmlFor="reasoning-effort">推理强度</label></div><div className="select-field"><select id="reasoning-effort" value={effort} onChange={e => setEffort(e.target.value)}>{(config.reasoningOptions || ['off', 'auto']).map(value => <option key={value} value={value}>{effortLabel(value)}</option>)}</select><ChevronDown size={14}/></div></div>
    {effort!=='off'&&config.reasoningOptions?.includes('off')&&<p className="field-note">资料分析使用所选强度，答复整理和历史压缩采用同一模型的快速模式。</p>}
    {config.reasoningOptions?.length === 1 && <p className="field-note">模型未提供可选档位。</p>}
    {effort === 'auto' && config.reasoningDefaultLevel && <p className="field-note">默认档位：{effortLabel(config.reasoningDefaultLevel)}。</p>}
    <div className="settings-divider"/><div className="setting-row"><div><h4>上下文压缩</h4></div><label className="switch-control"><input type="checkbox" checked={automatic} onChange={e => setAutomatic(e.target.checked)} aria-label="自动管理压缩阈值"/><span/>自动管理</label></div>
    <div className="context-policy-card"><div><span>模型容量{config.contextWindowKnown === false ? '（估算）' : ''}</span><strong>{compactNumber(window)} <small>Token</small></strong></div><div><span>触发阈值</span><strong>{compactNumber(effective)} <small>Token</small></strong></div></div>
    {config.contextWindowKnown === false && <p className="field-note">服务商未返回容量，当前使用估算值。</p>}
    <div className="range-labels"><span>{tokenNumber(min)}</span><b>{percentage}%</b><span>{compactNumber(max)}</span></div><input className="threshold-slider" aria-label="压缩阈值比例" type="range" min={Math.ceil(min / window * 1000) / 10} max={Math.floor(max / window * 100)} step="0.1" value={Math.min(max / window * 100, percentage)} onChange={e => { setAutomatic(false); setTokens(String(Math.max(min, Math.round(Number(e.target.value) / 100 * window)))) }}/>
    <label htmlFor="compression-tokens">精确阈值</label><div className="number-field"><input id="compression-tokens" type="number" min={min} max={max} step="1024" value={automatic ? effective : tokens} onChange={e => { setAutomatic(false); setTokens(e.target.value) }} aria-describedby="compression-help"/><span>Token</span></div>
    <div className="threshold-presets">{[32768, 65536, 131072, 262144].filter(n => n >= min && n <= max).map(n => <button type="button" key={n} className={!automatic && Number(tokens) === n ? 'selected' : ''} onClick={() => { setAutomatic(false); setTokens(String(n)) }}>{Math.round(n / 1024)}K</button>)}</div><p id="compression-help" className="field-note">输入达到此阈值时压缩历史，保留当前任务和查询结果。</p>
    {error && <div className="form-error" role="alert">{error}</div>}<div className="settings-form-footer"><button className="primary-button" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>}保存执行设置</button></div>
  </form>
}

export function Settings({ config, onSaved, onClose, initialTab = 'connection' }) {
  const [tab, setTab] = useState(initialTab)
  return <Dialog title="设置" className="settings-modal" onClose={onClose}><div className="settings-layout"><nav className="settings-tabs" aria-label="设置分类"><button className={tab === 'connection' ? 'active' : ''} aria-current={tab === 'connection' ? 'page' : undefined} onClick={() => setTab('connection')}><Link2 size={15}/>模型连接</button><button className={tab === 'execution' ? 'active' : ''} aria-current={tab === 'execution' ? 'page' : undefined} onClick={() => setTab('execution')}><SlidersHorizontal size={15}/>执行参数</button></nav><div className="settings-content">{tab === 'connection' ? <ConnectionForm config={config} onSaved={onSaved}/> : <ExecutionForm config={config} onSaved={onSaved}/>}</div></div></Dialog>
}

export function Usage({ usage, onClose }) {
  const total = usage || {}
  return <Dialog title="Token 用量" className="usage-modal" onClose={onClose}><div className="usage-grid">{[['累计 Token', total.totalTokens, 'total'], ['输入', total.inputTokens], ['输出', total.outputTokens], ['缓存命中', total.cachedTokens]].map(([label, value, tone]) => <div className={tone || ''} key={label}><small>{label}</small><strong>{tokenNumber(value)}</strong></div>)}</div><p className="usage-note">{total.requests || 0} 次请求{total.unreportedRequests > 0 && <span> · {total.unreportedRequests} 次未返回计量</span>}</p>{total.recent?.length > 0 && <div className="usage-records"><h3>最近请求</h3><div className="data-table-scroll"><table><thead><tr><th>模型 / 时间</th><th className="numeric">输入</th><th className="numeric">输出</th><th className="numeric">耗时</th></tr></thead><tbody>{total.recent.slice(0, 12).map(entry => <tr key={entry.id}><td><b>{entry.model}</b><small>{entry.purpose === 'compaction' ? '上下文压缩' : entry.purpose === 'delivery' ? '答复整理' : entry.purpose === 'verification' ? '答复核对' : effortLabel(entry.reasoningEffort || 'auto')} · {new Date(entry.at).toLocaleString('zh-CN')}</small></td><td className="numeric">{entry.unreportedRequests ? '—' : tokenNumber(entry.inputTokens)}</td><td className="numeric">{entry.unreportedRequests ? '—' : tokenNumber(entry.outputTokens)}</td><td className="numeric">{(entry.durationMs / 1000).toFixed(1)}s</td></tr>)}</tbody></table></div></div>}</Dialog>
}

export function Sources({ data, selected, onClose }) {
  const [query,setQuery]=useState(''),[activeId,setActiveId]=useState(selected),[browse,setBrowse]=useState(!selected),[detail,setDetail]=useState(null),[error,setError]=useState('')
  useEffect(()=>setActiveId(selected),[selected])
  useEffect(()=>{
    let current=true
    setBrowse(!activeId);setQuery('');setDetail(null);setError('')
    if(activeId)api(`/sources/${encodeURIComponent(activeId)}`).then(result=>{if(current)setDetail(result)}).catch(error=>{if(current)setError(error.message)})
    return()=>{current=false}
  },[activeId])
  const focused=!browse&&data.sources.find(source=>source.id===activeId),needle=query.trim().toLocaleLowerCase()
  const sources=focused?[focused]:data.sources.filter(source=>!needle||[source.title,source.scope,source.publisher,source.kind].some(value=>value?.toLocaleLowerCase().includes(needle)))
  const loaded=detail?.source.id===activeId?detail:null
  const entries=(loaded?.entries||[]).filter(entry=>!needle||`${entry.title}\n${entry.text}`.toLocaleLowerCase().includes(needle))
  return <Dialog title="资料与来源" className="sources-modal" onClose={onClose}>
    {focused?<div className="source-navigation"><button className="text-button" onClick={()=>{setBrowse(true);setQuery('')}}>← 全部资料</button><span>引用 {sourceNumber(focused.id)}</span></div>:<p className="source-scope">{data.metadata.scope}</p>}
    {!focused&&data.sources.length>8&&<label className="source-search"><Search size={16}/><input aria-label="查找资料来源" placeholder="按老师、网站或来源查找" value={query} onChange={event=>setQuery(event.target.value)}/><span>{sources.length} 条</span></label>}
    <ol className="source-list" aria-label="引用资料">{sources.map(source => <li className={`source-row ${activeId === source.id ? 'highlighted' : ''}`} aria-current={activeId === source.id ? 'true' : undefined} key={source.id}>
      <span className="source-id">{sourceNumber(source.id)}</span>
      <div className="source-info"><h3>{focused?source.title:<button className="source-title-button" onClick={()=>{setActiveId(source.id);setBrowse(false);setQuery('')}}>{source.title}</button>}</h3><p>{[source.kind,source.publisher,source.published_at?`发布 ${source.published_at}`:source.year,!source.url&&!data.metadata.colleges.includes(source.scope)&&source.scope].filter(Boolean).join(' · ')}</p>{source.url&&<div className="source-web"><a href={source.url} target="_blank" rel="noopener noreferrer">查看原始网页<ExternalLink size={12}/></a>{source.fetched_at&&<span>抓取 {new Date(source.fetched_at).toLocaleDateString('zh-CN')}</span>}</div>}</div>
    </li>)}</ol>
    {focused&&<div className="source-content">
      {error?<p className="form-error" role="alert">{error}</p>:!loaded?<p className="source-loading" role="status">载入资料内容…</p>:<>
        {(loaded.truncated || loaded.protection_notice) && (
          <div className="source-protection-banner" role="note" aria-label={loaded.truncated ? '预览截断与资料保护提示' : '资料访问保护提示'}>
            <div className="source-protection-head">
              <ShieldAlert size={15} aria-hidden="true"/>
              <strong>{loaded.truncated ? '预览已按保护策略截断' : '资料访问保护提示'}</strong>
              {loaded.truncated && loaded.total_entries != null && (
                <span className="source-truncation-badge">显示前 {loaded.entries.length} / 共 {loaded.total_entries} 条</span>
              )}
            </div>
            {loaded.protection_notice && <p>{loaded.protection_notice}</p>}
          </div>
        )}
        {loaded.entries.length>5&&<label className="source-search"><Search size={16}/><input aria-label="在本资料内查找" placeholder="输入导师姓名或关键词" value={query} onChange={event=>setQuery(event.target.value)}/><span>{entries.length} 条</span></label>}
        {entries.map((entry,index)=><details className="source-entry" key={index} open={entries.length===1}><summary>{entry.title}{entry.rating!=null&&<small className="source-entry-rating" title="培养体验评分">{entry.rating} / 5</small>}</summary><div>{entry.text}</div></details>)}
        {!!loaded.entries.length&&!entries.length&&<p className="empty-state">没有匹配的内容</p>}
        {loaded.table&&<div className="source-data-table"><DataTable rows={loaded.table.rows} columns={loaded.table.columns} caption={loaded.table.title}/></div>}
        {loaded.note&&<p className="source-note">{loaded.note}</p>}
      </>}
    </div>}
    {!sources.length&&<p className="empty-state">没有匹配的来源</p>}
  </Dialog>
}

export function VaultUnlockDialog({ status, onUnlocked, onClose }) {
  const [key, setKey] = useState(''), [showKey, setShowKey] = useState(false), [unlocking, setUnlocking] = useState(null), [error, setError] = useState('')
  const inputRef = useRef()
  async function unlockBuiltin() {
    setUnlocking('builtin'); setError('')
    try {
      const result = await api('/vault/unlock', { method: 'POST', body: { mode: 'builtin' } })
      await onUnlocked(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setUnlocking(null)
    }
  }
  async function unlockCustom(e) {
    e.preventDefault()
    const trimmed = key.trim()
    if (!trimmed) { setError('请输入解锁密钥'); inputRef.current?.focus(); return }
    setUnlocking('custom'); setError('')
    try {
      const result = await api('/vault/unlock', { method: 'POST', body: { key: trimmed, mode: 'custom' } })
      await onUnlocked(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setUnlocking(null)
    }
  }
  return <Dialog title="解锁导师加密数据库" className="vault-unlock-modal" onClose={onClose}>
    <p className="modal-intro">仓库中的导师与评价数据集采用加密存储，请通过本开源项目内置解密或自定义密钥解锁后查看与检索。</p>
    <div className="vault-unlock-meta">
      <Lock size={14} aria-hidden="true"/>
      <span>{status?.cipher || 'AES-256-GCM+scrypt+Brotli'}</span>
      <span>·</span>
      <span>{status?.vaults || 5} 个加密数据集</span>
    </div>
    <div className="vault-unlock-builtin-card">
      <div>
        <strong>开源项目内置模式</strong>
        <p>使用北极星内置项目密钥直接解密随仓分发的开源加密库，无需额外配置密钥。</p>
      </div>
      <button type="button" className="primary-button" disabled={unlocking !== null} onClick={unlockBuiltin}>
        {unlocking === 'builtin' ? <><LoaderCircle className="spin" size={15}/>正在解锁…</> : '使用内置开源模式解锁'}
      </button>
    </div>
    <div className="vault-unlock-divider" aria-hidden="true"><span>或使用自定义密钥</span></div>
    <form className="settings-form" onSubmit={unlockCustom}>
      <label htmlFor="vault-unlock-key">自定义解锁密钥 (MENTOR_VAULT_KEY)</label>
      <div className="field-with-icon">
        <KeyRound size={15}/>
        <input ref={inputRef} id="vault-unlock-key" type={showKey ? 'text' : 'password'} value={key} onChange={e => setKey(e.target.value)} placeholder="输入至少 16 位自定义密钥" autoComplete="off" spellCheck={false}/>
        <button type="button" className="icon-button" aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey(s => !s)}>{showKey ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
      </div>
      <small>适用于使用自定义 <code>MENTOR_VAULT_KEY</code> 封装的私有数据仓。</small>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" disabled={unlocking !== null} onClick={onClose}>暂不解锁</button>
        <button type="submit" className="secondary-button vault-unlock-submit" disabled={unlocking !== null || !key.trim()}>
          {unlocking === 'custom' ? <><LoaderCircle className="spin" size={15}/>验证中…</> : '验证密钥并解锁'}
        </button>
      </div>
    </form>
  </Dialog>
}

export function ShortcutHelp({ isMac = false, onClose }) {
  const mod = isMac ? '⌘' : 'Ctrl'
  const groups = [
    {
      title: '全局导航',
      items: [
        [[mod, 'K'], '打开或关闭查看导师速查'],
        [['/'], '聚焦底部提问输入框'],
        [[mod, '/'], '打开或关闭快捷键说明'],
        [['?'], '快速查看快捷键说明（非输入状态）'],
        [['Esc'], '关闭当前弹窗、导出菜单或侧栏'],
      ],
    },
    {
      title: '对话与提问',
      items: [
        [['Enter'], '发送问题'],
        [['Shift', 'Enter'], '在输入框中换行'],
        [['End'], '浏览长回答时跳回底部继续跟随'],
      ],
    },
    {
      title: '查看导师与档案',
      items: [
        [['↑', '↓'], '在速查结果列表中上下选择'],
        [['Enter'], '打开当前高亮导师的完整档案'],
        [['Shift', 'Enter'], '直接向北极星提问当前导师'],
        [['←', '→'], '图表数据点与侧栏宽度键盘调节'],
      ],
    },
  ]
  return (
    <Dialog title="键盘快捷键" className="shortcuts-modal" onClose={onClose}>
      <p className="modal-intro">
        <Keyboard size={14} className="shortcuts-intro-icon" aria-hidden="true" />
        使用以下快捷键在对话、全校导师速查与图表中高效切换。
      </p>
      <div className="shortcut-groups">
        {groups.map(group => (
          <section className="shortcut-group" key={group.title}>
            <h3>{group.title}</h3>
            <ul>
              {group.items.map(([keys, desc]) => (
                <li key={desc}>
                  <span>{desc}</span>
                  <span className="shortcut-keys" aria-label={keys.join(' 加 ')}>
                    {keys.map((k, idx) => (
                      <React.Fragment key={`${k}-${idx}`}>
                        {idx > 0 && <small aria-hidden="true">+</small>}
                        <kbd>{k}</kbd>
                      </React.Fragment>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

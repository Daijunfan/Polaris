import React,{useState} from 'react'
import {Pencil,RotateCcw,UserRound} from 'lucide-react'
import {profileChips,hasProfile} from '../../lib/profile.js'
import {usePolaris} from '../insights.jsx'
import Dialog from './Dialog.jsx'

function Choice({options,value,onChange,multiple=false,label}){
  const list=multiple?(Array.isArray(value)?value:[]):value
  const selected=item=>multiple?list.includes(item):list===item
  return <div className="choice-row" role="group" aria-label={label}>{options.map(option=><button type="button" key={option.value} className={'choice-chip'+(selected(option.value)?' selected':'')} aria-pressed={selected(option.value)} onClick={()=>onChange(multiple?(selected(option.value)?list.filter(item=>item!==option.value):[...list,option.value]):(selected(option.value)?null:option.value))}>{option.label}</button>)}</div>
}

export function ProfileEditor({onClose,colleges=[]}){
  const {profile,options,saveProfile,resetProfile}=usePolaris()
  const [draft,setDraft]=useState(()=>({stage:null,goal:null,score:'',program:'',colleges:[],musts:[],interests:'',notes:'',...profile,score:profile?.score??'',program:profile?.program||''}))
  const [error,setError]=useState(''),[saving,setSaving]=useState(false)
  const set=(key,value)=>setDraft(current=>({...current,[key]:value}))
  if(!options)return null
  async function save(event){
    event.preventDefault();setSaving(true)
    try{await saveProfile({...draft,score:draft.score===''?null:Number(draft.score)});onClose()}catch(e){setError(e.message)}finally{setSaving(false)}
  }
  return <Dialog title="我的择导画像" className="profile-modal" onClose={onClose}>
    <p className="modal-intro">北极星会在每一轮对话里默认沿用这些偏好；对话里随时可以改口，也可以直接说“记住我更看重实习”。</p>
    <form className="profile-form" onSubmit={save}>
      <label className="profile-label">报考方式</label><Choice label="报考方式" options={options.stage} value={draft.stage} onChange={value=>set('stage',value)}/>
      <label className="profile-label">读研目标</label><Choice label="读研目标" options={options.goal} value={draft.goal} onChange={value=>set('goal',value)}/>
      <div className="profile-inline">
        <label>初试分数<input inputMode="numeric" value={draft.score} onChange={event=>set('score',event.target.value.replace(/\D/g,'').slice(0,3))} placeholder="可不填"/></label>
        <label>目标专业或代码<input value={draft.program} maxLength={120} onChange={event=>set('program',event.target.value)} placeholder="例如 085412"/></label>
      </div>
      <label className="profile-label">我看重</label><Choice label="我看重" multiple options={options.musts} value={draft.musts} onChange={value=>set('musts',value)}/>
      {colleges.length>0&&<><label className="profile-label">关注学院 <small>不选即全部</small></label><Choice label="关注学院" multiple options={colleges.map(value=>({value,label:value.replace('学院','')}))} value={draft.colleges} onChange={value=>set('colleges',value)}/></>}
      <label className="profile-label" htmlFor="profile-interests">感兴趣的方向</label>
      <input id="profile-interests" value={draft.interests} maxLength={120} onChange={event=>set('interests',event.target.value)} placeholder="例如 大模型安全、漏洞挖掘"/>
      <label className="profile-label" htmlFor="profile-notes">其他想让北极星知道的</label>
      <textarea id="profile-notes" value={draft.notes} maxLength={600} onChange={event=>set('notes',event.target.value)} placeholder="例如 本科软件工程，有两段后端实习"/>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="profile-actions">
        {hasProfile(profile)&&<button type="button" className="text-button" disabled={saving} onClick={async()=>{setSaving(true);try{await resetProfile();onClose()}catch(e){setError(e.message)}finally{setSaving(false)}}}><RotateCcw size={13}/>清空画像</button>}
        <button type="button" className="secondary-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={saving}>保存画像</button>
      </div>
    </form>
  </Dialog>
}

export function ProfileBar({colleges}){
  const {profile}=usePolaris(),[editing,setEditing]=useState(false)
  const chips=profileChips(profile)
  return <>
    <div className="profile-bar">
      <button type="button" className={'profile-pill'+(chips.length?'':' empty')} onClick={()=>setEditing(true)} aria-label={chips.length?'编辑我的择导画像':'设置我的择导画像'}>
        <UserRound size={13}/>{chips.length?<span className="profile-pill-chips">{chips.map(chip=><i key={chip.key}>{chip.text}</i>)}</span>:<span>设置择导画像（可选），推荐更贴合个人偏好</span>}<Pencil size={11} className="profile-edit-icon"/>
      </button>
    </div>
    {editing&&<ProfileEditor colleges={colleges} onClose={()=>setEditing(false)}/>}
  </>
}

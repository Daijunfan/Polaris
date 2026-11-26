import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react'
import {api} from './api.js'
import {matchScore} from '../lib/match.js'
import {nameVariants} from '../lib/insights.js'
export {matchScore}

const Context=createContext(null)
export const usePolaris=()=>useContext(Context)||{insights:{},loading:false,error:'',reload:()=>{},profile:null,options:null,lookup:()=>null,openMentor:()=>{},closeMentor:()=>{},dismissMentorAll:()=>{},stepMentor:()=>{},match:()=>null}

export function PolarisProvider({children}){
  const [insights,setInsights]=useState({}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[profile,setProfile]=useState(null),[options,setOptions]=useState(null)
  const [dossierStack,setDossierStack]=useState([])
  const [dossierOrigin,setDossierOrigin]=useState(null)
  const stackRef=useRef([]),originRef=useRef(null)

  const syncStack=next=>{stackRef.current=next;setDossierStack(next)}
  const syncOrigin=next=>{originRef.current=next;setDossierOrigin(next)}

  const reload=useCallback(()=>{
    setLoading(true);setError('')
    return Promise.all([
      api('/insights').then(result=>setInsights(result.mentors)),
      api('/profile').then(result=>{setProfile(result.profile);setOptions(result.options)}).catch(()=>{}),
    ]).catch(e=>setError(e.message||'导师资料暂未加载')).finally(()=>setLoading(false))
  },[])
  useEffect(()=>{reload()},[reload])

  const lookup=useCallback(row=>{
    if(!row)return null
    const raw=row.rawName||row.name||row.mentor_name
    const name=typeof raw==='string'&&row.college&&raw.endsWith(' · '+row.college)?raw.slice(0,-(' · '+row.college).length):raw
    const hasCollege=(item,target)=>!target||item.college===target||item.college?.split(/[、,，]+/).map(part=>part.trim()).some(part=>part===target||part.startsWith(target+'（')||part.startsWith(target+'('))
    if(row.college&&insights[`${row.college}:${name}`])return insights[`${row.college}:${name}`]
    const matches=Object.values(insights).filter(item=>item.name===name&&hasCollege(item,row.college))
    if(matches.length===1)return matches[0]
    if(!row.college){
      const anyMatches=Object.values(insights).filter(item=>item.name===name)
      if(anyMatches.length===1)return anyMatches[0]
    }
    if(!matches.length&&name){
      for(const alt of nameVariants(name)){
        if(row.college&&insights[`${row.college}:${alt}`])return insights[`${row.college}:${alt}`]
        const altMatches=Object.values(insights).filter(item=>item.name===alt&&hasCollege(item,row.college))
        if(altMatches.length===1)return altMatches[0]
      }
    }
    return null
  },[insights])

  const openMentor=useCallback((row,optionsArg)=>{
    if(!row){
      syncStack([])
      syncOrigin(null)
      return
    }
    const entry={key:row.key||null,name:row.rawName||row.name||row.mentor_name,college:row.college}
    if(optionsArg?.origin){
      syncOrigin(optionsArg.origin)
      syncStack([entry])
    }else if(optionsArg?.replace){
      const cur=stackRef.current
      syncStack(cur.length?[...cur.slice(0,-1),entry]:[entry])
    }else{
      const cur=stackRef.current
      syncStack(cur.length?[...cur,entry]:[entry])
    }
  },[])

  const closeMentor=useCallback(()=>{
    const cur=stackRef.current
    if(cur.length>1){
      syncStack(cur.slice(0,-1))
      return
    }
    const origin=originRef.current
    syncStack([])
    syncOrigin(null)
    if(origin?.onReturn)origin.onReturn()
  },[])

  const dismissMentorAll=useCallback(()=>{
    syncStack([])
    syncOrigin(null)
  },[])

  const stepMentor=useCallback(delta=>{
    const origin=originRef.current
    if(!origin?.list?.length)return
    const nextIdx=Math.max(0,Math.min(origin.list.length-1,(origin.index??0)+delta))
    if(nextIdx===origin.index)return
    const nextItem=origin.list[nextIdx]
    if(!nextItem)return
    syncOrigin({...origin,index:nextIdx})
    syncStack([{key:nextItem.key||null,name:nextItem.rawName||nextItem.name||nextItem.mentor_name,college:nextItem.college}])
    origin.onStep?.(nextIdx,nextItem)
  },[])

  const dossier=dossierStack.at(-1)||null
  const previousDossier=dossierStack.length>1?dossierStack.at(-2):null

  const saveProfile=useCallback(async changes=>{const result=await api('/profile',{method:'PUT',body:changes});setProfile(result.profile);return result.profile},[])
  const resetProfile=useCallback(async()=>{const result=await api('/profile',{method:'DELETE'});setProfile(result.profile);return result.profile},[])
  const match=useCallback(insight=>matchScore(insight,profile),[profile])

  const value=useMemo(()=>({
    insights,loading,error,reload,profile,options,lookup,saveProfile,resetProfile,setProfile,match,
    dossier,previousDossier,dossierOrigin,openMentor,closeMentor,dismissMentorAll,stepMentor,
  }),[insights,loading,error,reload,profile,options,lookup,saveProfile,resetProfile,match,dossier,previousDossier,dossierOrigin,openMentor,closeMentor,dismissMentorAll,stepMentor])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

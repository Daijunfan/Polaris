import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from 'react'
import {api,downloadFile} from './api.js'
import {planById} from '../lib/plans.js'

const Context=createContext(null)
export const useWorkspace=()=>useContext(Context)
export function WorkspaceProvider({children}){
  const [state,setState]=useState(null),[pending,setPending]=useState(0),[error,setError]=useState(''),[view,setView]=useState(null),[requiredTier,setRequiredTier]=useState(null),[message,setMessage]=useState('')
  const queue=useRef(Promise.resolve()),current=useRef(null),previousView=useRef('library'),viewRef=useRef(null),mutationEpoch=useRef(0),activeMutations=useRef(0),needsRefresh=useRef(false)
  viewRef.current=view
  const accept=useCallback(next=>{current.current=next;setState(next)},[])
  const refresh=useCallback(()=>{
    if(activeMutations.current){needsRefresh.current=true;return Promise.resolve()}
    const epoch=mutationEpoch.current
    return api('/workbench').then(next=>{if(epoch===mutationEpoch.current&&!activeMutations.current)accept(next);else needsRefresh.current=true}).catch(e=>setError(e.message))
  },[accept])
  useEffect(()=>{refresh()},[refresh])
  useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),3000);return()=>clearTimeout(timer)},[message])
  const open=useCallback((next='library')=>{setError('');setRequiredTier(null);if(next==='membership')previousView.current=viewRef.current&&viewRef.current!=='membership'?viewRef.current:'library';setView(next)},[])
  const fail=useCallback(e=>{setError(e.message);if(e.code==='PLAN_REQUIRED'){previousView.current=viewRef.current&&viewRef.current!=='membership'?viewRef.current:'library';setRequiredTier(e.requiredTier);setView('membership')}},[])
  const mutate=useCallback((path,method='POST',body)=>{
    mutationEpoch.current++;activeMutations.current++
    setPending(value=>value+1)
    const task=queue.current.catch(()=>{}).then(async()=>{
      const request=typeof path==='function'?path(current.current):{path,method,body}
      const next=await api(request.path,{method:request.method||'POST',body:request.body})
      accept(next);setError('');return next
    }).catch(e=>{fail(e);throw e}).finally(()=>{setPending(value=>value-1);activeMutations.current--;if(!activeMutations.current&&needsRefresh.current){needsRefresh.current=false;refresh()}})
    queue.current=task;return task
  },[accept,fail,refresh])
  const saveMentor=useCallback(person=>{let removed=false;return mutate(now=>{
    const saved=now.items.find(item=>person.key?item.key===person.key:item.name===(person.name||person.mentor_name)&&(!person.college||item.college===person.college))
    removed=Boolean(saved)
    return saved?{path:'/workbench/items/'+saved.key,method:'DELETE'}:{path:'/workbench/items',body:{mentors:[person]}}
  }).then(next=>{setMessage(removed?'已移出候选':'已收藏'+(person.name||person.mentor_name));return next})},[mutate])
  const addCompare=useCallback(person=>mutate(now=>{
    const exists=now.comparison.find(item=>person.key?item.key===person.key:item.name===(person.name||person.mentor_name)&&(!person.college||item.college===person.college))
    return {path:'/workbench/comparison',method:'PATCH',body:exists?{remove:[person]}:{add:[person]}}
  }),[mutate])
  const exportReport=useCallback(async(format='html',snapshot,scope,keys)=>{
    try{
      await queue.current.catch(()=>{})
      const response=await fetch('/api/workbench/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format,snapshot,scope,keys})})
      if(!response.ok){const body=await response.json();throw Object.assign(new Error(body.error),body)}
      const text=await response.text();downloadFile((scope==='library'?'导师候选库':snapshot?current.current?.snapshots.find(item=>item.id===snapshot)?.name||'导师对比报告':'导师对比报告').replace(/[\\/:*?"<>|]/g,'_')+'.'+format,text,response.headers.get('content-type'));setMessage('报告已下载')
    }catch(e){fail(e)}
  },[fail])
  const requireFeature=()=>true
  const value={state,pending:Boolean(pending),error,message,view,requiredTier,plan:state?planById():null,open,back:()=>setView(previousView.current),close:()=>setView(null),setView,setError,setMessage,refresh,mutate,saveMentor,addCompare,exportReport,fail,requireFeature}
  return <Context.Provider value={value}>{children}</Context.Provider>
}

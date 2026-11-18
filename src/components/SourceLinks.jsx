import React from 'react'
import {BookOpen,ChevronDown} from 'lucide-react'
import {sourceName} from '../../lib/presentation.js'

export default function SourceLinks({sources=[],onSources}){
  if(!sources.length)return null
  return <details className="source-links">
    <summary><BookOpen size={13}/><span>来源</span><small>{sources.length}</small><ChevronDown size={12}/></summary>
    <div>{sources.map(source=><button key={source.id} title={source.title} onClick={()=>onSources?.(source.id)}>{source.url?sourceName(source):source.scope||sourceName(source)}</button>)}</div>
  </details>
}

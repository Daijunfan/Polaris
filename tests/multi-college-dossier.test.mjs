import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {createHash} from 'node:crypto'
import {loadData} from '../lib/data.js'
import {normalizeProfile} from '../lib/profile.js'
import {createMentorIndex} from '../lib/search.js'
import {createStore} from '../server/store.js'
import {createWorkbench} from '../server/workbench.js'
import {createApplication} from '../server/index.mjs'
import {createConfig} from '../server/config.js'

const data=loadData()
const index=createMentorIndex(data)

// 与 createMentorIndex / createApplication 相同的学院归一化与身份规则。
const normalizeCollege=college=>(data.metadata.colleges||[]).find(name=>college?.startsWith(name+'（')||college?.startsWith(name+'('))||college
const rowIdentity=row=>row.mentor_id||`${row.college}:${row.name}`
const personKey=person=>person.mentor_id||'candidate-'+createHash('sha256').update((person.college||'')+':'+person.name).digest('hex').slice(0,12)
const indexByKey=new Map(index.rows.map(row=>[rowIdentity(row),row]))
const rowForProfile=profile=>indexByKey.get(profile.mentor_id||`${normalizeCollege(profile.college)}:${profile.name}`)
const collegeSegments=college=>String(college||'').split(/[、,，]+/).map(part=>normalizeCollege(part.trim())).filter(Boolean)

async function withWorkbench(run){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'多学院档案-'))
  try{return await run(createWorkbench({store:createStore(dir),data}),dir)}
  finally{await fs.rm(dir,{recursive:true,force:true})}
}

// 目录只返回一页，商业排序必须翻完所有页后才能证明是全量服务端排序。
function collectDirectory(board,sort){
  let offset=0,first=null
  const rows=[]
  for(;;){
    const page=board.directory('','',offset,sort)
    if(!first)first=page
    else assert.equal(page.total,first.total,'分页过程中总数不能变化')
    assert.equal(page.offset,offset)
    rows.push(...page.rows)
    if(page.next_offset==null)break
    assert.equal(page.next_offset,offset+30)
    offset=page.next_offset
  }
  return {total:first.total,rows}
}

test('择导画像完整保留全部 14 个学院，不被截断为 8 个',()=>{
  const colleges=data.metadata.profile_colleges
  assert.equal(colleges.length,14)
  const profile=normalizeProfile({colleges})
  assert.notEqual(profile.colleges.length,8)
  assert.equal(profile.colleges.length,14)
  assert.deepEqual(profile.colleges,colleges)
  assert.equal(new Set(profile.colleges).size,14)
  // 去重、去空白和乱序不能丢掉任何已收录学院。
  const shuffled=normalizeProfile({colleges:[...colleges].reverse().concat('  计算机学院  ','','信息与通信工程学院')})
  assert.equal(shuffled.colleges.length,14)
  assert.deepEqual(new Set(shuffled.colleges),new Set(colleges))
})

test('非精评学院的官网导师在导师索引中完整暴露职称与研究领域',()=>{
  const colleges=['信息与通信工程学院','电子工程学院','经济管理学院']
  const exposed=[]

  for(const college of colleges){
    const profiles=data.profiles.filter(profile=>profile.college===college&&profile.source_type==='学校官网')
    assert.ok(profiles.length>=80,`${college} 应有足量官网导师`)

    const groups=new Map()
    for(const profile of profiles){
      const row=rowForProfile(profile)
      assert.ok(row,`${college}/${profile.name} 的官网资料应进入导师索引`)
      assert.equal(row.name,profile.name)
      for(const field of ['professional_title','research_areas','academic_summary'])assert.ok(field in row,`${college}/${profile.name} 缺少 ${field}`)
      if(!groups.has(row))groups.set(row,[])
      groups.get(row).push(profile)
    }

    const rows=[...groups.keys()]
    for(const [row,group] of groups){
      const titles=group.map(profile=>profile.professional_title).filter(Boolean)
      const areas=group.map(profile=>profile.research_areas).filter(Boolean)
      if(titles.length){
        assert.ok(row.professional_title,`${college}/${row.name} 应暴露 professional_title`)
        assert.ok(titles.includes(row.professional_title),`${college}/${row.name} 的职称不能被改写`)
      }else assert.equal(row.professional_title,null)
      if(areas.length){
        assert.ok(row.research_areas,`${college}/${row.name} 应暴露 research_areas`)
        assert.ok(areas.includes(row.research_areas),`${college}/${row.name} 的研究领域不能被改写`)
      }else assert.equal(row.research_areas,null)
      const descriptive=group.some(profile=>profile.professional_title||profile.research_areas||profile.biography||profile.projects||profile.achievements||profile.team_description)
      if(descriptive)assert.ok(row.professional_title||row.research_areas||row.academic_summary,`${college}/${row.name} 的官网资料不应在索引中丢失`)
    }

    const withTitle=rows.filter(row=>row.professional_title).length
    const withResearch=rows.filter(row=>row.research_areas||row.academic_summary).length
    assert.ok(withTitle>=Math.floor(rows.length*0.8),`${college} 职称覆盖 ${withTitle}/${rows.length}`)
    assert.ok(withResearch>=Math.floor(rows.length*0.9),`${college} 研究资料覆盖 ${withResearch}/${rows.length}`)
    exposed.push(...rows)
  }

  // 具体样本：官网上的职称与研究领域必须原样出现，而不是被截断或置空。
  for(const [name,college] of [['崔嘉斌','信息与通信工程学院'],['鲍霖','电子工程学院'],['曾雪云','经济管理学院']]){
    const profile=data.profiles.find(item=>item.name===name&&item.college===college&&item.source_type==='学校官网')
    assert.ok(profile,`${name} 应有官网资料`)
    const row=rowForProfile(profile)
    assert.ok(row?.professional_title,`${name} 应暴露职称`)
    assert.ok(row?.research_areas,`${name} 应暴露研究领域`)
    assert.equal(row.professional_title,profile.professional_title)
    assert.equal(row.research_areas,profile.research_areas)
  }
  assert.ok(exposed.length>=450,`三个非精评学院应覆盖大量导师，实际 ${exposed.length}`)
})

test('工作台目录按学院返回完整档案，并对全量导师执行服务端 rating/name 排序',async()=>withWorkbench(board=>{
  const college='信息与通信工程学院'
  const page=board.directory('',college)
  assert.ok(page.rows.length>0,'信息与通信工程学院目录不应为空')
  assert.ok(page.total>=page.rows.length)
  for(const row of page.rows){
    for(const field of ['professional_title','research_areas','academic_summary'])assert.ok(field in row,`目录行缺少 ${field}`)
    assert.ok(row.research_areas||row.academic_summary,`${row.name} 的官网研究资料不应丢失`)
    assert.ok(collegeSegments(row.college).includes(college),`${row.name} 不应出现在其他学院目录中`)
  }
  const sample=page.rows.find(row=>row.name==='曹傧')
  assert.ok(sample,'目录应包含信息与通信工程学院的官网导师')
  assert.equal(sample.professional_title,'教授')
  assert.match(sample.research_areas,/信息理论/)

  // 全量 rating 排序：评分降序，同分时博导优先，再按中文姓名稳定排序。
  const byRating=collectDirectory(board,'rating')
  assert.equal(byRating.total,index.rows.length)
  assert.equal(byRating.rows.length,index.rows.length)
  assert.equal(new Set(byRating.rows.map(row=>row.key)).size,index.rows.length,'排序分页不能重复或遗漏导师')
  const ratingOrder=(a,b)=>(b.rating??-1)-(a.rating??-1)||(b.can_supervise_doctoral?1:0)-(a.can_supervise_doctoral?1:0)||a.name.localeCompare(b.name,'zh-CN')
  assert.deepEqual(byRating.rows.map(row=>row.key),index.rows.toSorted(ratingOrder).map(personKey))
  for(let i=1;i<byRating.rows.length;i++)assert.ok(ratingOrder(byRating.rows[i-1],byRating.rows[i])<=0,`rating 排序在第 ${i} 行失效`)

  // 全量 name 排序：按 zh-CN 姓名升序，翻页后仍保持全局有序。
  const byName=collectDirectory(board,'name')
  assert.equal(byName.total,index.rows.length)
  assert.equal(byName.rows.length,index.rows.length)
  assert.equal(new Set(byName.rows.map(row=>row.key)).size,index.rows.length,'name 排序分页不能重复或遗漏导师')
  assert.deepEqual(byName.rows.map(row=>row.key),index.rows.toSorted((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(personKey))
  for(let i=1;i<byName.rows.length;i++)assert.ok(byName.rows[i-1].name.localeCompare(byName.rows[i].name,'zh-CN')<=0,`name 排序在第 ${i} 行失效`)
}))

test('HTTP insights 将括号学院归一化，并为全量官网导师提供 title/homepage/biography',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'多学院洞察-'))
  const store=createStore(dir)
  const app=createApplication({store,data,config:createConfig(store,{})})
  const server=http.createServer(app.handler)
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  const base='http://127.0.0.1:'+server.address().port

  try{
    const response=await fetch(base+'/api/insights')
    assert.equal(response.status,200)
    const payload=await response.json()
    const entries=Object.entries(payload.mentors)
    assert.ok(Object.keys(payload.mentors).length>=1300,`洞察应覆盖至少 1300 位导师，实际 ${entries.length}`)
    assert.equal(payload.count,entries.length)
    const keyCollege=key=>key.slice(0,key.indexOf(':'))
    assert.ok(entries.every(([key])=>!keyCollege(key).includes('（')&&!keyCollege(key).includes('(')),'洞察键的学院部分不应保留括号学院名')

    // 括号学院必须归一到基名，并保持其官网元数据。
    const bracket=data.profiles.filter(profile=>profile.college==='计算机学院（国家示范性软件学院）')
    assert.ok(bracket.length>100)
    const mapped=[]
    for(const profile of bracket){
      const row=rowForProfile(profile)
      assert.ok(row,`括号学院导师 ${profile.name} 应进入导师索引`)
      if(row.college!=='计算机学院')continue
      const mentor=payload.mentors[`计算机学院:${row.name}`]
      assert.ok(mentor,`计算机学院:${row.name} 应由括号学院归一化得到`)
      assert.equal(mentor.college,'计算机学院')
      assert.equal(mentor.name,row.name)
      assert.ok(mentor.homepage,`${row.name} 应保留官网 homepage`)
      mapped.push({profile,row,mentor})
    }
    assert.ok(mapped.length>=100,`括号学院应映射到大量计算机学院导师，实际 ${mapped.length}`)
    assert.ok(mapped.filter(({mentor})=>mentor.title).length>=mapped.length*0.8)
    assert.ok(mapped.filter(({mentor})=>mentor.biography).length>=25)
    assert.ok(mapped.filter(({mentor})=>mentor.directions).length>=mapped.length*0.8)

    // 具体括号学院样本：学院、职称、主页与简介均来自官网资料。
    const baiting=data.profiles.find(profile=>profile.name==='白婷'&&profile.college==='计算机学院（国家示范性软件学院）')
    assert.ok(baiting)
    const baitingMentor=payload.mentors['计算机学院:白婷']
    assert.ok(baitingMentor,'白婷 应以归一化学院键暴露')
    assert.equal(baitingMentor.college,'计算机学院')
    assert.equal(baitingMentor.title,baiting.professional_title)
    assert.equal(baitingMentor.homepage,baiting.url)
    assert.equal(baitingMentor.biography,baiting.biography.slice(0,480))
    assert.equal(baitingMentor.directions,baiting.research_areas)

    // 非精评学院的官网导师同样通过 HTTP 拿到完整官网元数据。
    for(const [name,college] of [['崔嘉斌','信息与通信工程学院'],['鲍霖','电子工程学院'],['曾雪云','经济管理学院']]){
      const profile=data.profiles.find(item=>item.name===name&&item.college===college&&item.source_type==='学校官网')
      assert.ok(profile,`${name} 应有官网资料`)
      const mentor=payload.mentors[`${college}:${name}`]
      assert.ok(mentor,`${name} 应出现在洞察中`)
      assert.equal(mentor.title,profile.professional_title)
      assert.equal(mentor.homepage,profile.url)
      assert.equal(mentor.biography,profile.biography.slice(0,480))
      assert.ok(mentor.title&&mentor.homepage&&mentor.biography)
    }

    // 全量核对：官网唯一导师的标题/主页/简介与原始抓取资料逐字一致。
    const official=data.profiles.filter(profile=>profile.source_type==='学校官网')
    const groups=new Map()
    for(const profile of official){
      const row=rowForProfile(profile)
      assert.ok(row,`官网导师 ${profile.name} 应进入导师索引`)
      const key=`${row.college}:${row.name}`
      if(!groups.has(key))groups.set(key,[])
      groups.get(key).push(profile)
    }
    for(const [key,profiles] of groups){
      const mentor=payload.mentors[key]
      assert.ok(mentor,`洞察应包含官网导师 ${key}`)
      assert.ok(mentor.homepage,`${key} 应保留主页`)
      if(profiles.length!==1)continue
      const profile=profiles[0]
      assert.equal(mentor.title??null,profile.professional_title??null,`${key} 职称应与官网一致`)
      assert.equal(mentor.homepage,profile.url,`${key} 主页应与官网一致`)
      assert.equal(mentor.biography??null,profile.biography?.slice(0,480)??null,`${key} 简介应与官网一致`)
    }
    assert.ok(entries.filter(([,mentor])=>mentor.title).length>=1000)
    assert.ok(entries.filter(([,mentor])=>mentor.homepage).length>=1200)
    assert.ok(entries.filter(([,mentor])=>mentor.biography).length>=300)
  }finally{
    await app.cancelAll()
    server.closeAllConnections()
    await new Promise(resolve=>server.close(resolve))
    await fs.rm(dir,{recursive:true,force:true})
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseOfficialProfile, parseSupplement } from '../scripts/web-pages.mjs'
import { loadData,readSealedDataset,resolveProfileMentor } from '../lib/data.js'
import { createToolRuntime } from '../lib/tools.js'
import { publicMessage, publicSource, publicWebUrl } from '../lib/presentation.js'
import {messageMarkdown,sourcesMarkdown} from '../src/presentation.js'

test('官网解析只取个人方向及可见介绍，排除模板和隐藏内容',()=>{
  const row=parseOfficialProfile(`<div id="teacherName">测试老师</div><div id="technicalTitle">教授</div><div class="mentorType">导师类别：硕士生导师</div><div id="LXFS"><p id="collegeName">所属院系：网络空间安全学院</p><p id="specialtyName">所属专业：网络空间安全</p><p>邮箱：test@bupt.edu.cn</p></div><div class="teac-rightcon"><div id="GRJJ"><div class="info2"><p>测试老师从事系统安全研究。</p><p style="display:none">伪造的隐藏信息</p><script>恶意指令</script></div></div><div id="YJFX"><div id="researchDirection">系统安全,软件安全</div><div class="tab-article">机电结构优化与控制</div></div><div class="teac-bkcon"><div class="btwz"><span class="fontColor">指导学科</span></div><div class="info2">083900 网络空间安全</div></div></div>`,'https://bupt.teacher.360eol.com/teacherBasic/preview?teacherId=1')
  assert.equal(row.name,'测试老师')
  assert.equal(row.contact_email,'test@bupt.edu.cn')
  assert.equal(row.research_areas,'系统安全,软件安全')
  assert.match(row.admissions,/083900/)
  assert.doesNotMatch(JSON.stringify(row),/机电结构|隐藏信息|恶意指令/)
  assert.throws(()=>parseOfficialProfile('<html>访问验证</html>','https://example.org'),/不是可识别/)
})
test('多学院同名主页按学院绑定，保留既有跨院关联，不凭唯一姓名串联不同学院',()=>{
  const mentors=[{mentor_id:'net',name:'同名老师',college:'网络空间安全学院'},{mentor_id:'ai',name:'同名老师',college:'人工智能学院'},{mentor_id:'soft',name:'软件老师',college:'软件学院'}]
  assert.equal(resolveProfileMentor({name:'同名老师',college:'人工智能学院'},mentors),'ai')
  assert.equal(resolveProfileMentor({name:'同名老师',college:'其他学院'},mentors),null)
  assert.equal(resolveProfileMentor({name:'同名老师',college:'人工智能学院',mentor_id:'net'},mentors),'net')
  assert.equal(resolveProfileMentor({name:'软件老师',college:'计算机学院（国家示范性软件学院）'},mentors),'soft')
  assert.equal(resolveProfileMentor({name:'软件老师',college:'其他学院'},mentors),null)
})
test('官方个人主页可由校方域名和标题确认身份，第三方仍需正文确认学校',()=>{
  const seed={name:'测试老师',url:'https://teacher.bupt.edu.cn/test/zh_CN/index.htm',source_type:'学校官网',selector:'article',profile:true}
  const page='<title>测试老师的个人主页</title><article><h2>研究方向</h2><p>人工智能与系统安全</p></article>'
  assert.match(parseSupplement(page,seed).biography,/人工智能与系统安全/)
  assert.throws(()=>parseSupplement(page,{...seed,url:'https://other.example/test',source_type:'第三方资料'}),/未同时确认/)
})

test('第三方摘录验证身份，新闻中的其他老师方向不串入当前老师',()=>{
  const seed={name:'测试老师',url:'https://example.org/news/1',selector:'article',max_chars:200}
  const html='<article><p>北京邮电大学测试老师作系统安全报告。</p><p>测试老师的主要研究方向为系统安全。</p><p>另一老师的研究方向为量子光学。</p></article>'
  const row=parseSupplement(html,seed)
  assert.match(row.biography,/系统安全/)
  assert.doesNotMatch(row.biography,/另一老师|量子光学/)
  const paragraph=parseSupplement('<article><p>北京邮电大学另一老师讲解量子光学。北京邮电大学测试老师介绍系统安全。另一嘉宾介绍光学研究方向。</p></article>',seed)
  assert.match(paragraph.biography,/测试老师介绍系统安全/)
  assert.doesNotMatch(paragraph.biography,/量子光学|另一嘉宾/)
  const profile=parseSupplement('<article>测试老师，北京邮电大学教授。<p>研究领域:</p><p>系统安全、隐私保护</p></article>',{...seed,profile:true})
  assert.equal(profile.research_areas,'系统安全、隐私保护')
  assert.equal(row.published_at,null)
  assert.throws(()=>parseSupplement('<article>其他大学测试老师</article>',seed),/未同时确认/)
  assert.throws(()=>parseSupplement('<article>北京邮电大学别的老师</article>',seed),/未同时确认/)
})

test('真实网页快照可查询、关联历史导师及可视化，来源保持完整且不改变学生数据',()=>{
  const data=loadData(),web=readSealedDataset('web-profiles')
  const original=readSealedDataset('dataset')
  assert.ok(web.profiles.filter(row=>row.source_type==='学校官网').length>=1000)
  assert.ok(new Set(web.profiles.flatMap(row=>(row.college||'').split('、')).filter(Boolean)).size>=10)
  assert.ok(web.profiles.filter(row=>row.projects).length>=150)
  assert.ok(web.profiles.filter(row=>row.source_type==='第三方资料').length>=5)
  assert.equal(new Set(web.profiles.map(row=>row.url)).size,web.profiles.length)
  for(const row of data.profiles) {
    assert.ok(row.name)
    assert.ok(publicWebUrl(row.url))
    assert.ok(Number.isFinite(Date.parse(row.fetched_at)))
    assert.ok(row.source_ids.every(id=>data.sources.some(source=>source.id===id&&source.url===row.url)))
    assert.ok(!Object.keys(row).some(key=>/staffNo|userAccount|openid|telephone|birthday|student_id/.test(key)))
    if(row.mentor_id)assert.equal(data.mentors.find(mentor=>mentor.mentor_id===row.mentor_id)?.name,row.name)
  }
  const manual=readSealedDataset('mentor-notes'),manualIds=new Set(manual.sources.map(source=>source.id))
  const expected=original.mentors.map(mentor=>({...mentor,group_context:manual.notes.some(note=>note.name===mentor.name&&note.group_context===null)?null:mentor.group_context,personal_directions:manual.notes.findLast(note=>note.name===mentor.name&&note.personal_directions)?.personal_directions||mentor.personal_directions}))
  const originalIds=new Set(original.mentors.map(mentor=>mentor.mentor_id))
  const own=data.mentors.find(mentor=>mentor.name==='杨文川')
  assert.equal(own.group_context,null);assert.match(own.review_text,/杨文川本人直接指导/)
  const storedFields=({management,internship,graduation,group_context,...mentor})=>mentor
  assert.deepEqual(data.mentors.filter(mentor=>originalIds.has(mentor.mentor_id)).map(({mentor_note,...mentor})=>storedFields({...mentor,...(mentor.mentor_id===own.mentor_id?{group_context:original.mentors.find(row=>row.mentor_id===own.mentor_id).group_context}:{}),source_ids:mentor.source_ids.filter(id=>!manualIds.has(id))})),expected.map(storedFields))
  const fu=data.mentors.find(row=>row.name==='付俊松')
  assert.match(fu.mentor_note,/本人直接(?:指导|带学生)/)
  assert.match(fu.mentor_note,/本校保研|北航/)
  assert.match(fu.mentor_note,/统考名额非常少.*1个左右/)
  assert.ok(fu.source_ids.some(id=>manualIds.has(id)))
  assert.equal(new Set(data.sources.map(source=>source.id)).size,data.sources.length)
  assert.equal(data.students.length,original.students.length)
  assert.equal(data.students.filter(row=>row.admission_type==='exam').length,118)
  const runtime=createToolRuntime(data),catalog=runtime.execute('catalog')
  assert.ok(catalog.datasets.some(dataset=>dataset.name==='profiles'&&dataset.count===web.profiles.length))
  assert.ok(catalog.sources.length<=12)
  const first=runtime.execute('query',{from:'profiles',limit:1}),second=runtime.execute('query',{from:'profiles',limit:1,offset:1})
  assert.deepEqual(first.sources.map(source=>source.id),data.profiles[0].source_ids)
  assert.deepEqual(second.sources.map(source=>source.id),data.profiles[1].source_ids)
  const profiles=runtime.execute('query',{from:'profiles',filters:[{field:'name',op:'eq',value:'付俊松'},{field:'source_type',op:'eq',value:'学校官网'}]})
  assert.equal(profiles.rows.length,1)
  assert.equal(profiles.rows[0].contact_email,'fujs@bupt.edu.cn')
  assert.doesNotMatch(profiles.rows[0].research_areas,/大模型/)
  const mixed=runtime.execute('query',{from:'profiles',filters:[{field:'name',op:'eq',value:'付俊松'}],select:['name','source_type','professional_title'],limit:100})
  const officialOnly=runtime.execute('query',{from:mixed.ref,filters:[{field:'source_type',op:'eq',value:'学校官网'}],select:['name','professional_title']})
  assert.equal(officialOnly.sources.length,1)
  assert.equal(officialOnly.sources[0].kind,'学校官网')
  const piped=runtime.acceptInput(mixed)
  const pipedOfficial=runtime.execute('query',{from:piped,filters:[{field:'source_type',op:'eq',value:'学校官网'}],select:['name']})
  assert.deepEqual(pipedOfficial.sources,officialOnly.sources)
  const joined=runtime.execute('join',{left:profiles.ref,right:'mentors',left_on:'name',right_on:'name',select:['name','research_areas','contact_email','rating']})
  assert.equal(joined.rows[0].rating,5)
  const view=runtime.execute('visualize',{from:profiles.ref,type:'table',title:'付俊松官网介绍'})
  const shown=publicMessage({role:'assistant',content:`公开邮箱见 [${profiles.sources[0].id}]`,artifacts:[view.artifact],sources:profiles.sources})
  assert.ok(shown.sources[0].url.startsWith('https://bupt.teacher.360eol.com/teacherBasic/preview?'))
  assert.ok(shown.artifacts[0].rows[0].contact_email)
  assert.doesNotMatch(JSON.stringify(shown),/profile_id|mentor_id|source_locator|file_path/)
})

test('个人方向补充可直接筛选并追溯来源，付俊松的四个具体方向都可查到',()=>{
  const data=loadData(),runtime=createToolRuntime(data)
  for(const keyword of ['网络武器研发','漏洞挖掘','4G','5G','逆向']) {
    const result=runtime.execute('query',{from:'mentors',filters:[{field:'personal_directions',op:'contains',value:keyword}],select:['name','personal_directions'],limit:5000})
    assert.ok(result.rows.some(row=>row.name==='付俊松'),keyword)
    assert.ok(result.sources.some(source=>source.id==='S136'))
  }
  const fu=data.mentors.find(mentor=>mentor.name==='付俊松')
  assert.doesNotMatch(fu.personal_directions,/大模型安全/)
  assert.deepEqual([fu.rating,fu.stipend_monthly_min,fu.student_count,fu.exam_count,fu.recommended_count],[5,2000,4,1,3])
})

test('网页来源只展示公开链接及日期，不携带底层字段',()=>{
  const source=publicSource({id:'S8',title:'教师主页',kind:'学校官网',url:'https://example.org/teacher/1',publisher:'学校',fetched_at:'2026-11-13T00:00:00Z',published_at:null,file:'/private/source.html',args:{q:1}})
  assert.equal(source.url,'https://example.org/teacher/1')
  assert.equal(source.published_at,null)
  assert.equal(source.file,undefined)
  assert.equal(source.args,undefined)
  for(const url of['javascript:alert(1)','file:///Users/private/key','http://127.0.0.1:3210/api/config','https://user:password@example.org/'])assert.equal(publicWebUrl(url),null)
  const copied=messageMarkdown({role:'assistant',content:'公开介绍 [S8]',sources:[source],artifacts:[]})
  assert.match(copied,/\[教师主页\]\(https:\/\/example.org\/teacher\/1\)/)
  assert.doesNotMatch(copied,/null|undefined|\/private/)
  assert.equal(sourcesMarkdown([source,source]).match(/example.org/g).length,1)
})

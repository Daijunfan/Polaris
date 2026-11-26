import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { pageDocument, parseOfficialProfile, parseSupplement } from './web-pages.mjs'
import { loadData, readSealedDataset, resolveProfileMentor } from '../lib/data.js'
import { sealSingleVault } from './seal-data.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)), cache = path.join(root, '.local/web-cache')
const plaintextDir = path.join(root, '.local', 'plaintext-data')
const target = path.join(plaintextDir, 'web-profiles.json'), refresh = process.argv.includes('--refresh')
const onlyAt=process.argv.indexOf('--only'),only=onlyAt<0?null:new Set((process.argv[onlyAt+1]||'').split(/[，,]/).map(name=>name.trim()).filter(Boolean))
if(only&&!only.size)throw new Error('--only 后填写导师姓名，多个姓名用逗号分隔')
const seedsOnly=process.argv.includes('--seeds-only')
const officialRoot = 'https://bupt.teacher.360eol.com', directory = `${officialRoot}/teacher/teacherList`,catalog=loadData()
if (catalog?.metadata?.vault_locked) {
  throw new Error('导师加密库处于锁定状态，无法执行网页抓取；请先解锁或移除 POLARIS_FORCE_LOCK')
}
async function readJsonOrSealed(name, fallback, required = false) {
  const plaintextPath = path.join(plaintextDir, `${name}.json`)
  try {
    return JSON.parse(await fs.readFile(plaintextPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const sealed = readSealedDataset(name)
  if (sealed != null) return sealed
  if (required) throw new Error(`缺少必需的数据集：${name}（.local/plaintext-data/${name}.json 或 data/${name}.vault）`)
  return fallback
}
await fs.mkdir(plaintextDir, { recursive: true })
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version
const old = await readJsonOrSealed('web-profiles', { profiles: [], sources: [] })
const oldPages = new Map(old.profiles.map(row => [row.url, row])), sources = new Map(old.sources.map(source => [source.url, source]))
const mentorNotes = await readJsonOrSealed('mentor-notes', { sources: [], notes: [] }, true)
const imported = await readJsonOrSealed('pdf-reviews', { sources: [] })
let nextSource = Math.max(3, ...old.sources.map(source => Number(source.id.slice(1))),...mentorNotes.sources.map(source=>Number(source.id.slice(1))),...imported.sources.map(source=>Number(source.id.slice(1)))) + 1
const report = { started_at: new Date().toISOString(), directories: [], failures: [], retained: [], skipped: [] }
await fs.mkdir(cache, { recursive: true })

async function fetchPage(url, options = {}) {
  const key = createHash('sha256').update(url + (options.body || '')).digest('hex'), file = path.join(cache, `${key}.json`)
  const cached = await fs.readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (!refresh && cached && Date.now() - Date.parse(cached.fetched_at) < 86400000) return cached
  const response = await fetch(url, { ...options, headers: { 'user-agent': `polaris-mentor/${version} (public teacher profile collection)`, ...options.headers }, signal: AbortSignal.timeout(25000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer()), declared = response.headers.get('content-type')?.match(/charset=([\w-]+)/i)?.[1]
  let body = new TextDecoder(declared || 'utf-8').decode(bytes)
  if(new URL(url).pathname.startsWith('/teacher/ajax/')) {
    const list=JSON.parse(body)
    body=JSON.stringify({code:list.code,count:list.count,data:list.data?.map(({id,name})=>({id,name}))})
  }
  const result = { body, fetched_at: new Date().toISOString(), url: response.url }
  await fs.writeFile(file, JSON.stringify(result), { mode: 0o600 })
  await delay(100)
  return result
}

const tasks = new Map()
function queue(seed) {
  if(only&&!only.has(seed.name))return
  const previous=tasks.get(seed.url)
  if(!previous)tasks.set(seed.url,seed)
  else if(seed.directory_college)previous.directory_college=[...new Set([previous.directory_college,seed.directory_college].filter(Boolean))].join('、')
}
if(!seedsOnly){
const directoryPage=await fetchPage(directory),$directory=pageDocument(directoryPage.body)
const colleges=$directory('a[data-option-name="collegeId"]').map((_,element)=>({name:$directory(element).text().trim(),id:$directory(element).attr('data-option')})).get().filter(college=>college.id&&college.id!=='0'&&college.name)
if(!colleges.length)throw new Error('未识别到官方导师目录，未改动现有快照')
for(const college of colleges){
 let expected = null, found = 0
 for (let page = 1; expected == null || found < expected; page++) {
  const url = `${officialRoot}/teacher/ajax/getTeacherData`, params = new URLSearchParams({ page: String(page), limit: '100', collegeId: college.id })
  const result = await fetchPage(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() })
  const list = JSON.parse(result.body)
  if (list.code !== 0 || !Array.isArray(list.data)) throw new Error('官方目录未返回有效的导师分页，未改动现有快照')
  if (page === 1 && list.count === 0 && !list.data.length) { expected = 0; break }
  if (!list.data.length) throw new Error('官方目录未返回有效的导师分页，未改动现有快照')
  expected = list.count; found += list.data.length
  for (const teacher of list.data) {
    if (!teacher.name?.trim()) { report.skipped.push({ directory, reason: '空姓名条目' }); continue }
    queue({ name: teacher.name.trim(), url: `${officialRoot}/teacherBasic/preview?teacherId=${teacher.id}`, source_type: '学校官网', publisher: '北京邮电大学研究生招生办公室', parser: 'official',directory_college:college.name })
  }
 }
 report.directories.push({ url: `${directory}?collegeId=${college.id}`,college:college.name, expected, received: found })
}

// Fill exact historical names from the same public university search, without guessing aliases.
const listed=new Set([...tasks.values()].map(seed=>seed.name))
for(const mentor of catalog.mentors.filter(row=>!listed.has(row.name)&&!/[（(]/.test(row.name))) {
  const url=`${officialRoot}/teacher/ajax/searchTeacher`
  try {
    const fetched=await fetchPage(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({page:'1',limit:'100',keyword:mentor.name}).toString()})
    const result=JSON.parse(fetched.body)
    for(const teacher of result.data||[])if(teacher.name?.trim()===mentor.name)queue({name:mentor.name,url:`${officialRoot}/teacherBasic/preview?teacherId=${teacher.id}`,source_type:'学校官网',publisher:'北京邮电大学研究生招生办公室',parser:'official'})
  }catch(error){report.failures.push({name:mentor.name,url:directory,error:error.message})}
}

// The Future College directory also links teacher-owned BUPT pages not in the graduate directory.
const future = 'https://future.bupt.edu.cn/sztd1/kydstd1/wlkjaqxy.htm', pending = [future], visited = new Set()
while (pending.length) {
  const url = pending.shift()
  if (visited.has(url)) continue
  visited.add(url)
  try {
    const result = await fetchPage(url), $ = pageDocument(result.body)
    const pageCollege=catalog.metadata.colleges.find(college=>$('title').text().includes(college))||'网络空间安全学院'
    const directoryCollege=colleges.find(college=>college.name.includes(pageCollege))?.name||pageCollege
    $('li[id^="line_"] a').each((_, element) => {
      const name = $(element).attr('title')?.trim(), href = $(element).attr('href')
      if (name && href&&href!=='#'&&/^[\u4e00-\u9fff]{2,4}$/.test(name)) queue({ name, url: new URL(href, url).href, source_type: '学校官网', publisher: '北京邮电大学教师主页', parser: 'teacher', selector: '#vsb_content, #vsb_content_2, .personal_info, .personalProfile, .introduce', directory_url: url,college:directoryCollege,directory_college:directoryCollege,profile:true,max_chars:6000 })
    })
    $('a[href]').each((_,element)=>{
      const text=$(element).text().trim(),link=new URL($(element).attr('href'),url)
      if(catalog.metadata.colleges.some(college=>text.includes(college))&&link.hostname==='future.bupt.edu.cn'&&link.pathname.includes('/sztd1/kydstd1/')&&!visited.has(link.href))pending.push(link.href)
    })
    $('.pagination a').each((_, element) => { const link = new URL($(element).attr('href'), url).href; if (!visited.has(link)) pending.push(link) })
  } catch (error) { report.failures.push({ url, error: error.message }) }
}
report.directories.push({ url: future, pages: visited.size })

}

const seeds = await readJsonOrSealed('web-seeds', [], true)
for (const seed of seeds) queue({ ...seed, parser: 'supplement' })
const rows = []
const jobs = [...tasks.values()]
async function worker() {
  while (jobs.length) {
    const seed = jobs.shift()
    try {
      const fetched = await fetchPage(seed.url)
      const parsed = seed.parser === 'official' ? parseOfficialProfile(fetched.body, seed.url) : parseSupplement(fetched.body, seed)
      if (parsed.name !== seed.name) throw new Error(`目录姓名与主页不一致：${seed.name}`)
      let source = sources.get(seed.url)
      if (!source) source = { id: `S${nextSource++}` }
      source = { ...source, title: parsed.page_title, kind: seed.source_type, publisher: seed.publisher, scope: parsed.name, url: seed.url, published_at: parsed.published_at || null, fetched_at: fetched.fetched_at, year: parsed.published_at?.slice(0, 4) || null }
      sources.set(seed.url, source)
      const profile={ ...parsed,directory_college:seed.directory_college||oldPages.get(seed.url)?.directory_college||null, profile_id: `profile-${createHash('sha256').update(seed.url).digest('hex').slice(0, 12)}`, source_type: seed.source_type, publisher: seed.publisher, fetched_at: fetched.fetched_at, published_at: parsed.published_at || null, source_ids: [source.id],mentor_id:oldPages.get(seed.url)?.mentor_id||null }
      profile.mentor_id=resolveProfileMentor(profile,catalog.mentors)
      rows.push(profile)
    } catch (error) {
      report.failures.push({ name: seed.name, url: seed.url, error: error.message })
      if (oldPages.has(seed.url)) { rows.push(oldPages.get(seed.url)); report.retained.push(seed.url) }
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))
const fetchedUrls=new Set(rows.map(row=>row.url))
for(const row of oldPages.values())if(!fetchedUrls.has(row.url)){rows.push(row);report.retained.push(row.url)}
if (!rows.some(row => row.source_type === '学校官网')) throw new Error('未抓到任何有效官方介绍，未改动现有快照')
rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.url.localeCompare(b.url))
const used = new Set(rows.flatMap(row => row.source_ids))
const snapshot = { version: 1, updated_at: new Date().toISOString(), directory_url: directory, profiles: rows, sources: [...sources.values()].filter(source => used.has(source.id)).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))) }
await fs.writeFile(`${target}.next`, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 })
await fs.rename(`${target}.next`, target)
if (!process.argv.includes('--no-seal')) {
  sealSingleVault('web-profiles', { custom: process.argv.includes('--custom') })
}
report.finished_at = snapshot.updated_at
report.profiles = rows.length; report.teachers = new Set(rows.map(row => row.name)).size
report.official = rows.filter(row => row.source_type === '学校官网').length
report.third_party = rows.filter(row => row.source_type !== '学校官网').length
await fs.writeFile(path.join(cache, 'last-run.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
console.log(JSON.stringify(report, null, 2))

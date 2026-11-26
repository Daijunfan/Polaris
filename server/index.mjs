import {APP_NAME} from '../lib/brand.js'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { publicActivity,publicArtifact, publicMessage, publicSource, publicSourceContent, publicText, publicTool } from '../lib/presentation.js'
import { loadData } from '../lib/data.js'
import {
  getRuntimeVaultState,
  isVaultConfigured,
  restoreRuntimeVaultState,
  setRuntimeVaultKey,
  unlockBuiltinRuntime,
  verifyVaultKey,
  vaultFilePath,
  VAULT_NAMES,
} from '../lib/vault.js'
import {answerPolicy} from '../lib/answer-policy.js'
import { createToolRuntime, toolDefinitions } from '../lib/tools.js'
import { createStore } from './store.js'
import { createConfig } from './config.js'
import { chooseModel, discoverModels, testConnection } from './provider.js'
import { runAgent } from './agent.js'
import {visibleHistory} from './context.js'
import {createWorkbench} from './workbench.js'
import {workbenchToolDefinition,profileToolDefinition} from './workbench-tool.js'
import {createProfiles} from './profile.js'
import {createExportService} from './export.js'
import {createMentorIndex} from '../lib/search.js'
import {mentorInsight} from '../lib/insights.js'
import {profileOptions} from '../lib/profile.js'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const version = JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
async function readBody(req) {
  let size = 0, chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('请求内容不能超过 1 MB')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') }
  catch { throw new Error('请求体需要是合法 JSON') }
}

export function createApplication({ data = loadData(), store = createStore(), config = createConfig(store), frontend, staticDirectory = dist, reload = () => loadData(), vaultDir } = {}) {
  const active = new Map(), profiles = createProfiles(store)
  let currentData = data
  let apiTools, workbench, insightCache = null, revisionCounter = 0, dataRevision
  const exportService = createExportService({ store, getData: () => currentData, getWorkbench: () => workbench, getProfile: () => profiles.read() })
  function computeRevision(nextData, nextTools, counter) {
    return createHash('sha256').update(JSON.stringify({
      version,
      execution: 'ordinary-chat-v9',
      revision: counter,
      data: nextData,
      tools: toolDefinitions,
      catalog: nextTools.execute('catalog').datasets,
      answerPolicy,
    })).digest('hex')
  }
  function applyData(nextData) {
    currentData = nextData
    apiTools = createToolRuntime(currentData)
    workbench = createWorkbench({ store, data: currentData })
    insightCache = null
    dataRevision = computeRevision(currentData, apiTools, revisionCounter)
  }
  function reloadData() {
    const nextData = reload()
    revisionCounter += 1
    applyData(nextData)
  }
  applyData(data)
  function insights(){
    if(insightCache)return insightCache
    const names=[...new Set(currentData.mentors.map(mentor=>mentor.name))]
    const pages=new Map()
    const normalizeCollege=college=>(currentData.metadata?.colleges||[]).find(name=>college?.startsWith(name+'（')||college?.startsWith(name+'('))||college
    for(const page of currentData.profiles||[]){
      const normCollege=normalizeCollege(page.college)
      for(const key of [page.mentor_id,`${normCollege}:${page.name}`,`${page.college}:${page.name}`].filter(Boolean)){
        if(!pages.has(key)||page.source_type==='学校官网')pages.set(key,page)
      }
    }
    const mentors={}
    for(const row of createMentorIndex(currentData).rows){
      const insight=mentorInsight(row,names),page=pages.get(row.mentor_id)||pages.get(`${row.college}:${row.name}`)
      const doctoralPrograms=[page?.doctoral_academic&&`学博：${page.doctoral_academic}`,page?.doctoral_professional&&`专博：${page.doctoral_professional}`].filter(Boolean).join(' · ')||null
      mentors[`${row.college}:${row.name}`]={key:row.mentor_id||'candidate-'+createHash('sha256').update((row.college||'')+':'+row.name).digest('hex').slice(0,12),name:row.name,college:row.college,group:row.group||null,rating:row.rating??null,doctoral:Boolean(row.can_supervise_doctoral),doctoralPrograms,title:page?.professional_title||row.professional_title||null,email:page?.contact_email||null,homepage:page?.source_type==='学校官网'?page.url:null,directions:row.personal_directions||page?.research_areas||row.research_areas||row.directions||null,academicSummary:row.academic_summary||null,enrollmentSignal:row.enrollment_signal||null,biography:page?.biography?.slice(0,480)||null,projects:page?.projects?.slice(0,520)||null,achievements:page?.achievements?.slice(0,520)||null,admissions:page?.admissions?.slice(0,260)||null,scoreFirstMax:row.score_first_max??null,students:row.student_count??null,exam:row.exam_count??null,recommended:row.recommended_count??null,...insight}
    }
    return insightCache={mentors,count:Object.keys(mentors).length}
  }
  let shuttingDown = false
  const snapshot = chat => ({ ...store.publicChat(chat), running: active.has(chat.id) })
  function launch(chat, text, replacesMessageId) {
    if (shuttingDown) throw new Error('服务正在停止，请稍后继续')
    if (active.has(chat.id)) throw new Error('这条对话仍在生成，请稍候或先停止')
    const run = { controller: new AbortController(), sinks: new Set() }
    active.set(chat.id, run)
    let visibleText = ''
    const emit = (event, payload) => {
      if (event === 'start' || event === 'done') payload = { ...payload, message: publicMessage(payload.message,{question:chat.latestUserText}) }
      if (event === 'tool_start') payload = publicTool(payload)
      if (event === 'tool_end') payload = { tool: publicTool(payload.tool), sources: payload.sources.map(publicSource) }
      if (event === 'artifact') { payload = publicArtifact(payload,{question:chat.latestUserText}); if (!payload) return }
      if (event === 'delta') {
        const content = publicText(payload.content, { streaming: true,question:chat.latestUserText })
        payload = { content, text: content.startsWith(visibleText) ? content.slice(visibleText.length) : '' }
        visibleText = content
      }
      if (event === 'progress') { payload = { text: publicText(payload.text), content: publicText(payload.content), ...(payload.activity?{activity:payload.activity.map(publicActivity)}:{}) }; visibleText = payload.content }
      if (event === 'error') payload = { ...payload, error: publicText(payload.error) }
      for (const sink of run.sinks) sink(event, payload)
    }
    run.promise = Promise.resolve().then(() => runAgent({ chat, text, replacesMessageId, data: currentData, dataRevision, store,workbench,profiles, exportService, config: config.effective(), emit, signal: run.controller.signal }))
      .then(message => emit('done', { message, usage: chat.usage, chat: { ...snapshot(chat), running: false } }))
      .catch(error => emit('error', { error: run.controller.signal.reason === 'shutdown' ? '服务重启中断了生成，可以直接重试' : run.controller.signal.aborted ? '已停止生成' : config.redact(error.message), canceled: run.controller.signal.aborted, chat: { ...snapshot(chat), running: false } }))
      .finally(() => { active.delete(chat.id); emit('end') })
    return run
  }
  function attach(req, res, chat, run, initial = false) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.flushHeaders()
    const sink = (event, payload) => {
      if (event === 'end') { clearInterval(heartbeat); res.end(); return }
      if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
    }
    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keep-alive\n\n') }, 15000)
    if (run) run.sinks.add(sink)
    if (!initial) sink('sync', snapshot(chat))
    if (!run) { sink('done', { message: publicMessage(chat.messages.at(-1),{question:chat.latestUserText}), chat: snapshot(chat), usage: chat.usage }); sink('end'); return }
    res.on('close', () => {
      clearInterval(heartbeat); run.sinks.delete(sink)
    })
  }
  // Interrupted requests remain visible and can be retried explicitly; never restart legacy goals.
  queueMicrotask(()=>{
    for(const item of store.list()){
      const chat=store.get(item.id),last=chat.messages.at(-1)
      if(last?.status==='running'){Object.assign(last,{status:'canceled',error:'上次生成被服务重启中断，可以直接重试'});store.save(chat)}
    }
  })
  async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    try {
      const url = new URL(req.url, 'http://localhost'), route = url.pathname
      if (!route.startsWith('/api/')) {
        if (frontend) return frontend(req, res)
        const directory = path.resolve(staticDirectory), relative = decodeURIComponent(route), file = path.resolve(directory, '.' + relative)
        if ((file !== directory && !file.startsWith(directory + path.sep)) || relative.includes('\0')) return json(res, 404, { error: '未找到页面' })
        const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(directory, 'index.html')
        if (!fs.existsSync(target)) return json(res, 503, { error: '前端尚未构建，请先运行 npm run build，或使用 npm run dev' })
        res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' })
        fs.createReadStream(target).pipe(res)
        return
      }
      // This is a local, single-user app. Browser requests must come from this origin.
      if(!['localhost','127.0.0.1','[::1]'].includes(new URL(`http://${req.headers.host}`).hostname))return json(res,403,{error:'本地接口仅允许本机地址访问'})
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: '仅允许当前应用页面访问本地 API' })
      if (req.method === 'GET' && route === '/api/health') {
        return json(res, 200, {
          ok: true,
          status: 'ok',
          name: APP_NAME,
          version,
          vault_locked: Boolean(currentData?.metadata?.vault_locked),
          mentor_count: currentData?.mentors?.length ?? 0,
          data_revision: dataRevision,
        })
      }
      if (req.method === 'GET' && route === '/api/vault/status') {
        const locked = Boolean(currentData?.metadata?.vault_locked)
        const mode = currentData?.metadata?.vault_mode || (locked ? 'locked' : (isVaultConfigured() ? 'custom' : 'builtin'))
        const datasets = VAULT_NAMES.map(name => ({
          name,
          sealed: fs.existsSync(vaultFilePath(name, vaultDir)),
        }))
        return json(res, 200, {
          locked,
          mode,
          configured: isVaultConfigured(),
          datasets,
          cipher: 'AES-256-GCM+scrypt+Brotli',
          vaults: VAULT_NAMES.length,
        })
      }
      if (req.method === 'POST' && route === '/api/vault/unlock') {
        const body = await readBody(req)
        const mode = body?.mode === 'builtin' ? 'builtin' : 'custom'
        const rawKey = body?.key ?? body?.vaultKey
        const trimmedKey = typeof rawKey === 'string' ? rawKey.trim() : ''
        if (mode !== 'builtin' && trimmedKey.length < 16) {
          return json(res, 400, {
            ok: false,
            error: 'MENTOR_VAULT_KEY 长度不足（需至少 16 字符高熵密钥）',
            code: 'ERR_VAULT_LOCKED',
          })
        }
        try {
          verifyVaultKey(trimmedKey, { dir: vaultDir, allowBuiltin: mode === 'builtin' })
        } catch (error) {
          if (error.code === 'ERR_VAULT_AUTH_FAILED') {
            return json(res, 403, { ok: false, error: config.redact(error.message), code: error.code })
          }
          if (error.code === 'ERR_VAULT_LOCKED') {
            return json(res, 400, { ok: false, error: config.redact(error.message), code: error.code })
          }
          if (['ENOENT', 'ERR_VAULT_CORRUPT', 'ERR_VAULT_MAGIC'].includes(error.code)) {
            return json(res, 500, { ok: false, error: config.redact(error.message), code: error.code })
          }
          throw error
        }
        const prevVaultState = getRuntimeVaultState()
        const prevData = currentData
        const prevRevisionCounter = revisionCounter
        if (mode === 'builtin' && !trimmedKey) {
          unlockBuiltinRuntime()
        } else {
          setRuntimeVaultKey(trimmedKey)
        }
        try {
          reloadData()
        } catch (error) {
          restoreRuntimeVaultState(prevVaultState)
          revisionCounter = prevRevisionCounter
          if (['ERR_VAULT_AUTH_FAILED', 'ERR_VAULT_LOCKED'].includes(error.code)) {
            return json(res, 403, { ok: false, unlocked: false, error: config.redact(error.message), code: error.code })
          }
          if (['ENOENT', 'ERR_VAULT_CORRUPT', 'ERR_VAULT_MAGIC'].includes(error.code)) {
            return json(res, 500, { ok: false, unlocked: false, error: config.redact(error.message), code: error.code })
          }
          return json(res, 500, { ok: false, unlocked: false, error: config.redact(error.message || '数据重载失败'), ...(error.code ? { code: error.code } : {}) })
        }
        if (currentData?.metadata?.vault_locked) {
          restoreRuntimeVaultState(prevVaultState)
          revisionCounter = prevRevisionCounter
          applyData(prevData)
          return json(res, 500, {
            ok: false,
            unlocked: false,
            error: '加密数据库解锁后仍处于锁定状态，已回滚运行时状态',
            code: 'ERR_VAULT_LOCKED',
          })
        }
        return json(res, 200, {
          ok: true,
          unlocked: true,
          locked: false,
          mode: currentData?.metadata?.vault_mode || mode,
          mentor_count: currentData?.mentors?.length ?? 0,
          mentors: currentData?.mentors?.length ?? 0,
          reviews: currentData?.reviews?.length ?? 0,
          data_revision: dataRevision,
        })
      }
      if(req.method==='GET'&&route==='/api/workbench')return json(res,200,workbench.snapshot())
      if(req.method==='POST'&&route==='/api/membership/experience')return json(res,200,workbench.setExperience((await readBody(req)).tier))
      if(req.method==='GET'&&route==='/api/insights')return json(res,200,insights())
      if(req.method==='GET'&&route==='/api/profile')return json(res,200,{profile:profiles.read(),options:profileOptions})
      if(req.method==='PUT'&&route==='/api/profile')return json(res,200,{profile:profiles.update(await readBody(req)),options:profileOptions})
      if(req.method==='DELETE'&&route==='/api/profile')return json(res,200,{profile:profiles.reset(),options:profileOptions})
      if(req.method==='GET'&&route==='/api/workbench/directory')return json(res,200,workbench.directory(url.searchParams.get('q')||'',url.searchParams.get('college')||'',Number(url.searchParams.get('offset')||0),url.searchParams.get('sort')||''))
      if(req.method==='GET'&&route==='/api/workbench/export'){
        const fmt=(url.searchParams.get('format')||'html').toLowerCase()
        const snap=url.searchParams.get('snapshot')||undefined
        const scope=url.searchParams.get('scope')||undefined
        if(['xlsx','pdf','docx'].includes(fmt)){
          const result=await exportService.resolveExport({format:fmt,kind:scope==='library'?'preset':'comparison',preset:scope==='library'?'library':undefined,snapshot:snap,scope})
          res.writeHead(200,{'Content-Type':result.type,'Cache-Control':'no-store','X-Export-Filename':encodeURIComponent(result.filename),'Content-Disposition':"attachment; filename=\"polaris-export."+result.extension+"\"; filename*=UTF-8''"+encodeURIComponent(result.filename)});res.end(result.body);return
        }
        const result=workbench.report(fmt,snap,{scope})
        res.writeHead(200,{'Content-Type':result.type,'Cache-Control':'no-store','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('导师对比报告.'+result.extension)});res.end(result.body);return
      }
      if(req.method==='POST'&&route==='/api/workbench/export'){
        const input=await readBody(req),fmt=String(input.format||'html').toLowerCase()
        if(['xlsx','pdf','docx'].includes(fmt)){
          const result=await exportService.resolveExport({format:fmt,kind:input.scope==='library'?'mentors':'comparison',snapshot:input.snapshot,scope:input.scope,keys:input.keys,title:input.scope==='library'?'导师候选库':'导师对比报告'})
          res.writeHead(200,{'Content-Type':result.type,'Cache-Control':'no-store','X-Export-Filename':encodeURIComponent(result.filename),'Content-Disposition':"attachment; filename=\"polaris-export."+result.extension+"\"; filename*=UTF-8''"+encodeURIComponent(result.filename)});res.end(result.body);return
        }
        const result=workbench.report(fmt,input.snapshot,{scope:input.scope,mentors:input.keys})
        res.writeHead(200,{'Content-Type':result.type,'Cache-Control':'no-store','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('导师资料.'+result.extension)});res.end(result.body);return
      }
      if(req.method==='POST'&&route==='/api/export'){
        const input=await readBody(req)
        const result=await exportService.resolveExport(input,apiTools)
        res.writeHead(200,{'Content-Type':result.type,'Cache-Control':'no-store','X-Export-Filename':encodeURIComponent(result.filename),'Content-Disposition':"attachment; filename=\"polaris-export."+result.extension+"\"; filename*=UTF-8''"+encodeURIComponent(result.filename)})
        res.end(result.body);return
      }
      const exportFileMatch=route.match(/^\/api\/exports\/([\w-]+)$/)
      if(req.method==='GET'&&exportFileMatch){
        const file=exportService.getExport(exportFileMatch[1])
        res.writeHead(200,{'Content-Type':file.type,'Cache-Control':'no-store','X-Export-Filename':encodeURIComponent(file.name),'Content-Disposition':"attachment; filename=\"polaris-export."+file.format+"\"; filename*=UTF-8''"+encodeURIComponent(file.name)})
        res.end(file.body);return
      }
      if(req.method==='POST'&&route==='/api/workbench/items')return json(res,200,workbench.addItems((await readBody(req)).mentors))
      if(req.method==='PUT'&&route==='/api/workbench/comparison')return json(res,200,workbench.setComparison((await readBody(req)).mentors))
      if(req.method==='PATCH'&&route==='/api/workbench/comparison')return json(res,200,workbench.patchComparison(await readBody(req)))
      if(req.method==='POST'&&route==='/api/workbench/comparison/check')return json(res,200,workbench.checkComparison((await readBody(req)).mentors))
      if(req.method==='PUT'&&route==='/api/workbench/fields')return json(res,200,workbench.setFields((await readBody(req)).fields))
      if(req.method==='POST'&&route==='/api/workbench/lists')return json(res,200,workbench.addList((await readBody(req)).name))
      if(req.method==='POST'&&route==='/api/workbench/snapshots'){const input=await readBody(req);return json(res,200,workbench.addSnapshot(input.name,input.conclusion))}
      if(req.method==='POST'&&route==='/api/workbench/templates')return json(res,200,workbench.addTemplate((await readBody(req)).name))
      if(req.method==='POST'&&route==='/api/workbench/goal')return json(res,200,workbench.setGoal((await readBody(req)).goal))
      if(req.method==='POST'&&route==='/api/workbench/analyze')return json(res,200,workbench.analyze((await readBody(req)).filters))
      if(req.method==='POST'&&route==='/api/workbench/views'){const input=await readBody(req);return json(res,200,workbench.addView(input.name,input.filters))}
      if(req.method==='POST'&&route==='/api/workbench/scenarios/compare')return json(res,200,workbench.compareScenarios((await readBody(req)).ids))
      const viewMatch=route.match(/^\/api\/workbench\/views\/([\w-]+)$/)
      if(viewMatch&&req.method==='GET')return json(res,200,workbench.getView(viewMatch[1]))
      if(viewMatch&&req.method==='DELETE')return json(res,200,workbench.deleteView(viewMatch[1]))
      const reportMatch=route.match(/^\/api\/workbench\/reports\/([\w-]+)$/)
      if(req.method==='GET'&&reportMatch){const file=workbench.getReport(reportMatch[1]);res.writeHead(200,{'Content-Type':file.type,'Cache-Control':'no-store','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name)});res.end(file.body);return}
      const workspaceMatch=route.match(/^\/api\/workbench\/(items|lists|snapshots|templates|mentors)\/([\w-]+)(?:\/(restore))?$/)
      if(workspaceMatch){
        const [,kind,id,action]=workspaceMatch
        if(req.method==='GET'&&kind==='mentors')return json(res,200,workbench.detail(id))
        if(req.method==='GET'&&kind==='snapshots')return json(res,200,workbench.getSnapshot(id))
        if(req.method==='POST'&&kind==='items'&&action==='restore')return json(res,200,workbench.restoreItem(id))
        if(req.method==='POST'&&kind==='snapshots'&&action==='restore')return json(res,200,workbench.restoreSnapshot(id))
        if(req.method==='POST'&&kind==='templates'&&action==='restore')return json(res,200,workbench.restoreTemplate(id))
        if(req.method==='PATCH'&&kind==='items')return json(res,200,workbench.updateItem(id,await readBody(req)))
        if(req.method==='PATCH'&&kind==='lists')return json(res,200,workbench.updateList(id,await readBody(req)))
        if(req.method==='DELETE'&&['items','lists','snapshots','templates'].includes(kind))return json(res,200,workbench[{items:'removeItem',lists:'deleteList',snapshots:'deleteSnapshot',templates:'deleteTemplate'}[kind]](id))
      }
      if (req.method === 'GET' && route === '/api/data') return json(res, 200, { metadata: { name: currentData.metadata.name, year: currentData.metadata.year, scope: currentData.metadata.scope, colleges: currentData.metadata.colleges, profile_colleges: currentData.metadata.profile_colleges, counts: currentData.metadata.counts }, sources: currentData.sources.map(publicSource) })
      const sourceMatch=route.match(/^\/api\/sources\/(S\d+)$/)
      if(req.method==='GET'&&sourceMatch){
        const source=currentData.sources.find(source=>source.id===sourceMatch[1])
        if(!source)return json(res,404,{error:'这条资料暂未收录'})
        const content=publicSourceContent(currentData,source)
        if(source.kind==='第三方评价'&&Array.isArray(content.entries)&&content.entries.length>20){
          return json(res,200,{...content,entries:content.entries.slice(0,20),truncated:true,total_entries:content.entries.length,protection_notice:'为防止评价库被整包抓取搬迁，接口仅预览前 20 条摘要；请通过北极星 Agent API 按具体导师或条件检索。'})
        }
        return json(res,200,content)
      }
      if (req.method === 'GET' && route === '/api/config') return json(res, 200, config.publicConfig())
      if (req.method === 'POST' && route === '/api/config/test') {
        const input = await readBody(req)
        const candidate = config.candidate(input)
        const result = await testConnection(candidate)
        return json(res, 200, result)
      }
      if (req.method === 'PUT' && route === '/api/config/execution') return json(res, 200, config.updateExecution(await readBody(req)))
      if ((req.method === 'GET' || req.method === 'POST') && route === '/api/models') {
        const candidate = req.method === 'POST' ? config.candidate(await readBody(req)) : config.effective()
        if (!candidate.apiKey) throw new Error('请先填写 API Key 和 URL')
        const cached = config.publicConfig().models
        const models = req.method === 'GET' && !url.searchParams.has('refresh') && cached.length && cached.every(m => m.reasoning) ? cached : await discoverModels(candidate)
        if (req.method === 'GET') config.setModels(models)
        return json(res, 200, { models })
      }
      if (req.method === 'PUT' && route === '/api/config/model') {
        const { model } = await readBody(req)
        const result = config.selectModel(model)
        return json(res, 200, result)
      }
      if (req.method === 'PUT' && route === '/api/config') {
        const input = await readBody(req), candidate = config.candidate(input)
        let models = [], warning
        try { models = await discoverModels(candidate) }
        catch (error) {
          if (!candidate.model || ![404, 405].includes(error.status)) throw error
          warning = '该服务商不支持模型列表，已保存指定模型；首次对话将验证连接及工具调用能力。'
        }
        candidate.model ||= chooseModel(models.map(m => m.id), candidate.baseUrl)
        if (!candidate.model) throw new Error('请填写支持工具调用的模型 ID')
        const result = config.save(candidate, input, models)
        return json(res, 200, { ...result, warning })
      }
      if (req.method === 'GET' && route === '/api/usage') return json(res, 200, store.usage())
      if (req.method === 'GET' && route === '/api/tools') return json(res, 200, { tools: [...toolDefinitions,workbenchToolDefinition,profileToolDefinition] })
      const toolMatch = route.match(/^\/api\/tools\/([a-z_]+)$/)
      if (req.method === 'POST' && toolMatch) {
        const toolName = toolMatch[1], args = await readBody(req)
        if (['query', 'search', 'join'].includes(toolName) && Number.isInteger(args?.limit) && args.limit > 100) {
          return json(res, 403, { error: '为防止加密评价数据被批量导出搬迁，单次 HTTP Agent API 查询上限为 100 条；请通过筛选条件缩小范围或使用 aggregate 统计。', code: 'BULK_EXPORT_BLOCKED' })
        }
        const rawResult = toolName === 'workspace' ? workbench.execute(args, apiTools) : toolName === 'profile' ? profiles.execute(args) : toolName === 'export_file' ? await exportService.executeTool(args, apiTools) : apiTools.execute(toolName, args)
        if (rawResult && Array.isArray(rawResult.rows)) {
          const stripInternal = row => row && typeof row === 'object' ? Object.fromEntries(Object.entries(row).filter(([k]) => !/^(?:mentor_id|review_id|student_id|exam_id|profile_id|candidate_id|source_locator|original_sha256|sha256)$/.test(k))) : row
          return json(res, 200, {
            ...rawResult,
            rows: rawResult.rows.map(stripInternal),
            ...(Array.isArray(rawResult.columns) ? { columns: rawResult.columns.filter(c => !/^(?:mentor_id|review_id|student_id|exam_id|profile_id|candidate_id|source_locator|original_sha256|sha256)$/.test(c.key)) } : {}),
          })
        }
        return json(res, 200, rawResult)
      }
      if (req.method === 'GET' && route === '/api/chats') return json(res, 200, { chats: store.list({ deleted: url.searchParams.get('deleted') === '1', query:url.searchParams.get('q') || '' }).map(c => ({ ...c, running: active.has(c.id) })) })
      if (req.method === 'POST' && route === '/api/chats') return json(res, 201, store.create())
      const chatMatch = route.match(/^\/api\/chats\/([\w-]+)(?:\/(messages|cancel|events|restore|retry|goal\/resume))?$/)
      if (chatMatch) {
        if (req.method === 'POST' && chatMatch[2] === 'restore') {
          const restored = store.restore(chatMatch[1])
          return restored ? json(res, 200, snapshot(restored)) : json(res, 404, { error: '回收站中没有这段对话' })
        }
        const chat = store.get(chatMatch[1])
        if (!chat) return json(res, 404, { error: '对话不存在' })
        if (!chatMatch[2] && req.method === 'PATCH') {
          const { title } = await readBody(req)
          if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) throw new Error('对话名称需为1–100个字符')
          chat.title = title.trim(); store.save(chat)
          return json(res, 200, snapshot(chat))
        }
        if (!chatMatch[2] && req.method === 'GET') return json(res, 200, snapshot(chat))
        if (!chatMatch[2] && req.method === 'DELETE') {
          if (active.has(chat.id)) return json(res, 409, { error: '请先停止正在生成的对话' })
          store.remove(chat.id); return json(res, 200, { deleted: true })
        }
        if (chatMatch[2] === 'cancel' && req.method === 'POST') {
          active.get(chat.id)?.controller.abort('user'); return json(res, 200, { canceled: true })
        }
        if (chatMatch[2] === 'events' && req.method === 'GET') return attach(req, res, chat, active.get(chat.id))
        if(chatMatch[2]==='goal/resume')return json(res,410,{error:'请直接发送普通消息继续对话'})
        if(chatMatch[2]==='retry'&&req.method==='POST'){
          if(active.has(chat.id))return json(res,409,{error:'正在生成，请稍候或停止后重试'})
          const last=chat.messages.at(-1)
          if(!last||last.role!=='assistant'||!['complete','error','canceled'].includes(last.status))return json(res,400,{error:'当前没有可以重新生成的回答'})
          if(!config.publicConfig().configured)throw new Error('请先配置可用模型')
          const question=chat.messages.findLast(message=>message.role==='user')?.content
          const anchor=chat.modelMessages.findLastIndex(message=>message.role==='user'&&message.content===question)
          const userIndex=chat.messages.findLastIndex(message=>message.role==='user')
          chat.modelMessages=anchor>=0?chat.modelMessages.slice(0,anchor+1):visibleHistory(chat.messages.slice(0,userIndex+1))
          const replacesMessageId=last.status==='complete'?last.id:last.replacesMessageId
          chat.latestUserText=question
          if(last.status!=='complete')chat.messages.pop()
          launch(chat,undefined,replacesMessageId)
          return json(res,202,snapshot(chat))
        }
        if (chatMatch[2] === 'messages' && req.method === 'POST') {
          const { text } = await readBody(req)
          if (typeof text !== 'string' || !text.trim() || text.length > 20000) return json(res, 400, { error: '请输入 1–20000 字的问题' })
          if (!config.publicConfig().configured) return json(res, 400, { error: '先在连接设置中填写 API Key 和 URL，并选择模型' })
          if (active.has(chat.id)) return json(res, 409, { error: '这条对话仍在生成，请稍候或先停止' })
          const question=text.trim().replace(/^\/goal(?:\s+|$)/i,'').trim()
          if(!question)return json(res,400,{error:'请输入问题'})
          return attach(req,res,chat,launch(chat,question),true)
        }
      }
      json(res, 404, { error: '未找到接口' })
    } catch (error) {
      if (!res.headersSent) json(res, ['PLAN_REQUIRED','OWNER_REQUIRED'].includes(error.code)?403:400, { error: config.redact(error.message),...(error.code?{code:error.code,requiredTier:error.requiredTier}:{}) })
      else res.end()
    }
  }
  return {
    handler,
    store,
    config,
    get data() { return currentData },
    get dataRevision() { return dataRevision },
    cancelAll: () => {
      shuttingDown = true
      for (const run of active.values()) run.controller.abort('shutdown')
      return Promise.allSettled([...active.values()].map(run => run.promise))
    },
  }
}

export async function startServer({ dev = false, port = Number(process.env.PORT || 3210), dataDir, staticDirectory = dist, vaultDir, registerSignals = true } = {}) {
  let vite
  if (dev) {
    const { createServer } = await import('vite')
    vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' })
  }
  const store = createStore(dataDir), app = createApplication({ store, frontend: vite?.middlewares, staticDirectory, vaultDir })
  const server = http.createServer(app.handler)
  server.requestTimeout = 0
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const address = `http://127.0.0.1:${server.address().port}`
  console.log(`${APP_NAME} 已启动：${address}${dev ? '（开发模式）' : ''}`)
  console.log('在浏览器中访问该地址即可。按 Ctrl+C 停止；不会自动打开窗口。')
  let closingPromise = null
  async function close() {
    if (closingPromise) return closingPromise
    closingPromise = (async () => {
      await app.cancelAll()
      await vite?.close()
      if (server.listening) await new Promise(resolve => server.close(resolve))
    })()
    return closingPromise
  }
  if (registerSignals) {
    process.once('SIGINT', () => close().then(() => process.exit(0)))
    process.once('SIGTERM', () => close().then(() => process.exit(0)))
  }
  return { server, app, address, close }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer({ dev: process.argv.includes('--dev') }).catch(error => { console.error(error.code === 'EADDRINUSE' ? '端口已被占用，可在 .env 中修改 PORT 后重试。' : error.message); process.exitCode = 1 })
}

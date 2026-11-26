import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createApplication } from '../server/index.mjs'
import { createStore } from '../server/store.js'
import { createConfig } from '../server/config.js'
import { lockedFallbackDataset } from '../lib/vault.js'
import { startMockProvider } from './mock-provider.mjs'

function buildLockedDataset() {
  const locked = lockedFallbackDataset()
  locked.mentor_notes = []
  locked.metadata.profile_colleges = locked.metadata.colleges
  locked.metadata.coverage = []
  return locked
}

async function readJsonBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

function jsonResponse(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function extractPromptContext(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const lastUser = messages.findLastIndex(m => m.role === 'user')
  const rawQuestion = lastUser >= 0 ? String(messages[lastUser]?.content || '') : ''
  let effectiveQuestion = rawQuestion
  try {
    const parsed = JSON.parse(rawQuestion)
    if (parsed && typeof parsed.question === 'string') effectiveQuestion = parsed.question
  } catch {}
  const sys0 = String(messages[0]?.content || '')
  return {
    effectiveQuestion,
    summarizing: sys0.startsWith('你在压缩 Agent 的历史记录'),
    reviewing: sys0.startsWith('你是数据答复的交付核对员'),
    delivering: sys0.startsWith('你是北极星，现在向用户交付最终答复'),
  }
}

export async function startUiServer({
  port = 0,
  configured = true,
  vaultLocked = false,
  data,
  envOverrides = {},
  enableTestControl = true,
} = {}) {
  let currentOptions = { configured, vaultLocked, data, envOverrides }
  let provider = await startMockProvider()
  const proxyState = { modelsStatus: null }

  const proxyServer = http.createServer(async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0]
    if (req.method === 'GET' && urlPath === '/models' && proxyState.modelsStatus != null) {
      jsonResponse(res, proxyState.modelsStatus, { error: { message: `mock models status ${proxyState.modelsStatus}` } })
      return
    }

    let rawBody = null
    if (req.method === 'POST' && urlPath === '/chat/completions') {
      rawBody = ''
      for await (const chunk of req) rawBody += chunk
      let body
      try { body = JSON.parse(rawBody || '{}') } catch { body = {} }
      const { effectiveQuestion, summarizing, reviewing, delivering } = extractPromptContext(body)

      if (!summarizing && effectiveQuestion.includes('模拟402')) {
        jsonResponse(res, 402, { error: { message: 'insufficient balance' } })
        return
      }
      if (!summarizing && effectiveQuestion.includes('模拟429')) {
        jsonResponse(res, 429, { error: { message: 'rate limit exceeded' } })
        return
      }
      if (!summarizing && effectiveQuestion.includes('模拟永久500')) {
        jsonResponse(res, 500, { error: { message: 'persistent upstream failure' } })
        return
      }
      if (!summarizing && !reviewing && !delivering && effectiveQuestion.includes('模拟工具断流')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'partial-tool-1', type: 'function', function: { name: 'query', arguments: '{"from":' } }] }, finish_reason: null }] })}\n\n`)
        const timer = setTimeout(() => { if (!res.destroyed) res.destroy() }, 25)
        res.on('close', () => clearTimeout(timer))
        return
      }
      if (!summarizing && !reviewing && !delivering && effectiveQuestion.includes('模拟长思考延迟')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '正在分析导师评价与培养条件...' }, finish_reason: null }] })}\n\n`)
        const timer = setTimeout(() => {
          if (res.destroyed || res.writableEnded) return
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '经过长思考分析，建议关注导师的实验室管理模式、实习政策与近三年毕业去向。' }, finish_reason: null }] })}\n\n`)
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
          res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125, prompt_tokens_details: { cached_tokens: 20 } } })}\n\n`)
          res.end('data: [DONE]\n\n')
        }, 1800)
        res.on('close', () => clearTimeout(timer))
        return
      }
      if (!summarizing && !reviewing && !delivering && effectiveQuestion.includes('模拟空回复')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'stop' }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 } })}\n\n`)
        res.end('data: [DONE]\n\n')
        return
      }
    }

    const upstreamUrl = new URL(req.url || '/', provider.url)
    const headers = { ...req.headers, host: upstreamUrl.host }
    if (rawBody !== null) headers['content-length'] = String(Buffer.byteLength(rawBody))
    const upReq = http.request(upstreamUrl, { method: req.method, headers }, upRes => {
      res.writeHead(upRes.statusCode || 500, upRes.headers)
      upRes.pipe(res)
    })
    upReq.on('error', () => {
      if (!res.headersSent && !res.destroyed) jsonResponse(res, 502, { error: { message: 'proxy upstream error' } })
      else if (!res.destroyed) res.destroy()
    })
    res.on('close', () => upReq.destroy())
    if (rawBody !== null) upReq.end(rawBody)
    else req.pipe(upReq)
  })

  await new Promise(resolve => proxyServer.listen(0, '127.0.0.1', resolve))
  const proxyUrl = `http://127.0.0.1:${proxyServer.address().port}`

  async function createState(opts) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mentor-ui-'))
    const store = createStore(dir)
    store.write('membership', { tier: 'ssvip', owner: true, experienceTier: null })
    const configEnv = opts.configured
      ? { MENTOR_API_URL: proxyUrl, MENTOR_API_KEY: 'ui-fixture-only', MENTOR_MODEL: 'test-agent', ...opts.envOverrides }
      : { ...opts.envOverrides }
    const config = createConfig(store, configEnv)
    const appData = opts.data !== undefined ? opts.data : (opts.vaultLocked ? buildLockedDataset() : undefined)
    const app = createApplication({
      ...(appData !== undefined ? { data: appData } : {}),
      store,
      config,
      staticDirectory: process.env.MENTOR_TEST_FRONTEND || path.resolve('.local/ui-test-dist'),
    })
    return { dir, store, config, app }
  }

  let active = await createState(currentOptions)

  async function rebuild(nextOpts, { resetProvider = false } = {}) {
    currentOptions = { ...currentOptions, ...nextOpts }
    const prevDir = active.dir
    await active.app.cancelAll()
    if (resetProvider) {
      proxyState.modelsStatus = null
      await provider.close()
      provider = await startMockProvider()
    }
    active = await createState(currentOptions)
    await fs.rm(prevDir, { recursive: true, force: true }).catch(() => {})
  }

  const server = http.createServer(async (req, res) => {
    const route = (req.url || '/').split('?')[0]
    if (enableTestControl && route.startsWith('/__test__/')) {
      try {
        if (req.method === 'POST' && route === '/__test__/reset') {
          const body = await readJsonBody(req)
          await rebuild({
            configured: body.configured ?? configured,
            vaultLocked: body.vaultLocked ?? vaultLocked,
            data: body.data ?? data,
            envOverrides: body.envOverrides ?? envOverrides,
          }, { resetProvider: true })
          jsonResponse(res, 200, { ok: true, proxyUrl, providerUrl: provider.url })
          return
        }
        if (req.method === 'POST' && route === '/__test__/mode') {
          const body = await readJsonBody(req)
          await rebuild({
            ...(body.configured !== undefined ? { configured: Boolean(body.configured) } : {}),
            ...(body.vaultLocked !== undefined ? { vaultLocked: Boolean(body.vaultLocked) } : {}),
            ...(body.data !== undefined ? { data: body.data } : { data: undefined }),
            ...(body.envOverrides !== undefined ? { envOverrides: body.envOverrides } : {}),
          })
          jsonResponse(res, 200, {
            ok: true,
            configured: currentOptions.configured,
            vaultLocked: currentOptions.vaultLocked,
          })
          return
        }
        if (req.method === 'POST' && route === '/__test__/provider') {
          const body = await readJsonBody(req)
          if ('modelsStatus' in body) proxyState.modelsStatus = body.modelsStatus
          jsonResponse(res, 200, { ok: true, ...proxyState })
          return
        }
        jsonResponse(res, 404, { error: 'unknown test control route' })
      } catch (err) {
        jsonResponse(res, 400, { error: err.message })
      }
      return
    }
    return active.app.handler(req, res)
  })

  server.requestTimeout = 0
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const actualPort = server.address().port
  const url = `http://127.0.0.1:${actualPort}`

  async function close() {
    await active.app.cancelAll()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    proxyServer.closeAllConnections()
    await new Promise(resolve => proxyServer.close(resolve))
    await provider.close()
    await fs.rm(active.dir, { recursive: true, force: true }).catch(() => {})
  }

  return {
    url,
    port: actualPort,
    proxyUrl,
    get providerUrl() { return provider.url },
    get store() { return active.store },
    get app() { return active.app },
    reset: (opts = {}) => rebuild(opts, { resetProvider: true }),
    setMode: (opts = {}) => rebuild(opts),
    setProvider: (opts = {}) => { if ('modelsStatus' in opts) proxyState.modelsStatus = opts.modelsStatus },
    close,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const uiServer = await startUiServer({
    port: 3321,
    configured: true,
    vaultLocked: false,
    enableTestControl: true,
  })
  console.log('UI test server ready')
  const shutdown = async () => {
    await uiServer.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { createApplication, startServer } from '../server/index.mjs'
import { createStore } from '../server/store.js'
import { createConfig, isLocalOllamaUrl, maskApiKey } from '../server/config.js'
import { loadData } from '../lib/data.js'
import { isForbiddenReleasePath } from '../scripts/package-release.mjs'
import { runVaultHygieneCheck } from '../scripts/check-vault-hygiene.mjs'
import { startMockProvider } from './mock-provider.mjs'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

test('maskApiKey 永不暴露完整密钥且 isLocalOllamaUrl 仅匹配 11434 端口', () => {
  assert.equal(maskApiKey(''), '')
  assert.equal(maskApiKey('shortkey'), '****')
  assert.equal(maskApiKey('1234567890'), '****')
  assert.equal(maskApiKey('sk-1234567890abcdef'), 'sk-1****cdef')
  assert.equal(isLocalOllamaUrl('http://127.0.0.1:11434/v1'), true)
  assert.equal(isLocalOllamaUrl('http://localhost:11434'), true)
  assert.equal(isLocalOllamaUrl('http://127.0.0.1:45678/v1'), false)
  assert.equal(isLocalOllamaUrl('https://api.deepseek.com'), false)
})

test('saved.source === ui 时不被空密钥的默认环境变量覆盖，且 Ollama 可免密钥保存', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-cfg-persist-'))
  try {
    const store = createStore(dir)
    const cfg = createConfig(store, {})
    const candidate = cfg.candidate({ baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', model: 'qwen2.5:7b' })
    assert.equal(candidate.apiKey, 'ollama')
    cfg.save(candidate, { apiKey: '' }, [{ id: 'qwen2.5:7b', name: 'qwen2.5:7b' }])

    const reloaded = createConfig(createStore(dir), { MENTOR_API_URL: 'https://api.deepseek.com', MENTOR_MODEL: 'deepseek-chat' })
    assert.equal(reloaded.publicConfig().baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(reloaded.publicConfig().model, 'qwen2.5:7b')
    assert.equal(reloaded.publicConfig().hasKey, false) // saved without manual key, uses Ollama fallback on candidate
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('POST /api/config/test 覆盖连通成功、401 脱敏与 404 模型列表回退探活', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-cfg-test-'))
  const provider = await startMockProvider()
  let mode = 'normal'
  const customProxy = http.createServer(async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0]
    if (mode === '404_models' && req.method === 'GET' && urlPath === '/models') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'not implemented' } }))
      return
    }
    if (mode === '404_models' && req.method === 'POST' && urlPath === '/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }))
      return
    }
    const target = new URL(req.url || '/', provider.url)
    const chunks = []
    for await (const c of req) chunks.push(c)
    const up = await fetch(target, {
      method: req.method,
      headers: { Authorization: req.headers.authorization || '', 'Content-Type': 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    })
    res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/json' })
    res.end(Buffer.from(await up.arrayBuffer()))
  })
  await new Promise(resolve => customProxy.listen(0, '127.0.0.1', resolve))
  const proxyUrl = `http://127.0.0.1:${customProxy.address().port}`

  const store = createStore(dir)
  const app = createApplication({
    data: loadData(),
    store,
    config: createConfig(store, { MENTOR_API_URL: proxyUrl, MENTOR_API_KEY: 'sk-super-secret-token-value', MENTOR_MODEL: 'test-agent' }),
  })
  const server = http.createServer(app.handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  try {
    // Check maskedKey in publicConfig
    const cfgRes = await (await fetch(`${base}/api/config`)).json()
    assert.equal(cfgRes.maskedKey, 'sk-s****alue')
    assert.ok(!JSON.stringify(cfgRes).includes('sk-super-secret-token-value'))

    // Test valid connection
    const okRes = await (await fetch(`${base}/api/config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: proxyUrl, apiKey: 'sk-super-secret-token-value', model: 'test-agent' }),
    })).json()
    assert.equal(okRes.ok, true)
    assert.ok(okRes.modelCount >= 1)
    assert.match(okRes.message, /连接成功/)

    // Test invalid key redaction
    const badRes = await (await fetch(`${base}/api/config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: proxyUrl, apiKey: 'invalid', model: 'test-agent' }),
    })).json()
    assert.equal(badRes.ok, false)
    assert.match(badRes.message, /无效/)

    // Test 404 /models fallback to /chat/completions
    mode = '404_models'
    const fallbackRes = await (await fetch(`${base}/api/config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: proxyUrl, apiKey: 'sk-super-secret-token-value', model: 'test-agent' }),
    })).json()
    assert.equal(fallbackRes.ok, true)
    assert.match(fallbackRes.message, /对话接口可用/)

    // Test unreachable host
    const deadRes = await (await fetch(`${base}/api/config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'http://127.0.0.1:65490/v1', apiKey: 'sk-1234567890abcdef', model: 'm' }),
    })).json()
    assert.equal(deadRes.ok, false)
    assert.ok(!deadRes.message.includes('sk-1234567890abcdef'))
  } finally {
    await app.cancelAll()
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => customProxy.close(resolve))
    await provider.close()
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('startServer 支持 registerSignals:false 与幂等 close() 且卫生检查拦截桌面安装包产物', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-srv-lifecycle-'))
  try {
    const beforeSig = process.listenerCount('SIGINT')
    const handle = await startServer({ port: 0, dataDir: dir, registerSignals: false })
    assert.equal(process.listenerCount('SIGINT'), beforeSig)
    const health = await (await fetch(`${handle.address}/api/health`)).json()
    assert.equal(health.ok, true)
    assert.equal(health.vault_locked, false)
    await handle.close()
    await handle.close() // idempotent

    // Package & hygiene forbidden checks
    assert.equal(isForbiddenReleasePath('dist-desktop/Polaris.dmg'), true)
    assert.equal(isForbiddenReleasePath('Polaris-5.0.0-win-x64-setup.exe'), true)
    assert.equal(isForbiddenReleasePath('Polaris.app/Contents/MacOS/Polaris'), true)
    assert.equal(isForbiddenReleasePath('build/icon.icns'), false)
    assert.equal(isForbiddenReleasePath('electron/main.mjs'), false)

    const hygiene = runVaultHygieneCheck({ unseal: false })
    assert.equal(hygiene.ok, true)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('桌面端静态资源清单存在且 electron/preload.cjs 合法', () => {
  assert.equal(fsSync.existsSync(path.join(root, 'electron', 'main.mjs')), true)
  assert.equal(fsSync.existsSync(path.join(root, 'electron', 'preload.cjs')), true)
  for (const icon of ['icon.png', 'icon.icns', 'icon.ico']) {
    const p = path.join(root, 'build', icon)
    assert.equal(fsSync.existsSync(p), true, icon)
    assert.ok(fsSync.statSync(p).size > 1000, icon)
  }
  const ico = fsSync.readFileSync(path.join(root, 'build', 'icon.ico'))
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.ok(ico.readUInt16LE(4) >= 5)

  const pkg = JSON.parse(fsSync.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.build?.mac?.extendInfo?.CFBundleName, undefined)
})

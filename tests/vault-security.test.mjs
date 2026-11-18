import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { VAULT_NAMES, unsealVaultPayload, unlockVaultData, grantAgentVaultAccess, vaultFilePath } from '../lib/vault.js'
import { createApplication } from '../server/index.mjs'
import { createStore } from '../server/store.js'

const dataDir = fileURLToPath(new URL('../data/', import.meta.url))

test('data/ 目录仅存放加密 .vault 二进制包，不存在任何明文 .json 数据文件', () => {
  const files = fs.readdirSync(dataDir)
  assert.equal(files.filter(f => f.endsWith('.json')).length, 0, 'data/ 下不得留存任何明文 JSON')
  for (const name of VAULT_NAMES) {
    const file = vaultFilePath(name, dataDir)
    assert.ok(fs.existsSync(file), `缺少加密包 ${name}.vault`)
    const raw = fs.readFileSync(file)
    assert.equal(raw.subarray(0, 5).toString('binary'), 'PVLT\x02')
    const asText = raw.toString('utf8')
    assert.ok(!asText.includes('付俊松') && !asText.includes('网络空间安全学院') && !asText.includes('review_text'), '密文不得泄漏任何可读中文或字段名')
  }
})

test('源码零硬编码密钥：未持有授权令牌、错误密钥或密文篡改时解密均严格拒绝', () => {
  const vaultSource = fs.readFileSync(new URL('../lib/vault.js', import.meta.url), 'utf8')
  assert.ok(!vaultSource.includes('K_SHARDS'), 'lib/vault.js 严禁硬编码任何密钥分片')

  const raw = fs.readFileSync(vaultFilePath('dataset', dataDir))
  assert.throws(() => unsealVaultPayload('dataset', raw, null), { code: 'ERR_VAULT_UNAUTHORIZED' })
  assert.throws(() => unsealVaultPayload('dataset', raw, Symbol('fake')), { code: 'ERR_VAULT_UNAUTHORIZED' })
  assert.throws(() => unlockVaultData('dataset', 'wrong-token'), { code: 'ERR_VAULT_UNAUTHORIZED' })

  const seal = grantAgentVaultAccess()
  // Wrong explicit secret key fails AES-256-GCM authentication
  assert.throws(() => unsealVaultPayload('dataset', raw, seal, '0000000000000000000000000000000000000000000000000000000000000000'), { code: 'ERR_VAULT_AUTH_FAILED' })
  // Wrong vaultName AAD binding fails GCM verification
  assert.throws(() => unsealVaultPayload('pdf-reviews', raw, seal), { code: 'ERR_VAULT_AUTH_FAILED' })

  // 1-bit tamper in ciphertext fails AES-256-GCM authentication
  const tampered = Buffer.from(raw)
  tampered[tampered.length - 1] ^= 0xff
  assert.throws(() => unsealVaultPayload('dataset', tampered, seal), { code: 'ERR_VAULT_AUTH_FAILED' })
})

test('HTTP Agent API 拦截批量导出抓取、剥离底层关联主键并对来源详情限流', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-vault-http-'))
  const app = createApplication({ store: createStore(tmp) })
  const server = http.createServer(app.handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  try {
    // 1. Bulk scraping > 100 rows is blocked with 403 BULK_EXPORT_BLOCKED
    const bulk = await fetch(`${base}/api/tools/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'mentors', limit: 500 }),
    })
    assert.equal(bulk.status, 403)
    const bulkBody = await bulk.json()
    assert.equal(bulkBody.code, 'BULK_EXPORT_BLOCKED')

    // 2. Legitimate small Agent query works, but internal primary/foreign keys are stripped from HTTP output
    const normal = await fetch(`${base}/api/tools/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'mentors', limit: 5 }),
    })
    assert.equal(normal.status, 200)
    const normalBody = await normal.json()
    assert.equal(normalBody.rows.length, 5)
    for (const row of normalBody.rows) {
      assert.equal(row.mentor_id, undefined)
      assert.equal(row.source_locator, undefined)
      assert.ok(row.name)
    }

    // 3. Review source endpoint caps raw review entries to 20 to prevent bulk scraping
    const s1 = await (await fetch(`${base}/api/sources/S1`)).json()
    assert.equal(s1.truncated, true)
    assert.equal(s1.entries.length, 20)
    assert.ok(s1.total_entries > 20)
  } finally {
    await app.cancelAll()
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

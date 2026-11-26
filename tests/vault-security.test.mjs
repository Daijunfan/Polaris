import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  VAULT_NAMES,
  grantAgentVaultAccess,
  resetRuntimeVaultState,
  sealVaultPayload,
  setRuntimeVaultKey,
  unlockBuiltinRuntime,
  unlockVaultData,
  unsealVaultPayload,
  vaultFilePath,
  verifyVaultKey,
  verifyVaultRoundTrip,
} from '../lib/vault.js'
import { loadData } from '../lib/data.js'
import { sealSingleVault, sealVaults } from '../scripts/seal-data.mjs'
import { createApplication } from '../server/index.mjs'
import { createStore } from '../server/store.js'

const rootDir = fileURLToPath(new URL('../', import.meta.url))
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

test('源码零硬编码密钥：未持有授权令牌、伪造全局Symbol、外部调用grant、错误密钥或密文篡改时均严格拒绝', () => {
  const vaultSource = fs.readFileSync(new URL('../lib/vault.js', import.meta.url), 'utf8')
  assert.ok(!vaultSource.includes('K_SHARDS'), 'lib/vault.js 严禁硬编码任何密钥分片')
  assert.ok(!vaultSource.includes('Symbol.for('), 'lib/vault.js 严禁使用可伪造的全局 Symbol.for')

  const raw = fs.readFileSync(vaultFilePath('dataset', dataDir))
  assert.throws(() => unsealVaultPayload('dataset', raw, null), { code: 'ERR_VAULT_UNAUTHORIZED' })
  assert.throws(() => unsealVaultPayload('dataset', raw, Symbol('fake')), { code: 'ERR_VAULT_UNAUTHORIZED' })
  assert.throws(() => unsealVaultPayload('dataset', raw, Symbol.for('polaris.agent.vault.runtime.v5')), { code: 'ERR_VAULT_UNAUTHORIZED' })
  assert.throws(() => unlockVaultData('dataset', 'wrong-token'), { code: 'ERR_VAULT_UNAUTHORIZED' })
  assert.throws(() => grantAgentVaultAccess(), { code: 'ERR_VAULT_UNAUTHORIZED' })

  assert.throws(
    () => execFileSync(process.execPath, ['-e', "import('./lib/vault.js').then(v => v.unlockVaultData('dataset', v.grantAgentVaultAccess()))"], { cwd: rootDir, stdio: 'pipe' }),
    /ERR_VAULT_UNAUTHORIZED/,
  )

  // Wrong explicit secret key fails AES-256-GCM authentication
  assert.throws(() => verifyVaultKey('0000000000000000000000000000000000000000000000000000000000000000', { dir: dataDir }), { code: 'ERR_VAULT_AUTH_FAILED' })
  assert.throws(() => verifyVaultRoundTrip('dataset', raw, {}, '0000000000000000000000000000000000000000000000000000000000000000'), { code: 'ERR_VAULT_AUTH_FAILED' })

  // Wrong vaultName AAD binding fails GCM verification
  assert.throws(() => verifyVaultRoundTrip('pdf-reviews', raw, {}), { code: 'ERR_VAULT_AUTH_FAILED' })

  // 1-bit tamper in ciphertext fails AES-256-GCM authentication
  const tampered = Buffer.from(raw)
  tampered[tampered.length - 1] ^= 0xff
  assert.throws(() => verifyVaultRoundTrip('dataset', tampered, {}), { code: 'ERR_VAULT_AUTH_FAILED' })

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-tamper-'))
  try {
    const tamperedFile = path.join(tmp, 'dataset.vault')
    fs.writeFileSync(tamperedFile, tampered)
    assert.throws(() => loadData(tamperedFile), { code: 'ERR_VAULT_AUTH_FAILED' })
    const wrongAadFile = path.join(tmp, 'pdf-reviews.vault')
    fs.writeFileSync(wrongAadFile, raw)
    assert.throws(() => loadData(wrongAadFile), { code: 'ERR_VAULT_AUTH_FAILED' })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('新克隆无密钥环境可通过内置项目绑定机制开箱解密，且 metadata.name 为北极星', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-fresh-clone-'))
  try {
    fs.mkdirSync(path.join(tmp, 'lib'))
    fs.mkdirSync(path.join(tmp, 'data'))
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ type: 'module' }))
    for (const file of ['vault.js', 'data.js', 'fields.js']) {
      fs.copyFileSync(path.join(rootDir, 'lib', file), path.join(tmp, 'lib', file))
    }
    for (const name of VAULT_NAMES) {
      fs.copyFileSync(vaultFilePath(name, dataDir), path.join(tmp, 'data', `${name}.vault`))
    }
    const cleanEnv = { ...process.env }
    delete cleanEnv.MENTOR_VAULT_KEY
    delete cleanEnv.POLARIS_FORCE_LOCK
    delete cleanEnv.MENTOR_DATA_FILE
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { loadData } from './lib/data.js'; const d = loadData(); console.log(JSON.stringify({ name: d.metadata.name, locked: d.metadata.vault_locked, mode: d.metadata.vault_mode, mentors: d.mentors.length, reviews: d.reviews.length, profiles: d.profiles.length }))",
      ],
      { cwd: tmp, env: cleanEnv, encoding: 'utf8' },
    )
    const parsed = JSON.parse(out.trim())
    assert.equal(parsed.name, '北极星')
    assert.equal(parsed.locked, false)
    assert.equal(parsed.mode, 'builtin')
    assert.equal(parsed.mentors, 414)
    assert.equal(parsed.reviews, 309)
    assert.equal(parsed.profiles, 1245)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('POLARIS_FORCE_LOCK=1 或错误显式 MENTOR_VAULT_KEY 时严格进入锁定态且不静默回退', () => {
  const runProbe = extraEnv => {
    const cleanEnv = { ...process.env, ...extraEnv }
    delete cleanEnv.MENTOR_DATA_FILE
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { loadData } from './lib/data.js'; const d = loadData(); console.log(JSON.stringify({ locked: d.metadata.vault_locked, mode: d.metadata.vault_mode, mentors: d.mentors.length }))",
      ],
      { cwd: rootDir, env: cleanEnv, encoding: 'utf8' },
    )
    return JSON.parse(out.trim())
  }

  const forced = runProbe({ POLARIS_FORCE_LOCK: '1' })
  assert.deepEqual(forced, { locked: true, mode: 'locked', mentors: 0 })

  const mismatched = runProbe({ MENTOR_VAULT_KEY: 'wrong-explicit-vault-key-123456' })
  assert.deepEqual(mismatched, { locked: true, mode: 'locked', mentors: 0 })

  const shortKey = runProbe({ MENTOR_VAULT_KEY: 'short' })
  assert.deepEqual(shortKey, { locked: true, mode: 'locked', mentors: 0 })
})

test('sealVaultPayload 支持内置与自定义密钥模式回环校验', () => {
  const sample = { metadata: { name: '北极星' }, ok: true }
  const builtinSealed = sealVaultPayload('dataset', sample, { keyMode: 'builtin' })
  assert.deepEqual(verifyVaultRoundTrip('dataset', builtinSealed, sample, { keyMode: 'builtin' }), { ok: true })

  const customKey = 'custom-test-vault-secret-2026-abcdef'
  const customSealed = sealVaultPayload('dataset', sample, customKey)
  assert.deepEqual(verifyVaultRoundTrip('dataset', customSealed, sample, customKey), { ok: true })
  assert.throws(() => verifyVaultRoundTrip('dataset', customSealed, sample, { keyMode: 'builtin' }), { code: 'ERR_VAULT_AUTH_FAILED' })
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

test('unlockBuiltinRuntime 在存在不匹配 MENTOR_VAULT_KEY 时仍允许 loadData 与显式 .vault 路径用内置密钥解密', () => {
  const prevKey = process.env.MENTOR_VAULT_KEY
  process.env.MENTOR_VAULT_KEY = 'stale-wrong-env-key-1234567890'
  resetRuntimeVaultState()
  try {
    const locked = loadData()
    assert.equal(locked.metadata.vault_locked, true)
    assert.equal(locked.metadata.vault_mode, 'locked')

    unlockBuiltinRuntime()
    const unlocked = loadData()
    assert.equal(unlocked.metadata.vault_locked, false)
    assert.equal(unlocked.metadata.vault_mode, 'builtin')
    assert.equal(unlocked.mentors.length, 414)
    assert.equal(unlocked.reviews.length, 309)
    assert.equal(unlocked.profiles.length, 1245)

    const directVault = loadData(vaultFilePath('dataset', dataDir))
    assert.equal(directVault.metadata.vault_locked, false)
    assert.equal(directVault.metadata.vault_mode, 'builtin')

    setRuntimeVaultKey('another-wrong-custom-key-12345678')
    const relocked = loadData()
    assert.equal(relocked.metadata.vault_locked, true)
  } finally {
    if (prevKey === undefined) delete process.env.MENTOR_VAULT_KEY
    else process.env.MENTOR_VAULT_KEY = prevKey
    resetRuntimeVaultState()
  }
})

test('sealSingleVault 在已存在旧备份且 metadata.name 已为北极星时仍同步刷新 .local/plaintext-data 备份', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-seal-backup-'))
  const tmpDataDir = path.join(tmp, 'data')
  const tmpBackupDir = path.join(tmp, '.local', 'plaintext-data')
  fs.mkdirSync(tmpDataDir, { recursive: true })
  fs.mkdirSync(tmpBackupDir, { recursive: true })

  try {
    const staleBackup = { metadata: { name: '北极星', marker: 'old' }, mentors: [] }
    const freshInput = { metadata: { name: '北极星', marker: 'new-edit' }, mentors: [{ name: '测试' }] }
    fs.writeFileSync(path.join(tmpBackupDir, 'dataset.json'), JSON.stringify(staleBackup))
    fs.writeFileSync(path.join(tmpDataDir, 'dataset.json'), JSON.stringify(freshInput))

    sealSingleVault('dataset', { dataDir: tmpDataDir, backupDir: tmpBackupDir })
    assert.equal(fs.existsSync(path.join(tmpDataDir, 'dataset.json')), false)
    const syncedBackup = JSON.parse(fs.readFileSync(path.join(tmpBackupDir, 'dataset.json'), 'utf8'))
    assert.equal(syncedBackup.metadata.marker, 'new-edit')
    assert.equal(syncedBackup.mentors.length, 1)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('loadData 支持对象参数 { file, allowLockedFallback } 并严格区分 true/false 锁定回退行为', () => {
  const prevForce = process.env.POLARIS_FORCE_LOCK
  const prevKey = process.env.MENTOR_VAULT_KEY
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-loaddata-opts-'))
  try {
    delete process.env.POLARIS_FORCE_LOCK
    delete process.env.MENTOR_VAULT_KEY
    resetRuntimeVaultState()

    const unlocked = loadData({ allowLockedFallback: true })
    assert.equal(unlocked.metadata.name, '北极星')
    assert.equal(unlocked.metadata.vault_locked, false)
    assert.equal(unlocked.mentors.length, 414)

    const strictUnlocked = loadData({ allowLockedFallback: false })
    assert.equal(strictUnlocked.metadata.name, '北极星')
    assert.equal(strictUnlocked.metadata.vault_locked, false)

    process.env.POLARIS_FORCE_LOCK = '1'
    const lockedFallback = loadData({ allowLockedFallback: true })
    assert.equal(lockedFallback.metadata.vault_locked, true)
    assert.equal(lockedFallback.metadata.vault_mode, 'locked')
    assert.equal(lockedFallback.mentors.length, 0)
    assert.throws(() => loadData({ allowLockedFallback: false }), { code: 'ERR_VAULT_LOCKED' })

    delete process.env.POLARIS_FORCE_LOCK
    const customVault = path.join(tmp, 'dataset.vault')
    fs.writeFileSync(
      customVault,
      sealVaultPayload('dataset', { metadata: { name: '北极星', colleges: [], counts: {}, notes: [] }, mentors: [], students: [], exams: [], reviews: [], profiles: [], sources: [] }, 'custom-load-data-secret-2026-xyz'),
    )
    const customLocked = loadData({ file: customVault, allowLockedFallback: true })
    assert.equal(customLocked.metadata.vault_locked, true)
    assert.throws(() => loadData({ file: customVault, allowLockedFallback: false }), { code: 'ERR_VAULT_AUTH_FAILED' })
    assert.throws(() => loadData(customVault), { code: 'ERR_VAULT_AUTH_FAILED' })
  } finally {
    if (prevForce === undefined) delete process.env.POLARIS_FORCE_LOCK
    else process.env.POLARIS_FORCE_LOCK = prevForce
    if (prevKey === undefined) delete process.env.MENTOR_VAULT_KEY
    else process.env.MENTOR_VAULT_KEY = prevKey
    resetRuntimeVaultState()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('sealVaults 在 data/ 同时存在多个明文 JSON 时批量封存全部数据集并清空 data/*.json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-seal-batch-'))
  const tmpDataDir = path.join(tmp, 'data')
  const tmpBackupDir = path.join(tmp, '.local', 'plaintext-data')
  fs.mkdirSync(tmpDataDir, { recursive: true })
  fs.mkdirSync(tmpBackupDir, { recursive: true })

  try {
    const fixtures = {
      dataset: { metadata: { name: '旧名' }, mentors: [], students: [], exams: [], reviews: [], sources: [] },
      'pdf-reviews': { mentors: [], reviews: [], sources: [] },
      'mentor-notes': { notes: [], sources: [] },
      'web-profiles': { updated_at: '2026-11-26T00:00:00Z', profiles: [], sources: [] },
      'web-seeds': { seeds: [] },
    }
    for (const [name, payload] of Object.entries(fixtures)) {
      fs.writeFileSync(path.join(tmpDataDir, `${name}.json`), JSON.stringify(payload))
    }

    const summary = sealVaults({ dataDir: tmpDataDir, backupDir: tmpBackupDir, quiet: true })
    assert.equal(summary.length, VAULT_NAMES.length)
    assert.deepEqual(fs.readdirSync(tmpDataDir).filter(f => f.endsWith('.json')), [])
    for (const name of VAULT_NAMES) {
      assert.ok(fs.existsSync(vaultFilePath(name, tmpDataDir)), `应生成 ${name}.vault`)
      assert.ok(fs.existsSync(path.join(tmpBackupDir, `${name}.json`)), `应备份 ${name}.json`)
    }
    const backedDataset = JSON.parse(fs.readFileSync(path.join(tmpBackupDir, 'dataset.json'), 'utf8'))
    assert.equal(backedDataset.metadata.name, '北极星')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

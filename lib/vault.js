import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

// Polaris Encrypted Data Vault (PVLT v2 — Zero Hardcoded Key)
// Encrypts all mentor datasets at rest with Brotli + scrypt + AES-256-GCM.
// Decryption requires BOTH:
//   1. The 256-bit secret MENTOR_VAULT_KEY (never committed to Git; supplied via .env or POST /api/vault/unlock)
//   2. The unforgeable Polaris Agent Runtime capability seal.

const MAGIC = Buffer.from('PVLT\x02') // 5 bytes
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN

const AGENT_RUNTIME_SEAL = Symbol.for('polaris.agent.vault.runtime.v5')
const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url))
const DATA_DIR = path.join(ROOT_DIR, 'data')

const PROTOCOL_CONTRACT = [
  'polaris-mentor-vault-v5',
  'tools:catalog,search,query,join,aggregate,visualize,workspace,profile',
  'cipher:aes-256-gcm+scrypt+brotli',
].join('::')

let dynamicVaultKey = null

export function setRuntimeVaultKey(secret) {
  if (typeof secret !== 'string' || secret.trim().length < 16) {
    throw new Error('MENTOR_VAULT_KEY 长度不足（需至少 16 字符高熵密钥）')
  }
  dynamicVaultKey = secret.trim()
  vaultMemoryCache.clear()
}

export function resolveVaultKey() {
  if (dynamicVaultKey) return dynamicVaultKey
  if (process.env.MENTOR_VAULT_KEY?.trim()) return process.env.MENTOR_VAULT_KEY.trim()
  // Check local gitignored .env or .local/vault.key for owner CLI/test convenience
  const envPath = path.join(ROOT_DIR, '.env')
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const m = line.match(/^\s*MENTOR_VAULT_KEY\s*=\s*(.+?)\s*$/)
      if (m && m[1].replace(/^['"]|['"]$/g, '').trim()) {
        return m[1].replace(/^['"]|['"]$/g, '').trim()
      }
    }
  }
  const localKeyPath = path.join(ROOT_DIR, '.local', 'vault.key')
  if (fs.existsSync(localKeyPath)) {
    const k = fs.readFileSync(localKeyPath, 'utf8').trim()
    if (k) return k
  }
  return null
}

export function isVaultConfigured() {
  return Boolean(resolveVaultKey())
}

function deriveVaultKey(vaultName, salt, explicitKey) {
  const secret = explicitKey ?? resolveVaultKey()
  if (!secret || secret.length < 16) {
    const err = new Error('导师加密数据库处于锁定状态：缺少 MENTOR_VAULT_KEY 解锁密钥')
    err.code = 'ERR_VAULT_LOCKED'
    throw err
  }
  const material = `${PROTOCOL_CONTRACT}::${vaultName}::${secret}`
  return crypto.scryptSync(material, salt, 32, { N: 16384, r: 8, p: 1 })
}

function aadFor(vaultName) {
  return Buffer.from(`PVLT-AAD:v2:${vaultName}`, 'utf8')
}

export function grantAgentVaultAccess() {
  return AGENT_RUNTIME_SEAL
}

export function sealVaultPayload(vaultName, dataObject, explicitKey) {
  const jsonBytes = Buffer.from(JSON.stringify(dataObject), 'utf8')
  const compressed = zlib.brotliCompressSync(jsonBytes, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  })
  const salt = crypto.randomBytes(SALT_LEN)
  const iv = crypto.randomBytes(IV_LEN)
  const key = deriveVaultKey(vaultName, salt, explicitKey)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aadFor(vaultName))
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, salt, iv, tag, encrypted])
}

export function unsealVaultPayload(vaultName, buffer, capabilityToken, explicitKey) {
  if (capabilityToken !== AGENT_RUNTIME_SEAL) {
    const err = new Error('未授权的数据访问：导师加密库仅允许通过北极星 Agent API 运行时解锁')
    err.code = 'ERR_VAULT_UNAUTHORIZED'
    throw err
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_LEN) {
    const err = new Error(`加密数据包损坏或格式非法 (${vaultName})`)
    err.code = 'ERR_VAULT_CORRUPT'
    throw err
  }
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
    const err = new Error(`加密数据包版本或魔数校验失败 (${vaultName})`)
    err.code = 'ERR_VAULT_MAGIC'
    throw err
  }
  const salt = buffer.subarray(MAGIC.length, MAGIC.length + SALT_LEN)
  const iv = buffer.subarray(MAGIC.length + SALT_LEN, MAGIC.length + SALT_LEN + IV_LEN)
  const tag = buffer.subarray(MAGIC.length + SALT_LEN + IV_LEN, HEADER_LEN)
  const ciphertext = buffer.subarray(HEADER_LEN)

  const key = deriveVaultKey(vaultName, salt, explicitKey)
  let compressed
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(aadFor(vaultName))
    decipher.setAuthTag(tag)
    compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    const err = new Error(`加密数据包完整性或密钥验证失败 (${vaultName})`)
    err.code = 'ERR_VAULT_AUTH_FAILED'
    throw err
  }
  const jsonBytes = zlib.brotliDecompressSync(compressed)
  return JSON.parse(jsonBytes.toString('utf8'))
}

const vaultMemoryCache = new Map()

export const VAULT_NAMES = ['dataset', 'pdf-reviews', 'mentor-notes', 'web-profiles', 'web-seeds']

export function vaultFilePath(vaultName, dir = DATA_DIR) {
  return path.join(dir, `${vaultName}.vault`)
}

export function lockedFallbackDataset() {
  return {
    metadata: {
      name: '北极星加密导师库（待解锁）',
      year: 2026,
      vault_locked: true,
      scope: '当前导师加密库处于锁定保护状态；请在服务端配置 MENTOR_VAULT_KEY 或调用 POST /api/vault/unlock 解锁完整数据。',
      colleges: ['网络空间安全学院', '计算机学院', '人工智能学院', '软件学院'],
      counts: { mentors: 0, students: 0, exams: 0, reviews: 0, web_profiles: 0 },
      notes: ['导师评价数据已采用 AES-256-GCM 加密保护，仅限通过授权的北极星 Agent API 实例解锁访问。'],
    },
    mentors: [],
    students: [],
    exams: [],
    reviews: [],
    profiles: [],
    sources: [],
  }
}

export function unlockVaultData(vaultName, capabilityToken, { dir = DATA_DIR, useCache = true, allowLockedFallback = false } = {}) {
  if (capabilityToken !== AGENT_RUNTIME_SEAL) {
    const err = new Error('未授权的数据访问：导师加密库仅允许通过北极星 Agent API 运行时解锁')
    err.code = 'ERR_VAULT_UNAUTHORIZED'
    throw err
  }
  const filePath = vaultFilePath(vaultName, dir)
  if (!fs.existsSync(filePath)) {
    const jsonFallback = path.join(dir, `${vaultName}.json`)
    if (fs.existsSync(jsonFallback)) {
      return JSON.parse(fs.readFileSync(jsonFallback, 'utf8'))
    }
    return null
  }
  const secret = resolveVaultKey()
  if (!secret) {
    if (allowLockedFallback) return vaultName === 'dataset' ? lockedFallbackDataset() : null
    const err = new Error('导师加密数据库处于锁定状态：请配置 MENTOR_VAULT_KEY 或通过 Agent API 解锁')
    err.code = 'ERR_VAULT_LOCKED'
    throw err
  }
  const cacheKey = `${filePath}::${crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16)}`
  if (useCache && vaultMemoryCache.has(cacheKey)) {
    return structuredClone(vaultMemoryCache.get(cacheKey))
  }
  const buf = fs.readFileSync(filePath)
  const parsed = unsealVaultPayload(vaultName, buf, capabilityToken, secret)
  if (useCache) vaultMemoryCache.set(cacheKey, parsed)
  return structuredClone(parsed)
}

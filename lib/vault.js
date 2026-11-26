import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

// Polaris Encrypted Data Vault (PVLT v2)
// Encrypts all mentor datasets at rest with Brotli + scrypt + AES-256-GCM.
// Decryption requires BOTH:
//   1. The unforgeable Polaris Agent Runtime capability seal (gated to ./data.js).
//   2. Either an explicit MENTOR_VAULT_KEY override or the project-bound built-in key derivation.

const MAGIC = Buffer.from('PVLT\x02') // 5 bytes
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN

const AGENT_RUNTIME_SEAL = Symbol('polaris.agent.vault.runtime.v5')
const SELF_PATH = path.resolve(fileURLToPath(import.meta.url))
const AUTHORIZED_CALLER_PATH = path.resolve(fileURLToPath(new URL('./data.js', import.meta.url)))
const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url))
const DATA_DIR = path.join(ROOT_DIR, 'data')

const PROTOCOL_CONTRACT = [
  'polaris-mentor-vault-v5',
  'tools:catalog,search,query,join,aggregate,visualize,workspace,profile',
  'cipher:aes-256-gcm+scrypt+brotli',
].join('::')

export const VAULT_NAMES = ['dataset', 'pdf-reviews', 'mentor-notes', 'web-profiles', 'web-seeds']

let dynamicVaultKey = null
let runtimeLockBypassed = false
let runtimeBuiltinOverride = false
let runtimeClaimed = false
const vaultMemoryCache = new Map()

function unauthorizedError(message = '未授权的数据访问：导师加密库仅允许通过北极星 Agent API 运行时解锁') {
  const err = new Error(message)
  err.code = 'ERR_VAULT_UNAUTHORIZED'
  return err
}

function lockedError(message = '导师加密数据库处于锁定状态：缺少有效的 MENTOR_VAULT_KEY 解锁密钥') {
  const err = new Error(message)
  err.code = 'ERR_VAULT_LOCKED'
  return err
}

function normalizeCallerPath(fileName) {
  if (!fileName || typeof fileName !== 'string') return null
  try {
    const resolved = fileName.startsWith('file://') ? fileURLToPath(fileName) : fileName
    return path.resolve(resolved)
  } catch {
    return null
  }
}

function sameRealPath(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return false
  }
}

function getDirectCallerPath() {
  const originalPrepare = Error.prepareStackTrace
  try {
    Error.prepareStackTrace = (_, stack) => stack
    const err = new Error()
    const frames = err.stack
    if (!Array.isArray(frames)) return null
    for (const frame of frames) {
      const file = normalizeCallerPath(frame?.getFileName?.())
      if (!file) continue
      if (sameRealPath(file, SELF_PATH)) continue
      return file
    }
    return null
  } finally {
    Error.prepareStackTrace = originalPrepare
  }
}

export function isForceLocked() {
  return !runtimeLockBypassed && /^(1|true|yes)$/i.test(String(process.env.POLARIS_FORCE_LOCK || '').trim())
}

export function setRuntimeVaultKey(secret) {
  if (typeof secret !== 'string' || secret.trim().length < 16) {
    throw lockedError('MENTOR_VAULT_KEY 长度不足（需至少 16 字符高熵密钥）')
  }
  dynamicVaultKey = secret.trim()
  runtimeLockBypassed = true
  runtimeBuiltinOverride = false
  vaultMemoryCache.clear()
}

export function unlockBuiltinRuntime() {
  dynamicVaultKey = null
  runtimeLockBypassed = true
  runtimeBuiltinOverride = true
  vaultMemoryCache.clear()
}

export function clearRuntimeVaultKey() {
  dynamicVaultKey = null
  runtimeBuiltinOverride = false
  vaultMemoryCache.clear()
}

export function resetRuntimeVaultState() {
  dynamicVaultKey = null
  runtimeLockBypassed = false
  runtimeBuiltinOverride = false
  vaultMemoryCache.clear()
}

export function isBuiltinRuntimeOverride() {
  return runtimeBuiltinOverride
}

export function getRuntimeVaultState() {
  return {
    dynamicVaultKey,
    runtimeLockBypassed,
    runtimeBuiltinOverride,
  }
}

export function restoreRuntimeVaultState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return
  dynamicVaultKey = snapshot.dynamicVaultKey ?? null
  runtimeLockBypassed = Boolean(snapshot.runtimeLockBypassed)
  runtimeBuiltinOverride = Boolean(snapshot.runtimeBuiltinOverride)
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

function deriveBuiltinProjectSecret(capabilityToken) {
  if (capabilityToken !== AGENT_RUNTIME_SEAL) {
    throw unauthorizedError()
  }
  const ikm = Buffer.from(`${PROTOCOL_CONTRACT}::polaris-mentor::北极星`, 'utf8')
  const salt = Buffer.from('PVLT-AAD:v2', 'utf8')
  const info = Buffer.from(VAULT_NAMES.join('|'), 'utf8')
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 32)).toString('hex')
}

function resolveSecretForOption(explicitKeyOrOptions, capabilityToken) {
  if (typeof explicitKeyOrOptions === 'string') {
    const trimmed = explicitKeyOrOptions.trim()
    if (trimmed.length < 16) {
      throw lockedError('MENTOR_VAULT_KEY 长度不足（需至少 16 字符高熵密钥）')
    }
    return trimmed
  }
  if (explicitKeyOrOptions && typeof explicitKeyOrOptions === 'object') {
    const mode = explicitKeyOrOptions.keyMode ?? explicitKeyOrOptions.mode
    if (mode === 'builtin') {
      return deriveBuiltinProjectSecret(capabilityToken)
    }
    if (mode === 'custom') {
      const custom = typeof explicitKeyOrOptions.key === 'string'
        ? explicitKeyOrOptions.key.trim()
        : resolveVaultKey()
      if (!custom || custom.length < 16) {
        throw lockedError('导师加密数据库处于锁定状态：缺少有效的 MENTOR_VAULT_KEY 解锁密钥')
      }
      return custom
    }
    if (typeof explicitKeyOrOptions.explicitKey === 'string') {
      const trimmed = explicitKeyOrOptions.explicitKey.trim()
      if (trimmed.length < 16) {
        throw lockedError('MENTOR_VAULT_KEY 长度不足（需至少 16 字符高熵密钥）')
      }
      return trimmed
    }
  }
  const explicit = resolveVaultKey()
  if (explicit !== null) {
    if (explicit.length < 16) {
      throw lockedError('MENTOR_VAULT_KEY 长度不足（需至少 16 字符高熵密钥）')
    }
    return explicit
  }
  return deriveBuiltinProjectSecret(capabilityToken)
}

function deriveVaultKey(vaultName, salt, explicitKeyOrOptions, capabilityToken) {
  const secret = resolveSecretForOption(explicitKeyOrOptions, capabilityToken)
  const material = `${PROTOCOL_CONTRACT}::${vaultName}::${secret}`
  return crypto.scryptSync(material, salt, 32, { N: 16384, r: 8, p: 1 })
}

function aadFor(vaultName) {
  return Buffer.from(`PVLT-AAD:v2:${vaultName}`, 'utf8')
}

export function grantAgentVaultAccess() {
  if (runtimeClaimed) {
    throw unauthorizedError('未授权的数据访问：运行时访问令牌仅允许北极星数据模块单次领取')
  }
  const caller = getDirectCallerPath()
  if (!sameRealPath(caller, AUTHORIZED_CALLER_PATH)) {
    throw unauthorizedError('未授权的数据访问：仅允许 lib/data.js 领取运行时访问令牌')
  }
  runtimeClaimed = true
  return AGENT_RUNTIME_SEAL
}

export function sealVaultPayload(vaultName, dataObject, explicitKeyOrOptions) {
  const jsonBytes = Buffer.from(JSON.stringify(dataObject), 'utf8')
  const compressed = zlib.brotliCompressSync(jsonBytes, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  })
  const salt = crypto.randomBytes(SALT_LEN)
  const iv = crypto.randomBytes(IV_LEN)
  const key = deriveVaultKey(vaultName, salt, explicitKeyOrOptions, AGENT_RUNTIME_SEAL)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aadFor(vaultName))
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, salt, iv, tag, encrypted])
}

export function unsealVaultPayload(vaultName, buffer, capabilityToken, explicitKeyOrOptions) {
  if (capabilityToken !== AGENT_RUNTIME_SEAL) {
    throw unauthorizedError()
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

  const key = deriveVaultKey(vaultName, salt, explicitKeyOrOptions, capabilityToken)
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

export function verifyVaultRoundTrip(vaultName, buffer, expectedObject, explicitKeyOrOptions) {
  const verified = unsealVaultPayload(vaultName, buffer, AGENT_RUNTIME_SEAL, explicitKeyOrOptions)
  if (JSON.stringify(verified) !== JSON.stringify(expectedObject)) {
    const err = new Error(`加密回环校验不一致：${vaultName}`)
    err.code = 'ERR_VAULT_ROUNDTRIP_MISMATCH'
    throw err
  }
  return { ok: true }
}

export function verifyVaultKey(secret, { dir = DATA_DIR, allowBuiltin = false } = {}) {
  const filePath = vaultFilePath('dataset', dir)
  if (!fs.existsSync(filePath)) {
    const err = new Error(`找不到加密库文件 (${filePath})`)
    err.code = 'ENOENT'
    throw err
  }
  const trimmed = typeof secret === 'string' ? secret.trim() : ''
  const useBuiltin = allowBuiltin && !trimmed
  if (!useBuiltin && trimmed.length < 16) {
    throw lockedError('MENTOR_VAULT_KEY 长度不足（需至少 16 字符高熵密钥）')
  }
  const keyOption = useBuiltin ? { keyMode: 'builtin' } : trimmed
  unsealVaultPayload('dataset', fs.readFileSync(filePath), AGENT_RUNTIME_SEAL, keyOption)
  for (const name of VAULT_NAMES) {
    if (name === 'dataset') continue
    const extraPath = vaultFilePath(name, dir)
    if (fs.existsSync(extraPath)) {
      unsealVaultPayload(name, fs.readFileSync(extraPath), AGENT_RUNTIME_SEAL, keyOption)
    }
  }
  return { ok: true, mode: useBuiltin ? 'builtin' : 'custom' }
}

export function vaultFilePath(vaultName, dir = DATA_DIR) {
  return path.join(dir, `${vaultName}.vault`)
}

export function lockedFallbackDataset() {
  return {
    metadata: {
      name: '北极星加密导师库（待解锁）',
      year: 2026,
      vault_locked: true,
      vault_mode: 'locked',
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
    throw unauthorizedError()
  }
  const filePath = vaultFilePath(vaultName, dir)
  if (!fs.existsSync(filePath)) {
    const jsonFallback = path.join(dir, `${vaultName}.json`)
    if (fs.existsSync(jsonFallback)) {
      return JSON.parse(fs.readFileSync(jsonFallback, 'utf8'))
    }
    return null
  }
  if (isForceLocked()) {
    if (allowLockedFallback) return vaultName === 'dataset' ? lockedFallbackDataset() : null
    throw lockedError('导师加密数据库处于锁定状态：当前启用了 POLARIS_FORCE_LOCK')
  }
  let explicit = null
  let mode = 'builtin'
  if (!runtimeBuiltinOverride) {
    explicit = resolveVaultKey()
    mode = explicit ? 'custom' : 'builtin'
    if (explicit !== null && explicit.length < 16) {
      if (allowLockedFallback) return vaultName === 'dataset' ? lockedFallbackDataset() : null
      throw lockedError('MENTOR_VAULT_KEY 长度不足（需至少 16 字符高熵密钥）')
    }
  }
  const secretForCache = runtimeBuiltinOverride || !explicit
    ? deriveBuiltinProjectSecret(capabilityToken)
    : explicit
  const cacheKey = `${filePath}::${mode}::${crypto.createHash('sha256').update(secretForCache).digest('hex').slice(0, 16)}`
  let parsed
  if (useCache && vaultMemoryCache.has(cacheKey)) {
    parsed = vaultMemoryCache.get(cacheKey)
  } else {
    const buf = fs.readFileSync(filePath)
    try {
      parsed = unsealVaultPayload(
        vaultName,
        buf,
        capabilityToken,
        runtimeBuiltinOverride ? { keyMode: 'builtin' } : (explicit ?? { keyMode: 'builtin' }),
      )
    } catch (error) {
      if (allowLockedFallback && ['ERR_VAULT_AUTH_FAILED', 'ERR_VAULT_LOCKED'].includes(error.code)) {
        return vaultName === 'dataset' ? lockedFallbackDataset() : null
      }
      throw error
    }
    if (useCache) vaultMemoryCache.set(cacheKey, parsed)
  }
  const cloned = structuredClone(parsed)
  if (vaultName === 'dataset' && cloned && typeof cloned === 'object') {
    cloned.metadata = {
      ...cloned.metadata,
      vault_locked: false,
      vault_mode: mode,
    }
  }
  return cloned
}

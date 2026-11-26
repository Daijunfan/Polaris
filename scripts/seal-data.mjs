import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { APP_NAME } from '../lib/brand.js'
import {
  VAULT_NAMES,
  resolveVaultKey,
  sealVaultPayload,
  vaultFilePath,
  verifyVaultKey,
  verifyVaultRoundTrip,
} from '../lib/vault.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const defaultDataDir = path.join(root, 'data')
const defaultBackupDir = path.join(root, '.local', 'plaintext-data')

function resolveSealMode(options = {}) {
  if (options.key != null) {
    const trimmed = String(options.key).trim()
    if (trimmed.length < 16) {
      throw new Error('--key 密钥长度不足（需至少 16 字符高熵密钥）')
    }
    return { keyOption: trimmed, mode: 'custom' }
  }
  if (options.custom) {
    const configured = resolveVaultKey()
    if (!configured || configured.length < 16) {
      throw new Error('启用了 --custom，但未在环境变量、.env 或 .local/vault.key 中找到有效的 MENTOR_VAULT_KEY（需至少 16 字符）')
    }
    return { keyOption: configured, mode: 'custom' }
  }
  return { keyOption: { keyMode: 'builtin' }, mode: 'builtin' }
}

export function sealSingleVault(name, options = {}) {
  if (!VAULT_NAMES.includes(name)) {
    throw new Error(`未知加密数据集名称：${name}（允许值：${VAULT_NAMES.join(', ')}）`)
  }
  const dataDir = options.dataDir || defaultDataDir
  const backupDir = options.backupDir || defaultBackupDir
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(backupDir, { recursive: true })

  const { keyOption, mode } = resolveSealMode(options)
  const jsonInData = path.join(dataDir, `${name}.json`)
  const jsonInBackup = path.join(backupDir, `${name}.json`)
  const sourcePath = fs.existsSync(jsonInData) ? jsonInData : jsonInBackup

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`找不到源数据文件：${name}.json（已检查 data/ 与 .local/plaintext-data/）`)
  }

  let rawJson = fs.readFileSync(sourcePath, 'utf8')
  const parsed = JSON.parse(rawJson)

  let wroteNormalizedBackup = false
  if (name === 'dataset' && parsed?.metadata && parsed.metadata.name !== APP_NAME) {
    parsed.metadata.name = APP_NAME
    const normalized = JSON.stringify(parsed, null, 2) + '\n'
    fs.writeFileSync(jsonInBackup, normalized, { mode: 0o600 })
    rawJson = normalized
    wroteNormalizedBackup = true
  }

  const sealed = sealVaultPayload(name, parsed, keyOption)
  verifyVaultRoundTrip(name, sealed, parsed, keyOption)

  const outVault = vaultFilePath(name, dataDir)
  fs.writeFileSync(outVault, sealed)

  if (fs.existsSync(jsonInData)) {
    if (!wroteNormalizedBackup) {
      fs.copyFileSync(jsonInData, jsonInBackup)
      try { fs.chmodSync(jsonInBackup, 0o600) } catch {}
    }
    fs.unlinkSync(jsonInData)
  }

  if (fs.existsSync(jsonInData)) {
    throw new Error(`封存后 ${path.basename(dataDir)}/ 目录仍残留明文 JSON：${name}.json`)
  }

  return {
    name,
    mode,
    vault: `data/${name}.vault`,
    rawBytes: Buffer.byteLength(rawJson),
    encryptedBytes: sealed.length,
    ratio: `${((sealed.length / Buffer.byteLength(rawJson)) * 100).toFixed(1)}%`,
  }
}

export function sealVaults(options = {}) {
  const names = options.only?.length ? options.only : VAULT_NAMES
  for (const name of names) {
    if (!VAULT_NAMES.includes(name)) {
      throw new Error(`未知加密数据集名称：${name}（允许值：${VAULT_NAMES.join(', ')}）`)
    }
  }

  const { mode } = resolveSealMode(options)
  if (mode === 'custom' && !options.quiet) {
    console.warn('注意：当前使用自定义密钥 (--custom/--key) 封存；未配置相同 MENTOR_VAULT_KEY 的新克隆环境将无法自动解密。')
  }

  const summary = names.map(name => sealSingleVault(name, options))

  const dataDir = options.dataDir || defaultDataDir
  const strayJson = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'))
  if (strayJson.length > 0) {
    throw new Error(`data/ 目录不得留存任何明文 JSON：${strayJson.join(', ')}`)
  }

  if (mode === 'builtin' && !options.quiet) {
    const localOverride = resolveVaultKey()
    if (localOverride) {
      let matches = false
      try {
        verifyVaultKey(localOverride, { dir: dataDir })
        matches = true
      } catch {
        matches = false
      }
      if (!matches) {
        console.warn('警告：检测到本地 .env 或 .local/vault.key 配置了与内置密钥不匹配的 MENTOR_VAULT_KEY；本地运行时会优先使用该密钥导致数据集进入锁定状态，建议注释或移除旧密钥。')
      }
    }
  }

  return summary
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'built-in': { type: 'boolean', default: false },
      custom: { type: 'boolean', default: false },
      key: { type: 'string' },
      only: { type: 'string' },
    },
  })
  if (values['built-in'] && (values.custom || values.key !== undefined)) {
    throw new Error('--built-in 不能与 --custom 或 --key 同时使用')
  }
  if (values.custom && values.key !== undefined) {
    throw new Error('--custom 与 --key 不能同时使用')
  }
  const only = values.only
    ? values.only.split(',').map(item => item.trim()).filter(Boolean)
    : undefined
  const summary = sealVaults({
    custom: values.custom,
    key: values.key,
    only,
  })
  console.log('Polaris Vault 加密封存完成（明文已隔离至 .local/plaintext-data/）：')
  console.table(summary.map(({ vault, mode, rawBytes, encryptedBytes, ratio }) => ({
    vault,
    mode,
    rawBytes,
    encryptedBytes,
    ratio,
  })))
}

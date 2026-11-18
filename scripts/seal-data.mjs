import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VAULT_NAMES, sealVaultPayload, unsealVaultPayload, grantAgentVaultAccess, vaultFilePath } from '../lib/vault.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const dataDir = path.join(root, 'data')
const backupDir = path.join(root, '.local', 'plaintext-data')
fs.mkdirSync(backupDir, { recursive: true })

const token = grantAgentVaultAccess()
const summary = []

for (const name of VAULT_NAMES) {
  const jsonInData = path.join(dataDir, `${name}.json`)
  const jsonInBackup = path.join(backupDir, `${name}.json`)
  const sourcePath = fs.existsSync(jsonInData) ? jsonInData : jsonInBackup

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`找不到源数据文件：${name}.json`)
  }
  const rawJson = fs.readFileSync(sourcePath, 'utf8')
  const parsed = JSON.parse(rawJson)
  const sealed = sealVaultPayload(name, parsed)

  // Verify round-trip integrity before removing plaintext from data/
  const verified = unsealVaultPayload(name, sealed, token)
  if (JSON.stringify(verified) !== JSON.stringify(parsed)) {
    throw new Error(`加密回环校验不一致：${name}`)
  }

  const outVault = vaultFilePath(name, dataDir)
  fs.writeFileSync(outVault, sealed)

  // Keep local private backup in .local/plaintext-data/ (gitignored) and remove plaintext from data/
  if (fs.existsSync(jsonInData)) {
    fs.copyFileSync(jsonInData, jsonInBackup)
    fs.unlinkSync(jsonInData)
  }

  summary.push({
    vault: `data/${name}.vault`,
    rawBytes: Buffer.byteLength(rawJson),
    encryptedBytes: sealed.length,
    ratio: `${((sealed.length / Buffer.byteLength(rawJson)) * 100).toFixed(1)}%`,
  })
}

console.log('Polaris Vault 加密封存完成（明文已移出仓库至 .local/plaintext-data/）：')
console.table(summary)

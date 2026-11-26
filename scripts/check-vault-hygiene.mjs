import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { APP_NAME } from '../lib/brand.js'
import { loadData, readSealedDataset } from '../lib/data.js'
import {
  VAULT_NAMES,
  grantAgentVaultAccess,
  isForceLocked,
  isVaultConfigured,
  unsealVaultPayload,
  vaultFilePath,
  verifyVaultKey,
} from '../lib/vault.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const dataDir = path.join(root, 'data')

const FORBIDDEN_TRACKED_RULES = [
  { rule: 'tracked-non-vault-in-data', re: /^data\/(?!.*\.vault$).+/ },
  { rule: 'tracked-env-file', re: /(?:^|\/)\.env(?:\..+)?$/, allow: /(?:^|\/)\.env\.example$/ },
  { rule: 'tracked-sensitive-ext', re: /\.(?:key|pem|crt|p12|pfx|xlsx|xls|pdf|zip|tar\.gz|7z|log|dmg|exe|app|msi|deb|rpm|AppImage|blockmap)(?:\/|$)/i },
  { rule: 'tracked-raw-source', re: /(?:^|\/)(?:初试结果\.md|复试结果\.md|导师评价\.md|src\/data\/admissionData\.js)$/ },
  { rule: 'tracked-local-or-artifact-dir', re: /(?:^|\/)(?:\.local|PDFs|node_modules|dist|dist-desktop|release|test-results|playwright-report)(?:\/|$)/ },
  { rule: 'tracked-os-junk', re: /(?:^|\/)(?:\.DS_Store|\._.*|Thumbs\.db)$/ },
]

const PLAINTEXT_JSON_MARKERS = [
  '"mentors":',
  '"reviews":',
  '"students":',
  '"exams":',
  '"profiles":',
  '"review_text":',
  '"stipend_text":',
  '"student_name":',
]

const PLAINTEXT_DOMAIN_MARKERS = [
  '网络空间安全学院',
  '计算机学院',
  '软件学院',
  '人工智能学院',
  '北京邮电大学',
  '导师自助餐',
  '360eol.com',
  'bupt.edu.cn',
  '付俊松',
  '左兴权',
  '高慧',
  '王小婕',
]

const BINARY_EXTS = new Set(['.vault', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.icns', '.woff', '.woff2', '.ttf', '.eot'])

function gitPaths(args) {
  const out = execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: root,
    encoding: 'buffer',
  })
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(item => item.replaceAll('\\', '/'))
}

function checkPaths(paths, scope, failures) {
  for (const rel of paths) {
    for (const item of FORBIDDEN_TRACKED_RULES) {
      if (item.allow?.test(rel)) continue
      if (item.re.test(rel)) {
        failures.push({ rule: `${scope}:${item.rule}`, path: rel, message: `禁止追踪或暂存敏感/明文路径：${rel}` })
      }
    }
  }
}

function collectLocalSecretsInMemory() {
  const secrets = []
  const envFile = path.join(root, '.env')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:MENTOR_VAULT_KEY|MENTOR_API_KEY)\s*=\s*(.+?)\s*$/)
      if (m) {
        const val = m[1].replace(/^['"]|['"]$/g, '').trim()
        if (val.length >= 12) secrets.push(val)
      }
    }
  }
  for (const keyName of ['vault.key', 'vault.key.pre-m1.bak']) {
    const keyFile = path.join(root, '.local', keyName)
    if (fs.existsSync(keyFile)) {
      const val = fs.readFileSync(keyFile, 'utf8').trim()
      if (val.length >= 12) secrets.push(val)
    }
  }
  return [...new Set(secrets)]
}

export function runVaultHygieneCheck({ staged = false, unseal = true } = {}) {
  const failures = []
  const tracked = gitPaths(['ls-files', '-z'])
  checkPaths(tracked, 'git', failures)

  for (const name of VAULT_NAMES) {
    const expected = `data/${name}.vault`
    if (!tracked.includes(expected)) {
      failures.push({ rule: 'git:missing-tracked-vault', path: expected, message: `仓库未追踪加密数据集：${expected}` })
    }
  }

  if (staged) {
    const stagedFiles = gitPaths(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'])
    checkPaths(stagedFiles, 'staged', failures)
  }

  // Working-tree data/ directory audit
  if (!fs.existsSync(dataDir)) {
    failures.push({ rule: 'data-dir:missing', path: 'data', message: '缺少 data/ 目录' })
  } else {
    const entries = fs.readdirSync(dataDir)
    const expectedSet = new Set(VAULT_NAMES.map(name => `${name}.vault`))
    for (const entry of entries) {
      if (entry.endsWith('.json')) {
        failures.push({ rule: 'data-dir:plaintext-json', path: `data/${entry}`, message: `data/ 下不得留存明文 JSON：${entry}` })
      } else if (!expectedSet.has(entry)) {
        failures.push({ rule: 'data-dir:unexpected-file', path: `data/${entry}`, message: `data/ 下存在非受控文件：${entry}` })
      }
    }
    for (const name of VAULT_NAMES) {
      if (!entries.includes(`${name}.vault`)) {
        failures.push({ rule: 'data-dir:missing-vault', path: `data/${name}.vault`, message: `缺少加密库文件：data/${name}.vault` })
      }
    }
  }

  // Binary .vault header & anti-plaintext scan
  const magic = Buffer.from('PVLT\x02')
  for (const name of VAULT_NAMES) {
    const file = vaultFilePath(name, dataDir)
    if (!fs.existsSync(file)) continue
    const buf = fs.readFileSync(file)
    if (buf.length <= 49 || !buf.subarray(0, 5).equals(magic)) {
      failures.push({ rule: 'vault:invalid-header', path: `data/${name}.vault`, message: `加密包魔数或头部长度无效：data/${name}.vault` })
      continue
    }
    const asUtf8 = buf.toString('utf8')
    const asLatin1 = buf.toString('latin1')
    const hasLeak = PLAINTEXT_JSON_MARKERS.some(marker => asUtf8.includes(marker) || asLatin1.includes(marker))
      || PLAINTEXT_DOMAIN_MARKERS.some(marker => asUtf8.includes(marker) || asLatin1.includes(marker))
    if (hasLeak) {
      failures.push({ rule: 'vault:plaintext-leak', path: `data/${name}.vault`, message: `加密包中检测到可读明文或结构标记：data/${name}.vault` })
    }
  }

  // Built-in unseal & runtime boundary checks
  if (unseal) {
    const datasetVault = vaultFilePath('dataset', dataDir)
    if (fs.existsSync(datasetVault)) {
      const buf = fs.readFileSync(datasetVault)
      for (const badToken of [null, Symbol('fake')]) {
        let rejected = false
        try {
          unsealVaultPayload('dataset', buf, badToken)
        } catch (err) {
          rejected = err?.code === 'ERR_VAULT_UNAUTHORIZED'
        }
        if (!rejected) {
          failures.push({ rule: 'vault:unauthorized-token-accepted', path: 'lib/vault.js', message: '未授权令牌未被 ERR_VAULT_UNAUTHORIZED 拒绝' })
        }
      }
      let grantRejected = false
      try {
        grantAgentVaultAccess()
      } catch (err) {
        grantRejected = err?.code === 'ERR_VAULT_UNAUTHORIZED'
      }
      if (!grantRejected) {
        failures.push({ rule: 'vault:grant-not-gated', path: 'lib/vault.js', message: 'grantAgentVaultAccess() 未拒绝外部调用' })
      }
      let wrongKeyRejected = false
      try {
        verifyVaultKey('00000000000000000000000000000000', { dir: dataDir })
      } catch (err) {
        wrongKeyRejected = err?.code === 'ERR_VAULT_AUTH_FAILED'
      }
      if (!wrongKeyRejected) {
        failures.push({ rule: 'vault:wrong-key-accepted', path: 'lib/vault.js', message: '错误密钥未被 ERR_VAULT_AUTH_FAILED 拒绝' })
      }
      try {
        verifyVaultKey('', { dir: dataDir, allowBuiltin: true })
      } catch (err) {
        failures.push({ rule: 'vault:builtin-key-failed', path: 'data/dataset.vault', message: `内置项目密钥无法解密 dataset.vault (${err.code || err.message})` })
      }
    }

    if (!isForceLocked() && !isVaultConfigured()) {
      try {
        for (const name of VAULT_NAMES) {
          const item = readSealedDataset(name)
          if (!item) {
            failures.push({ rule: 'vault:builtin-unseal-empty', path: `data/${name}.vault`, message: `内置解密返回空结果：${name}` })
          }
        }
        const loaded = loadData()
        if (loaded?.metadata?.vault_locked) {
          failures.push({ rule: 'vault:builtin-locked', path: 'data/dataset.vault', message: '内置解密后仍处于 vault_locked 状态' })
        }
        if (loaded?.metadata?.name !== APP_NAME) {
          failures.push({ rule: 'vault:metadata-name-mismatch', path: 'data/dataset.vault', message: `dataset metadata.name 应为 "${APP_NAME}"，实际为 "${loaded?.metadata?.name}"` })
        }
        if (!loaded?.mentors?.length || !loaded?.reviews?.length || !loaded?.profiles?.length) {
          failures.push({ rule: 'vault:incomplete-counts', path: 'data/dataset.vault', message: '内置解密后数据集计数为空' })
        }
      } catch (err) {
        failures.push({ rule: 'vault:builtin-unseal-error', path: 'data/*.vault', message: `内置解密失败：${err.message}` })
      }
    }
  }

  // Tracked source secret leak audit
  const vaultSourcePath = path.join(root, 'lib', 'vault.js')
  if (fs.existsSync(vaultSourcePath)) {
    const src = fs.readFileSync(vaultSourcePath, 'utf8')
    if (src.includes('K_SHARDS')) {
      failures.push({ rule: 'source:k-shards', path: 'lib/vault.js', message: 'lib/vault.js 禁止包含 K_SHARDS' })
    }
    if (src.includes('Symbol.for(')) {
      failures.push({ rule: 'source:symbol-for', path: 'lib/vault.js', message: 'lib/vault.js 禁止使用全局 Symbol.for(' })
    }
  }

  const localSecrets = collectLocalSecretsInMemory()
  const privateKeyRe = new RegExp('-----BEGIN ' + '[A-Z ]*PRIVATE KEY-----')
  const tokenRe = /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,})\b/

  for (const rel of tracked) {
    const ext = path.extname(rel).toLowerCase()
    if (BINARY_EXTS.has(ext)) continue
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
    const content = fs.readFileSync(abs, 'utf8')
    if (privateKeyRe.test(content)) {
      failures.push({ rule: 'source:private-key-header', path: rel, message: `受控文本文件中检测到私钥头部：${rel}` })
    }
    if (tokenRe.test(content)) {
      failures.push({ rule: 'source:hardcoded-token', path: rel, message: `受控文本文件中检测到疑似明文令牌：${rel}` })
    }
    for (const secret of localSecrets) {
      if (content.includes(secret)) {
        failures.push({ rule: 'source:local-secret-leak', path: rel, message: `受控文本文件中检测到本地密钥原文泄漏：${rel}` })
        break
      }
    }
  }

  return {
    ok: failures.length === 0,
    checkedVaults: VAULT_NAMES.length,
    trackedCount: tracked.length,
    failures,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      json: { type: 'boolean', default: false },
      staged: { type: 'boolean', default: false },
      'no-unseal': { type: 'boolean', default: false },
    },
  })
  const report = runVaultHygieneCheck({
    staged: values.staged,
    unseal: !values['no-unseal'],
  })
  if (values.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else if (report.ok) {
    console.log(`Polaris Vault 卫生检查通过：已核验 ${report.trackedCount} 个受控文件与 ${report.checkedVaults} 个加密库。`)
  } else {
    console.error(`Polaris Vault 卫生检查失败（${report.failures.length} 项违规）：`)
    for (const item of report.failures) {
      console.error(`- [${item.rule}] ${item.path}: ${item.message}`)
    }
  }
  if (!report.ok) process.exitCode = 1
}

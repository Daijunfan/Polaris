import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { VAULT_NAMES } from '../lib/vault.js'

const defaultRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const VAULT_MAGIC = Buffer.from('PVLT\x02')
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
const PRIVATE_KEY_RE = new RegExp('-----BEGIN ' + '[A-Z ]*PRIVATE KEY-----')
const TOKEN_RE = /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,})\b/

export function isForbiddenReleasePath(file) {
  const relative = String(file || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (!relative) return false
  const parts = relative.split('/')
  if (parts.some(part =>
    part === 'node_modules' ||
    part === '.local' ||
    part === 'dist-desktop' ||
    part === 'release' ||
    part === 'test-results' ||
    part === 'playwright-report' ||
    part === '__pycache__' ||
    part === '.DS_Store' ||
    part === 'Thumbs.db' ||
    part.startsWith('._') ||
    /\.app$/i.test(part) ||
    (part.startsWith('.env') && part !== '.env.example')
  )) return true
  if (/\.(?:pyc|pyo|key|pem|crt|p12|pfx|pdf|xls|xlsx|zip|tar\.gz|7z|log|dmg|exe|app|msi|deb|rpm|AppImage|blockmap)$/i.test(relative)) return true
  if (['初试结果.md', '复试结果.md', '导师评价.md', 'src/data/admissionData.js'].includes(relative)) return true
  if (relative.startsWith('data/') && !/^data\/[^/]+\.vault$/.test(relative)) return true
  return false
}

export function parseTarListing(output, rootName) {
  const prefix = `${rootName}/`
  const entries = String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^\.\//, ''))

  const relativeMembers = []
  for (const member of entries) {
    const normalized = member.replace(/\/+$/, '')
    if (normalized === rootName) continue
    if (!member.startsWith(prefix)) {
      throw new Error(`归档成员前缀异常：${member}`)
    }
    const relative = member.slice(prefix.length)
    if (isForbiddenReleasePath(relative)) {
      throw new Error('归档包含系统元数据或运行时文件')
    }
    const cleanRel = relative.replace(/\/+$/, '')
    if (cleanRel) relativeMembers.push(cleanRel)
  }
  return relativeMembers
}

export async function packageRelease({ out: outArg, root = defaultRoot } = {}) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const out = path.resolve(outArg || path.join(root, '.local/releases'))
  await fs.mkdir(out, { recursive: true })
  const staging = await fs.mkdtemp(path.join(out, '.stage-'))
  const name = `${pkg.name}-${pkg.version}`
  const project = path.join(staging, name)
  const files = []

  try {
    await fs.mkdir(project)
    const entries = new Set([
      ...pkg.files,
      'package.json',
      'package-lock.json',
      'README.md',
      'LICENSE',
      '.gitignore',
      '.gitattributes',
    ])
    for (const entry of entries) {
      const source = path.join(root, entry)
      if (entry.startsWith('data/') && !fsSync.existsSync(source)) {
        throw new Error(`发行包缺少加密数据集：${entry}`)
      }
      const target = path.join(project, entry)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.cp(source, target, {
        recursive: true,
        filter: src => !isForbiddenReleasePath(path.relative(root, src)),
      })
    }

    async function inventory(directory) {
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name)
        const relative = path.relative(project, file).split(path.sep).join('/')
        if (isForbiddenReleasePath(relative)) throw new Error(`发行包包含禁止文件：${relative}`)
        if (item.isSymbolicLink()) throw new Error(`发行包不能包含外部链接：${relative}`)
        if (item.isDirectory()) await inventory(file)
        else {
          const content = await fs.readFile(file)
          if (relative.startsWith('data/')) {
            if (content.length <= 49 || !content.subarray(0, 5).equals(VAULT_MAGIC)) {
              throw new Error(`发行包加密数据集魔数或长度无效：${relative}`)
            }
            const asUtf8 = content.toString('utf8')
            const asLatin1 = content.toString('latin1')
            const hasLeak = PLAINTEXT_JSON_MARKERS.some(marker => asUtf8.includes(marker) || asLatin1.includes(marker))
              || PLAINTEXT_DOMAIN_MARKERS.some(marker => asUtf8.includes(marker) || asLatin1.includes(marker))
            if (hasLeak) {
              throw new Error(`发行包加密数据集检测到明文或结构标记：${relative}`)
            }
          } else if (!BINARY_EXTS.has(path.extname(relative).toLowerCase())) {
            const text = content.toString('utf8')
            if (PRIVATE_KEY_RE.test(text)) {
              throw new Error(`发行包文本文件包含私钥头部：${relative}`)
            }
            if (TOKEN_RE.test(text)) {
              throw new Error(`发行包文本文件包含疑似明文令牌：${relative}`)
            }
          }
          files.push({ path: relative, sha256: createHash('sha256').update(content).digest('hex') })
        }
      }
    }

    await inventory(project)
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

    const archiveName = `${name}.tar.gz`
    const archive = path.join(out, archiveName)
    const stagingRel = path.relative(out, staging) || '.'
    const tarCmd = process.platform === 'darwin' && fsSync.existsSync('/usr/bin/tar') ? '/usr/bin/tar' : 'tar'
    const args = [
      '-czf',
      archiveName,
      ...(process.platform === 'darwin' ? ['--no-mac-metadata', '--no-xattrs'] : []),
      '-C',
      stagingRel,
      name,
    ]
    execFileSync(tarCmd, args, {
      cwd: out,
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      stdio: 'pipe',
      windowsHide: true,
    })

    const listing = execFileSync(tarCmd, ['-tzf', archiveName], {
      cwd: out,
      encoding: 'utf8',
      windowsHide: true,
    })
    const members = parseTarListing(listing, name)

    const expectedVaults = VAULT_NAMES.map(vaultName => `data/${vaultName}.vault`)
    for (const vault of expectedVaults) {
      if (!members.includes(vault)) {
        throw new Error(`发行包缺少加密数据集：${vault}`)
      }
    }

    const manifest = {
      name: pkg.name,
      version: pkg.version,
      sha256: createHash('sha256').update(await fs.readFile(archive)).digest('hex'),
      files,
    }
    await fs.writeFile(path.join(out, `${name}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
    return { archive, sha256: manifest.sha256, files: files.length, members }
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

const isMain = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
if (isMain) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } })
  const result = await packageRelease({ out: values.out })
  console.log(JSON.stringify({ archive: result.archive, sha256: result.sha256, files: result.files }))
}

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { APP_NAME } from '../lib/brand.js'
import { VAULT_NAMES } from '../lib/vault.js'
import { isForbiddenReleasePath, packageRelease, parseTarListing } from '../scripts/package-release.mjs'
import { buildChildEnv, checkNodeVersion, parseLaunchFlags, shouldOpenBrowser, startApp } from '../scripts/start.mjs'
import { chooseModel } from '../server/provider.js'
import { createStore, renameWithRetry } from '../server/store.js'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const cliPath = path.join(root, 'bin', 'mentor.mjs')

test('.gitattributes 与 .gitignore 包含跨平台 EOL、二进制与 Python 缓存规则', () => {
  const gitattributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8')
  for (const rule of [
    '* text=auto eol=lf',
    '*.cmd text eol=crlf',
    '*.bat text eol=crlf',
    '*.ps1 text eol=crlf',
    '*.command text eol=lf',
    '*.sh text eol=lf',
    '*.vault binary',
    '*.png binary',
    '*.ico binary',
    '*.xlsx binary',
    '*.pdf binary',
    '*.tar.gz binary',
    '*.zip binary',
  ]) {
    assert.ok(gitattributes.includes(rule), `.gitattributes 缺少规则: ${rule}`)
  }

  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  for (const entry of ['__pycache__/', '*.pyc', '*.pyo', 'Thumbs.db']) {
    assert.ok(gitignore.includes(entry), `.gitignore 缺少规则: ${entry}`)
  }
})

test('start.cmd 使用 CRLF 并包含 node 检查与交互式暂停守卫', () => {
  const cmd = fs.readFileSync(path.join(root, 'start.cmd'), 'utf8')
  assert.ok(cmd.includes('\r\n'), 'start.cmd 必须使用 CRLF')
  assert.equal(/(?<!\r)\n/.test(cmd), false, 'start.cmd 不能存在裸 LF')
  assert.match(cmd, /setlocal/i)
  assert.match(cmd, /chcp 65001/i)
  assert.match(cmd, /where node/i)
  assert.match(cmd, /%~dp0scripts\\start\.mjs"\s+%\*/)
  assert.match(cmd, /EXIT_CODE=%errorlevel%/)
  assert.match(cmd, /not defined CI/i)
  assert.match(cmd, /POLARIS_NO_PAUSE/)
})

test('start.command 使用 LF、可执行权限、多路径 Node 查找与语法校验通过', () => {
  const shPath = path.join(root, 'start.command')
  const sh = fs.readFileSync(shPath, 'utf8')
  assert.equal(sh.includes('\r'), false, 'start.command 不能包含 CR')
  assert.match(sh, /CDPATH= cd --/)
  for (const needle of [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/opt/local/bin/node',
    '.volta/bin/node',
    '.asdf/shims/node',
    '.local/share/mise/shims/node',
    'NVM_DIR',
    'FNM_DIR',
    'Application Support/fnm',
    '$HOME/.fnm',
    'aliases/default/bin/node',
    'command -v node',
    'read -r _',
    'POLARIS_NO_PAUSE',
  ]) {
    assert.ok(sh.includes(needle), `start.command 缺少: ${needle}`)
  }
  if (process.platform !== 'win32') {
    const mode = fs.statSync(shPath).mode & 0o777
    assert.equal(mode, 0o755)
    const syntax = spawnSync('sh', ['-n', shPath], { encoding: 'utf8' })
    assert.equal(syntax.status, 0, syntax.stderr)
  }
})

test('isForbiddenReleasePath 拦截敏感/缓存/非 vault 文件并放行合法文件', () => {
  for (const bad of [
    '__pycache__/x.pyc',
    'scripts/__pycache__/import-pdf-reviews.cpython-312.pyc',
    'foo.pyc',
    'foo.pyo',
    'vault.key',
    'cert.pem',
    'root.crt',
    'client.p12',
    'client.pfx',
    'doc.pdf',
    'table.xls',
    'table.xlsx',
    'archive.zip',
    'release.tar.gz',
    'backup.7z',
    'app.log',
    'Thumbs.db',
    '.DS_Store',
    'docs/._guide.md',
    '.env',
    '.env.local',
    '.local/plaintext.json',
    'node_modules/ajv/index.js',
    'test-results/out.json',
    'playwright-report/index.html',
    '初试结果.md',
    '复试结果.md',
    '导师评价.md',
    'src/data/admissionData.js',
    'data/dataset.json',
    'data/extra/dataset.vault',
  ]) {
    assert.equal(isForbiddenReleasePath(bad), true, `应拦截禁止路径: ${bad}`)
  }

  for (const ok of [
    '.env.example',
    '.gitattributes',
    'data',
    'data/',
    'data/dataset.vault',
    'data/mentor-notes.vault',
    'scripts/start.mjs',
    'start.cmd',
    'start.command',
  ]) {
    assert.equal(isForbiddenReleasePath(ok), false, `不应误拦截合法路径: ${ok}`)
  }
})

test('parseTarListing 兼容 Windows CRLF 与 ./ 前缀并校验前缀和禁传路径', () => {
  const members = parseTarListing(
    './polaris-mentor-5.0.0/\r\n./polaris-mentor-5.0.0/data/\r\n./polaris-mentor-5.0.0/data/dataset.vault\r\n./polaris-mentor-5.0.0/.gitattributes\r\n',
    'polaris-mentor-5.0.0',
  )
  assert.deepEqual(members, ['data', 'data/dataset.vault', '.gitattributes'])

  assert.throws(
    () => parseTarListing('polaris-mentor-5.0.0/data/leak.json\r\n', 'polaris-mentor-5.0.0'),
    /归档包含系统元数据或运行时文件/,
  )
  assert.throws(
    () => parseTarListing('other-root/package.json\n', 'polaris-mentor-5.0.0'),
    /归档成员前缀异常/,
  )
})

test('packageRelease 在含空格和中文字符的目录中正常打包、校验 manifest 并支持解压后运行 CLI', async () => {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'polaris release 北极星-'))
  try {
    const outDir = path.join(tmpBase, '发布 输出')
    const result = await packageRelease({ out: outDir, root })
    const manifestPath = path.join(outDir, `${pkg.name}-${pkg.version}.manifest.json`)
    assert.ok(fs.existsSync(result.archive), '应生成 .tar.gz 归档')
    assert.ok(fs.existsSync(manifestPath), '应生成 manifest')
    assert.ok(result.members.includes('.gitattributes'), '归档应包含 .gitattributes')
    assert.ok(result.members.includes('start.cmd'), '归档应包含 start.cmd')
    assert.ok(result.members.includes('start.command'), '归档应包含 start.command')

    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
    const actualSha = createHash('sha256').update(await fsp.readFile(result.archive)).digest('hex')
    assert.equal(manifest.sha256, actualSha)

    const expectedVaults = VAULT_NAMES.map(name => `data/${name}.vault`)
    assert.equal(expectedVaults.length, 5)
    for (const vault of expectedVaults) {
      assert.ok(result.members.includes(vault), `归档缺少 ${vault}`)
      assert.ok(manifest.files.some(entry => entry.path === vault && /^[a-f0-9]{64}$/.test(entry.sha256)), `manifest 缺少 ${vault}`)
    }
    assert.equal(result.members.some(m => isForbiddenReleasePath(m)), false)

    const extractRoot = path.join(tmpBase, '解压 目录')
    await fsp.mkdir(extractRoot, { recursive: true })
    const tarCmd = process.platform === 'darwin' && fs.existsSync('/usr/bin/tar') ? '/usr/bin/tar' : 'tar'
    execFileSync(tarCmd, ['-xzf', path.relative(extractRoot, result.archive)], { cwd: extractRoot, stdio: 'pipe' })
    const extracted = path.join(extractRoot, `${pkg.name}-${pkg.version}`)
    await fsp.symlink(path.join(root, 'node_modules'), path.join(extracted, 'node_modules'), 'junction')
    const catalogOut = JSON.parse(execFileSync(process.execPath, ['bin/mentor.mjs', 'catalog'], {
      cwd: extracted,
      encoding: 'utf8',
    }))
    assert.equal(catalogOut.metadata.vault_locked, false)
    assert.equal(catalogOut.metadata.counts.mentors, 414)
  } finally {
    await fsp.rm(tmpBase, { recursive: true, force: true })
  }
})

test('renameWithRetry 对 EPERM/EBUSY/EACCES 按退避重试成功，非瞬态错误立即抛出', () => {
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    let calls = 0
    const sleeps = []
    renameWithRetry('a.tmp', 'a.json', {
      maxRetries: 4,
      baseDelayMs: 5,
      sleepSync: ms => sleeps.push(ms),
      renameSync: () => {
        calls++
        if (calls < 3) {
          const err = new Error(`transient ${code}`)
          err.code = code
          throw err
        }
      },
    })
    assert.equal(calls, 3)
    assert.deepEqual(sleeps, [5, 10])
  }

  let nonTransientCalls = 0
  assert.throws(() => {
    renameWithRetry('a.tmp', 'a.json', {
      maxRetries: 5,
      sleepSync: () => { throw new Error('不应等待') },
      renameSync: () => {
        nonTransientCalls++
        const err = new Error('missing')
        err.code = 'ENOENT'
        throw err
      },
    })
  }, /missing/)
  assert.equal(nonTransientCalls, 1)
})

test('createStore 重试耗尽时清理 .tmp 文件，且支持含空格和中文路径及 UTF-8 BOM', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'store 北极星 dir-'))
  try {
    const failingStore = createStore(tmpDir, {
      maxRetries: 2,
      baseDelayMs: 1,
      sleepSync: () => {},
      renameSync: () => {
        const err = new Error('locked')
        err.code = 'EBUSY'
        throw err
      },
    })
    assert.throws(() => failingStore.write('chats', [{ id: '1' }]), /locked/)
    const leftover = fs.readdirSync(tmpDir).filter(name => name.endsWith('.tmp'))
    assert.deepEqual(leftover, [])

    const realStore = createStore(tmpDir)
    const created = realStore.create()
    assert.ok(created.id)
    const reopened = createStore(tmpDir)
    assert.equal(reopened.list().length, 1)

    await fsp.writeFile(path.join(tmpDir, 'bom.json'), '\uFEFF' + JSON.stringify({ ok: true }), 'utf8')
    assert.deepEqual(reopened.read('bom', null), { ok: true })
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
})

test('bin/mentor.mjs 支持 >64KB 标准输入管道、UTF-8 BOM、--where-file、--json-file、--json - 与错误检查', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cli 北极星 test-'))
  try {
    const largeInput = JSON.stringify({
      ref: 't_big',
      total: 400,
      returned: 400,
      rows: Array.from({ length: 400 }, (_, i) => ({
        name: `导师${i}`,
        college: i % 2 === 0 ? '计算机学院' : '软件学院',
        note: 'x'.repeat(200),
      })),
    })
    assert.ok(Buffer.byteLength(largeInput, 'utf8') > 64 * 1024)

    const pipeRes = spawnSync(
      process.execPath,
      [cliPath, 'aggregate', '--from', '-', '--group-by', 'college', '--metrics', '[{"op":"count","as":"n"}]'],
      { input: '\uFEFF' + largeInput, encoding: 'utf8' },
    )
    assert.equal(pipeRes.status, 0, pipeRes.stderr)
    const pipeJson = JSON.parse(pipeRes.stdout)
    assert.equal(pipeJson.rows.reduce((sum, row) => sum + row.n, 0), 400)

    const emptyStdin = spawnSync(
      process.execPath,
      [cliPath, 'aggregate', '--from', '-', '--metrics', '[{"op":"count","as":"n"}]'],
      { input: '   \n', encoding: 'utf8' },
    )
    assert.equal(emptyStdin.status, 1)
    assert.match(JSON.parse(emptyStdin.stderr).error, /标准输入为空/)

    const whereFile = path.join(tmpDir, '筛选 条件.json')
    await fsp.writeFile(whereFile, '\uFEFF' + JSON.stringify([{ field: 'name', op: 'eq', value: '付俊松' }]), 'utf8')
    const whereOut = JSON.parse(execFileSync(
      process.execPath,
      [cliPath, 'query', '--from', 'mentors', '--where-file', whereFile, '--select', 'name,college'],
      { encoding: 'utf8' },
    ))
    assert.equal(whereOut.rows[0].name, '付俊松')

    const jsonFile = path.join(tmpDir, '完整 参数.json')
    await fsp.writeFile(jsonFile, '\uFEFF' + JSON.stringify({ from: 'mentors', filters: [{ field: 'name', op: 'eq', value: '付俊松' }], select: ['name'], limit: 1 }), 'utf8')
    const jsonFileOut = JSON.parse(execFileSync(
      process.execPath,
      [cliPath, 'query', '--json-file', jsonFile],
      { encoding: 'utf8' },
    ))
    assert.equal(jsonFileOut.rows[0].name, '付俊松')

    const jsonStdin = spawnSync(
      process.execPath,
      [cliPath, 'query', '--json', '-'],
      { input: '\uFEFF' + JSON.stringify({ from: 'mentors', select: ['name'], limit: 2 }), encoding: 'utf8' },
    )
    assert.equal(jsonStdin.status, 0, jsonStdin.stderr)
    assert.equal(JSON.parse(jsonStdin.stdout).rows.length, 2)

    const conflictStdin = spawnSync(
      process.execPath,
      [cliPath, 'aggregate', '--json', '-', '--from', '-'],
      { input: '{}', encoding: 'utf8' },
    )
    assert.equal(conflictStdin.status, 1)
    assert.match(JSON.parse(conflictStdin.stderr).error, /不能同时从标准输入读取/)
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
})

test('scripts/start.mjs 辅助函数、健康检查与不自动打开浏览器守卫', async () => {
  assert.equal(checkNodeVersion('22.11.9'), false)
  assert.equal(checkNodeVersion('22.12.0'), true)
  assert.equal(checkNodeVersion('24.0.0'), true)

  const winEnv = buildChildEnv({ Path: 'C:\\Windows\\System32', PATH: 'C:\\old' }, 'C:\\Program Files\\nodejs\\node.exe', 'win32')
  assert.ok(winEnv.Path.startsWith('C:\\Program Files\\nodejs'))
  assert.equal('PATH' in winEnv, false)

  assert.equal(shouldOpenBrowser([], {}), false)
  assert.equal(shouldOpenBrowser(['--open', '--no-open'], {}), false)
  assert.equal(shouldOpenBrowser(['--open'], { CI: '1' }), false)
  assert.equal(shouldOpenBrowser(['--open'], { POLARIS_NO_OPEN: '1' }), false)
  assert.equal(shouldOpenBrowser(['--open'], {}), true)

  let openedUrls = []
  const healthyServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, name: APP_NAME, version: pkg.version }))
  })
  await new Promise(resolve => healthyServer.listen(0, '127.0.0.1', resolve))
  const healthyPort = String(healthyServer.address().port)
  try {
    const codeNoOpen = await startApp({
      root,
      argv: [],
      env: { PORT: healthyPort },
      openBrowserImpl: url => openedUrls.push(url),
    })
    assert.equal(codeNoOpen, 0)
    assert.deepEqual(openedUrls, [])

    const codeCiOpen = await startApp({
      root,
      argv: ['--open'],
      env: { PORT: healthyPort, CI: 'true' },
      openBrowserImpl: url => openedUrls.push(url),
    })
    assert.equal(codeCiOpen, 0)
    assert.deepEqual(openedUrls, [])

    const codeWithOpen = await startApp({
      root,
      argv: ['--open'],
      env: { PORT: healthyPort },
      openBrowserImpl: url => openedUrls.push(url),
    })
    assert.equal(codeWithOpen, 0)
    assert.deepEqual(openedUrls, [`http://127.0.0.1:${healthyPort}`])
  } finally {
    await new Promise(resolve => healthyServer.close(resolve))
  }

  const otherServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, name: 'other-service', version: '1.0.0' }))
  })
  await new Promise(resolve => otherServer.listen(0, '127.0.0.1', resolve))
  const otherPort = String(otherServer.address().port)
  try {
    openedUrls = []
    const codeOccupied = await startApp({
      root,
      argv: ['--open'],
      env: { PORT: otherPort },
      openBrowserImpl: url => openedUrls.push(url),
    })
    assert.equal(codeOccupied, 1)
    assert.deepEqual(openedUrls, [])
  } finally {
    await new Promise(resolve => otherServer.close(resolve))
  }
})

test('package.json 包含 vault:check、跨平台 Python 3 data:import、.gitattributes 与 cross-platform 测试', () => {
  assert.ok(pkg.files.includes('.gitattributes'))
  assert.equal(pkg.scripts['vault:check'], 'node scripts/check-vault-hygiene.mjs')
  assert.doesNotMatch(pkg.scripts['data:import'], /^python3\s/)
  assert.match(pkg.scripts['data:import'], /PYTHONDONTWRITEBYTECODE/)
  assert.match(pkg.scripts['data:import'], /Python\\s\+3\\\./)
  assert.match(pkg.scripts.test, /tests\/cross-platform\.test\.mjs/)
})

test('packageRelease 拒绝缺少 VAULT_NAMES、无效 .vault 魔数及明文私钥/令牌', async () => {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'pkg-guard-'))
  try {
    async function makeFakeRepo(mutate) {
      const fakeRoot = path.join(tmpBase, `repo-${Math.random().toString(36).slice(2, 8)}`)
      await fsp.mkdir(path.join(fakeRoot, 'data'), { recursive: true })
      const fakePkg = {
        name: 'polaris-test',
        version: '0.0.1',
        files: VAULT_NAMES.map(name => `data/${name}.vault`),
      }
      await fsp.writeFile(path.join(fakeRoot, 'package.json'), JSON.stringify(fakePkg))
      await fsp.writeFile(path.join(fakeRoot, 'package-lock.json'), '{}')
      await fsp.writeFile(path.join(fakeRoot, 'README.md'), '# test\n')
      await fsp.writeFile(path.join(fakeRoot, 'LICENSE'), 'MIT\n')
      await fsp.writeFile(path.join(fakeRoot, '.gitignore'), 'node_modules/\n')
      await fsp.writeFile(path.join(fakeRoot, '.gitattributes'), '* text=auto eol=lf\n')
      const validVault = Buffer.concat([Buffer.from('PVLT\x02'), Buffer.alloc(64, 0xaa)])
      for (const name of VAULT_NAMES) {
        await fsp.writeFile(path.join(fakeRoot, 'data', `${name}.vault`), validVault)
      }
      await mutate(fakeRoot, fakePkg)
      return fakeRoot
    }

    const outDir = path.join(tmpBase, 'out')

    const missingVaultRoot = await makeFakeRepo(async fakeRoot => {
      await fsp.rm(path.join(fakeRoot, 'data', 'web-seeds.vault'))
    })
    await assert.rejects(
      () => packageRelease({ out: outDir, root: missingVaultRoot }),
      /发行包缺少加密数据集/,
    )

    const badMagicRoot = await makeFakeRepo(async fakeRoot => {
      await fsp.writeFile(path.join(fakeRoot, 'data', 'dataset.vault'), Buffer.from('BADHDR' + 'x'.repeat(80)))
    })
    await assert.rejects(
      () => packageRelease({ out: outDir, root: badMagicRoot }),
      /魔数或长度无效/,
    )

    const keyHeaderRoot = await makeFakeRepo(async fakeRoot => {
      const pem = ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join('')
      await fsp.writeFile(path.join(fakeRoot, 'README.md'), `${pem}\n`)
    })
    await assert.rejects(
      () => packageRelease({ out: outDir, root: keyHeaderRoot }),
      /包含私钥头部/,
    )
  } finally {
    await fsp.rm(tmpBase, { recursive: true, force: true })
  }
})

test('bin/mentor.mjs 在锁定态退出 1 并输出错误，正常输出 --help Windows 提示、catalog 与 schemas', () => {
  const lockedForce = spawnSync(process.execPath, [cliPath, 'catalog'], {
    cwd: root,
    env: { ...process.env, POLARIS_FORCE_LOCK: '1' },
    encoding: 'utf8',
  })
  assert.equal(lockedForce.status, 1)
  assert.match(JSON.parse(lockedForce.stderr).error, /锁定状态/)

  const lockedWrongKey = spawnSync(process.execPath, [cliPath, 'catalog'], {
    cwd: root,
    env: { ...process.env, MENTOR_VAULT_KEY: 'invalid-test-key-1234567890' },
    encoding: 'utf8',
  })
  assert.equal(lockedWrongKey.status, 1)
  assert.match(JSON.parse(lockedWrongKey.stderr).error, /锁定状态/)

  const helpRes = execFileSync(process.execPath, [cliPath, '--help'], { cwd: root, encoding: 'utf8' })
  assert.match(helpRes, /cmd\.exe/)
  assert.match(helpRes, /PowerShell 5\.1/)
  assert.match(helpRes, /--where-file/)
  assert.match(helpRes, /--json-file/)

  const catalogRes = JSON.parse(execFileSync(process.execPath, [cliPath, 'catalog'], { cwd: root, encoding: 'utf8' }))
  assert.equal(catalogRes.metadata.vault_locked, false)
  assert.equal(catalogRes.metadata.counts.mentors, 414)

  const schemasRes = JSON.parse(execFileSync(process.execPath, [cliPath, 'schemas'], { cwd: root, encoding: 'utf8' }))
  assert.equal(schemasRes.tools.length, 8)
})

test('scripts/start.mjs 支持 --check 模式、非数字版本守卫、win32 参数数组与 npm ci -> npm install 回退', async () => {
  assert.equal(checkNodeVersion(''), false)
  assert.equal(checkNodeVersion('invalid'), false)
  assert.equal(checkNodeVersion(null), false)
  assert.equal(checkNodeVersion('v22.12.0'), true)
  assert.deepEqual(parseLaunchFlags(['--open', '--check']), { open: true, check: true })
  assert.deepEqual(parseLaunchFlags(['--no-open']), { open: false, check: false })

  const checkPass = await startApp({
    root,
    argv: ['--check'],
    env: { PORT: '65498' },
    fetchImpl: async () => { throw new Error('ECONNREFUSED') },
    spawnSyncImpl: () => { throw new Error('不应执行 npm') },
    spawnImpl: () => { throw new Error('不应启动服务') },
  })
  assert.equal(checkPass, 0)

  const checkBadNode = await startApp({
    root,
    argv: ['--check'],
    nodeVersion: '20.11.0',
    spawnSyncImpl: () => { throw new Error('不应执行 npm') },
  })
  assert.equal(checkBadNode, 1)

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'start-check-'))
  try {
    await fsp.writeFile(path.join(tmpRoot, 'package.json'), JSON.stringify({ name: 'polaris-mentor', version: pkg.version }))
    const checkMissingVault = await startApp({
      root: tmpRoot,
      argv: ['--check'],
      env: { PORT: '65497' },
      fetchImpl: async () => { throw new Error('ECONNREFUSED') },
    })
    assert.equal(checkMissingVault, 1)

    await fsp.mkdir(path.join(tmpRoot, 'node_modules'), { recursive: true })
    await fsp.writeFile(path.join(tmpRoot, 'package-lock.json'), '{}')
    const calls = []
    const fallbackCode = await startApp({
      root: tmpRoot,
      argv: [],
      env: { PORT: '65496' },
      platform: 'win32',
      fetchImpl: async () => { throw new Error('ECONNREFUSED') },
      spawnSyncImpl: (cmd, args) => {
        calls.push({ cmd, args })
        if (args.includes('ci')) return { status: 1 }
        return { status: 0 }
      },
      spawnImpl: () => ({
        pid: 12345,
        on(event, cb) {
          if (event === 'exit') setTimeout(() => cb(0), 5)
        },
      }),
    })
    assert.equal(fallbackCode, 0)
    assert.deepEqual(calls.map(c => [c.cmd, c.args]), [
      ['cmd.exe', ['/d', '/c', 'npm.cmd', 'ci', '--no-audit', '--no-fund']],
      ['cmd.exe', ['/d', '/c', 'npm.cmd', 'install', '--no-audit', '--no-fund']],
      ['cmd.exe', ['/d', '/c', 'npm.cmd', 'run', 'build']],
    ])
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true })
  }
})

test('chooseModel 在 api.deepseek.com 优先选择 deepseek-chat 并兼容回退', () => {
  assert.equal(
    chooseModel(['deepseek-reasoner', 'deepseek-chat'], 'https://api.deepseek.com'),
    'deepseek-chat',
  )
  assert.equal(
    chooseModel(['deepseek-reasoner', 'deepseek-flash'], 'https://api.deepseek.com/v1'),
    'deepseek-flash',
  )
  assert.equal(
    chooseModel(['text-embedding-3-large', 'gpt-4.1-mini'], 'https://api.openai.com/v1'),
    'gpt-4.1-mini',
  )
})

test('README.md、DATA.md 与 docs/*.md 内链、锚点、图片路径与口径校验无死链', () => {
  const mdFiles = [
    'README.md',
    'DATA.md',
    ...fs.readdirSync(path.join(root, 'docs'))
      .filter(file => file.endsWith('.md'))
      .map(file => path.join('docs', file)),
  ]
  const headingSlug = text => text.trim().toLowerCase().replace(/[^\w\u4e00-\u9fff\s-]/g, '').replace(/\s+/g, '-')

  for (const rel of mdFiles) {
    const abs = path.join(root, rel)
    const raw = fs.readFileSync(abs, 'utf8')
    const stripped = raw.replace(/```[\s\S]*?```/g, '')
    const anchors = new Set([
      ...[...raw.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/g)].map(m => m[1]),
      ...[...stripped.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => headingSlug(m[1])),
    ])

    for (const match of stripped.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].trim()
      if (/^(?:https?:|mailto:)/i.test(target)) continue
      if (target.startsWith('#')) {
        assert.ok(anchors.has(target.slice(1)), `${rel} 存在无效锚点: ${target}`)
        continue
      }
      const [filePart, hashPart] = target.split('#')
      const resolved = path.resolve(path.dirname(abs), filePart)
      assert.ok(fs.existsSync(resolved), `${rel} 存在失效链接: ${target}`)
      if (hashPart) {
        const targetRaw = fs.readFileSync(resolved, 'utf8')
        const targetAnchors = new Set([
          ...[...targetRaw.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/g)].map(m => m[1]),
          ...[...targetRaw.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => headingSlug(m[1])),
        ])
        assert.ok(targetAnchors.has(hashPart), `${rel} 跨文件锚点无效: ${target}`)
      }
    }

    for (const match of stripped.matchAll(/<img[^>]+src=["']([^"']+)["']/g)) {
      const src = match[1].trim()
      if (/^https?:/i.test(src)) continue
      const resolved = path.resolve(path.dirname(abs), src)
      assert.ok(fs.existsSync(resolved), `${rel} 存在缺失图片: ${src}`)
    }
  }

  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.match(readme, /414 位评价导师/)
  assert.match(readme, /1,309 位/)
  assert.match(readme, /PowerShell 5\.1/)
  assert.match(readme, /PowerShell 7\.3\+/)
})

test('data:import 脚本强制匹配 Python 3、以 -- 结尾并正确透传 --no-seal/--custom 参数', async () => {
  const script = pkg.scripts['data:import']
  assert.ok(script.endsWith(' --'), 'data:import 必须以 -- 结尾以透传带横杠参数')
  assert.match(script, /\/Python\\s\+3\\\.\//i, 'data:import 必须仅匹配 Python 3.x')
  assert.doesNotMatch(script, /\/Python\\s\+\\d\//i)

  const regexMatch = script.match(/\/(Python\\s\+3\\\.)\/i/)
  assert.ok(regexMatch)
  const pyRegex = new RegExp(regexMatch[1], 'i')
  assert.equal(pyRegex.test('Python 2.7.18'), false)
  assert.equal(pyRegex.test('Python 3.12.2'), true)

  const inlineStart = script.indexOf('"') + 1
  const inlineEnd = script.lastIndexOf('"')
  const inlineCode = script.slice(inlineStart, inlineEnd).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  const probeScript = inlineCode.replace(
    /const res=spawnSync\([\s\S]*$/,
    'console.log(JSON.stringify(process.argv.slice(1)));process.exit(0)',
  )

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'polaris-data-import-'))
  try {
    const noPathEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'path'),
    )
    const emptyPathRes = spawnSync(
      process.execPath,
      ['-e', probeScript, '--', '--no-seal', '--custom'],
      {
        cwd: tmpDir,
        env: { ...noPathEnv, PATH: '' },
        encoding: 'utf8',
      },
    )
    assert.doesNotMatch(emptyPathRes.stderr || '', /bad option/i)
    if (emptyPathRes.status === 0) {
      assert.deepEqual(JSON.parse(emptyPathRes.stdout.trim()), ['--no-seal', '--custom'])
    } else {
      assert.equal(emptyPathRes.status, 1)
      assert.match(emptyPathRes.stderr || '', /未检测到可用的 Python 3/)
    }

    if (process.platform !== 'win32') {
      const binPy2 = path.join(tmpDir, 'bin-py2')
      const binPy3 = path.join(tmpDir, 'bin-py3')
      await fsp.mkdir(binPy2, { recursive: true })
      await fsp.mkdir(binPy3, { recursive: true })

      const py2Shim = '#!/bin/sh\necho "Python 2.7.18"\nexit 0\n'
      for (const name of ['python3', 'python']) {
        const p = path.join(binPy2, name)
        await fsp.writeFile(p, py2Shim, { mode: 0o755 })
      }

      const py3Shim = [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then',
        '  echo "Python 3.12.2"',
        '  exit 0',
        'fi',
        `exec "${process.execPath}" -e "console.log(JSON.stringify(process.argv.slice(1)))" -- "$@"`,
        '',
      ].join('\n')
      await fsp.writeFile(path.join(binPy3, 'python3'), py3Shim, { mode: 0o755 })

      const nodeDir = path.dirname(process.execPath)

      const py2Res = spawnSync(`${script} --no-seal --custom`, {
        cwd: tmpDir,
        env: { ...process.env, PATH: `${binPy2}:${nodeDir}` },
        shell: true,
        encoding: 'utf8',
      })
      assert.equal(py2Res.status, 1)
      assert.doesNotMatch(py2Res.stderr || '', /bad option/i)
      assert.match(py2Res.stderr || '', /未检测到可用的 Python 3/)

      const py3Res = spawnSync(`${script} --no-seal --custom`, {
        cwd: tmpDir,
        env: { ...process.env, PATH: `${binPy3}:${nodeDir}` },
        shell: true,
        encoding: 'utf8',
      })
      assert.equal(py3Res.status, 0, py3Res.stderr)
      assert.doesNotMatch(py3Res.stderr || '', /bad option/i)
      assert.deepEqual(JSON.parse(py3Res.stdout.trim()), [
        '-B',
        'scripts/import-pdf-reviews.py',
        '--no-seal',
        '--custom',
      ])
    }
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
})

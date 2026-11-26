import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync, spawn } from 'node:child_process'
import { APP_NAME } from '../lib/brand.js'
import { VAULT_NAMES } from '../lib/vault.js'

const defaultRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)))

export function checkNodeVersion(version = process.versions.node) {
  const [major, minor] = String(version ?? '').trim().replace(/^v/i, '').split('.').map(Number)
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false
  return major > 22 || (major === 22 && minor >= 12)
}

export function buildChildEnv(baseEnv = process.env, execPath = process.execPath, platform = process.platform) {
  const pathImpl = platform === 'win32' ? path.win32 : path.posix
  const env = { ...baseEnv }
  const binDir = pathImpl.dirname(execPath)
  const pathKeys = Object.keys(env).filter(key => key.toLowerCase() === 'path')
  const existingValues = pathKeys.map(key => env[key]).filter(Boolean)
  const primaryKey = platform === 'win32'
    ? (pathKeys.find(key => key === 'Path') || pathKeys[0] || 'Path')
    : (pathKeys.find(key => key === 'PATH') || pathKeys[0] || 'PATH')
  const entries = []
  for (const part of [binDir, ...existingValues.flatMap(value => value.split(pathImpl.delimiter))]) {
    if (part && !entries.includes(part)) entries.push(part)
  }
  for (const key of pathKeys) {
    if (key !== primaryKey) delete env[key]
  }
  env[primaryKey] = entries.join(pathImpl.delimiter)
  return env
}

export function parseLaunchFlags(argv = []) {
  let open = false
  let check = false
  for (const arg of argv) {
    if (arg === '--open') open = true
    else if (arg === '--no-open') open = false
    else if (arg === '--check') check = true
  }
  return { open, check }
}

export function shouldOpenBrowser(argv = [], env = process.env) {
  const { open } = parseLaunchFlags(argv)
  return Boolean(open && !env.CI && env.POLARIS_NO_OPEN !== '1')
}

export function openBrowserUrl(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const [cmd, args] = platform === 'darwin'
    ? ['open', [url]]
    : platform === 'win32'
      ? ['cmd.exe', ['/d', '/c', 'start', '', url]]
      : ['xdg-open', [url]]
  const child = spawnImpl(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child?.on?.('error', () => {})
  child?.unref?.()
  return child
}

async function waitForHealth(url, { fetchImpl, timeoutMs = 15000, isExited = () => false } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && !isExited()) {
    const response = await fetchImpl(`${url}/api/health`, { signal: AbortSignal.timeout(800) }).catch(() => null)
    if (response?.ok) return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return false
}

export async function startApp({
  root = defaultRoot,
  argv = process.argv.slice(2),
  env = process.env,
  nodeVersion = process.versions.node,
  execPath = process.execPath,
  platform = process.platform,
  fetchImpl = fetch,
  spawnSyncImpl = spawnSync,
  spawnImpl = spawn,
  openBrowserImpl = openBrowserUrl,
  loadEnvFile = file => process.loadEnvFile(file),
} = {}) {
  try {
    loadEnvFile(path.join(root, '.env'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  if (!checkNodeVersion(nodeVersion)) {
    console.error(`错误：当前 Node.js ${nodeVersion}，需要 Node.js 22.12 或更新版本。\nError: Node.js ${nodeVersion} detected, but Polaris requires Node.js 22.12+.`)
    return 1
  }

  const port = Number(env.PORT || 3210)
  const url = `http://127.0.0.1:${port}`
  let pkg
  try {
    pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  } catch (error) {
    console.error(`错误：无法读取 package.json（${error.message}）。\nError: Failed to read package.json (${error.message}).`)
    return 1
  }
  const { check } = parseLaunchFlags(argv)
  const allowOpen = !check && shouldOpenBrowser(argv, env)

  if (check) {
    const missingVaults = []
    for (const name of VAULT_NAMES) {
      const vaultStat = await fs.stat(path.join(root, 'data', `${name}.vault`)).catch(() => null)
      if (!vaultStat?.isFile() || vaultStat.size <= 49) missingVaults.push(`data/${name}.vault`)
    }
    if (missingVaults.length) {
      console.error(`错误：缺少或损坏加密数据集：${missingVaults.join(', ')}\nError: Missing or invalid encrypted vault files: ${missingVaults.join(', ')}`)
      return 1
    }
    const nodeModulesReady = Boolean(await fs.stat(path.join(root, 'node_modules/.package-lock.json')).catch(() => null))
    const distReady = Boolean(await fs.stat(path.join(root, 'dist/index.html')).catch(() => null))
    const response = await fetchImpl(`${url}/api/health`, { signal: AbortSignal.timeout(800) }).catch(() => null)
    if (response) {
      const health = await response.json().catch(() => null)
      if (health?.name === APP_NAME && health.version === pkg.version) {
        console.log(JSON.stringify({ ok: true, status: 'running', url, nodeVersion, nodeModulesReady, distReady, vaults: VAULT_NAMES.length }))
        return 0
      }
      console.error(`端口${port}已被${health?.name === APP_NAME ? `${APP_NAME} ${health.version}` : '其他服务'}占用，请先停止原服务再启动当前版本。`)
      return 1
    }
    console.log(JSON.stringify({ ok: true, status: 'ready', url, nodeVersion, nodeModulesReady, distReady, vaults: VAULT_NAMES.length }))
    return 0
  }

  const response = await fetchImpl(`${url}/api/health`, { signal: AbortSignal.timeout(800) }).catch(() => null)
  if (response) {
    const health = await response.json().catch(() => null)
    if (health?.name === APP_NAME && health.version === pkg.version) {
      console.log(`${APP_NAME} ${health.version} 已在运行：${url}`)
      if (allowOpen) openBrowserImpl(url, { platform, spawnImpl })
      return 0
    }
    console.error(`端口${port}已被${health?.name === APP_NAME ? `${APP_NAME} ${health.version}` : '其他服务'}占用，请先停止原服务再启动当前版本。`)
    return 1
  }

  const childEnv = buildChildEnv(env, execPath, platform)

  function npm(command) {
    const args = command.split(' ').filter(Boolean)
    const result = platform === 'win32'
      ? spawnSyncImpl('cmd.exe', ['/d', '/c', 'npm.cmd', ...args], { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true })
      : spawnSyncImpl('npm', args, { cwd: root, env: childEnv, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) return result.status || 1
    return 0
  }

  const installed = await fs.stat(path.join(root, 'node_modules/.package-lock.json')).catch(() => null)
  const lock = await fs.stat(path.join(root, 'package-lock.json')).catch(() => null)
  if (!installed || (lock && installed.mtimeMs < lock.mtimeMs)) {
    let status = lock ? npm('ci --no-audit --no-fund') : npm('install --no-audit --no-fund')
    if (status !== 0 && lock) {
      const hasNodeModules = await fs.stat(path.join(root, 'node_modules')).catch(() => null)
      if (hasNodeModules) {
        console.warn('警告：npm ci 失败，检测到已存在 node_modules，尝试使用 npm install 恢复...\nWarning: npm ci failed with existing node_modules; retrying once with npm install...')
        status = npm('install --no-audit --no-fund')
      }
    }
    if (status !== 0) {
      console.error('错误：依赖安装失败。请关闭占用 node_modules 的进程或杀毒软件后，在项目根目录运行 npm install 重试。\nError: Dependency installation failed. Close processes locking node_modules and retry with "npm install".')
      return status
    }
  }

  // Always build current source; a stale dist must not become the interface the user sees.
  const buildStatus = npm('run build')
  if (buildStatus !== 0) {
    console.error('错误：前端构建（npm run build）失败，请检查上方输出或重新运行 npm install。\nError: Frontend build ("npm run build") failed. Check the output above or re-run "npm install".')
    return buildStatus
  }

  const server = spawnImpl(execPath, ['--env-file-if-exists=.env', 'server/index.mjs'], {
    cwd: root,
    env: childEnv,
    stdio: 'inherit',
    windowsHide: true,
  })

  let exited = false
  const forwardSignal = signal => {
    if (!exited && server.pid) {
      try {
        server.kill(signal)
      } catch {}
    }
  }
  const onSigInt = () => forwardSignal('SIGINT')
  const onSigTerm = () => forwardSignal('SIGTERM')
  process.on('SIGINT', onSigInt)
  process.on('SIGTERM', onSigTerm)

  if (allowOpen) {
    waitForHealth(url, { fetchImpl, isExited: () => exited }).then(ready => {
      if (ready && !exited) openBrowserImpl(url, { platform, spawnImpl })
    })
  }

  return await new Promise(resolve => {
    const cleanup = code => {
      exited = true
      process.off('SIGINT', onSigInt)
      process.off('SIGTERM', onSigTerm)
      resolve(code)
    }
    server.on('error', error => {
      console.error(error.message)
      cleanup(1)
    })
    server.on('exit', code => {
      cleanup(code ?? 0)
    })
  })
}

const isMain = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
if (isMain) {
  const code = await startApp()
  process.exitCode = code
}

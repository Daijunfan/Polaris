import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync,spawn} from 'node:child_process'
import {APP_NAME} from '../lib/brand.js'

const root=fileURLToPath(new URL('../',import.meta.url))
try{process.loadEnvFile(path.join(root,'.env'))}catch(error){if(error.code!=='ENOENT')throw error}
const port=Number(process.env.PORT||3210)
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'))
const [major,minor]=process.versions.node.split('.').map(Number)
if(major<22||major===22&&minor<12){console.error('需要Node.js 22.12或更新版本');process.exit(1)}
const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(800)}).catch(()=>null)
if(response){
  const health=await response.json().catch(()=>null)
  if(health?.name===APP_NAME&&health.version===pkg.version){console.log(`${APP_NAME} ${health.version} 已在运行：http://127.0.0.1:${port}`);process.exit(0)}
  console.error(`端口${port}已被${health?.name===APP_NAME?`${APP_NAME} ${health.version}`:'其他服务'}占用，请先停止原服务再启动当前版本。`);process.exit(1)
}
function npm(command){
  const result=process.platform==='win32'?spawnSync('cmd.exe',['/d','/c',`npm.cmd ${command}`],{cwd:root,stdio:'inherit',windowsHide:true}):spawnSync('npm',command.split(' '),{cwd:root,stdio:'inherit'})
  if(result.error)throw result.error
  if(result.status!==0)process.exit(result.status||1)
}
const installed=await fs.stat(path.join(root,'node_modules/.package-lock.json')).catch(()=>null),lock=await fs.stat(path.join(root,'package-lock.json'))
if(!installed||installed.mtimeMs<lock.mtimeMs)npm('ci --no-audit --no-fund')
// Always build current source; a stale dist must not become the interface the user sees.
npm('run build')
const server=spawn(process.execPath,['--env-file-if-exists=.env','server/index.mjs'],{cwd:root,stdio:'inherit',windowsHide:true})
server.on('error',error=>{console.error(error.message);process.exitCode=1})
server.on('exit',code=>{process.exitCode=code||0})

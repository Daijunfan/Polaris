import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {parseArgs} from 'node:util'

const root=fileURLToPath(new URL('../',import.meta.url)),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'))
const {values}=parseArgs({options:{out:{type:'string'}}}),out=path.resolve(values.out||path.join(root,'.local/releases'))
await fs.mkdir(out,{recursive:true})
const staging=await fs.mkdtemp(path.join(out,'.stage-')),name=`${pkg.name}-${pkg.version}`,project=path.join(staging,name),files=[]
const forbidden=file=>{const relative=file.replaceAll('\\','/');return relative.split('/').some(part=>part==='node_modules'||part==='.local'||part==='test-results'||part==='playwright-report'||part==='.DS_Store'||part.startsWith('._')||part.startsWith('.env')&&part!=='.env.example')||/\.(?:xlsx|zip|log)$/i.test(relative)||/^data\/.*\.json$/i.test(relative)||['初试结果.md','复试结果.md','导师评价.md','src/data/admissionData.js'].includes(relative)}
try{
  await fs.mkdir(project)
  for(const entry of new Set([...pkg.files,'package.json','package-lock.json','README.md','LICENSE','.gitignore'])){
    const source=path.join(root,entry),target=path.join(project,entry)
    await fs.mkdir(path.dirname(target),{recursive:true})
    await fs.cp(source,target,{recursive:true,filter:source=>!forbidden(path.relative(root,source))})
  }
  async function inventory(directory){
    for(const item of await fs.readdir(directory,{withFileTypes:true})){
      const file=path.join(directory,item.name),relative=path.relative(project,file).split(path.sep).join('/')
      if(forbidden(relative))throw new Error(`发行包包含禁止文件：${relative}`)
      if(item.isSymbolicLink())throw new Error(`发行包不能包含外部链接：${relative}`)
      if(item.isDirectory())await inventory(file)
      else files.push({path:relative,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')})
    }
  }
  await inventory(project);files.sort((a,b)=>a.path.localeCompare(b.path))
  const archive=path.join(out,name+'.tar.gz'),args=['-czf',archive,...(process.platform==='darwin'?['--no-mac-metadata','--no-xattrs']:[]),'-C',staging,name]
  execFileSync('tar',args,{env:{...process.env,COPYFILE_DISABLE:'1'},stdio:'pipe'})
  const members=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n')
  if(members.some(member=>forbidden(member.slice(name.length+1))))throw new Error('归档包含系统元数据或运行时文件')
  const manifest={name:pkg.name,version:pkg.version,sha256:createHash('sha256').update(await fs.readFile(archive)).digest('hex'),files}
  await fs.writeFile(path.join(out,name+'.manifest.json'),JSON.stringify(manifest,null,2)+'\n')
  console.log(JSON.stringify({archive,sha256:manifest.sha256,files:files.length}))
}finally{await fs.rm(staging,{recursive:true,force:true})}

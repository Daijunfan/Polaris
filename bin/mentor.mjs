#!/usr/bin/env node
import {APP_NAME} from '../lib/brand.js'
import fs from 'node:fs'
import { parseArgs } from 'node:util'
import { loadData } from '../lib/data.js'
import { createToolRuntime, toolDefinitions } from '../lib/tools.js'
import {workbenchToolDefinition,profileToolDefinition} from '../server/workbench-tool.js'

const help = `${APP_NAME} — 给 Agent 的可组合数据工具

用法：npm run cli -- <catalog|search|query|join|aggregate|visualize|workspace|profile> [参数]
      node bin/mentor.mjs schemas
      node bin/mentor.mjs --version

通用参数：
  --json '<JSON>'       完整工具参数，与 HTTP/Function Calling 完全相同
  --from <dataset|->   数据集或标准输入；- 消费上一条命令的 JSON 结果
  --where '<JSON>'     filters 数组（AND），支持 between、in、contains 等
  --select a,b,c       仅返回这些字段
  --sort-by field      排序字段
  --sort '<JSON>'      多字段优先级排序
  --row-number 推荐序  排序后自动编号
  --derive '<JSON>'    计算分差、比例、加权值等新列
  --order asc|desc     默认 desc
  --limit N           默认 5000（完整管道）；Agent 默认 30
  --offset N          分页起点

检索：--terms 'AI security,大模型安全' --mode any
统计：--group-by a,b --metrics '[{"op":"mean","field":"score_first","as":"初试均分"}]'
      --bucket '{"field":"score_first","width":20}'
关联：--left - --right mentors --left-on mentor_id --right-on mentor_id --how left
视图：--type bar|line|scatter|table|metric --x name --y rating --title '导师原文评分'
      --pick '付俊松,杨文川'  按姓名顺序选人（visualize）
      --row-notes '<JSON>'   逐行说明，如 {"by":"name","entries":[{"value":"付俊松","text":"本人指导"}]}
      --replace              替换已有图表（布尔；具体 id 可从 --json 传入）
      --discard a,b          移除本轮多余图表 id

工作台：--action read|save|compare|restore|report --scope library|comparison --server 本机网址
画像：--action read|update --stage 考研|保研 --goal 读博|就业 --score 350 --program 软件工程
      --colleges 计算机学院,软件学院 --musts internship,no_clock --interests 大模型安全 --notes 备注
      --server 本机网址（也可用 --json 传完整画像参数）
版本：--version / -v 输出应用名称与版本

输出始终为 JSON，错误写 stderr 且退出码为 1。不执行任意 SQL 或代码。
文档：docs/TOOLS.md；schemas 输出所有工具的 JSON Schema。
`

const splitComma = value => value.split(',').map(item => item.trim()).filter(Boolean)
function requireInteger (flag, value) {
  const text = String(value).trim()
  const number = Number(text)
  if (text === '' || !Number.isInteger(number)) throw new Error(`${flag} 必须是整数`)
  return number
}
function parsePick (value) {
  const parts = splitComma(value)
  if (!parts.length) throw new Error('pick 不能为空')
  const named = parts[0].match(/^([A-Za-z_][\w]*)[:=](.+)$/)
  if (named) parts[0] = named[2].trim()
  const field = named ? named[1] : parts.every(item => item.startsWith('mentor-')) ? 'mentor_id' : 'name'
  return { field, values: parts }
}

try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    scope:{type:'string'},action:{type:'string'},'list-name':{type:'string'},name:{type:'string'},note:{type:'string'},status:{type:'string'},format:{type:'string'},server:{type:'string'},'include-notes':{type:'boolean'},terms:{type:'string'},mode:{type:'string'},help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, json: { type: 'string' }, from: { type: 'string' }, dataset: { type: 'string' },
    where: { type: 'string' }, select: { type: 'string' }, 'row-number':{type:'string'}, 'sort-by': { type: 'string' }, sort: { type:'string' }, derive: { type:'string' }, order: { type: 'string' }, limit: { type: 'string' }, offset: { type: 'string' },
    'group-by': { type: 'string' }, metrics: { type: 'string' }, bucket: { type: 'string' }, left: { type: 'string' }, right: { type: 'string' }, 'left-on': { type: 'string' }, 'right-on': { type: 'string' }, how: { type: 'string' },
    purpose:{type:'string'}, type: { type: 'string' }, x: { type: 'string' }, y: { type: 'string' }, 'color-by': { type:'string' }, title: { type: 'string' }, description: { type: 'string' },
    pick: { type: 'string' }, 'row-notes': { type: 'string' }, replace: { type: 'boolean' }, discard: { type: 'string' },
    stage: { type: 'string' }, goal: { type: 'string' }, score: { type: 'string' }, program: { type: 'string' }, colleges: { type: 'string' }, musts: { type: 'string' }, interests: { type: 'string' }, notes: { type: 'string' },
  } })
  const command = positionals[0]
  if (values.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    process.stdout.write(JSON.stringify({ name: APP_NAME, version: pkg.version }) + '\n'); process.exit(0)
  }
  if (!command || values.help) { process.stdout.write(help); process.exit(0) }
  if (command === 'schemas') { process.stdout.write(JSON.stringify({ tools: [...toolDefinitions,workbenchToolDefinition,profileToolDefinition] }, null, 2) + '\n'); process.exit(0) }
  for (const flag of ['limit', 'offset']) if (values[flag] !== undefined) requireInteger(flag, values[flag])
  if (values.score !== undefined && values.score.trim() !== '') requireInteger('score', values.score)
  const args = values.json ? JSON.parse(values.json) : {}
  const mapping = {scope:'scope',action:'action','list-name':'list_name',name:'name',note:'note',status:'status',format:'format','include-notes':'include_notes',terms:'terms',mode:'mode', from: 'from', dataset: 'dataset', where: 'filters', select: 'select', 'row-number':'row_number_as', 'sort-by': 'sort_by', sort:'sort', derive:'derive', order: 'order', limit: 'limit', offset: 'offset', 'group-by': 'group_by', metrics: 'metrics', bucket: 'bucket', left: 'left', right: 'right', 'left-on': 'left_on', 'right-on': 'right_on', how: 'how', purpose:'purpose', type: 'type', x: 'x', y: 'y', 'color-by':'color_by', title: 'title', description: 'description', stage: 'stage', goal: 'goal', score: 'score', program: 'program', colleges: 'colleges', musts: 'musts', interests: 'interests', notes: 'notes' }
  for (const [flag, field] of Object.entries(mapping)) {
    if (values[flag] === undefined) continue
    if (['where', 'metrics', 'bucket','sort','derive'].includes(flag)) args[field] = JSON.parse(values[flag])
    else if (['select', 'group-by', 'y','terms','colleges','musts'].includes(flag)) args[field] = splitComma(values[flag])
    else if (['limit', 'offset'].includes(flag)) args[field] = Number(values[flag])
    else if (flag === 'score') args[field] = values[flag].trim() === '' ? null : Number(values[flag])
    else if (['stage', 'goal', 'program'].includes(flag)) args[field] = values[flag].trim() === '' ? null : values[flag]
    else args[field] = values[flag]
  }
  if (values.pick !== undefined) args.pick = parsePick(values.pick)
  if (values['row-notes'] !== undefined) args.row_notes = JSON.parse(values['row-notes'])
  if (values.replace && args.replace === undefined) args.replace = true
  if (values.discard !== undefined) {
    const ids = splitComma(values.discard)
    args.discard = ids.length === 1 ? ids[0] : ids.join(',')
  }
  if(command==='workspace'||command==='profile'){
    if(command==='workspace'&&args.from==='-'){
      const input=JSON.parse(fs.readFileSync(0,'utf8'))
      if(!Array.isArray(input.rows)||input.total>input.rows.length)throw new Error('请传入包含完整rows的导师查询结果，避免把分页样本当成全部')
      args.mentors=input.rows.map(row=>({name:row.name||row.mentor_name,college:row.college}));delete args.from
    }
    const base=values.server||process.env.MENTOR_SERVER_URL||'http://127.0.0.1:'+(process.env.PORT||3210)
    let response
    try{
      response=await fetch(new URL('/api/tools/'+command,base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)})
    }catch(error){
      if(error?.code==='ECONNREFUSED'||error?.cause?.code==='ECONNREFUSED'||/ECONNREFUSED|fetch failed/i.test(error?.message||''))
        throw new Error('无法连接北极星本地服务（'+base+'），请先运行 npm start 启动服务')
      throw error
    }
    const result=await response.json()
    if(!response.ok)throw new Error(result.error||(command==='profile'?'画像请求失败':'工作台请求失败'))
    process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exit(0)
  }
  if (['search','query', 'join', 'aggregate'].includes(command)) args.limit ??= 5000
  const runtime = createToolRuntime(loadData())
  if ([args.from, args.left, args.right].includes('-')) {
    const ref = runtime.acceptInput(JSON.parse(fs.readFileSync(0, 'utf8')))
    for (const key of ['from', 'left', 'right']) if (args[key] === '-') args[key] = ref
  }
  process.stdout.write(JSON.stringify(runtime.execute(command, args), null, 2) + '\n')
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error.message }) + '\n')
  process.exitCode = 1
}

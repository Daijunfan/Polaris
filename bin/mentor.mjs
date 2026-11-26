#!/usr/bin/env node
import { APP_NAME } from '../lib/brand.js'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadData } from '../lib/data.js'
import { createToolRuntime, toolDefinitions } from '../lib/tools.js'
import { workbenchToolDefinition, profileToolDefinition } from '../server/workbench-tool.js'
import {
  buildComparisonDocument,
  buildDossierDocument,
  buildFromMentors,
  buildInsights,
  exportDocument,
  resolvePresetFilter,
} from '../lib/export/index.js'
import { mentorComparisonFields } from '../lib/fields.js'
import { publicSource } from '../lib/presentation.js'

const help = `${APP_NAME} — 给 Agent 的可组合数据工具

用法：node bin/mentor.mjs <catalog|search|query|join|aggregate|visualize|export|workspace|profile> [参数]
      npm run cli -- <命令> [参数]
      node bin/mentor.mjs schemas
      node bin/mentor.mjs --version

通用参数：
  --json '<JSON>'       完整工具参数，与 HTTP/Function Calling 完全相同
  --json -              从标准输入读取完整 JSON 参数（不可与 --from - / --left - / --right - 同用）
  --json-file <path>    从 UTF-8 JSON 文件读取完整工具参数（自动忽略 BOM）
  --from <dataset|->    数据集或标准输入；- 消费上一条命令的 JSON 结果
  --where '<JSON>'      filters 数组（AND），支持 between、in、contains 等
  --where-file <path>   从 UTF-8 JSON 文件读取 filters 数组（推荐在 Windows 下使用）
  --select a,b,c        仅返回这些字段
  --sort-by field       排序字段
  --sort '<JSON>'       多字段优先级排序
  --row-number 推荐序   排序后自动编号
  --derive '<JSON>'     计算分差、比例、加权值等新列
  --order asc|desc      默认 desc
  --limit N             默认 5000（完整管道）；Agent 默认 30
  --offset N            分页起点

检索：--terms 'AI security,大模型安全' --mode any
统计：--group-by a,b --metrics '[{"op":"mean","field":"score_first","as":"初试均分"}]'
      --bucket '{"field":"score_first","width":20}'
关联：--left - --right mentors --left-on mentor_id --right-on mentor_id --how left
视图：--type bar|line|scatter|table|metric --x name --y rating --title '导师原文评分'
      --pick '付俊松,杨文川'  按姓名顺序选人（visualize）
      --row-notes '<JSON>'   逐行说明，如 {"by":"name","entries":[{"value":"付俊松","text":"本人指导"}]}
      --replace              替换已有图表（布尔；具体 id 可从 --json 传入）
      --discard a,b          移除本轮多余图表 id

导出：node bin/mentor.mjs export --format xlsx|pdf|docx|md|html|csv [--preset five_star|zero_risk|internship_no_clock|doctoral|all]
      [--mode list|comparison|dossier] [--mentors 姓名1,姓名2] [--college 学院] [--query 关键词] [--filters id1,id2] [--from -] [--out 输出路径]

工作台：--action read|save|compare|restore|report --scope library|comparison --server 本机网址
画像：--action read|update --stage 考研|保研 --goal 读博|就业 --score 350 --program 软件工程
      --colleges 计算机学院,软件学院 --musts internship,no_clock --interests 大模型安全 --notes 备注
      --server 本机网址（也可用 --json 传完整画像参数）
版本：--version / -v 输出应用名称与版本

Windows 提示（cmd.exe / PowerShell）：
  - cmd.exe 不把单引号 '...' 当作字符串定界符，建议使用 --where-file / --json-file，
    或用 --json - 通过管道传入，或在 cmd.exe 中用双引号并转义内部引号（\"...\"）。
  - Windows PowerShell 5.1 向原生命令传递单引号 '...' 时会剥离内部的双引号（"），建议改用 --where-file / --json-file / --json -（或升级至 PowerShell 7.3+ 后直接使用单引号）。

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

function stripBom (text) {
  return text.replace(/^\uFEFF/, '')
}

async function readStdinJson () {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
  }
  const text = stripBom(Buffer.concat(chunks).toString('utf8'))
  if (!text.trim()) throw new Error('标准输入为空，无法解析 JSON 参数')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`标准输入 JSON 解析失败：${error.message}`)
  }
}

function readJsonFile (filePath, flag) {
  let raw
  try {
    raw = stripBom(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`无法读取 ${flag} 文件（${filePath}）：${error.message}`)
  }
  if (!raw.trim()) throw new Error(`${flag} 文件为空（${filePath}）`)
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`${flag} JSON 解析失败（${filePath}）：${error.message}`)
  }
}

async function main () {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    scope: { type: 'string' }, action: { type: 'string' }, 'list-name': { type: 'string' }, name: { type: 'string' }, note: { type: 'string' }, status: { type: 'string' }, format: { type: 'string' }, server: { type: 'string' }, 'include-notes': { type: 'boolean' }, terms: { type: 'string' }, mode: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, json: { type: 'string' }, 'json-file': { type: 'string' }, from: { type: 'string' }, dataset: { type: 'string' },
    where: { type: 'string' }, 'where-file': { type: 'string' }, select: { type: 'string' }, 'row-number': { type: 'string' }, 'sort-by': { type: 'string' }, sort: { type: 'string' }, derive: { type: 'string' }, order: { type: 'string' }, limit: { type: 'string' }, offset: { type: 'string' },
    'group-by': { type: 'string' }, metrics: { type: 'string' }, bucket: { type: 'string' }, left: { type: 'string' }, right: { type: 'string' }, 'left-on': { type: 'string' }, 'right-on': { type: 'string' }, how: { type: 'string' },
    purpose: { type: 'string' }, type: { type: 'string' }, x: { type: 'string' }, y: { type: 'string' }, 'color-by': { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
    pick: { type: 'string' }, 'row-notes': { type: 'string' }, replace: { type: 'boolean' }, discard: { type: 'string' },
    stage: { type: 'string' }, goal: { type: 'string' }, score: { type: 'string' }, program: { type: 'string' }, colleges: { type: 'string' }, musts: { type: 'string' }, interests: { type: 'string' }, notes: { type: 'string' },
    preset: { type: 'string' }, mentors: { type: 'string' }, college: { type: 'string' }, query: { type: 'string' }, filters: { type: 'string' }, out: { type: 'string' },
  } })
  const command = positionals[0]
  if (values.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    process.stdout.write(JSON.stringify({ name: APP_NAME, version: pkg.version }) + '\n')
    return
  }
  if (!command || values.help) {
    process.stdout.write(help)
    return
  }
  if (command === 'schemas') {
    process.stdout.write(JSON.stringify({ tools: [...toolDefinitions, workbenchToolDefinition, profileToolDefinition] }, null, 2) + '\n')
    return
  }
  for (const flag of ['limit', 'offset']) if (values[flag] !== undefined) requireInteger(flag, values[flag])
  if (values.score !== undefined && values.score.trim() !== '') requireInteger('score', values.score)
  if (values.json !== undefined && values['json-file'] !== undefined) throw new Error('不能同时指定 --json 和 --json-file')
  if (values.where !== undefined && values['where-file'] !== undefined) throw new Error('不能同时指定 --where 和 --where-file')

  const jsonUsesStdin = values.json === '-'
  if (jsonUsesStdin && [values.from, values.left, values.right].includes('-')) {
    throw new Error('不能同时从标准输入读取 --json - 与数据管道（-）')
  }

  let args = {}
  if (values['json-file'] !== undefined) {
    args = readJsonFile(values['json-file'], '--json-file')
  } else if (values.json !== undefined) {
    args = jsonUsesStdin ? await readStdinJson() : JSON.parse(stripBom(values.json))
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('--json 参数必须是 JSON 对象')
  }

  const mapping = { scope: 'scope', action: 'action', 'list-name': 'list_name', name: 'name', note: 'note', status: 'status', format: 'format', 'include-notes': 'include_notes', terms: 'terms', mode: 'mode', from: 'from', dataset: 'dataset', where: 'filters', select: 'select', 'row-number': 'row_number_as', 'sort-by': 'sort_by', sort: 'sort', derive: 'derive', order: 'order', limit: 'limit', offset: 'offset', 'group-by': 'group_by', metrics: 'metrics', bucket: 'bucket', left: 'left', right: 'right', 'left-on': 'left_on', 'right-on': 'right_on', how: 'how', purpose: 'purpose', type: 'type', x: 'x', y: 'y', 'color-by': 'color_by', title: 'title', description: 'description', stage: 'stage', goal: 'goal', score: 'score', program: 'program', colleges: 'colleges', musts: 'musts', interests: 'interests', notes: 'notes' }
  for (const [flag, field] of Object.entries(mapping)) {
    if (values[flag] === undefined) continue
    if (['where', 'metrics', 'bucket', 'sort', 'derive'].includes(flag)) args[field] = JSON.parse(stripBom(values[flag]))
    else if (['select', 'group-by', 'y', 'terms', 'colleges', 'musts'].includes(flag)) args[field] = splitComma(values[flag])
    else if (['limit', 'offset'].includes(flag)) args[field] = Number(values[flag])
    else if (flag === 'score') args[field] = values[flag].trim() === '' ? null : Number(values[flag])
    else if (['stage', 'goal', 'program'].includes(flag)) args[field] = values[flag].trim() === '' ? null : values[flag]
    else args[field] = values[flag]
  }
  if (values['where-file'] !== undefined) {
    args.filters = readJsonFile(values['where-file'], '--where-file')
  }
  if (values.pick !== undefined) args.pick = parsePick(values.pick)
  if (values['row-notes'] !== undefined) args.row_notes = JSON.parse(stripBom(values['row-notes']))
  if (values.replace && args.replace === undefined) args.replace = true
  if (values.discard !== undefined) {
    const ids = splitComma(values.discard)
    args.discard = ids.length === 1 ? ids[0] : ids.join(',')
  }
  if (jsonUsesStdin && [args.from, args.left, args.right].includes('-')) {
    throw new Error('不能同时从标准输入读取 --json - 与数据管道（-）')
  }
  if (command === 'workspace' || command === 'profile') {
    if (command === 'workspace' && args.from === '-') {
      const input = await readStdinJson()
      if (!Array.isArray(input.rows) || input.total > input.rows.length) throw new Error('请传入包含完整rows的导师查询结果，避免把分页样本当成全部')
      args.mentors = input.rows.map(row => ({ name: row.name || row.mentor_name, college: row.college })); delete args.from
    }
    const base = values.server || process.env.MENTOR_SERVER_URL || 'http://127.0.0.1:' + (process.env.PORT || 3210)
    let response
    try {
      response = await fetch(new URL('/api/tools/' + command, base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
    } catch (error) {
      if (error?.code === 'ECONNREFUSED' || error?.cause?.code === 'ECONNREFUSED' || /ECONNREFUSED|fetch failed/i.test(error?.message || ''))
        throw new Error('无法连接北极星本地服务（' + base + '），请先运行 npm start 启动服务')
      throw error
    }
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || (command === 'profile' ? '画像请求失败' : '工作台请求失败'))
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  if (['search', 'query', 'join', 'aggregate'].includes(command)) args.limit ??= 5000
  const data = loadData()
  if (data?.metadata?.vault_locked) {
    throw new Error('导师加密数据库处于锁定状态：请检查或移除无效的 MENTOR_VAULT_KEY / POLARIS_FORCE_LOCK（默认内置解密可开箱读取）')
  }
  if (command === 'export') {
    const format = String(values.format || args.format || 'xlsx').toLowerCase().trim()
    if (format === 'ppt' || format === 'pptx') {
      throw new Error('暂不支持导出 PPT/PPTX 格式，请选择 xlsx、pdf、docx、md、html 或 csv')
    }
    const insightState = buildInsights(data)
    const preset = values.preset || args.preset
    const exportMode = values.mode || args.mode || 'list'
    const rawNames = values.mentors ? splitComma(values.mentors) : (Array.isArray(args.mentors) ? args.mentors.map(m => typeof m === 'string' ? m : m?.name).filter(Boolean) : [])
    const colleges = values.college ? splitComma(values.college) : (values.colleges ? splitComma(values.colleges) : (Array.isArray(args.colleges) ? args.colleges : []))
    const queryStr = values.query ?? args.query ?? ''
    const filterIds = values.filters ? splitComma(values.filters) : (Array.isArray(args.filters) ? args.filters : [])

    let rows = []
    if (args.from === '-') {
      const piped = await readStdinJson()
      rows = Array.isArray(piped?.rows) ? piped.rows : Array.isArray(piped) ? piped : []
    } else if (preset) {
      const resolved = resolvePresetFilter(preset, { allMentors: insightState.list, query: queryStr, colleges, extraFilters: filterIds })
      rows = resolved.mentors
    } else if (rawNames.length) {
      rows = rawNames.flatMap(name => insightState.list.filter(m => m.name === name && (!colleges.length || colleges.some(c => m.college?.includes(c)))))
    } else {
      const resolved = resolvePresetFilter('all', { allMentors: insightState.list, query: queryStr, colleges, extraFilters: filterIds })
      rows = resolved.mentors
    }
    if (!rows.length) throw new Error('没有符合条件的导师可导出')

    const collectSources = list => {
      const ids = new Set(list.flatMap(r => r?.source_ids || []))
      return (data.sources || []).filter(s => ids.has(s.id)).map(publicSource)
    }

    let doc
    if (exportMode === 'dossier') {
      const target = insightState.byKey.get(rows[0].key) || insightState.list.find(m => m.name === rows[0].name) || rows[0]
      doc = buildDossierDocument({ insight: target, detail: { ...target, sources: collectSources([target]) }, fieldOptions: mentorComparisonFields })
    } else if (exportMode === 'comparison') {
      doc = buildComparisonDocument({ rows, insights: insightState, fields: mentorComparisonFields.map(f => f.key), title: values.title || args.title || '导师对比分析报告' })
    } else {
      const title = values.title || args.title || (preset ? resolvePresetFilter(preset, { allMentors: [] }).title : '北极星导师清单')
      doc = buildFromMentors({ rows, insights: insightState, title, sources: collectSources(rows) })
    }
    const result = await exportDocument(doc, format, { filename: values.name || args.name || values.title || args.title })
    const outPath = path.resolve(values.out || args.out || result.filename)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, result.body, Buffer.isBuffer(result.body) ? undefined : 'utf8')
    const bytes = Buffer.isBuffer(result.body) ? result.body.length : Buffer.byteLength(String(result.body), 'utf8')
    process.stdout.write(JSON.stringify({ ok: true, path: outPath, filename: result.filename, format: result.extension, bytes, count: rows.length }, null, 2) + '\n')
    return
  }
  const runtime = createToolRuntime(data)
  if ([args.from, args.left, args.right].includes('-')) {
    const ref = runtime.acceptInput(await readStdinJson())
    for (const key of ['from', 'left', 'right']) if (args[key] === '-') args[key] = ref
  }
  process.stdout.write(JSON.stringify(runtime.execute(command, args), null, 2) + '\n')
}

try {
  await main()
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error.message }) + '\n')
  process.exitCode = 1
}

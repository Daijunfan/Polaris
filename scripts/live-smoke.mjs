import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { parseArgs } from 'node:util'
import { createApplication } from '../server/index.mjs'
import { createConfig } from '../server/config.js'
import { createStore } from '../server/store.js'
import { discoverModels, chooseModel } from '../server/provider.js'

const { values } = parseArgs({ options: { 'key-file': { type: 'string' }, question: { type: 'string' }, 'data-dir': { type: 'string' } } })
const dir = values['data-dir'] || await fs.mkdtemp(path.join(os.tmpdir(), 'mentor-live-'))
const store = createStore(dir), env = { ...process.env, ...(values['key-file'] ? { MENTOR_API_KEY_FILE: values['key-file'] } : {}) }
const config = createConfig(store, env)
if (!config.effective().apiKey) throw new Error('请设置 MENTOR_API_KEY / MENTOR_API_KEY_FILE，或传入 --key-file；不会自动读取其他软件的凭据')
const details = await discoverModels(config.effective()), models = details.map(m => m.id)
const candidate = config.candidate({ baseUrl: config.effective().baseUrl, model: config.effective().model || chooseModel(models, config.effective().baseUrl) })
config.save(candidate, {}, details)
const app = createApplication({ store, config }), server = http.createServer(app.handler)
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const questions = values.question ? [values.question] : [
  '最好的导师是谁？请给出有依据、有条件的候选比较，并用可视化表格展示。',
  '我初试350分，想就业。结合相近分数的历史拟录取样本，我可以重点了解哪些导师？请解释样本数量并可视化对比，不要给录取保证。',
  '哪个导师给学生的月劳务费最高？请查询原文，比较支付条件，用图表展示，有特殊数字要指出。',
  '哪些是羊导，哪些是牛导？我想管理宽松、能实习。请根据考勤、工作内容和毕业要求比较，用可视化表格，不要只按评分给人贴标签。',
  '2026年进入复试考生的初试平均分和中位分是多少？按专业分组统计样本数，并画初试总分直方图。',
]
const reports = []
try {
  console.log(JSON.stringify({ provider: config.publicConfig().baseUrl, model: candidate.model, availableModels: models, cases: questions.length }))
  for (const question of questions) {
    const created = await fetch(base + '/api/chats', { method: 'POST' }).then(r => r.json()), started = Date.now()
    const response = await fetch(`${base}/api/chats/${created.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: question }) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    // Drain the same stream the real frontend consumes, rather than calling the provider directly.
    const stream = await response.text()
    const chat = await fetch(`${base}/api/chats/${created.id}`).then(r => r.json()), message = store.get(created.id).messages.at(-1)
    const report = { chatId: created.id, question, status: message.status, context: chat.context, durationMs: Date.now() - started, tools: message.tools.map(t => ({ name: t.name, status: t.status, args: t.args, summary: t.summary })), artifacts: message.artifacts.map(a => ({ type: a.type, title: a.title, rows: a.rows.length })), usage: message.usage, answer: message.content, error: message.error }
    reports.push(report)
    console.log(JSON.stringify({ question, status: report.status, durationMs: report.durationMs, tools: report.tools.map(t => t.name), artifacts: report.artifacts, usage: report.usage }))
    report.passed=report.status==='complete'&&stream.includes('event: done')&&report.artifacts.length>0&&report.usage.totalTokens>0
    if(!report.passed)process.exitCode=1
  }
  const evidence = { model: candidate.model, at: new Date().toISOString(), reports, usage: store.usage() }
  if (values['data-dir']) await fs.writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ passed: reports.every(r => r.passed), totalTokens: store.usage().totalTokens, report: values['data-dir'] ? path.join(dir, 'acceptance.json') : '(临时验收目录)' }))
} finally {
  await app.cancelAll(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  if (!values['data-dir']) await fs.rm(dir, { recursive: true, force: true })
}

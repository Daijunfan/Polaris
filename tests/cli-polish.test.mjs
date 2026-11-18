import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {profileToolDefinition, workbenchToolDefinition} from '../server/workbench-tool.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = path.join(root, 'bin', 'mentor.mjs')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const offlineServer = 'http://127.0.0.1:65499'

function run (args) {
  return execFileSync(process.execPath, [cli, ...args], {cwd: root, encoding: 'utf8'})
}
function runFail (args) {
  try {
    run(args)
  } catch (error) {
    return {status: error.status, stdout: error.stdout, stderr: error.stderr}
  }
  assert.fail(`命令应失败：${args.join(' ')}`)
}

test('--version 与 -v 输出版本 JSON 并退出 0', () => {
  for (const flag of ['--version', '-v']) {
    const output = JSON.parse(run([flag]))
    assert.deepEqual(output, {name: '北极星', version: pkg.version})
  }
})

test('--help 说明 profile 与 --version', () => {
  const help = run(['--help'])
  assert.match(help, /profile/)
  assert.match(help, /--version/)
  assert.match(help, /画像/)
})

test('schemas 返回与 /api/tools 一致的 8 个工具', () => {
  const {tools} = JSON.parse(run(['schemas']))
  assert.equal(tools.length, 8)
  assert.deepEqual(tools.map(tool => tool.function.name), ['catalog', 'search', 'query', 'join', 'aggregate', 'visualize', 'workspace', 'profile'])
  assert.deepEqual(tools.find(tool => tool.function.name === 'workspace'), workbenchToolDefinition)
  assert.deepEqual(tools.find(tool => tool.function.name === 'profile'), profileToolDefinition)
})

test('--limit 与 --offset 非法整数时退出 1 并给出中文错误', () => {
  for (const [flag, message] of [['--limit', 'limit 必须是整数'], ['--offset', 'offset 必须是整数']]) {
    const {status, stderr} = runFail(['query', '--from', 'mentors', flag, 'abc'])
    assert.equal(status, 1)
    assert.equal(JSON.parse(stderr).error, message)
  }
})

test('--score 非空时必须为整数，空值可作为 null 传入', () => {
  const {status, stderr} = runFail(['profile', '--action', 'update', '--score', 'abc', '--server', offlineServer])
  assert.equal(status, 1)
  assert.equal(JSON.parse(stderr).error, 'score 必须是整数')
})

test('--pick 按逗号顺序选择真实记录', () => {
  const result = JSON.parse(run([
    'visualize', '--from', 'mentors', '--type', 'table', '--title', '候选',
    '--pick', '付俊松,杨文川', '--select', 'name,college',
  ]))
  assert.deepEqual(result.artifact.rows.map(row => row.name), ['付俊松', '杨文川'])
})

test('--pick 可用 field:value 指定唯一字段', () => {
  const result = JSON.parse(run([
    'visualize', '--from', 'mentors', '--type', 'table', '--title', '候选',
    '--pick', 'mentor_id:mentor-160dd3fadb91', '--select', 'name',
  ]))
  assert.deepEqual(result.artifact.rows.map(row => row.name), ['安达'])
})

test('--row-notes 按 JSON 关联逐行说明', () => {
  const result = JSON.parse(run([
    'visualize', '--from', 'mentors', '--type', 'table', '--title', '候选',
    '--pick', '付俊松,杨文川', '--select', 'name',
    '--row-notes', '{"by":"name","entries":[{"value":"付俊松","text":"本人指导"}]}',
  ]))
  assert.deepEqual(result.artifact.row_notes, ['本人指导', null])
})

test('workspace 连接失败时给出友好的中文提示', () => {
  const {status, stderr} = runFail(['workspace', '--action', 'read', '--server', offlineServer])
  assert.equal(status, 1)
  assert.equal(JSON.parse(stderr).error, `无法连接北极星本地服务（${offlineServer}），请先运行 npm start 启动服务`)
})

test('profile 连接失败时给出友好的中文提示', () => {
  const {status, stderr} = runFail(['profile', '--action', 'read', '--server', offlineServer])
  assert.equal(status, 1)
  assert.equal(JSON.parse(stderr).error, `无法连接北极星本地服务（${offlineServer}），请先运行 npm start 启动服务`)
})

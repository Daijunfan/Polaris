import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { loadData } from '../lib/data.js'
import { createApplication } from '../server/index.mjs'
import { createStore } from '../server/store.js'
import { createConfig } from '../server/config.js'
import { createExportService, exportToolDefinition } from '../server/export.js'
import { startMockProvider } from './mock-provider.mjs'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const cliPath = path.join(root, 'bin', 'mentor.mjs')

test('POST /api/export 与 /api/exports/:id 支持全部预设与场景导出（Excel/PDF/Word/MD）且拒绝 PPT', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-export-api-'))
  const provider = await startMockProvider()
  const store = createStore(dir)
  const data = loadData()
  const app = createApplication({
    data,
    store,
    config: createConfig(store, { MENTOR_API_URL: provider.url, MENTOR_API_KEY: 'test-key', MENTOR_MODEL: 'test-agent' }),
  })
  const server = http.createServer(app.handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  try {
    // Prepare saved library & comparison items
    const findMentor = async name => {
      const r = await fetch(`${base}/api/tools/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'mentors', filters: [{ field: 'name', op: 'eq', value: name }], limit: 1 }),
      })
      return (await r.json()).rows[0]
    }
    const fu = await findMentor('付俊松')
    const yang = await findMentor('杨文川')
    assert.ok(fu && yang)

    await fetch(`${base}/api/workbench/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mentors: [{ name: '付俊松', college: fu.college }, { name: '杨文川', college: yang.college }] }),
    })
    await fetch(`${base}/api/workbench/comparison`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mentors: [{ name: '付俊松', college: fu.college }, { name: '杨文川', college: yang.college }] }),
    })

    // 1. 5-star preset Excel -> verify ZIP signature and Chinese cells readable via ExcelJS
    const fiveStarRes = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'preset', preset: 'five_star', format: 'xlsx' }),
    })
    assert.equal(fiveStarRes.status, 200)
    assert.match(decodeURIComponent(fiveStarRes.headers.get('x-export-filename') || ''), /5星.*\.xlsx$/)
    const xlsxBuf = Buffer.from(await fiveStarRes.arrayBuffer())
    assert.equal(xlsxBuf.subarray(0, 4).toString('hex'), '504b0304')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(xlsxBuf)
    assert.ok(wb.worksheets.length >= 2)
    assert.ok(wb.worksheets[0].getRow(1).values.some(v => String(v).includes('5星')))

    // 2. Dossier PDF -> valid %PDF- header
    const dossierPdfRes = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'dossier', format: 'pdf', name: '付俊松', college: fu.college }),
    })
    assert.equal(dossierPdfRes.status, 200)
    const pdfBuf = Buffer.from(await dossierPdfRes.arrayBuffer())
    assert.equal(pdfBuf.subarray(0, 5).toString('ascii'), '%PDF-')
    assert.ok(pdfBuf.length > 500)

    // 3. Comparison DOCX -> valid PK zip
    const compDocxRes = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'comparison', format: 'docx' }),
    })
    assert.equal(compDocxRes.status, 200)
    const docxBuf = Buffer.from(await compDocxRes.arrayBuffer())
    assert.equal(docxBuf.subarray(0, 4).toString('hex'), '504b0304')

    // 4. Custom Markdown document + Workbench binary export route
    const customMdRes = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'custom', format: 'md', title: '套磁建议清单', content: '## 关键步骤\n\n- 附成绩单与项目简介' }),
    })
    assert.equal(customMdRes.status, 200)
    const mdText = await customMdRes.text()
    assert.match(mdText, /套磁建议清单/)
    assert.match(mdText, /附成绩单与项目简介/)

    const wbXlsxRes = await fetch(`${base}/api/workbench/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'xlsx', scope: 'library' }),
    })
    assert.equal(wbXlsxRes.status, 200)
    const wbXlsx = Buffer.from(await wbXlsxRes.arrayBuffer())
    assert.equal(wbXlsx.subarray(0, 4).toString('hex'), '504b0304')

    // 5. Persistent tool export + GET /api/exports/:id
    const toolRes = await fetch(`${base}/api/tools/export_file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'xlsx', preset: 'zero_risk' }),
    })
    assert.equal(toolRes.status, 200)
    const toolBody = await toolRes.json()
    assert.ok(toolBody.file?.url?.startsWith('/api/exports/'))
    const dlRes = await fetch(`${base}${toolBody.file.url}`)
    assert.equal(dlRes.status, 200)
    assert.equal(Buffer.from(await dlRes.arrayBuffer()).subarray(0, 4).toString('hex'), '504b0304')

    // 6. PPT explicitly rejected cleanly
    const pptRes = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'preset', preset: 'five_star', format: 'ppt' }),
    })
    assert.equal(pptRes.status, 400)
    const pptErr = await pptRes.json()
    assert.match(pptErr.error, /PPT/i)

    // 7. Export tool schema sanity
    assert.equal(exportToolDefinition.function.name, 'export_file')
  } finally {
    await app.cancelAll()
    await new Promise(resolve => server.close(resolve))
    await provider.close()
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('CLI export 支持预设与管道输入输出真实 Excel/Word/Markdown 文件', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-cli-export-'))
  try {
    const outXlsx = path.join(tmpDir, 'five-star.xlsx')
    const outRes = JSON.parse(execFileSync(process.execPath, [
      cliPath, 'export', '--preset', 'five_star', '--format', 'xlsx', '--out', outXlsx,
    ], { cwd: root, encoding: 'utf8' }))
    assert.equal(outRes.ok, true)
    assert.equal(outRes.format, 'xlsx')
    assert.ok(outRes.count > 0)
    const buf = fsSync.readFileSync(outXlsx)
    assert.equal(buf.subarray(0, 4).toString('hex'), '504b0304')

    const queried = execFileSync(process.execPath, [
      cliPath, 'query', '--from', 'mentors', '--where', JSON.stringify([{ field: 'name', op: 'in', value: ['付俊松', '杨文川'] }]),
    ], { cwd: root, encoding: 'utf8' })
    const outDocx = path.join(tmpDir, 'piped.docx')
    const pipeRes = JSON.parse(execFileSync(process.execPath, [
      cliPath, 'export', '--from', '-', '--format', 'docx', '--title', '管道对比文档', '--out', outDocx,
    ], { cwd: root, input: queried, encoding: 'utf8' }))
    assert.equal(pipeRes.ok, true)
    assert.equal(pipeRes.count, 2)
    assert.equal(fsSync.readFileSync(outDocx).subarray(0, 4).toString('hex'), '504b0304')
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

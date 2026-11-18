import {test,expect} from '@playwright/test'
import fs from 'node:fs/promises'

let people

test.beforeEach(async({request})=>{
  people=await Promise.all(['南国顺','王小婕'].map(async name=>(await (await request.get('/api/workbench/directory?q='+encodeURIComponent(name))).json()).rows[0]))
  await request.post('/api/workbench/items',{data:{mentors:people}})
})
async function open(page){
  await page.goto('/')
  await page.getByRole('button',{name:'候选库 · 打开选导师工作台',exact:true}).click()
  await expect(page.getByRole('heading',{name:'我的导师候选',exact:true})).toBeVisible()
}
async function note(page){
  await page.getByRole('button',{name:'南国顺',exact:true}).click()
  return page.getByRole('textbox',{name:'导师备注',exact:true})
}

test('备注在直接返回、Esc关闭和刷新后保留，最终写入本机记录',async({page,request})=>{
  await open(page)
  const first='已比较研究方向，准备联系。'
  await (await note(page)).fill(first)
  await page.getByRole('button',{name:'返回候选',exact:true}).click()
  await expect(await note(page)).toHaveValue(first)
  const second='已约好交流，重点问本人指导与项目参与。'
  await (await noteInput(page)).fill(second)
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'候选库 · 打开选导师工作台',exact:true}).click()
  await expect(await note(page)).toHaveValue(second)
  const third='刷新后继续整理的个人记录。'
  await (await noteInput(page)).fill(third)
  await page.reload()
  await page.getByRole('button',{name:'候选库 · 打开选导师工作台',exact:true}).click()
  await expect(await note(page)).toHaveValue(third)
  await expect.poll(async()=>((await (await request.get('/api/workbench')).json()).items.find(row=>row.name==='南国顺').note)).toBe(third)
})
async function noteInput(page){return page.getByRole('textbox',{name:'导师备注',exact:true})}

test('清单可以移出单个人选且保留收藏与备注，中文联系进度筛选命中实际人选',async({page,request})=>{
  await open(page)
  await page.getByRole('button',{name:'新建清单',exact:true}).click()
  await page.getByRole('textbox',{name:'清单名称',exact:true}).fill('重点联系备选')
  await page.getByRole('button',{name:'保存',exact:true}).click()
  for(const [index,person] of people.entries()){
    await page.getByLabel('将'+person.name+'加入清单').selectOption({label:'重点联系备选'})
    await expect(page.locator('.workspace-list-line').filter({hasText:'重点联系备选'}).locator('button').first()).toContainText(String(index+1))
  }
  await page.getByRole('button',{name:/^重点联系备选/}).click()
  await page.locator('.mentor-tile').filter({hasText:'南国顺'}).getByRole('button',{name:'移出这份清单',exact:true}).click()
  await expect(page.locator('.mentor-tile-name')).toHaveText(['王小婕'])
  const state=await (await request.get('/api/workbench')).json()
  expect(state.items.some(row=>row.name==='南国顺')).toBe(true)
  await page.getByRole('button',{name:/^全部候选/}).click()
  await note(page)
  await page.getByLabel('联系进度',{exact:true}).selectOption('priority')
  await page.getByRole('button',{name:'返回候选',exact:true}).click()
  await page.locator('.analysis-rules>summary').click()
  await page.getByRole('button',{name:'添加条件',exact:true}).click()
  await page.getByLabel('筛选字段 1',{exact:true}).selectOption('status')
  await page.getByLabel('筛选值 1',{exact:true}).selectOption({label:'重点联系'})
  await page.getByRole('button',{name:'应用联动',exact:true}).click()
  await expect(page.locator('.mentor-tile-name')).toHaveText(['南国顺'])
})

test('候选库支持表格与卡片视图切换并导出当前结果',async({page})=>{
  await open(page)
  const library=page.getByRole('dialog',{name:'候选库',exact:true})
  await expect(library).toBeVisible()
  await expect(library.getByRole('button',{name:/对比分析/})).toHaveCount(0)
  await expect(library.getByRole('button',{name:/加入对比/})).toHaveCount(0)

  // 卡片视图 → 表格视图 → 卡片视图
  await expect(page.locator('.mentor-tile-grid')).toBeVisible()
  await expect(page.locator('.mentor-tile')).toHaveCount(2)
  await page.getByRole('button',{name:'候选表格视图',exact:true}).click()
  await expect(page.locator('.result-table')).toBeVisible()
  await expect(page.locator('.result-table')).toContainText('南国顺')
  await expect(page.locator('.result-table')).toContainText('王小婕')
  await expect(page.locator('.mentor-tile')).toHaveCount(0)
  await page.getByRole('button',{name:'候选卡片视图',exact:true}).click()
  await expect(page.locator('.mentor-tile')).toHaveCount(2)

  // 导出当前结果 CSV
  const pending=page.waitForEvent('download')
  await library.getByRole('button',{name:'导出当前结果',exact:true}).click()
  const csv=await fs.readFile(await (await pending).path(),'utf8')
  expect(csv).toContain('南国顺')
  expect(csv).toContain('王小婕')
})
